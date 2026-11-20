import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapOperatingOrganization } from '@/lib/domain/platform/operating-organization';
import { listPriceBookItems } from '@/lib/domain/pricing/price-book';
import { foundBusiness } from '@/tests/support/founding';
import { setAsideOperatingOrganization } from '@/tests/support/operating-organization';

/**
 * Recurring items live in the price book beside one-off items, and GildOps' plans are recurring
 * items of its operating Organization (ADR-057). Moving the plans keeps every price record as it
 * was; a recurring item is never priced as a one-off line; and ownership follows the operating
 * Organization.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Person = { db: SupabaseClient; userId: string; email: string };

let pg: Client;
let restore: () => Promise<void>;
let owner: Person;
let clerk: Person;
let outsider: Person;
let gildops: string;
let business: string;
let otherBusiness: string;
let recurring: string;
let oneOff: string;
let customer: string;
let planId: string;
let priceId: string;
/** Unique per run: plan items move with the operating organization, so a fixed name collides across runs. */
const PLAN_LABEL = `Price book test plan ${randomUUID().slice(0, 8)}`;

async function person(label: string, options: { staff?: boolean } = {}): Promise<Person> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  if (options.staff) await pg.query('insert into public.platform_staff (user_id, name) values ($1, $2)', [created.data.user.id, 'Operator']);
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: created.data.user.id, email };
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  restore = await setAsideOperatingOrganization(pg);

  owner = await person('price-owner', { staff: true });
  outsider = await person('price-outsider');
  business = await foundBusiness({ ownerEmail: owner.email, name: `Subscriptions Co ${randomUUID().slice(0, 8)}`, currency: 'CAD' });
  gildops = await foundBusiness({ ownerEmail: owner.email, name: `GildOps ${randomUUID().slice(0, 8)}`, currency: 'CAD' });
  otherBusiness = await foundBusiness({ ownerEmail: outsider.email, name: `Other ${randomUUID().slice(0, 8)}`, currency: 'CAD' });

  clerk = await person('price-clerk');
  const role = await pg.query<{ id: string }>(
    `insert into public.roles (organization_id, name, capabilities, created_by) values ($1, 'Clerk', array['invoice.issue'], $2) returning id`,
    [business, owner.userId],
  );
  await pg.query('insert into public.memberships (organization_id, user_id, role_id, created_by) values ($1, $2, $3, $4)', [business, clerk.userId, role.rows[0].id, owner.userId]);

  const created = await owner.db.rpc('create_recurring_price_book_item', { p_organization_id: business, p_name: 'Monthly care', p_unit: 'month', p_description: 'Care plan' });
  if (created.error) throw created.error;
  recurring = created.data as string;
  const unit = await owner.db.rpc('create_price_book_item', { p_organization_id: business, p_name: 'Visit', p_unit: 'visit', p_unit_amount_minor: 9000 });
  if (unit.error) throw unit.error;
  oneOff = unit.data as string;
  customer = (await pg.query<{ id: string }>(
    `insert into public.contacts (organization_id, name, contact_type, lifecycle, created_by) values ($1, 'Buyer', 'company', 'customer', $2) returning id`,
    [business, owner.userId],
  )).rows[0].id;

  // A plan with a price recorded before any operating organization exists.
  planId = (await pg.query<{ id: string }>(
    `insert into public.platform_plans (key, kind, label) values ($1, 'plan', $2) returning id`,
    [`pb_${randomUUID().slice(0, 8)}`, PLAN_LABEL],
  )).rows[0].id;
  priceId = (await pg.query<{ id: string }>(
    `insert into public.price_book_item_prices (plan_id, currency, amount_minor, billing_interval, effective_from) values ($1, 'CAD', 4900, 'month', '2026-01-01') returning id`,
    [planId],
  )).rows[0].id;
}, 120_000);

afterAll(async () => {
  try {
    await restore?.();
  } finally {
    await pg.end();
  }
});

describe('recurring items in the price book', () => {
  it('creates a recurring item with no single amount, for a member who sets prices', async () => {
    const { rows } = await pg.query('select pricing_model, unit_amount_minor, currency, description from public.price_book_items where id = $1', [recurring]);
    expect(rows[0]).toEqual({ pricing_model: 'recurring', unit_amount_minor: null, currency: null, description: 'Care plan' });
  });

  it('refuses a member without the pricing permission', async () => {
    const { error } = await clerk.db.rpc('create_recurring_price_book_item', { p_organization_id: business, p_name: 'Sneaky', p_unit: 'month' });
    expect(error?.code).toBe('42501');
  });

  it('lets no client insert a recurring item directly', async () => {
    const { error } = await owner.db.from('price_book_items').insert({ organization_id: business, name: 'Direct', unit: 'month', pricing_model: 'recurring', created_by: owner.userId } as never);
    expect(error).not.toBeNull();
  });

  it('keeps recurring items out of the one-off price list', async () => {
    const ids = (await listPriceBookItems(owner.db, { organizationId: business })).map((item) => item.id);
    expect(ids).toContain(oneOff);
    expect(ids).not.toContain(recurring);
  });

  it('refuses a recurring item on a quote, a direct invoice or a price update, by name', async () => {
    const quote = await owner.db.rpc('build_catalog_proposal', { p_organization_id: business, p_customer_id: customer, p_lines: [{ price_book_item_id: recurring, quantity: 1 }], p_notes: '' });
    expect(quote.error?.message).toMatch(/sold through Subscriptions/);
    const invoice = await owner.db.rpc('issue_direct_invoice', {
      p_organization_id: business, p_customer_id: customer, p_lines: [{ price_book_item_id: recurring, quantity: 1 }],
      p_issued_at: null, p_due_at: null, p_issuance_key: randomUUID(),
    });
    expect(invoice.error?.message).toMatch(/sold through Subscriptions/);
    const update = await owner.db.rpc('update_price_book_item', { p_id: recurring, p_name: 'Monthly care', p_unit: 'month', p_unit_amount_minor: 100 });
    expect(update.error?.message).toMatch(/price history/);
  });

  it('refuses a recurring item as the price of online booking', async () => {
    const type = await pg.query<{ id: string }>(
      `insert into public.work_item_types (organization_id, name, created_by, schedulable) values ($1, 'Visit type', $2, true) returning id`,
      [business, owner.userId],
    );
    await expect(pg.query('update public.work_item_types set booking_price_item_id = $1 where id = $2', [recurring, type.rows[0].id]))
      .rejects.toThrow(/sold through Subscriptions/);
  });

  it('guards Work priced lines with the same rule', async () => {
    const { rows } = await pg.query<{ def: string }>("select pg_get_functiondef('public.add_work_item_priced_line(uuid, uuid, integer)'::regprocedure) as def");
    expect(rows[0].def).toContain('app.require_one_off_items(v_org, array[p_price_book_item_id])');
  });

  it('shows a business’s recurring items only to its own members', async () => {
    const { data } = await outsider.db.from('price_book_items').select('id').eq('id', recurring);
    expect(data).toEqual([]);
  });
});

describe('GildOps’ plans as recurring items of its operating organization', () => {
  it('leaves a plan’s prices unowned while no operating organization exists', async () => {
    const { rows } = await pg.query('select organization_id, item_id from public.price_book_item_prices where id = $1', [priceId]);
    expect(rows[0]).toEqual({ organization_id: null, item_id: null });
  });

  describe('once GildOps is designated', () => {
    beforeAll(async () => {
      await bootstrapOperatingOrganization(owner.db, { organizationId: gildops });
    }, 60_000);

    it('sells every plan through a recurring item of GildOps’ price book', async () => {
      const { rows } = await pg.query<{ unsold: number }>(
        `select count(*)::int as unsold from public.platform_plans p
           left join public.price_book_items i on i.id = p.price_book_item_id
          where i.id is null or i.organization_id <> $1 or i.pricing_model <> 'recurring'`,
        [gildops],
      );
      expect(rows[0].unsold).toBe(0);
    });

    it('keeps the price record itself: same id, amount, currency, interval and start', async () => {
      const { rows } = await pg.query(
        `select pr.id, pr.amount_minor::int as amount, pr.currency, pr.billing_interval, pr.effective_from::date::text as from_date,
                pr.organization_id, pr.item_id = p.price_book_item_id as names_item
           from public.price_book_item_prices pr join public.platform_plans p on p.id = pr.plan_id where pr.id = $1`,
        [priceId],
      );
      expect(rows[0]).toEqual({ id: priceId, amount: 4900, currency: 'CAD', billing_interval: 'month', from_date: '2026-01-01', organization_id: gildops, names_item: true });
    });

    it('names a new plan’s item after the plan and reuses the plan’s id when it can', async () => {
      const { rows } = await pg.query('select i.id, i.name, i.unit, i.sale_status from public.platform_plans p join public.price_book_items i on i.id = p.price_book_item_id where p.id = $1', [planId]);
      expect(rows[0]).toEqual({ id: planId, name: PLAN_LABEL, unit: 'subscription', sale_status: 'active' });
    });

    it('gives a plan created afterwards its item at once', async () => {
      const later = (await pg.query<{ id: string }>(`insert into public.platform_plans (key, kind, label) values ($1, 'addon', 'Later add-on') returning id`, [`pb_${randomUUID().slice(0, 8)}`])).rows[0].id;
      const { rows } = await pg.query('select i.organization_id, i.unit from public.platform_plans p join public.price_book_items i on i.id = p.price_book_item_id where p.id = $1', [later]);
      expect(rows[0]).toEqual({ organization_id: gildops, unit: 'add-on' });
    });

    it('fills a price recorded against the plan with its item, and the reverse', async () => {
      const byPlan = await pg.query(`insert into public.price_book_item_prices (plan_id, currency, amount_minor, billing_interval, effective_from) values ($1, 'CAD', 5900, 'month', '2026-06-01') returning item_id, organization_id`, [planId]);
      expect(byPlan.rows[0]).toEqual({ item_id: planId, organization_id: gildops });
      const byItem = await pg.query(`insert into public.price_book_item_prices (organization_id, item_id, currency, amount_minor, billing_interval, effective_from) values ($1, $2, 'CAD', 6900, 'month', '2026-09-01') returning plan_id`, [gildops, planId]);
      expect(byItem.rows[0]).toEqual({ plan_id: planId });
    });

    it('creates nothing on a second sync', async () => {
      const { rows } = await pg.query<{ changed: number }>('select app.sync_plan_catalog_items() as changed');
      expect(rows[0].changed).toBe(0);
    });

    it('lets any business member read a plan’s list price, as before', async () => {
      const { data } = await outsider.db.from('price_book_item_prices').select('id').eq('id', priceId);
      expect(data).toEqual([{ id: priceId }]);
    });

    it('moves plan items, prices and add-on links with the operating organization', async () => {
      const addon = (await pg.query<{ id: string }>(`insert into public.platform_plans (key, kind, label) values ($1, 'addon', 'Travelling add-on') returning id`, [`pb_${randomUUID().slice(0, 8)}`])).rows[0].id;
      await pg.query('insert into public.price_book_item_addons (plan_id, addon_plan_id) values ($1, $2)', [planId, addon]);
      await pg.query('update public.platform_settings set operating_organization_id = null where singleton');
      await pg.query('update public.platform_settings set operating_organization_id = $1 where singleton', [otherBusiness]);
      const { rows } = await pg.query(
        `select (select organization_id from public.price_book_items where id = $1) as item_org,
                (select organization_id from public.price_book_item_prices where id = $2) as price_org,
                (select organization_id from public.price_book_item_addons where plan_id = $1 and addon_plan_id = $3) as addon_org`,
        [planId, priceId, addon],
      );
      expect(rows[0]).toEqual({ item_org: otherBusiness, price_org: otherBusiness, addon_org: otherBusiness });
      await pg.query('update public.platform_settings set operating_organization_id = null where singleton');
      await pg.query('update public.platform_settings set operating_organization_id = $1 where singleton', [gildops]);
    });
  });
});

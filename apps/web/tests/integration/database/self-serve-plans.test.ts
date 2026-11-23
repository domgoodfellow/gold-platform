import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { publicPlanCatalog } from '@/lib/domain/catalogue/public-catalog';
import { foundBusiness } from '@/tests/support/founding';
import { designateGildOps, grantGildOpsFinance } from '@/tests/support/plans';

/**
 * Buying GildOps without a consultation (owner decision, 2026-11-23). A visitor reads the plans and
 * the list prices in force from GildOps' Finance; a business's billing manager chooses a listed plan
 * for the business they just founded, which records it as a GildOps customer and writes its
 * subscription in GildOps' Finance, where the plan line switches the plan on.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Person = { db: SupabaseClient; userId: string; email: string };

let pg: Client;
let restore: () => Promise<void>;
let operator: { db: SupabaseClient; userId: string };
let gildops: string;
let listedKey: string;
let listedItem: string;
let unlistedKey: string;
let yearlessKey: string;

async function person(label: string): Promise<Person> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: created.data.user.id, email };
}

async function planItem(name: string, listed: boolean): Promise<{ item: string; key: string }> {
  const created = await operator.db.rpc('create_plan_item', { p_organization_id: gildops, p_kind: 'plan', p_name: `${name} ${randomUUID().slice(0, 6)}` });
  if (created.error) throw created.error;
  const item = created.data as string;
  if (listed) {
    await pg.query(`update public.price_book_items set sale_status = 'active' where id = $1`, [item]);
    await pg.query(`update public.platform_plans set sale_status = 'active' where price_book_item_id = $1`, [item]);
  }
  const { rows } = await pg.query<{ key: string }>('select key from public.platform_plans where price_book_item_id = $1', [item]);
  return { item, key: rows[0].key };
}

async function price(item: string, amountMinor: number, input: { interval?: string; from?: number; currency?: string } = {}) {
  const { error } = await operator.db.rpc('record_item_price', {
    p_organization_id: gildops, p_item_id: item, p_currency: input.currency ?? 'CAD', p_amount_minor: amountMinor,
    p_billing_interval: input.interval ?? 'month',
    p_effective_from: new Date(Date.now() - (input.from ?? 400) * 86_400_000).toISOString(), p_note: '',
  });
  if (error) throw error;
}

/** A person who signed up and founded a business of their own, as the create-business form does. */
async function founder(label: string, currency = 'CAD') {
  const owner = await person(label);
  const organizationId = await foundBusiness({ ownerEmail: owner.email, name: `${label} ${randomUUID().slice(0, 6)}`, currency });
  return { owner, organizationId };
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  const designated = await designateGildOps(pg, 'self-serve-gildops');
  restore = designated.restore;
  operator = designated;
  gildops = designated.organizationId;

  const listed = await planItem('Self-serve plan', true);
  listedKey = listed.key;
  listedItem = listed.item;
  // An earlier price, superseded by the one in force: the public list shows only the second.
  await price(listedItem, 3_900, { from: 400 });
  await price(listedItem, 4_900, { from: 30 });
  await price(listedItem, 49_000, { interval: 'year', from: 30 });

  const unlisted = await planItem('Private plan', false);
  unlistedKey = unlisted.key;
  await price(unlisted.item, 9_900);

  const yearless = await planItem('Monthly-only plan', true);
  yearlessKey = yearless.key;
  await price(yearless.item, 2_900);
});

afterAll(async () => {
  try {
    await restore?.();
  } finally {
    await pg.end();
  }
});

describe('the public plan list', () => {
  it('shows a listed plan at the list price in force, and never an unlisted plan', async () => {
    const visitor = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const plans = await publicPlanCatalog(visitor as never);
    const listed = plans.find((plan) => plan.key === listedKey);
    expect(listed?.requiresContactSales).toBe(false);
    expect(listed?.prices).toEqual([
      { currency: 'CAD', amountMinor: 4_900, billingInterval: 'month' },
      { currency: 'CAD', amountMinor: 49_000, billingInterval: 'year' },
    ]);
    expect(plans.some((plan) => plan.key === unlistedKey)).toBe(false);
  });
});

describe('choosing a plan for a new business', () => {
  it('charges in the plan’s own currency, whatever currency the business works in', async () => {
    const euro = await founder('euro', 'EUR');
    const chosen = await euro.owner.db.rpc('choose_platform_plan', { p_organization_id: euro.organizationId, p_plan_key: listedKey });
    expect(chosen.error).toBeNull();
    const { rows: [subscription] } = await pg.query('select currency from public.subscriptions where id = $1', [chosen.data]);
    expect(subscription.currency).toBe('CAD');
    const { rows: [business] } = await pg.query('select currency from public.organizations where id = $1', [euro.organizationId]);
    expect(business.currency).toBe('EUR');
  });

  it('records the business as a GildOps customer, writes its subscription and switches the plan on', async () => {
    const { owner, organizationId } = await founder('chooser');
    const chosen = await owner.db.rpc('choose_platform_plan', { p_organization_id: organizationId, p_plan_key: listedKey, p_billing_interval: 'month' });
    expect(chosen.error).toBeNull();
    const subscriptionId = chosen.data as string;

    const { rows: [subscription] } = await pg.query(
      `select s.organization_id, s.currency, s.billing_interval, s.starts_on = current_date as today, s.created_by,
              r.origin, r.tenant_organization_id, l.item_id, l.role, a.organization_id as entitled, a.plan_kind
         from public.subscriptions s
         join public.client_tenant_relationships r on r.organization_id = s.organization_id and r.customer_id = s.customer_id and r.status = 'active'
         join public.subscription_lines l on l.subscription_id = s.id
         join public.organization_plan_assignments a on a.subscription_line_id = l.id
        where s.id = $1`,
      [subscriptionId],
    );
    expect(subscription).toMatchObject({
      organization_id: gildops, currency: 'CAD', billing_interval: 'month', today: true, created_by: owner.userId,
      origin: 'self_serve', tenant_organization_id: organizationId, item_id: listedItem, role: 'primary',
      entitled: organizationId, plan_kind: 'plan',
    });

    // The line is priced at the list price in force, so GildOps' Finance invoices or Stripe collects it unchanged.
    const { rows: [line] } = await pg.query(
      `select p.amount_minor, p.source from public.subscription_lines l, app.subscription_line_price(l.id) p where l.subscription_id = $1`,
      [subscriptionId],
    );
    expect(line).toMatchObject({ amount_minor: '4900', source: 'list' });
  });

  it('refuses a second plan, an unlisted plan, an interval it is not sold in, and GildOps itself', async () => {
    const { owner, organizationId } = await founder('refused');
    expect((await owner.db.rpc('choose_platform_plan', { p_organization_id: organizationId, p_plan_key: unlistedKey })).error?.code).toBe('GD051');
    expect((await owner.db.rpc('choose_platform_plan', { p_organization_id: organizationId, p_plan_key: yearlessKey, p_billing_interval: 'year' })).error?.code).toBe('GD053');
    expect((await owner.db.rpc('choose_platform_plan', { p_organization_id: organizationId, p_plan_key: yearlessKey })).error).toBeNull();
    expect((await owner.db.rpc('choose_platform_plan', { p_organization_id: organizationId, p_plan_key: listedKey })).error?.code).toBe('GD054');


    expect((await operator.db.rpc('choose_platform_plan', { p_organization_id: gildops, p_plan_key: listedKey })).error?.code).toBe('GD050');
  });

  it('is the business billing manager’s alone: not a member without billing, a stranger or a signed-out visitor', async () => {
    const { owner, organizationId } = await founder('guarded');
    const clerk = await person('guarded-clerk');
    await grantGildOpsFinance(pg, { operatingOrganizationId: organizationId, userId: clerk.userId, capabilities: ['customer.read'], createdBy: owner.userId });
    const stranger = await person('guarded-stranger');
    const visitor = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

    expect((await clerk.db.rpc('choose_platform_plan', { p_organization_id: organizationId, p_plan_key: listedKey })).error?.code).toBe('42501');
    expect((await stranger.db.rpc('choose_platform_plan', { p_organization_id: organizationId, p_plan_key: listedKey })).error?.code).toBe('42501');
    expect((await visitor.rpc('choose_platform_plan', { p_organization_id: organizationId, p_plan_key: listedKey })).error).not.toBeNull();

    const { rows } = await pg.query('select count(*)::int as n from public.client_tenant_relationships where tenant_organization_id = $1', [organizationId]);
    expect(rows[0].n).toBe(0);
  });
});


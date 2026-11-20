import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapOperatingOrganization } from '@/lib/domain/platform/operating-organization';
import { foundBusiness } from '@/tests/support/founding';
import { setAsideOperatingOrganization } from '@/tests/support/operating-organization';

/**
 * GildOps prices its plans in its own Finance (ADR-057). Only members of GildOps' operating
 * organization who set prices may change them; platform authority alone changes nothing; another
 * business sells its own recurring items but cannot reach GildOps' billing provider; Product
 * Registry keeps what a plan switches on under the catalogue permission.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Person = { db: SupabaseClient; userId: string; email: string };

let pg: Client;
let restore: () => Promise<void>;
let operator: Person;
let bookkeeper: Person;
let staffOutsider: Person;
let otherOwner: Person;
let gildops: string;
let other: string;
let planKey: string;
let planItem: string;
let addonItem: string;
let otherItem: string;

async function person(label: string, options: { staff?: string[] } = {}): Promise<Person> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  if (options.staff) {
    await pg.query('insert into public.platform_staff (user_id, name, capabilities) values ($1, $2, $3)', [created.data.user.id, 'Operator', options.staff]);
  }
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: created.data.user.id, email };
}

const ALL_PLATFORM = ['platform.organizations', 'platform.catalogue', 'platform.commercial', 'platform.providers', 'platform.health'];

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  restore = await setAsideOperatingOrganization(pg);

  operator = await person('gildops-operator', { staff: ALL_PLATFORM });
  gildops = await foundBusiness({ ownerEmail: operator.email, name: `GildOps ${randomUUID().slice(0, 8)}`, currency: 'CAD' });
  await bootstrapOperatingOrganization(operator.db, { organizationId: gildops });
  otherOwner = await person('other-owner');
  other = await foundBusiness({ ownerEmail: otherOwner.email, name: `Other ${randomUUID().slice(0, 8)}`, currency: 'CAD' });

  bookkeeper = await person('gildops-bookkeeper');
  const role = await pg.query<{ id: string }>(
    `insert into public.roles (organization_id, name, capabilities, created_by) values ($1, 'Bookkeeper', array['invoice.issue','report.read'], $2) returning id`,
    [gildops, operator.userId],
  );
  await pg.query('insert into public.memberships (organization_id, user_id, role_id, created_by) values ($1, $2, $3, $4)', [gildops, bookkeeper.userId, role.rows[0].id, operator.userId]);
  staffOutsider = await person('staff-outsider', { staff: ALL_PLATFORM });

  planKey = `rec_${randomUUID().slice(0, 8)}`;
  const created = await operator.db.rpc('create_plan', { p_key: planKey, p_kind: 'plan', p_label: 'Dialer test', p_description: '', p_billable: true, p_sale_status: 'active', p_display_order: 0 });
  if (created.error) throw created.error;
  planItem = (await pg.query<{ id: string }>('select price_book_item_id as id from public.platform_plans where key = $1', [planKey])).rows[0].id;
  const addonKey = `rec_${randomUUID().slice(0, 8)}`;
  const addon = await operator.db.rpc('create_plan', { p_key: addonKey, p_kind: 'addon', p_label: 'Extra caller test', p_description: '', p_billable: true, p_sale_status: 'active', p_display_order: 0 });
  if (addon.error) throw addon.error;
  addonItem = (await pg.query<{ id: string }>('select price_book_item_id as id from public.platform_plans where key = $1', [addonKey])).rows[0].id;
  const own = await otherOwner.db.rpc('create_recurring_price_book_item', { p_organization_id: other, p_name: 'Monthly care', p_unit: 'month' });
  if (own.error) throw own.error;
  otherItem = own.data as string;
}, 120_000);

afterAll(async () => {
  try {
    await restore?.();
  } finally {
    await pg.end();
  }
});

const price = (organizationId: string, itemId: string) => ({
  p_organization_id: organizationId, p_item_id: itemId, p_currency: 'CAD', p_amount_minor: 4900, p_billing_interval: 'month',
  p_effective_from: new Date().toISOString(), p_note: '',
});

describe('pricing GildOps’ plan items', () => {
  it('lets a GildOps member who sets prices record one, kept against the plan as well', async () => {
    const { data, error } = await operator.db.rpc('record_item_price', price(gildops, planItem));
    expect(error).toBeNull();
    const { rows } = await pg.query('select organization_id, item_id, plan_id, amount_minor::int as amount, source from public.price_book_item_prices where id = $1', [data]);
    const plan = (await pg.query<{ id: string }>('select id from public.platform_plans where key = $1', [planKey])).rows[0].id;
    expect(rows[0]).toEqual({ organization_id: gildops, item_id: planItem, plan_id: plan, amount: 4900, source: 'finance' });
  });

  it('refuses a GildOps member without the pricing permission', async () => {
    expect((await bookkeeper.db.rpc('record_item_price', price(gildops, planItem))).error?.code).toBe('42501');
  });

  it('refuses platform staff who are not GildOps members, whatever platform permissions they hold', async () => {
    expect((await staffOutsider.db.rpc('record_item_price', price(gildops, planItem))).error?.code).toBe('42501');
  });

  it('refuses another business’s owner, and that owner’s item in GildOps’ name', async () => {
    expect((await otherOwner.db.rpc('record_item_price', price(gildops, planItem))).error?.code).toBe('42501');
    expect((await operator.db.rpc('record_item_price', price(gildops, otherItem))).error?.code).toBe('23503');
  });

  it('offers an add-on with a plan, and refuses a plan as an add-on’s add-on', async () => {
    expect((await operator.db.rpc('set_item_addon', { p_organization_id: gildops, p_item_id: planItem, p_addon_item_id: addonItem, p_attached: true })).error).toBeNull();
    expect((await operator.db.rpc('set_item_addon', { p_organization_id: gildops, p_item_id: addonItem, p_addon_item_id: planItem, p_attached: true })).error?.code).toBe('22023');
  });

  it('renames the plan when its item is renamed in Finance', async () => {
    const { error } = await operator.db.from('price_book_items').update({ name: 'Dialer', description: 'Calls in the browser', sale_status: 'unlisted' }).eq('id', planItem);
    expect(error).toBeNull();
    const { rows } = await pg.query('select label, description, sale_status from public.platform_plans where key = $1', [planKey]);
    expect(rows[0]).toEqual({ label: 'Dialer', description: 'Calls in the browser', sale_status: 'unlisted' });
  });

  it('tells GildOps’ members what the item switches on, and nobody else', async () => {
    await operator.db.rpc('grant_plan_product', { p_plan_id: (await pg.query<{ id: string }>('select id from public.platform_plans where key = $1', [planKey])).rows[0].id, p_product_key: 'comms' });
    const mine = await bookkeeper.db.rpc('price_book_item_switches', { p_organization_id: gildops, p_item_id: planItem });
    expect(mine.data).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'product', label: 'Gild Comms' })]));
    const theirs = await otherOwner.db.rpc('price_book_item_switches', { p_organization_id: gildops, p_item_id: planItem });
    expect(theirs.data).toEqual([]);
  });
});

describe('GildOps’ billing provider and usage prices', () => {
  it('records a checkout price reference for GildOps, and refuses any other seller', async () => {
    const priceId = (await operator.db.rpc('record_item_price', { ...price(gildops, planItem), p_billing_interval: 'year', p_amount_minor: 49000 })).data as string;
    const mine = await operator.db.rpc('record_item_provider_price', { p_organization_id: gildops, p_item_price_id: priceId, p_environment: 'sandbox', p_product_reference: 'prod_test', p_price_reference: `price_${randomUUID().slice(0, 8)}`, p_provider: 'stripe' });
    expect(mine.error).toBeNull();
    const otherPrice = (await otherOwner.db.rpc('record_item_price', price(other, otherItem))).data as string;
    const theirs = await otherOwner.db.rpc('record_item_provider_price', { p_organization_id: other, p_item_price_id: otherPrice, p_environment: 'sandbox', p_product_reference: 'prod_x', p_price_reference: `price_${randomUUID().slice(0, 8)}`, p_provider: 'stripe' });
    expect(theirs.error?.code).toBe('42501');
  });

  it('keeps GildOps’ checkout references from other businesses', async () => {
    const { data } = await otherOwner.db.from('price_book_item_provider_prices').select('id').eq('organization_id', gildops);
    expect(data).toEqual([]);
  });

  it('records a usage price only on an item that sells a plan', async () => {
    const meter = (await pg.query<{ id: string }>('select id from public.platform_meters order by id limit 1')).rows[0].id;
    const onPlan = await operator.db.rpc('record_item_usage_price', { p_organization_id: gildops, p_item_id: planItem, p_meter_id: meter, p_currency: 'CAD', p_unit_amount_micros: 1_250_000, p_effective_from: new Date().toISOString(), p_note: '' });
    expect(onPlan.error).toBeNull();
    const own = await operator.db.rpc('create_recurring_price_book_item', { p_organization_id: gildops, p_name: `Consulting ${randomUUID().slice(0, 6)}`, p_unit: 'month' });
    const offPlan = await operator.db.rpc('record_item_usage_price', { p_organization_id: gildops, p_item_id: own.data, p_meter_id: meter, p_currency: 'CAD', p_unit_amount_micros: 1, p_effective_from: new Date().toISOString(), p_note: '' });
    expect(offPlan.error?.code).toBe('22023');
  });
});

describe('what other businesses read', () => {
  it('shows a plan’s selling item and list prices to any business member, as the public catalogue does', async () => {
    expect((await otherOwner.db.from('price_book_items').select('id').eq('id', planItem)).data).toEqual([{ id: planItem }]);
    expect(((await otherOwner.db.from('price_book_item_prices').select('id').eq('item_id', planItem)).data ?? []).length).toBeGreaterThan(0);
  });

  it('keeps any other recurring item inside its business', async () => {
    const own = (await operator.db.rpc('create_recurring_price_book_item', { p_organization_id: gildops, p_name: `Private ${randomUUID().slice(0, 6)}`, p_unit: 'month' })).data as string;
    expect((await otherOwner.db.from('price_book_items').select('id').eq('id', own)).data).toEqual([]);
    expect((await operator.db.from('price_book_items').select('id').eq('id', otherItem)).data).toEqual([]);
  });
});

describe('Product Registry keeps what a plan switches on', () => {
  it('lets catalogue staff create a plan, whose item appears in GildOps’ Finance', async () => {
    const curator = await person('catalogue-curator', { staff: ['platform.catalogue'] });
    const key = `rec_${randomUUID().slice(0, 8)}`;
    const { error } = await curator.db.rpc('create_plan', { p_key: key, p_kind: 'plan', p_label: 'Curated', p_description: '', p_billable: true, p_sale_status: 'active', p_display_order: 0 });
    expect(error).toBeNull();
    const { rows } = await pg.query('select i.organization_id, i.pricing_model from public.platform_plans p join public.price_book_items i on i.id = p.price_book_item_id where p.key = $1', [key]);
    expect(rows[0]).toEqual({ organization_id: gildops, pricing_model: 'recurring' });
  });

  it('refuses staff with only the commercial permission', async () => {
    const seller = await person('commercial-only', { staff: ['platform.commercial'] });
    const { error } = await seller.db.rpc('create_plan', { p_key: `rec_${randomUUID().slice(0, 8)}`, p_kind: 'plan', p_label: 'Nope', p_description: '', p_billable: true, p_sale_status: 'active', p_display_order: 0 });
    expect(error?.code).toBe('42501');
  });
});

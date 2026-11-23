import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapOperatingOrganization } from '@/lib/domain/platform/operating-organization';
import { foundBusiness } from '@/tests/support/founding';
import { setAsideOperatingOrganization } from '@/tests/support/operating-organization';
import { grantGildOpsFinance } from '@/tests/support/plans';

/**
 * One subscription model (ADR-057, completed 2026-11-22). Any business sells its recurring items to
 * its own customers through the same subscription records, permissions and invoices; GildOps sells
 * its plans exactly that way, and the one GildOps-specific piece is that a plan line provisions the
 * linked business's entitlement. Usage is priced by the plans a business holds — an agreed price on
 * its subscription line, then an add-on's, then the base plan's — and by nothing else. GildOps'
 * billing-provider invoices become ordinary Finance invoices of that subscription, and the buying
 * business reads its own through a buyer-only projection.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const ALL_PLATFORM = ['platform.organizations', 'platform.catalogue', 'platform.providers', 'platform.health'];

type Person = { db: SupabaseClient; userId: string; email: string };

let pg: Client;
let restore: () => Promise<void>;
let operator: Person;
let technician: Person;
let shopOwner: Person;
let shopClerk: Person;
let gildops: string;
let shop: string;
let shopItem: string;
let shopUpgrade: string;
let shopAddon: string;
let shopCustomer: string;
let gildopsCustomerOfShop: string;
let planItem: string;
let planId: string;
let secondPlanItem: string;
let secondPlanId: string;
let addonPlanItem: string;

async function person(label: string, options: { staff?: string[] } = {}): Promise<Person> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  if (options.staff) {
    await pg.query('insert into public.platform_staff (user_id, name, capabilities) values ($1, $2, $3)', [created.data.user.id, label, options.staff]);
  }
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: created.data.user.id, email };
}

async function customer(organizationId: string, name: string, createdBy: string): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `insert into public.contacts (organization_id, name, contact_type, lifecycle, custom, created_by)
     values ($1, $2, 'company', 'customer', '{}'::jsonb, $3) returning id`,
    [organizationId, name, createdBy],
  );
  return rows[0].id;
}

/** GildOps' onboarding link between its customer and the business that customer runs. */
async function linkToBusiness(customerId: string, tenantId: string): Promise<void> {
  await pg.query(
    `insert into public.client_tenant_relationships (organization_id, customer_id, tenant_organization_id, origin, authority_basis, created_by)
     values ($1, $2, $3, 'existing_tenant_link', 'finance-subscriptions.test.ts', $4)`,
    [gildops, customerId, tenantId, operator.userId],
  );
}

async function priced(db: SupabaseClient, organizationId: string, itemId: string, amountMinor: number, interval = 'month') {
  const { error } = await db.rpc('record_item_price', {
    p_organization_id: organizationId, p_item_id: itemId, p_currency: 'CAD', p_amount_minor: amountMinor,
    p_billing_interval: interval, p_effective_from: new Date(Date.now() - 400 * 86_400_000).toISOString(), p_note: '',
  });
  if (error) throw error;
}

function daysFromToday(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

function firstOfMonth(monthsAgo: number): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1)).toISOString().slice(0, 10);
}

/** A business GildOps sells a plan to: a GildOps customer linked to it and a subscription for the plan item. */
async function sellPlan(label: string, input: { startsOn?: string; agreedAmountMinor?: number | null } = {}) {
  const owner = await person(`${label}-owner`);
  const tenant = await foundBusiness({ ownerEmail: owner.email, name: `${label} ${randomUUID().slice(0, 6)}`, currency: 'CAD' });
  const customerId = await customer(gildops, `${label} customer`, operator.userId);
  await linkToBusiness(customerId, tenant);
  const created = await operator.db.rpc('create_subscription', {
    p_organization_id: gildops, p_customer_id: customerId, p_item_id: planItem, p_currency: 'CAD', p_billing_interval: 'month',
    p_starts_on: input.startsOn ?? firstOfMonth(1), p_agreed_amount_minor: input.agreedAmountMinor ?? null,
  });
  if (created.error) throw created.error;
  return { owner, tenant, customerId, subscriptionId: created.data as string };
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  restore = await setAsideOperatingOrganization(pg);

  operator = await person('subscriptions-operator', { staff: ALL_PLATFORM });
  gildops = await foundBusiness({ ownerEmail: operator.email, name: `GildOps ${randomUUID().slice(0, 8)}`, currency: 'CAD' });
  await bootstrapOperatingOrganization(operator.db, { organizationId: gildops });
  technician = await person('subscriptions-technician', { staff: ALL_PLATFORM });
  await grantGildOpsFinance(pg, { operatingOrganizationId: gildops, userId: technician.userId, capabilities: ['customer.read'], createdBy: operator.userId });

  shopOwner = await person('shop-owner');
  shop = await foundBusiness({ ownerEmail: shopOwner.email, name: `Shop ${randomUUID().slice(0, 8)}`, currency: 'CAD' });
  shopClerk = await person('shop-clerk');
  await grantGildOpsFinance(pg, { operatingOrganizationId: shop, userId: shopClerk.userId, capabilities: ['customer.read', 'subscription.read'], createdBy: shopOwner.userId });

  for (const [name, assign] of [['Monthly care', (id: string) => { shopItem = id; }], ['Premium care', (id: string) => { shopUpgrade = id; }], ['Extra visit', (id: string) => { shopAddon = id; }]] as const) {
    const created = await shopOwner.db.rpc('create_recurring_price_book_item', { p_organization_id: shop, p_name: name, p_unit: 'month', p_description: '' });
    if (created.error) throw created.error;
    assign(created.data as string);
  }
  await priced(shopOwner.db, shop, shopItem, 4_900);
  await priced(shopOwner.db, shop, shopUpgrade, 7_900);
  await priced(shopOwner.db, shop, shopAddon, 1_500);
  const attached = await shopOwner.db.rpc('set_item_addon', { p_organization_id: shop, p_item_id: shopItem, p_addon_item_id: shopAddon, p_attached: true, p_included_by_default: false });
  if (attached.error) throw attached.error;
  shopCustomer = await customer(shop, 'Greenleaf Dental', shopOwner.userId);
  gildopsCustomerOfShop = await customer(gildops, 'Somebody else’s customer', operator.userId);

  for (const [kind, name, assign] of [['plan', 'Subscriptions plan', (id: string) => { planItem = id; }], ['plan', 'Subscriptions plan two', (id: string) => { secondPlanItem = id; }], ['addon', 'Subscriptions add-on', (id: string) => { addonPlanItem = id; }]] as const) {
    const created = await operator.db.rpc('create_plan_item', { p_organization_id: gildops, p_kind: kind, p_name: `${name} ${randomUUID().slice(0, 6)}` });
    if (created.error) throw created.error;
    assign(created.data as string);
  }
  await priced(operator.db, gildops, planItem, 10_000);
  await priced(operator.db, gildops, secondPlanItem, 20_000);
  await priced(operator.db, gildops, addonPlanItem, 2_500);
  const addon = await operator.db.rpc('set_item_addon', { p_organization_id: gildops, p_item_id: planItem, p_addon_item_id: addonPlanItem, p_attached: true, p_included_by_default: false });
  if (addon.error) throw addon.error;
  planId = (await pg.query<{ id: string }>('select id from public.platform_plans where price_book_item_id = $1', [planItem])).rows[0].id;
  secondPlanId = (await pg.query<{ id: string }>('select id from public.platform_plans where price_book_item_id = $1', [secondPlanItem])).rows[0].id;
}, 180_000);

afterAll(async () => {
  try {
    await restore?.();
  } finally {
    await pg.end();
  }
});

describe('a business sells its own recurring items', () => {
  let subscriptionId: string;

  it('subscribes one of its customers at the list price, in its own currency and interval', async () => {
    const { data, error } = await shopOwner.db.rpc('create_subscription', {
      p_organization_id: shop, p_customer_id: shopCustomer, p_item_id: shopItem, p_currency: 'CAD', p_billing_interval: 'month',
      p_starts_on: firstOfMonth(2), p_note: 'signed in person',
    });
    expect(error).toBeNull();
    subscriptionId = data as string;
    const prices = await shopOwner.db.rpc('subscription_line_prices', { p_subscription_id: subscriptionId });
    expect(prices.error).toBeNull();
    expect(prices.data).toEqual([expect.objectContaining({ amount_minor: 4_900, currency: 'CAD', billing_interval: 'month', source: 'list' })]);
    const { rows } = await pg.query('select collection, customer_id from public.subscriptions where id = $1', [subscriptionId]);
    expect(rows[0]).toEqual({ collection: 'manual', customer_id: shopCustomer });
  });

  it('keeps it inside the business: another business, and a member without the permission, can neither read nor change it', async () => {
    const otherOwner = await person('other-owner');
    const other = await foundBusiness({ ownerEmail: otherOwner.email, name: `Other ${randomUUID().slice(0, 6)}`, currency: 'CAD' });
    expect((await otherOwner.db.from('subscriptions').select('id').eq('id', subscriptionId)).data).toEqual([]);
    expect((await otherOwner.db.rpc('cancel_subscription', { p_subscription_id: subscriptionId, p_ends_on: daysFromToday(30) })).error?.code).toBe('42501');
    expect((await otherOwner.db.rpc('create_subscription', {
      p_organization_id: other, p_customer_id: shopCustomer, p_item_id: shopItem, p_currency: 'CAD', p_billing_interval: 'month', p_starts_on: daysFromToday(0),
    })).error?.code).toBe('23503');
    expect((await shopOwner.db.rpc('create_subscription', {
      p_organization_id: shop, p_customer_id: gildopsCustomerOfShop, p_item_id: shopItem, p_currency: 'CAD', p_billing_interval: 'month', p_starts_on: daysFromToday(0),
    })).error?.code).toBe('GD011');
    // The clerk reads subscriptions but may not change them.
    expect((await shopClerk.db.from('subscriptions').select('id').eq('id', subscriptionId)).data).toHaveLength(1);
    expect((await shopClerk.db.rpc('set_subscription_price', { p_line_id: (await primaryLine(subscriptionId)), p_amount_minor: 1 })).error?.code).toBe('42501');
  });

  it('agrees a price for a line from now, and returns it to the list price', async () => {
    const line = await primaryLine(subscriptionId);
    expect((await shopOwner.db.rpc('set_subscription_price', { p_line_id: line, p_amount_minor: 3_900 })).error).toBeNull();
    expect((await shopOwner.db.rpc('subscription_line_prices', { p_subscription_id: subscriptionId })).data).toEqual([expect.objectContaining({ amount_minor: 3_900, source: 'agreed' })]);
    expect((await shopOwner.db.rpc('set_subscription_price', { p_line_id: line, p_amount_minor: 3_500, p_effective_from: new Date(Date.now() - 86_400_000).toISOString() })).error?.code).toBe('22023');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await shopOwner.db.rpc('set_subscription_price', { p_line_id: line, p_amount_minor: null })).error).toBeNull();
    expect((await shopOwner.db.rpc('subscription_line_prices', { p_subscription_id: subscriptionId })).data).toEqual([expect.objectContaining({ amount_minor: 4_900, source: 'list' })]);
    const history = await pg.query('select amount_minor::int as amount, effective_to is not null as ended from public.subscription_agreed_prices where line_id = $1', [line]);
    expect(history.rows).toEqual([{ amount: 3_900, ended: true }]);
  });

  it('adds only an add-on of what it is for, and ends it on its own', async () => {
    expect((await shopOwner.db.rpc('add_subscription_addon', { p_subscription_id: subscriptionId, p_item_id: shopUpgrade, p_starts_on: daysFromToday(0) })).error?.code).toBe('GD043');
    const added = await shopOwner.db.rpc('add_subscription_addon', { p_subscription_id: subscriptionId, p_item_id: shopAddon, p_starts_on: firstOfMonth(2) });
    expect(added.error).toBeNull();
    expect((await shopOwner.db.rpc('add_subscription_addon', { p_subscription_id: subscriptionId, p_item_id: shopAddon, p_starts_on: firstOfMonth(1) })).error?.code).toBe('23P01');
    expect((await shopOwner.db.rpc('end_subscription_addon', { p_line_id: await primaryLine(subscriptionId), p_ends_on: daysFromToday(10) })).error?.code).toBe('GD045');
    expect((await shopOwner.db.rpc('end_subscription_addon', { p_line_id: added.data, p_ends_on: daysFromToday(10) })).error).toBeNull();
  });

  it('invoices each period once, at the prices in force when it starts, and not before it starts', async () => {
    const key = randomUUID();
    const first = await shopOwner.db.rpc('issue_subscription_invoice', { p_subscription_id: subscriptionId, p_due_at: null, p_issuance_key: key });
    expect(first.error).toBeNull();
    expect((await shopOwner.db.rpc('issue_subscription_invoice', { p_subscription_id: subscriptionId, p_due_at: null, p_issuance_key: key })).data).toBe(first.data);
    const invoice = await pg.query(
      `select i.source, i.subscription_id, i.period_start::text, i.period_end::text, i.customer_id, r.total_minor::int as total, r.settled
         from public.invoices i join public.finance_invoice_records r on r.id = i.id where i.id = $1`,
      [first.data],
    );
    expect(invoice.rows[0]).toEqual({
      source: 'subscription', subscription_id: subscriptionId, period_start: firstOfMonth(2), period_end: firstOfMonth(1),
      customer_id: shopCustomer, total: 4_900 + 1_500, settled: false,
    });
    const second = await shopOwner.db.rpc('issue_subscription_invoice', { p_subscription_id: subscriptionId, p_due_at: null, p_issuance_key: randomUUID() });
    expect(second.error).toBeNull();
    expect((await pg.query('select period_start::text from public.invoices where id = $1', [second.data])).rows[0].period_start).toBe(firstOfMonth(1));
    const third = await shopOwner.db.rpc('issue_subscription_invoice', { p_subscription_id: subscriptionId, p_due_at: null, p_issuance_key: randomUUID() });
    expect(third.error).toBeNull();
    expect((await shopOwner.db.rpc('issue_subscription_invoice', { p_subscription_id: subscriptionId, p_due_at: null, p_issuance_key: randomUUID() })).error?.code).toBe('GD048');
    expect((await shopClerk.db.rpc('issue_subscription_invoice', { p_subscription_id: subscriptionId, p_due_at: null, p_issuance_key: randomUUID() })).error?.code).toBe('42501');
  });

  it('changes what it is for from a date, keeping the old line as history', async () => {
    const today = daysFromToday(0);
    expect((await shopOwner.db.rpc('change_subscription_item', { p_subscription_id: subscriptionId, p_item_id: shopUpgrade, p_effective_on: today })).error).toBeNull();
    const { rows } = await pg.query<{ item_id: string; ends_on: string | null }>(
      `select item_id, ends_on::text from public.subscription_lines where subscription_id = $1 and role = 'primary' order by starts_on`,
      [subscriptionId],
    );
    expect(rows).toEqual([{ item_id: shopItem, ends_on: today }, { item_id: shopUpgrade, ends_on: null }]);
    expect((await shopOwner.db.rpc('subscription_line_prices', { p_subscription_id: subscriptionId })).data).toEqual(
      expect.arrayContaining([expect.objectContaining({ amount_minor: 7_900, source: 'list' })]),
    );
  });

  it('ends on a date: every line ends with it, and it provisions nothing for a business that sells no plan', async () => {
    const endsOn = daysFromToday(20);
    expect((await shopOwner.db.rpc('cancel_subscription', { p_subscription_id: subscriptionId, p_ends_on: endsOn, p_reason: 'moved away' })).error).toBeNull();
    const lines = await pg.query('select bool_and(ends_on <= $2::date) as all_end from public.subscription_lines where subscription_id = $1', [subscriptionId, endsOn]);
    expect(lines.rows[0].all_end).toBe(true);
    const entitlements = await pg.query(
      `select count(*)::int as n from public.organization_plan_assignments a join public.subscription_lines l on l.id = a.subscription_line_id where l.subscription_id = $1`,
      [subscriptionId],
    );
    expect(entitlements.rows[0].n).toBe(0);
    expect((await shopOwner.db.rpc('cancel_subscription', { p_subscription_id: subscriptionId, p_ends_on: daysFromToday(40) })).error?.code).toBe('22023');
  });

  it('invoices a subscription recorded today for an item priced today, at that price', async () => {
    const created = await shopOwner.db.rpc('create_recurring_price_book_item', { p_organization_id: shop, p_name: `Priced today ${randomUUID().slice(0, 6)}`, p_unit: 'month', p_description: '' });
    expect(created.error).toBeNull();
    expect((await shopOwner.db.rpc('record_item_price', {
      p_organization_id: shop, p_item_id: created.data, p_currency: 'CAD', p_amount_minor: 2_500, p_billing_interval: 'month', p_note: '',
    })).error).toBeNull();
    const subscription = await shopOwner.db.rpc('create_subscription', {
      p_organization_id: shop, p_customer_id: shopCustomer, p_item_id: created.data, p_currency: 'CAD', p_billing_interval: 'month', p_starts_on: daysFromToday(0),
    });
    expect(subscription.error).toBeNull();
    const issued = await shopOwner.db.rpc('issue_subscription_invoice', { p_subscription_id: subscription.data, p_due_at: null, p_issuance_key: randomUUID() });
    expect(issued.error).toBeNull();
    expect((await pg.query('select total_minor::int as total from public.finance_invoice_records where id = $1', [issued.data])).rows[0].total).toBe(2_500);
  });

  it('refuses an item with no list price in the subscription’s terms unless a price is agreed', async () => {
    const yearly = await shopOwner.db.rpc('create_subscription', {
      p_organization_id: shop, p_customer_id: shopCustomer, p_item_id: shopItem, p_currency: 'CAD', p_billing_interval: 'year', p_starts_on: daysFromToday(0),
    });
    expect(yearly.error?.code).toBe('GD042');
    const agreed = await shopOwner.db.rpc('create_subscription', {
      p_organization_id: shop, p_customer_id: shopCustomer, p_item_id: shopItem, p_currency: 'CAD', p_billing_interval: 'year', p_starts_on: daysFromToday(0), p_agreed_amount_minor: 49_000,
    });
    expect(agreed.error).toBeNull();
  });
});

async function primaryLine(subscriptionId: string): Promise<string> {
  const { rows } = await pg.query<{ id: string }>(
    `select id from public.subscription_lines where subscription_id = $1 and role = 'primary' order by starts_on desc limit 1`,
    [subscriptionId],
  );
  return rows[0].id;
}

async function assignments(tenant: string) {
  const { rows } = await pg.query<{ plan_id: string; plan_kind: string; period_start: string; period_end: string; linked: boolean }>(
    `select plan_id, plan_kind, period_start::text, period_end::text, subscription_line_id is not null as linked
       from public.organization_plan_assignments where organization_id = $1 order by period_start, plan_kind desc`,
    [tenant],
  );
  return rows;
}

describe('GildOps sells its plans with the same subscriptions', () => {
  it('provisions a plan line onto the business its customer is linked to, following the line’s dates', async () => {
    const sale = await sellPlan('provisioned');
    expect(await assignments(sale.tenant)).toEqual([{ plan_id: planId, plan_kind: 'plan', period_start: firstOfMonth(1), period_end: '9999-12-31', linked: true }]);
    const today = daysFromToday(0);
    expect((await operator.db.rpc('change_subscription_item', { p_subscription_id: sale.subscriptionId, p_item_id: secondPlanItem, p_effective_on: today })).error).toBeNull();
    expect(await assignments(sale.tenant)).toEqual([
      { plan_id: planId, plan_kind: 'plan', period_start: firstOfMonth(1), period_end: today, linked: true },
      { plan_id: secondPlanId, plan_kind: 'plan', period_start: today, period_end: '9999-12-31', linked: true },
    ]);
    const endsOn = daysFromToday(15);
    expect((await operator.db.rpc('cancel_subscription', { p_subscription_id: sale.subscriptionId, p_ends_on: endsOn })).error).toBeNull();
    expect((await assignments(sale.tenant)).at(-1)?.period_end).toBe(endsOn);
  });

  it('provisions when the customer is linked to its business after subscribing', async () => {
    const owner = await person('late-link-owner');
    const tenant = await foundBusiness({ ownerEmail: owner.email, name: `Late ${randomUUID().slice(0, 6)}`, currency: 'CAD' });
    const customerId = await customer(gildops, 'Late link', operator.userId);
    const created = await operator.db.rpc('create_subscription', {
      p_organization_id: gildops, p_customer_id: customerId, p_item_id: planItem, p_currency: 'CAD', p_billing_interval: 'month', p_starts_on: daysFromToday(0),
    });
    expect(created.error).toBeNull();
    expect(await assignments(tenant)).toEqual([]);
    await linkToBusiness(customerId, tenant);
    expect(await assignments(tenant)).toEqual([expect.objectContaining({ plan_id: planId, linked: true })]);
  });

  it('prices the business’s plan by its subscription: the agreed price, else the list price', async () => {
    const sale = await sellPlan('agreed', { agreedAmountMinor: 7_500 });
    const read = (db: SupabaseClient) => db.rpc('organization_plan_price', { p_organization_id: sale.tenant, p_plan_id: planId });
    expect((await read(sale.owner.db)).data).toEqual([expect.objectContaining({ amount_minor: 7_500, source: 'agreement' })]);
    expect((await read(operator.db)).data).toEqual([expect.objectContaining({ amount_minor: 7_500, source: 'agreement' })]);
    // Platform authority alone reads no price.
    expect((await read(technician.db)).data).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await operator.db.rpc('set_subscription_price', { p_line_id: await primaryLine(sale.subscriptionId), p_amount_minor: null })).error).toBeNull();
    expect((await read(sale.owner.db)).data).toEqual([expect.objectContaining({ amount_minor: 10_000, source: 'standard' })]);
  });

  it('composes the business’s charge from its agreed subscription price', async () => {
    const sale = await sellPlan('composed', { startsOn: firstOfMonth(2), agreedAmountMinor: 8_800 });
    const start = `${firstOfMonth(1)}T00:00:00Z`;
    const end = `${firstOfMonth(0)}T00:00:00Z`;
    await pg.query('select * from app.compose_organization_charges($1, $2::timestamptz, $3::timestamptz, $4)', [sale.tenant, start, end, operator.userId]);
    const { rows } = await pg.query(
      `select amount_minor::int as amount, provenance->>'priceSource' as source from public.organization_charge_components
        where organization_id = $1 and component_type = 'base_plan' and billing_period_start = $2::timestamptz`,
      [sale.tenant, start],
    );
    expect(rows).toEqual([{ amount: 8_800, source: 'agreement' }]);
  });

  it('gives platform authority without Finance permissions no subscription to read or change', async () => {
    const sale = await sellPlan('guarded');
    expect((await technician.db.from('subscriptions').select('id').eq('id', sale.subscriptionId)).data).toEqual([]);
    expect((await technician.db.rpc('create_subscription', {
      p_organization_id: gildops, p_customer_id: sale.customerId, p_item_id: planItem, p_currency: 'CAD', p_billing_interval: 'month', p_starts_on: daysFromToday(0),
    })).error?.code).toBe('42501');
    expect((await technician.db.rpc('cancel_subscription', { p_subscription_id: sale.subscriptionId, p_ends_on: daysFromToday(5) })).error?.code).toBe('42501');
  });

  it('has no door that assigns a plan or agrees a price outside a subscription', async () => {
    const { rows } = await pg.query(
      `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'app') and p.proname in ('record_plan_assignment', 'record_organization_plan_agreement', 'write_plan_agreement', 'resolve_commercial_retail_rate', 'effective_retail_rates', 'retail_rate_at')`,
    );
    expect(rows[0].n).toBe(0);
    expect((await pg.query("select to_regclass('public.organization_plan_agreements') as t")).rows[0].t).toBeNull();
  });
});

describe('usage is priced by the plans a business holds, and nothing else', () => {
  let sale: Awaited<ReturnType<typeof sellPlan>>;
  const at = (days = 0) => new Date(Date.now() + days * 86_400_000).toISOString();
  // Moments are the database's own clock unless a test names one.
  const resolve = async (tenant: string, currency = 'CAD', when: string | null = null) =>
    (await pg.query('select unit_amount_micros::bigint::text as micros, source_scope from app.usage_price_at($1, $2, $3, coalesce($4::timestamptz, now()))', ['sms_segment', currency, tenant, when])).rows;
  const usagePrice = (itemId: string, micros: number, from?: string) => operator.db.rpc('record_item_usage_price', {
    p_organization_id: gildops, p_item_id: itemId, p_meter_id: 'sms_segment', p_currency: 'CAD', p_unit_amount_micros: micros, p_note: '',
    ...(from ? { p_effective_from: from } : {}),
  });

  beforeAll(async () => {
    sale = await sellPlan('metered', { startsOn: firstOfMonth(1) });
  }, 60_000);

  it('uses the base plan item’s usage price, from when it starts, in the business’s currency only', async () => {
    expect((await usagePrice(planItem, 6_000_000)).error).toBeNull();
    expect(await resolve(sale.tenant)).toEqual([{ micros: '6000000', source_scope: 'plan' }]);
    expect((await usagePrice(planItem, 7_000_000, at(2))).error).toBeNull();
    expect(await resolve(sale.tenant)).toEqual([{ micros: '6000000', source_scope: 'plan' }]);
    expect(await resolve(sale.tenant, 'CAD', at(3))).toEqual([{ micros: '7000000', source_scope: 'plan' }]);
    expect(await resolve(sale.tenant, 'EUR')).toEqual([]);
    expect((await usagePrice(planItem, 1, at(-2))).error?.code).toBe('22023');
  });

  it('prefers an add-on’s usage price to the base plan’s, and an agreed one to both', async () => {
    expect((await usagePrice(addonPlanItem, 5_000_000)).error).toBeNull();
    const added = await operator.db.rpc('add_subscription_addon', { p_subscription_id: sale.subscriptionId, p_item_id: addonPlanItem, p_starts_on: daysFromToday(0) });
    expect(added.error).toBeNull();
    expect(await resolve(sale.tenant)).toEqual([{ micros: '5000000', source_scope: 'addon' }]);
    expect((await operator.db.rpc('set_subscription_usage_price', { p_line_id: await primaryLine(sale.subscriptionId), p_meter_id: 'sms_segment', p_unit_amount_micros: 4_000_000 })).error).toBeNull();
    expect(await resolve(sale.tenant)).toEqual([{ micros: '4000000', source_scope: 'agreement' }]);
    expect((await technician.db.rpc('set_subscription_usage_price', { p_line_id: await primaryLine(sale.subscriptionId), p_meter_id: 'sms_segment', p_unit_amount_micros: 1 })).error?.code).toBe('42501');
  });

  it('records usage at that price and the business reads the same price, while a business on no plan is not priced', async () => {
    const { rows } = await pg.query<{ id: string }>(
      `select app.record_usage($1, 'sms_segment', 3, 'twilio', now(), null, null, null, $2, 'finance-subscriptions.test.ts') as id`,
      [sale.tenant, `usage-${randomUUID()}`],
    );
    const usage = await pg.query('select customer_charge_micros::bigint::text as micros, retail_rate_id is not null as priced from public.usage_events where id = $1', [rows[0].id]);
    expect(usage.rows[0]).toEqual({ micros: '12000000', priced: true });
    const own = await sale.owner.db.rpc('effective_usage_prices', { p_currency: 'CAD', p_organization_id: sale.tenant });
    expect(own.data).toEqual(expect.arrayContaining([expect.objectContaining({ meter_id: 'sms_segment', unit_amount_micros: 4_000_000, source_scope: 'agreement' })]));
    expect((await shopOwner.db.rpc('effective_usage_prices', { p_currency: 'CAD', p_organization_id: sale.tenant })).data).toEqual([]);
    expect(await resolve(shop)).toEqual([]);
  });

  it('keeps the retired platform-wide prices only as history usage already names', async () => {
    const { rows } = await pg.query(
      `select count(*)::int as n from public.price_book_item_usage_prices where item_id is null and (effective_to is null or effective_to > now())`,
    );
    expect(rows[0].n).toBe(0);
  });
});

describe('GildOps’ billing-provider invoices are Finance invoices of the subscription', () => {
  let sale: Awaited<ReturnType<typeof sellPlan>>;
  const reference = `cus_${randomUUID().slice(0, 12)}`;
  const apply = async (eventId: string, type: string, invoice: Record<string, unknown>, customerReference = reference) =>
    (await pg.query<{ result: string | null }>(
      `select public.apply_platform_invoice_event($1, $2, $3, $4::jsonb, 'stripe', 'sandbox') as result`,
      [eventId, type, customerReference, JSON.stringify(invoice)],
    )).rows[0].result;
  const stripeInvoice = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, number: `GILD-${id.slice(-4)}`, status: 'open', currency: 'CAD', created: Math.floor(Date.now() / 1000), finalized_at: Math.floor(Date.now() / 1000),
    due_date: null, period_start: Math.floor(Date.now() / 1000) - 86_400, period_end: Math.floor(Date.now() / 1000) + 29 * 86_400,
    hosted_invoice_url: `https://invoice.stripe.com/i/test/${id}`, total: 11_300, tax: 1_300, amount_paid: 0, payment_reference: null,
    lines: [{ description: 'Subscriptions plan', amount: 10_000, quantity: 1 }], refunds: [], event_created: Math.floor(Date.now() / 1000),
    ...overrides,
  });
  const invoiceOf = async (providerReference: string) => (await pg.query(
    `select i.id, i.organization_id, i.subscription_id, i.customer_id, i.source, i.provider_number, i.voided_at is not null as voided,
            r.total_minor::int as total, r.paid_minor::int as paid, r.settled
       from public.invoices i join public.finance_invoice_records r on r.id = i.id
      where i.provider = 'stripe' and i.provider_reference = $1`,
    [providerReference],
  )).rows;

  beforeAll(async () => {
    sale = await sellPlan('invoiced');
    await pg.query(
      `insert into public.platform_billing_customers (organization_id, environment, provider, customer_reference, created_by) values ($1, 'sandbox', 'stripe', $2, $3)`,
      [sale.tenant, reference, operator.userId],
    );
  }, 60_000);

  it('records a finalized invoice once, with the provider’s lines, tax and number, against the business’s subscription', async () => {
    const invoiceId = `in_${randomUUID().slice(0, 10)}`;
    expect(await apply(`evt_${randomUUID()}`, 'invoice.finalized', stripeInvoice(invoiceId))).toBe(sale.tenant);
    const replay = `evt_${randomUUID()}`;
    await apply(replay, 'invoice.finalized', stripeInvoice(invoiceId));
    expect(await apply(replay, 'invoice.finalized', stripeInvoice(invoiceId))).toBeNull();
    const rows = await invoiceOf(invoiceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: gildops, subscription_id: sale.subscriptionId, customer_id: sale.customerId, source: 'subscription',
      provider_number: `GILD-${invoiceId.slice(-4)}`, total: 11_300, paid: 0, settled: false, voided: false,
    });
  });

  it('records the payment once under the provider’s payment id, and a refund against it', async () => {
    const invoiceId = `in_${randomUUID().slice(0, 10)}`;
    const paid = stripeInvoice(invoiceId, { status: 'paid', amount_paid: 11_300, payment_reference: `pi_${randomUUID().slice(0, 8)}` });
    await apply(`evt_${randomUUID()}`, 'invoice.paid', paid);
    await apply(`evt_${randomUUID()}`, 'invoice.paid', paid);
    expect((await invoiceOf(invoiceId))[0]).toMatchObject({ total: 11_300, paid: 11_300, settled: true });
    const refund = { id: invoiceId, currency: 'CAD', status: null, lines: [], refunds: [{ id: `re_${randomUUID().slice(0, 8)}`, amount: 1_300, created: Math.floor(Date.now() / 1000) }] };
    await apply(`evt_${randomUUID()}`, 'charge.refunded', refund);
    await apply(`evt_${randomUUID()}`, 'charge.refunded', refund);
    expect((await invoiceOf(invoiceId))[0]).toMatchObject({ paid: 10_000, settled: false });
  });

  it('marks a voided invoice void, owed by no one', async () => {
    const invoiceId = `in_${randomUUID().slice(0, 10)}`;
    await apply(`evt_${randomUUID()}`, 'invoice.finalized', stripeInvoice(invoiceId));
    await apply(`evt_${randomUUID()}`, 'invoice.voided', stripeInvoice(invoiceId, { status: 'void' }));
    expect((await invoiceOf(invoiceId))[0]).toMatchObject({ voided: true, settled: true });
  });

  it('records nothing for a customer GildOps never provisioned, or a business with no subscription', async () => {
    expect(await apply(`evt_${randomUUID()}`, 'invoice.finalized', stripeInvoice('in_unknown'), 'cus_never_provisioned')).toBeNull();
    const owner = await person('no-subscription-owner');
    const tenant = await foundBusiness({ ownerEmail: owner.email, name: `Unsold ${randomUUID().slice(0, 6)}`, currency: 'CAD' });
    const lone = `cus_${randomUUID().slice(0, 12)}`;
    await pg.query(`insert into public.platform_billing_customers (organization_id, environment, provider, customer_reference, created_by) values ($1, 'sandbox', 'stripe', $2, $3)`, [tenant, lone, operator.userId]);
    const event = `evt_${randomUUID()}`;
    await apply(event, 'invoice.finalized', stripeInvoice(`in_${randomUUID().slice(0, 10)}`), lone);
    expect((await pg.query('select application from public.platform_billing_webhook_events where event_reference = $1', [event])).rows[0].application).toBe('unmatched');
  });

  it('is applied only by the billing webhook’s own role', async () => {
    expect((await operator.db.rpc('apply_platform_invoice_event', {
      p_event_reference: 'evt_forged', p_event_type: 'invoice.paid', p_customer_reference: reference, p_invoice: stripeInvoice('in_forged'),
    })).error).not.toBeNull();
  });

  it('shows the buying business its own invoices, and nothing of GildOps’ records', async () => {
    const mine = await sale.owner.db.rpc('platform_invoices_for_buyer', { p_organization_id: sale.tenant });
    expect(mine.error).toBeNull();
    expect((mine.data ?? []).length).toBeGreaterThanOrEqual(3);
    expect(mine.data?.[0]).toEqual(expect.objectContaining({ currency: 'CAD', pay_url: expect.stringMatching(/^https:\/\/invoice\.stripe\.com\//) }));
    expect(Object.keys(mine.data?.[0] ?? {}).sort()).toEqual(['currency', 'due_at', 'id', 'issued_at', 'number', 'paid_minor', 'pay_url', 'period_end', 'period_start', 'total_minor', 'voided']);
    // The buyer reads none of GildOps' invoice rows themselves.
    expect((await sale.owner.db.from('invoices').select('id').eq('organization_id', gildops)).data).toEqual([]);
    // Another business, and a member of the buyer who does not manage its billing, read nothing.
    expect((await shopOwner.db.rpc('platform_invoices_for_buyer', { p_organization_id: sale.tenant })).data).toEqual([]);
    const viewer = await person('buyer-viewer');
    await grantGildOpsFinance(pg, { operatingOrganizationId: sale.tenant, userId: viewer.userId, capabilities: ['customer.read'], createdBy: sale.owner.userId });
    expect((await viewer.db.rpc('platform_invoices_for_buyer', { p_organization_id: sale.tenant })).data).toEqual([]);
  });
});

describe('the Administration directory opens no tenant’s private records', () => {
  it('gives platform staff who manage businesses none of a tenant’s customers, work or invoices', async () => {
    const tenantCustomer = await customer(shop, 'Private customer', shopOwner.userId);
    for (const staffMember of [operator, technician]) {
      expect((await staffMember.db.from('contacts').select('id').eq('organization_id', shop)).data).toEqual([]);
      expect((await staffMember.db.from('contacts').select('id').eq('id', tenantCustomer)).data).toEqual([]);
      expect((await staffMember.db.from('work_items').select('id').eq('organization_id', shop)).data).toEqual([]);
      expect((await staffMember.db.from('invoices').select('id').eq('organization_id', shop)).data).toEqual([]);
      expect((await staffMember.db.from('subscriptions').select('id').eq('organization_id', shop)).data).toEqual([]);
    }
  });
});

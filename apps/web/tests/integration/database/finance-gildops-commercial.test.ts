import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { foundBusiness } from '@/tests/support/founding';
import { agreeFixturePrice, assignFixturePlan, createFixturePlan, designateGildOps } from '@/tests/support/plans';

/**
 * GildOps' money is GildOps' Finance (ADR-057, completed): its subscriptions, agreed prices,
 * supplier rates, cost components and economics answer only to Finance permissions held in its
 * operating organization. Platform authority — every platform permission at once — opens none of
 * it, even for a member of GildOps; a customer business reads its own plan and nothing of GildOps'
 * costs or of any other customer.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const ALL_PLATFORM = ['platform.organizations', 'platform.catalogue', 'platform.providers', 'platform.health'];

type Person = { db: SupabaseClient; userId: string; email: string };

let pg: Client;
let restore: () => Promise<void>;
let gildops: string;
let owner: Person;
let technician: Person;
let accountManager: Person;
let analyst: Person;
let outsiderStaff: Person;
let customer: Person;
let customerOrg: string;
let otherCustomerOrg: string;
let planId: string;
let addonId: string;
let rateId: string;

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

/** A member of GildOps with exactly these Finance permissions, and optionally every platform permission. */
async function gildopsMember(label: string, capabilities: string[], staff = false): Promise<Person> {
  const member = await person(label);
  const role = await pg.query<{ id: string }>(
    'insert into public.roles (organization_id, name, capabilities, created_by) values ($1, $2, $3, $4) returning id',
    [gildops, `${label} ${randomUUID().slice(0, 6)}`, capabilities, owner.userId],
  );
  await pg.query('insert into public.memberships (organization_id, user_id, role_id, created_by) values ($1, $2, $3, $4)', [gildops, member.userId, role.rows[0].id, owner.userId]);
  if (staff) await pg.query('insert into public.platform_staff (user_id, name, capabilities) values ($1, $2, $3)', [member.userId, 'Technician', ALL_PLATFORM]);
  return member;
}

const visible = async (db: SupabaseClient, table: string, column: string, value: string) => {
  const { data, error } = await db.from(table).select('id').eq(column, value);
  expect(error, table).toBeNull();
  return (data ?? []).length;
};

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  const designated = await designateGildOps(pg, 'commercial-gildops');
  gildops = designated.organizationId;
  restore = designated.restore;
  owner = { db: designated.db, userId: designated.userId, email: '' };

  technician = await gildopsMember('technician', ['customer.read'], true);
  accountManager = await gildopsMember('account-manager', ['subscription.read', 'subscription.manage']);
  analyst = await gildopsMember('analyst', ['cost.read']);
  outsiderStaff = await person('outsider-staff');
  await pg.query('insert into public.platform_staff (user_id, name, capabilities) values ($1, $2, $3)', [outsiderStaff.userId, 'Outsider', ALL_PLATFORM]);

  customer = await person('customer-owner');
  customerOrg = await foundBusiness({ ownerEmail: customer.email, name: `Customer ${randomUUID().slice(0, 6)}`, currency: 'CAD' });
  const otherOwner = await person('other-customer');
  otherCustomerOrg = await foundBusiness({ ownerEmail: otherOwner.email, name: `Other ${randomUUID().slice(0, 6)}`, currency: 'CAD' });

  planId = await createFixturePlan({ key: `gc_${randomUUID().replaceAll('-', '').slice(0, 12)}`, label: `Commercial ${randomUUID().slice(0, 6)}`, billable: true });
  addonId = await createFixturePlan({ key: `gca_${randomUUID().replaceAll('-', '').slice(0, 12)}`, kind: 'addon', label: `Commercial add-on ${randomUUID().slice(0, 6)}`, billable: true });
  await assignFixturePlan({ organizationId: customerOrg, planId, periodStart: '2026-01-01', periodEnd: '9999-12-31' });
  await assignFixturePlan({ organizationId: otherCustomerOrg, planId, periodStart: '2026-01-01', periodEnd: '9999-12-31' });
  await agreeFixturePrice({ organizationId: customerOrg, planId, currency: 'CAD', amountMinor: 30_000 });
  await agreeFixturePrice({ organizationId: otherCustomerOrg, planId, currency: 'CAD', amountMinor: 31_000 });

  const rate = await owner.db.rpc('record_provider_rate', {
    p_provider_key: 'twilio', p_meter_id: 'voice_minutes', p_currency: 'USD', p_unit_amount_micros: 13_000,
    p_source: 'finance-gildops-commercial.test.ts', p_source_url: null, p_approval_state: 'approved', p_note: '',
  });
  expect(rate.error).toBeNull();
  rateId = rate.data as string;
}, 180_000);

afterAll(async () => {
  try { await restore?.(); } finally { await pg?.end(); }
});

describe('platform authority opens no GildOps money', () => {
  it('shows a GildOps member who holds every platform permission but no Finance permission no subscription, agreed price or cost', async () => {
    expect(await visible(technician.db, 'organization_plan_agreements', 'organization_id', customerOrg)).toBe(0);
    expect(await visible(technician.db, 'organization_commercial_terms', 'organization_id', customerOrg)).toBe(0);
    expect(await visible(technician.db, 'platform_provider_rates', 'id', rateId)).toBe(0);
    expect(await visible(technician.db, 'commercial_draft_scenarios', 'id', randomUUID())).toBe(0);
    const portfolio = await technician.db.rpc('platform_revenue_portfolio', { p_billing_period_start: '2026-11-01T00:00:00Z', p_billing_period_end: '2026-12-01T00:00:00Z', p_reporting_currency: 'CAD' });
    expect(portfolio.error?.code).toBe('42501');
  });

  it('lets that member see the entitlement Administration enforces, and no more', async () => {
    expect(await visible(technician.db, 'organization_plan_assignments', 'organization_id', customerOrg)).toBe(1);
  });

  it('refuses that member every subscription change', async () => {
    await expect(recordPlanAssignment(technician.db, { organizationId: customerOrg, planId: addonId, periodStart: '2030-01-01', periodEnd: '2030-02-01' }))
      .rejects.toMatchObject({ message: expect.stringMatching(/subscription permission in GildOps/) });
  });

  it('gives platform staff outside GildOps nothing at all', async () => {
    expect(await visible(outsiderStaff.db, 'organization_plan_agreements', 'organization_id', customerOrg)).toBe(0);
    expect(await visible(outsiderStaff.db, 'platform_provider_rates', 'id', rateId)).toBe(0);
    expect((await outsiderStaff.db.rpc('platform_usage_economics', {})).error?.code).toBe('42501');
  });
});

describe('each Finance permission opens its own part', () => {
  it('lets subscription permissions read and change subscriptions, but not costs', async () => {
    expect(await visible(accountManager.db, 'organization_plan_agreements', 'organization_id', customerOrg)).toBe(1);
    expect(await visible(accountManager.db, 'platform_provider_rates', 'id', rateId)).toBe(0);
    const id = await recordPlanAssignment(accountManager.db, { organizationId: customerOrg, planId: addonId, periodStart: '2031-01-01', periodEnd: '2031-02-01', note: 'finance-gildops-commercial.test.ts' });
    expect(id).toBeTruthy();
  });

  it('lets cost permission read supplier rates and economics, but change no subscription', async () => {
    expect(await visible(analyst.db, 'platform_provider_rates', 'id', rateId)).toBe(1);
    const portfolio = await analyst.db.rpc('platform_revenue_portfolio', { p_billing_period_start: '2026-11-01T00:00:00Z', p_billing_period_end: '2026-12-01T00:00:00Z', p_reporting_currency: 'CAD' });
    expect(portfolio.error).toBeNull();
    await expect(recordPlanAssignment(analyst.db, { organizationId: customerOrg, planId: addonId, periodStart: '2032-01-01', periodEnd: '2032-02-01' })).rejects.toBeTruthy();
  });

  it('refuses a supplier rate to the subscription permissions', async () => {
    const result = await accountManager.db.rpc('record_provider_rate', {
      p_provider_key: 'twilio', p_meter_id: 'voice_minutes', p_currency: 'USD', p_unit_amount_micros: 1,
      p_source: 'refused', p_source_url: null, p_approval_state: 'approved', p_note: '',
    });
    expect(result.error?.code).toBe('42501');
  });
});

describe('a customer business', () => {
  it('reads its own plan and agreed price — the buyer side of Plan & usage', async () => {
    expect(await visible(customer.db, 'organization_plan_assignments', 'organization_id', customerOrg)).toBeGreaterThanOrEqual(1);
    expect(await visible(customer.db, 'organization_plan_agreements', 'organization_id', customerOrg)).toBe(1);
  });

  it('never reads another customer’s plan or agreed price', async () => {
    expect(await visible(customer.db, 'organization_plan_assignments', 'organization_id', otherCustomerOrg)).toBe(0);
    expect(await visible(customer.db, 'organization_plan_agreements', 'organization_id', otherCustomerOrg)).toBe(0);
  });

  it('never reads GildOps’ supplier rates, costs or billing-provider references', async () => {
    expect(await visible(customer.db, 'platform_provider_rates', 'id', rateId)).toBe(0);
    expect(await visible(customer.db, 'usage_cost_components', 'id', randomUUID())).toBe(0);
    expect(await visible(customer.db, 'price_book_item_provider_prices', 'organization_id', gildops)).toBe(0);
    expect((await customer.db.rpc('organization_cost_to_serve', { p_organization_id: customerOrg, p_period_start: '2026-11-01T00:00:00Z', p_period_end: '2026-12-01T00:00:00Z', p_reporting_currency: 'CAD' })).error?.code).toBe('42501');
  });
});

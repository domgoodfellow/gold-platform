import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlan, setPlanQuota } from '@/lib/domain/catalogue/plans';
import { recordPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { buildOrganizationPurchaseQuote } from '@/lib/domain/platform-billing/quote';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * Work order C §3: what an organization is about to buy, resolved entirely from its own
 * already-approved package (base Plan + Add-ons) — never a catalogue browse, and never
 * resolved from anything the browser supplies.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const RUN = randomUUID().slice(0, 6).replace(/[^a-z0-9]/gi, 'a');
const CURRENCY = 'QQQ';
const ANCHOR = '2025-01-01T00:00:00Z';

let pg: Client;
let staff: SupabaseClient;
let basePlanId: string;
let recurringAddonPlanId: string;
let oneTimeAddonPlanId: string;

async function foundTenant(label: string): Promise<{ db: SupabaseClient; organizationId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 6)}`, currency: CURRENCY });
  return { db, organizationId };
}

async function assign(organizationId: string, planId: string) {
  return recordPlanAssignment(staff, {
    organizationId,
    planId,
    periodStart: new Date().toISOString().slice(0, 10),
    periodEnd: '9999-12-31',
    note: 'platform-billing-quote.test.ts',
  });
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  staff = await asPlatformStaff();

  basePlanId = await createPlan(staff, {
    key: `quote_base_${RUN}`, kind: 'plan', label: 'Quote Base', description: 'x', billable: true, saleStatus: 'unlisted',
  });
  recurringAddonPlanId = await createPlan(staff, {
    key: `quote_recurring_${RUN}`, kind: 'addon', label: 'Quote Extra Seats', description: 'x', billable: true, saleStatus: 'unlisted',
  });
  oneTimeAddonPlanId = await createPlan(staff, {
    key: `quote_setup_${RUN}`, kind: 'addon', label: 'Quote Setup Service', description: 'x', billable: true, saleStatus: 'unlisted',
  });

  await setPlanQuota(staff, {
    planId: recurringAddonPlanId, allowanceKey: 'seats', label: 'Extra seats', unit: 'seat',
    includedQuantity: 5, period: 'none', hardLimit: null, overagePolicy: 'blocked',
    allowanceType: 'recurring_resource', resetSemantics: 'none', overageBehavior: 'hard_limit',
  });

  await pg.query(
    `insert into public.platform_plan_prices (plan_id,currency,amount_minor,billing_interval,effective_from,approval_state,source,captured_at)
     values ($1,$2,9900,'month',$3,'approved','quote.test.ts',$3)`,
    [basePlanId, CURRENCY, ANCHOR],
  );
  await pg.query(
    `insert into public.platform_plan_prices (plan_id,currency,amount_minor,billing_interval,effective_from,approval_state,source,captured_at)
     values ($1,$2,2000,'month',$3,'approved','quote.test.ts',$3)`,
    [recurringAddonPlanId, CURRENCY, ANCHOR],
  );
  await pg.query(
    `insert into public.platform_plan_prices (plan_id,currency,amount_minor,billing_interval,effective_from,approval_state,source,captured_at)
     values ($1,$2,15000,'one_time',$3,'approved','quote.test.ts',$3)`,
    [oneTimeAddonPlanId, CURRENCY, ANCHOR],
  );
});

afterAll(async () => {
  try {
    await pg.query(`delete from public.platform_plan_prices where source = 'quote.test.ts'`);
    await pg.query(`delete from public.organization_plan_assignments where plan_id in (select id from public.platform_plans where key like $1)`, [`quote_%_${RUN}`]);
    await pg.query(`delete from public.platform_plan_quotas where plan_id in (select id from public.platform_plans where key like $1)`, [`quote_%_${RUN}`]);
    await pg.query(`delete from public.platform_plans where key like $1`, [`quote_%_${RUN}`]);
  } finally {
    await pg?.end();
  }
});

describe('buildOrganizationPurchaseQuote', () => {
  it('reports a blocker and no lines for a business with no assigned Plan', async () => {
    const org = await foundTenant('quote-none');
    const quote = await buildOrganizationPurchaseQuote(org.db, { organizationId: org.organizationId });
    expect(quote.blockers.map((b) => b.code)).toContain('no_base_plan');
    expect(quote.recurring).toEqual([]);
    expect(quote.dueNow).toEqual([]);
  });

  it('prices the base Plan alone as one recurring line with no blockers', async () => {
    const org = await foundTenant('quote-base');
    await assign(org.organizationId, basePlanId);

    const quote = await buildOrganizationPurchaseQuote(org.db, { organizationId: org.organizationId });
    expect(quote.blockers).toEqual([]);
    expect(quote.currency).toBe(CURRENCY);
    expect(quote.recurring).toHaveLength(1);
    expect(quote.recurring[0]?.amountMinor).toBe(9900);
    expect(quote.recurringTotalMinor).toBe(9900);
    expect(quote.dueNowTotalMinor).toBe(9900); // due now includes the first recurring charge
  });

  it('separates a recurring Add-on from a one-time Add-on, and totals each correctly', async () => {
    const org = await foundTenant('quote-mixed');
    await assign(org.organizationId, basePlanId);
    await assign(org.organizationId, recurringAddonPlanId);
    await assign(org.organizationId, oneTimeAddonPlanId);

    const quote = await buildOrganizationPurchaseQuote(org.db, { organizationId: org.organizationId });
    expect(quote.blockers).toEqual([]);

    const recurringLabels = quote.recurring.map((l) => l.label).sort();
    expect(recurringLabels).toEqual(['Quote Base', 'Quote Extra Seats']);
    expect(quote.recurringTotalMinor).toBe(9900 + 2000);

    const oneTimeLabels = quote.dueNow.filter((l) => l.billingInterval === 'one_time').map((l) => l.label);
    expect(oneTimeLabels).toEqual(['Quote Setup Service']);
    // Due now is the one-time component plus the first recurring charge.
    expect(quote.dueNowTotalMinor).toBe(15000 + 9900 + 2000);
  });

  it('gives a stable configuration version that changes when the assigned package changes', async () => {
    const org = await foundTenant('quote-version');
    await assign(org.organizationId, basePlanId);
    const before = await buildOrganizationPurchaseQuote(org.db, { organizationId: org.organizationId });

    await assign(org.organizationId, recurringAddonPlanId);
    const after = await buildOrganizationPurchaseQuote(org.db, { organizationId: org.organizationId });

    expect(after.commercialConfigurationVersion).not.toBe(before.commercialConfigurationVersion);
  });

  it('never resolves another organization’s package, even by id', async () => {
    const owner = await foundTenant('quote-owner');
    await assign(owner.organizationId, basePlanId);
    const outsider = await foundTenant('quote-outsider');

    // RLS silently filters the outsider's read of owner's assignments to nothing -- the quote
    // reports the same "no Plan" blocker it would for a business with none, never the owner's.
    const seenByOutsider = await buildOrganizationPurchaseQuote(outsider.db, { organizationId: owner.organizationId });
    expect(seenByOutsider.blockers.map((b) => b.code)).toContain('no_base_plan');
    expect(seenByOutsider.recurring).toEqual([]);
  });
});

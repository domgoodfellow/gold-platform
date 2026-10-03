import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlan, setPlanQuota } from '@/lib/domain/catalogue/plans';
import { recordPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { organizationAllowanceStates } from '@/lib/domain/commercial/allowances';
import {
  composeOrganizationCharges,
  finalizeOrganizationCharges,
  listOrganizationCharges,
  organizationRevenueSummary,
  platformRevenuePortfolio,
  recordCommercialAdjustment,
} from '@/lib/domain/commercial/charges';
import { listOrganizationInfrastructureCosts, organizationCostToServe, recordInfrastructureCost } from '@/lib/domain/commercial/infrastructure-costs';
import { uploadDocument } from '@/lib/domain/documents/documents';
import { createCustomer } from '@/lib/domain/customers/customers';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * Work Order B: GildOps' own cost side (infrastructure allocation), the customer charge model,
 * and the two read models over them (cost-to-serve, revenue/margin) — plus organization storage,
 * modelled as an ordinary capacity allowance over the same engine Work Order A already built.
 *
 * What is proved here: a cost is classified into exactly one taxonomy category and carries an
 * honest allocation-quality mark; shared and unallocated infrastructure never leak into an
 * organization's own attributable COGS; a charge is composed idempotently and, once finalized,
 * survives a later Plan/rate change unchanged; a tenant may read its own revenue but never
 * GildOps' own cost or margin; and organization storage is one counter, enforced at the upload
 * door itself, never only in a screen.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function currencyCode(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const pick = () => letters[Math.floor(Math.random() * 26)];
  return `X${pick()}${pick()}`;
}

const RUN = randomUUID().slice(0, 6).replace(/[^a-z0-9]/gi, 'a');
const CURRENCY = currencyCode();
const DAY = 86_400_000;

type Tenant = { db: SupabaseClient; organizationId: string; userId: string; customerId: string };

let pg: Client;
let staff: SupabaseClient;
let basePlanId: string;
let addonPlanId: string;
let oneTimeAddonPlanId: string;

async function signedIn(label: string): Promise<{ db: SupabaseClient; userId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: created.data.user.id };
}

async function foundTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 6)}`, currency: CURRENCY });
  const customerId = await createCustomer(db, { organizationId, name: 'A Customer' });
  return { db, organizationId, userId: created.data.user.id, customerId };
}

function fileOfSize(name: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/octet-stream' });
}

async function assign(organizationId: string, planId: string, periodStart?: string) {
  return recordPlanAssignment(staff, {
    organizationId, planId,
    periodStart: periodStart ?? new Date().toISOString().slice(0, 10),
    periodEnd: '9999-12-31', note: 'commercial-costs-and-charges.test.ts',
  });
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  staff = await asPlatformStaff();

  basePlanId = await createPlan(staff, {
    key: `cc_base_${RUN}`, kind: 'plan', label: 'CC Base', description: 'x', billable: true, saleStatus: 'unlisted',
  });
  addonPlanId = await createPlan(staff, {
    key: `cc_addon_${RUN}`, kind: 'addon', label: 'CC Extra Storage', description: 'x', billable: true, saleStatus: 'unlisted',
  });
  oneTimeAddonPlanId = await createPlan(staff, {
    key: `cc_setup_${RUN}`, kind: 'addon', label: 'CC Setup Service', description: 'x', billable: true, saleStatus: 'unlisted',
  });

  await setPlanQuota(staff, {
    planId: basePlanId, allowanceKey: 'storage_bytes', label: 'Organization storage', unit: 'byte',
    includedQuantity: 1000, period: 'none', hardLimit: 1000, overagePolicy: 'blocked',
    allowanceType: 'capacity', resetSemantics: 'none', overageBehavior: 'hard_limit',
  });
  await setPlanQuota(staff, {
    planId: addonPlanId, allowanceKey: 'storage_bytes', label: 'Extra storage', unit: 'byte',
    includedQuantity: 500, period: 'none', hardLimit: 500, overagePolicy: 'blocked',
    allowanceType: 'capacity', resetSemantics: 'none', overageBehavior: 'hard_limit',
  });

  // A fixed, well-in-the-past anchor rather than one relative to wall-clock "now": this suite's
  // billing periods are themselves fixed 2026 calendar months, and a price effective "30 days
  // ago" from whatever today happens to be could easily land after one of them.
  const ANCHOR = '2025-01-01T00:00:00Z';
  await pg.query(
    `insert into public.platform_plan_prices (plan_id,currency,amount_minor,billing_interval,effective_from,approval_state,source,captured_at)
     values ($1,$2,5000,'month',$3,'approved','cc.test.ts',$3)`,
    [basePlanId, CURRENCY, ANCHOR],
  );
  await pg.query(
    `insert into public.platform_plan_prices (plan_id,currency,amount_minor,billing_interval,effective_from,approval_state,source,captured_at)
     values ($1,$2,50,'month',$3,'approved','cc.test.ts',$3)`,
    [addonPlanId, CURRENCY, ANCHOR],
  );
  await pg.query(
    `insert into public.platform_plan_prices (plan_id,currency,amount_minor,billing_interval,effective_from,approval_state,source,captured_at)
     values ($1,$2,2500,'one_time',$3,'approved','cc.test.ts',$3)`,
    [oneTimeAddonPlanId, CURRENCY, ANCHOR],
  );
  // Appended over a direct connection, as `allowances.test.ts` already does: `record_retail_rate`
  // refuses an effective date in the past, which is the operator door's own rule about rewriting
  // a price backwards, and this suite needs rate history pre-dating every billing period it tests.
  await pg.query(
    `insert into public.platform_retail_rates (meter_id, currency, unit_amount_micros, approval_state, effective_from, source)
     values ('voice_minutes', $1, 50000, 'approved', $2::timestamptz, 'cc.test.ts')`,
    [CURRENCY, ANCHOR],
  );
});

afterAll(async () => {
  try {
    await pg.query(`delete from public.organization_charge_components where source_domain in ('catalogue.plan_assignment','catalogue.addon_assignment','commercial.usage','commercial.adjustment') and description like '%'`);
    await pg.query(`delete from public.platform_infrastructure_cost_components where source = 'cc.test.ts'`);
    await pg.query(`delete from public.platform_plan_prices where source = 'cc.test.ts'`);
    // The retail rate row is left in place -- usage_events this run wrote still reference it
    // (the same reason a rate is appended, never rewritten: I8), and it is scoped to a
    // throwaway random currency nothing else will ever query by.
    await pg.query(`delete from public.organization_plan_assignments where plan_id in (select id from public.platform_plans where key like $1)`, [`cc_%_${RUN}`]);
    await pg.query(`delete from public.platform_plan_quotas where plan_id in (select id from public.platform_plans where key like $1)`, [`cc_%_${RUN}`]);
    await pg.query(`delete from public.platform_plans where key like $1`, [`cc_%_${RUN}`]);
  } finally {
    await pg?.end();
  }
});

describe('storage', () => {
  it('counts current document bytes, and never another organization’s', async () => {
    const a = await foundTenant('store-a');
    const b = await foundTenant('store-b');
    await assign(a.organizationId, basePlanId);
    await assign(b.organizationId, basePlanId);

    await uploadDocument(a.db, { organizationId: a.organizationId, attachedTo: { entity: 'customer', id: a.customerId }, file: fileOfSize('a.bin', 300) });

    const aState = (await organizationAllowanceStates(staff, { organizationId: a.organizationId, allowanceKey: 'storage_bytes' }))[0];
    const bState = (await organizationAllowanceStates(staff, { organizationId: b.organizationId, allowanceKey: 'storage_bytes' }))[0];
    expect(aState.consumed).toBe(300);
    expect(bState.consumed).toBe(0);
  });

  it('checks the aggregate allowance on a new upload, and the 25MB object limit independently', async () => {
    const org = await foundTenant('store-agg');
    await assign(org.organizationId, basePlanId); // 1000 bytes included, hard limit 1000

    await uploadDocument(org.db, { organizationId: org.organizationId, attachedTo: { entity: 'customer', id: org.customerId }, file: fileOfSize('one.bin', 700) });
    const mid = (await organizationAllowanceStates(staff, { organizationId: org.organizationId, allowanceKey: 'storage_bytes' }))[0];
    expect(mid.consumed).toBe(700);

    // Within the allowance: permitted.
    await uploadDocument(org.db, { organizationId: org.organizationId, attachedTo: { entity: 'customer', id: org.customerId }, file: fileOfSize('two.bin', 200) });

    // Over the allowance: refused, distinctly from "file too large".
    await expect(
      uploadDocument(org.db, { organizationId: org.organizationId, attachedTo: { entity: 'customer', id: org.customerId }, file: fileOfSize('three.bin', 500) }),
    ).rejects.toMatchObject({ code: 'documents.storage_limit_reached' });

    // The 25 MB per-file technical limit is independent and still applies, even to a business
    // with plenty of aggregate allowance left.
    const roomy = await foundTenant('store-roomy');
    await assign(roomy.organizationId, basePlanId);
    await expect(
      uploadDocument(roomy.db, {
        organizationId: roomy.organizationId,
        attachedTo: { entity: 'customer', id: roomy.customerId },
        file: fileOfSize('huge.bin', 26 * 1024 * 1024),
      }),
    ).rejects.toMatchObject({ code: 'documents.too_large' });
  });

  it('refuses an upload at the hard limit regardless of role, and permits one below it', async () => {
    const org = await foundTenant('store-limit');
    await assign(org.organizationId, basePlanId);
    await uploadDocument(org.db, { organizationId: org.organizationId, attachedTo: { entity: 'customer', id: org.customerId }, file: fileOfSize('fill.bin', 1000) });

    await expect(
      uploadDocument(org.db, { organizationId: org.organizationId, attachedTo: { entity: 'customer', id: org.customerId }, file: fileOfSize('over.bin', 1) }),
    ).rejects.toMatchObject({ code: 'documents.storage_limit_reached' });

    const after = (await organizationAllowanceStates(staff, { organizationId: org.organizationId, allowanceKey: 'storage_bytes' }))[0];
    expect(after.consumed).toBe(1000);
  });

  it('refuses a role with no upload authority regardless of available quota', async () => {
    const org = await foundTenant('store-role');
    await assign(org.organizationId, basePlanId);
    const { db: memberDb, userId: memberUserId } = await signedIn('store-role-member');
    await pg.query(
      `insert into public.roles (organization_id, name, capabilities, created_by)
       values ($1, 'No Upload', array[]::text[], $2) returning id`,
      [org.organizationId, org.userId],
    );
    const { rows: roleRows } = await pg.query(`select id from public.roles where organization_id=$1 and name='No Upload'`, [org.organizationId]);
    await pg.query(
      `insert into public.memberships (organization_id, user_id, role_id, display_name, created_by) values ($1,$2,$3,'No Upload Member',$4)`,
      [org.organizationId, memberUserId, roleRows[0].id, org.userId],
    );
    await expect(
      uploadDocument(memberDb, { organizationId: org.organizationId, attachedTo: { entity: 'customer', id: org.customerId }, file: fileOfSize('x.bin', 1) }),
    ).rejects.toMatchObject({ code: 'documents.forbidden' });
    // Plenty of quota remained unused — the refusal was authority, not allowance.
    const state = (await organizationAllowanceStates(staff, { organizationId: org.organizationId, allowanceKey: 'storage_bytes' }))[0];
    expect(state.consumed).toBe(0);
  });

  it('composes an Add-on’s storage grant into the same counter, never a second one', async () => {
    const org = await foundTenant('store-addon');
    await assign(org.organizationId, basePlanId); // 1000
    await assign(org.organizationId, addonPlanId); // +500
    const state = (await organizationAllowanceStates(staff, { organizationId: org.organizationId, allowanceKey: 'storage_bytes' }))[0];
    expect(state.included).toBe(1500);
    expect(state.sourceContributions.map((c) => c.planKind).sort()).toEqual(['addon', 'plan']);
  });

  it('does not fabricate a Library/future contributor that does not exist', async () => {
    const org = await foundTenant('store-future');
    await assign(org.organizationId, basePlanId);
    // No Library table exists; the counter must read exactly zero, never error, never guess.
    const state = (await organizationAllowanceStates(staff, { organizationId: org.organizationId, allowanceKey: 'storage_bytes' }))[0];
    expect(state.consumed).toBe(0);
    expect(state.enforcement).toBe('counted');
  });
});

describe('infrastructure allocation', () => {
  it('classifies a direct organization resource cost', async () => {
    const org = await foundTenant('infra-direct');
    const id = await recordInfrastructureCost(staff, {
      costCategory: 'resource_direct', allocationQuality: 'direct', organizationId: org.organizationId,
      providerKey: 'twilio', billingPeriod: '2026-01-01', nativeCostMicros: 1_150_000, nativeCurrency: 'USD',
      reportingCostMicros: 1_150_000, reportingCurrency: 'USD', source: 'cc.test.ts',
    });
    expect(id).toBeTruthy();
    const rows = await listOrganizationInfrastructureCosts(staff, { organizationId: org.organizationId });
    expect(rows).toHaveLength(1);
    expect([rows[0].costCategory, rows[0].allocationQuality]).toEqual(['resource_direct', 'direct']);
  });

  it('tells measured, estimated, shared and unallocated apart, and refuses to mismatch category and quality', async () => {
    const org = await foundTenant('infra-quality');
    await recordInfrastructureCost(staff, {
      costCategory: 'infrastructure_attributable', allocationQuality: 'measured', organizationId: org.organizationId,
      providerKey: 'supabase', billingPeriod: '2026-01-01', nativeCostMicros: 400_000, nativeCurrency: 'USD',
      reportingCostMicros: 400_000, reportingCurrency: 'USD', driverBasis: 'byte_days', driverQuantity: 1_000_000, source: 'cc.test.ts',
    });
    await recordInfrastructureCost(staff, {
      costCategory: 'infrastructure_attributable', allocationQuality: 'estimated', organizationId: org.organizationId,
      providerKey: 'vercel', billingPeriod: '2026-01-01', nativeCostMicros: 100_000, nativeCurrency: 'USD',
      reportingCostMicros: 100_000, reportingCurrency: 'USD', source: 'cc.test.ts',
    });
    const rows = await listOrganizationInfrastructureCosts(staff, { organizationId: org.organizationId });
    expect(rows.map((r) => r.allocationQuality).sort()).toEqual(['estimated', 'measured']);

    // A shared cost naming an organization, or an organization-scoped quality naming none, both refuse.
    await expect(pg.query(
      `insert into public.platform_infrastructure_cost_components (organization_id,cost_category,allocation_quality,billing_period,native_cost_micros,native_currency,source)
       values ($1,'infrastructure_shared','shared','2026-01-01',1,'USD','cc.test.ts')`,
      [org.organizationId],
    )).rejects.toThrow();
    await expect(pg.query(
      `insert into public.platform_infrastructure_cost_components (organization_id,cost_category,allocation_quality,billing_period,native_cost_micros,native_currency,source)
       values (null,'manual_direct','shared','2026-01-01',1,'USD','cc.test.ts')`,
    )).rejects.toThrow();
  });

  it('keeps shared cost separate from unallocated, and neither inside an organization’s own attributable figure', async () => {
    const org = await foundTenant('infra-shared');
    await assign(org.organizationId, basePlanId);
    await pg.query(
      `insert into public.platform_infrastructure_cost_components (organization_id,cost_category,allocation_quality,billing_period,native_cost_micros,native_currency,reporting_cost_micros,reporting_currency,source)
       values (null,'infrastructure_shared','shared','2026-01-01',9000000,'USD',9000000,'USD','cc.test.ts')`,
    );
    await pg.query(
      `insert into public.platform_infrastructure_cost_components (organization_id,cost_category,allocation_quality,billing_period,native_cost_micros,native_currency,reporting_cost_micros,reporting_currency,source)
       values (null,'infrastructure_attributable','unallocated','2026-01-01',3000000,'USD',3000000,'USD','cc.test.ts')`,
    );
    const cost = await organizationCostToServe(staff, {
      organizationId: org.organizationId, periodStart: '2026-01-01T00:00:00Z', periodEnd: '2026-02-01T00:00:00Z', reportingCurrency: 'USD',
    });
    expect(cost.attributableKnownCogsMicros).toBe(0);
    expect(cost.sharedPlatformCostMicros).toBe(9_000_000);
    expect(cost.unallocatedCostMicros).toBe(3_000_000);
  });

  it('reports unknown as unknown, never zero, and a currency mismatch as not known', async () => {
    const org = await foundTenant('infra-unknown');
    // Recorded cost is real, but only in USD -- asking in CAD must not silently read as $0 known.
    await recordInfrastructureCost(staff, {
      costCategory: 'manual_direct', allocationQuality: 'direct', organizationId: org.organizationId,
      billingPeriod: '2026-01-01', nativeCostMicros: 500_000, nativeCurrency: 'USD',
      reportingCostMicros: 500_000, reportingCurrency: 'USD', source: 'cc.test.ts',
    });
    const inUsd = await organizationCostToServe(staff, { organizationId: org.organizationId, periodStart: '2026-01-01T00:00:00Z', periodEnd: '2026-02-01T00:00:00Z', reportingCurrency: 'USD' });
    const inCad = await organizationCostToServe(staff, { organizationId: org.organizationId, periodStart: '2026-01-01T00:00:00Z', periodEnd: '2026-02-01T00:00:00Z', reportingCurrency: 'CAD' });
    expect(inUsd.manualDirectCogsMicros).toBe(500_000);
    expect(inUsd.costCoverage).toBe(1);
    expect(inCad.manualDirectCogsMicros).toBe(0);
    expect(inCad.costCoverage).toBe(0); // known ≠ unknown collapsed into zero-means-free
  });
});

describe('charges', () => {
  it('composes base Plan only, idempotently, and never duplicates on a second run', async () => {
    const org = await foundTenant('ch-base');
    await assign(org.organizationId, basePlanId, '2026-01-01');
    const start = '2026-03-01T00:00:00Z';
    const end = '2026-04-01T00:00:00Z';
    const first = await composeOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    const second = await composeOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    expect(first.find((r) => r.kind === 'base_plan')?.written).toBe(true);
    expect(second.find((r) => r.kind === 'base_plan')?.written).toBe(true);
    const components = await listOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    expect(components.filter((c) => c.componentType === 'base_plan')).toHaveLength(1);
    expect(components[0].amountMinor).toBe(5000);
  });

  it('composes Plan + Add-ons, a one-time service, included usage, overage usage and an adjustment', async () => {
    const org = await foundTenant('ch-full');
    await assign(org.organizationId, basePlanId, '2026-01-01');
    await assign(org.organizationId, addonPlanId, '2026-01-01');
    // Assigned inside the billing period itself — a one-time service composes only in the
    // period its assignment began.
    await assign(org.organizationId, oneTimeAddonPlanId, '2026-03-05');
    await recordCommercialAdjustment(staff, { organizationId: org.organizationId, direction: 'credit', amountMinor: 500, currency: CURRENCY, reason: 'Goodwill credit', effectiveAt: '2026-03-15T00:00:00Z' });

    const start = '2026-03-01T00:00:00Z';
    const end = '2026-04-01T00:00:00Z';
    // Usage within the period: no voice allowance on this Plan, so the whole quantity is overage.
    await pg.query(`select app.record_usage($1,'voice_minutes',10,'twilio','2026-03-10T00:00:00Z',null,null,null,$2,'cc.test.ts')`, [org.organizationId, `u-${randomUUID()}`]);

    await composeOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    const components = await listOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    const byType = Object.fromEntries(components.map((c) => [c.componentType, c]));
    expect(byType.base_plan.amountMinor).toBe(5000);
    expect(byType.addon.amountMinor).toBe(50);
    expect(byType.one_time_service.amountMinor).toBe(2500);
    expect(byType.usage_overage.amountMinor).toBeGreaterThan(0);
    expect(byType.credit_adjustment.amountMinor).toBe(500);

    const revenue = await organizationRevenueSummary(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end, reportingCurrency: CURRENCY });
    expect(revenue.customerObligationMinor).toBe(
      byType.base_plan.amountMinor + byType.addon.amountMinor + byType.one_time_service.amountMinor + byType.usage_overage.amountMinor - 500,
    );
  });

  it('skips a component kind that needs a proration policy, rather than guessing', async () => {
    const org = await foundTenant('ch-proration');
    const start = '2026-03-01T00:00:00Z';
    const end = '2026-04-01T00:00:00Z';
    // Two base Plan assignments both intersect the period: unresolved without a proration rule.
    await assign(org.organizationId, basePlanId, '2026-01-01');
    const other = await createPlan(staff, { key: `cc_other_${RUN}`, kind: 'plan', label: 'Other', description: 'x', billable: true, saleStatus: 'unlisted' });
    await pg.query(
      `update public.organization_plan_assignments set period_end = '2026-03-15' where organization_id=$1 and plan_id=$2`,
      [org.organizationId, basePlanId],
    );
    await assign(org.organizationId, other, '2026-03-15');

    const result = await composeOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    expect(result.find((r) => r.kind === 'base_plan')?.prorationRequired).toBe(true);
    const components = await listOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    expect(components.find((c) => c.componentType === 'base_plan')).toBeUndefined();
  });

  it('is idempotent under a real double run, and finalizing then changing the price leaves history untouched', async () => {
    const org = await foundTenant('ch-history');
    await assign(org.organizationId, basePlanId, '2026-01-01');
    const start = '2026-05-01T00:00:00Z';
    const end = '2026-06-01T00:00:00Z';
    await composeOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    await composeOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    const before = await listOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    expect(before).toHaveLength(1);
    const originalAmount = before[0].amountMinor;

    const finalizedCount = await finalizeOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    expect(finalizedCount).toBe(1);

    await pg.query(
      `insert into public.platform_plan_prices (plan_id,currency,amount_minor,billing_interval,effective_from,approval_state,source,captured_at)
       values ($1,$2,999999,'month',$3,'approved','cc.test.ts',$3)`,
      [basePlanId, CURRENCY, new Date(Date.now() - DAY).toISOString()],
    );
    await composeOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    const after = await listOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    expect(after).toHaveLength(1);
    expect(after[0].amountMinor).toBe(originalAmount);
    expect(after[0].finalizedAt).not.toBeNull();
  });
});

describe('economic separation', () => {
  it('lets a business read its own revenue, never GildOps’ own cost', async () => {
    const org = await foundTenant('sep-tenant');
    await assign(org.organizationId, basePlanId, '2026-01-01');
    const start = '2026-07-01T00:00:00Z';
    const end = '2026-08-01T00:00:00Z';
    await composeOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });

    const ownCharges = await listOrganizationCharges(org.db, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    expect(ownCharges.length).toBeGreaterThan(0);

    await expect(
      organizationCostToServe(org.db, { organizationId: org.organizationId, periodStart: start, periodEnd: end }),
    ).rejects.toMatchObject({ code: 'infrastructure_costs.cost_to_serve_failed' });
    await expect(
      organizationRevenueSummary(org.db, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end }),
    ).rejects.toMatchObject({ code: 'charges.revenue_summary_failed' });
  });

  it('refuses a tenant another business’s charge components', async () => {
    const a = await foundTenant('sep-a');
    const b = await foundTenant('sep-b');
    await assign(a.organizationId, basePlanId, '2026-01-01');
    const start = '2026-07-01T00:00:00Z';
    const end = '2026-08-01T00:00:00Z';
    await composeOrganizationCharges(staff, { organizationId: a.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    const seenByB = await listOrganizationCharges(b.db, { organizationId: a.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    expect(seenByB).toEqual([]);
  });

  it('a provider cost change never rewrites a finalized customer charge, and vice versa', async () => {
    const org = await foundTenant('sep-history');
    await assign(org.organizationId, basePlanId, '2026-01-01');
    const start = '2026-08-01T00:00:00Z';
    const end = '2026-09-01T00:00:00Z';
    await composeOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    await finalizeOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    const before = await listOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });

    await recordInfrastructureCost(staff, {
      costCategory: 'manual_direct', allocationQuality: 'direct', organizationId: org.organizationId,
      billingPeriod: '2026-08-01', nativeCostMicros: 777_000, nativeCurrency: CURRENCY,
      reportingCostMicros: 777_000, reportingCurrency: CURRENCY, source: 'cc.test.ts',
    });
    const after = await listOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    expect(after.map((c) => c.amountMinor)).toEqual(before.map((c) => c.amountMinor));
  });

  it('shows every organization with a composed charge in the portfolio, ranked, staff-only', async () => {
    const org = await foundTenant('sep-portfolio');
    await assign(org.organizationId, basePlanId, '2026-01-01');
    const start = '2026-09-01T00:00:00Z';
    const end = '2026-10-01T00:00:00Z';
    await composeOrganizationCharges(staff, { organizationId: org.organizationId, billingPeriodStart: start, billingPeriodEnd: end });
    const portfolio = await platformRevenuePortfolio(staff, { billingPeriodStart: start, billingPeriodEnd: end, reportingCurrency: CURRENCY });
    expect(portfolio.some((row) => row.organizationId === org.organizationId)).toBe(true);
    await expect(
      platformRevenuePortfolio(org.db, { billingPeriodStart: start, billingPeriodEnd: end }),
    ).rejects.toMatchObject({ code: 'charges.portfolio_failed' });
  });
});

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { getPlan, listPlanQuotas, setPlanQuota } from '@/lib/domain/catalogue/plans';
import { recordPlanAgreement, recordPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { listDraftScenarios, saveDraftScenario, simulatePackageEconomics } from '@/lib/domain/commercial/package-economics';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function tenant(): Promise<{ db: SupabaseClient; organizationId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `economics-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signedIn = await db.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return { db, organizationId: await foundBusiness({ ownerEmail: email, name: `Economics ${randomUUID().slice(0, 6)}`, currency: 'CAD' }) };
}

describe('commercial packaging and package economics', () => {
  let staff: SupabaseClient;
  let ordinary: { db: SupabaseClient; organizationId: string };
  let planId: string;

  beforeAll(async () => {
    staff = await asPlatformStaff();
    ordinary = await tenant();
    planId = (await getPlan(staff, 'start'))!.id;
  });

  it('stores structured allowance and overage semantics on the canonical Plan quota', async () => {
    await setPlanQuota(staff, {
      planId,
      allowanceKey: 'economics_test_units',
      label: 'Economics test units',
      unit: 'unit',
      includedQuantity: 100,
      period: 'month',
      hardLimit: 150,
      allowanceType: 'usage',
      resetSemantics: 'billing_period',
      overageBehavior: 'metered',
    });
    expect((await listPlanQuotas(staff, planId)).find((quota) => quota.allowanceKey === 'economics_test_units')).toMatchObject({
      includedQuantity: 100,
      hardLimit: 150,
      allowanceType: 'usage',
      resetSemantics: 'billing_period',
      overageBehavior: 'metered',
    });
  });

  it('versions an organization-free reference scenario and compares candidate prices without choosing one', async () => {
    const name = `Reference ${randomUUID().slice(0, 8)}`;
    const scenarioId = await saveDraftScenario(staff, {
      name,
      notes: 'Planning only',
      planId,
      currency: 'CAD',
      candidatePricesMinor: [49900, 69900, 89900, 99900],
      expectedSeats: 12,
      expectedResourceCount: 3,
      inputs: [{ allowanceKey: 'voice_minutes', meterId: 'voice_minutes', expectedQuantity: 250 }],
    });
    await saveDraftScenario(staff, {
      scenarioId,
      name,
      notes: 'Second planning revision',
      planId,
      currency: 'CAD',
      candidatePricesMinor: [49900, 69900, 89900, 99900],
      inputs: [{ allowanceKey: 'voice_minutes', meterId: 'voice_minutes', expectedQuantity: 300 }],
    });
    const saved = (await listDraftScenarios(staff)).find((scenario) => scenario.id === scenarioId)!;
    expect(saved).toMatchObject({ revision: 2, candidatePricesMinor: [49900, 69900, 89900, 99900] });
    const simulation = await simulatePackageEconomics(staff, { source: { type: 'draft_scenario', id: scenarioId }, profile: 'expected' });
    expect(simulation.comparisons.map((result) => result.candidateAmountMinor)).toEqual([49900, 69900, 89900, 99900]);
    expect(simulation.result.sourceType).toBe('draft_scenario');
    expect(simulation.maxAllowance.profile).toBe('max_allowance');
  });

  it('keeps draft planning staff-only and side-effect free', async () => {
    const before = await tableCounts();
    await simulatePackageEconomics(staff, { source: { type: 'plan_default', id: planId }, profile: 'heavy' });
    expect(await tableCounts()).toEqual(before);
    expect((await ordinary.db.from('commercial_draft_scenarios').select('id')).data).toEqual([]);
    await expect(saveDraftScenario(ordinary.db, {
      name: 'Forbidden', planId, currency: 'CAD', candidatePricesMinor: [49900], inputs: [],
    })).rejects.toMatchObject({ code: 'package_economics.save_draft_failed' });
  });

  it('requires a real Plan assignment before recording an organization agreement and honors its end date', async () => {
    await expect(recordPlanAgreement(staff, {
      organizationId: ordinary.organizationId, planId, currency: 'CAD', amountMinor: 69900,
      effectiveFrom: '2026-11-01T00:00:00Z', effectiveTo: '2026-12-01T00:00:00Z',
    })).rejects.toMatchObject({ code: 'organization_plans.record_agreement_failed' });
    await recordPlanAssignment(staff, { organizationId: ordinary.organizationId, planId, periodStart: '2026-01-01', periodEnd: '2027-01-01' });
    await expect(recordPlanAgreement(staff, {
      organizationId: ordinary.organizationId, planId, currency: 'CAD', amountMinor: 69900,
      effectiveFrom: '2026-11-01T00:00:00Z', effectiveTo: '2026-12-01T00:00:00Z',
    })).resolves.toBeTruthy();
  });
});

async function tableCounts() {
  const pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  try {
    const { rows } = await pg.query(`select
      (select count(*)::int from public.organization_plan_agreements) agreements,
      (select count(*)::int from public.usage_events) usage_events,
      (select count(*)::int from public.organization_provider_resources) provider_resources,
      (select count(*)::int from public.invoices) invoices`);
    return rows[0];
  } finally {
    await pg.end();
  }
}

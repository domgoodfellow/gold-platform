import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getCatalogProduct,
  listCatalogFeatures,
  listCatalogModules,
  listCatalogProducts,
  listFeaturesByRuntimeMapping,
  updateCatalogProduct,
} from '@/lib/domain/catalogue/catalogue';
import {
  createPlan,
  getPlan,
  grantPlanProduct,
  listPlanPrices,
  listPlanQuotas,
  planEntitledFeatureIds,
  recordPlanPrice,
  setPlanFeatureOverride,
  setPlanQuota,
  updatePlan,
} from '@/lib/domain/catalogue/plans';
import {
  activeModuleKeys,
  availableFeatureKeys,
  currentPlanAssignment,
  listOrganizationPlanAgreements,
  organizationEffectiveEntitlements,
  organizationEffectiveQuotas,
  organizationResolvedFeatureStates,
  organizationPlanPrice,
  recordPlanAgreement,
  recordPlanAssignment,
  recordPlanQuotaOverride,
} from '@/lib/domain/catalogue/organization-plans';
import { moduleCommercialState } from '@/lib/domain/commercial/terms';
import { asPlatformStaff, foundBusiness } from './helpers/founding';
import { CATALOGUE_SURFACE_COVERAGE } from '@/lib/catalogue-surface-coverage';

/**
 * The canonical Product -> Module -> Feature catalogue, and Plans/Add-ons above it
 * (`20260918000001`).
 *
 * The claim worth testing is the one this slice's design rests on: a Plan's entitlement is
 * resolved (override > module grant > product grant, restricted to `available` Features) rather
 * than stored redundantly, a Plan assignment never touches `organization_modules` or
 * `organization_commercial_terms`, and a legacy organization with no assignment keeps resolving
 * exactly as it did before this migration existed.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// **GOLD Internal may have exactly one current holder**, and `gold-bootstrap.test.ts` proves the
// bootstrap door refuses a second. The two tests below give it to a throwaway organization to
// prove it resolves like any other Plan; an assignment running to 9999-12-31 that nobody removes
// would be the "second holder" every later run of that file trips over, so they are removed here.
// Written over a direct connection because no role holds a delete grant on assignments — the
// same reason `communications.test.ts` writes its rate table that way.
const goldInternalHolders: string[] = [];

afterAll(async () => {
  if (goldInternalHolders.length === 0) return;
  const pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  try {
    await pg.query(
      `delete from public.organization_plan_assignments
        where organization_id = any($1::uuid[])
          and plan_id = (select id from public.platform_plans where key = 'gold_internal')`,
      [goldInternalHolders],
    );
  } finally {
    await pg.end();
  }
});

async function newTenant(label: string): Promise<{ db: SupabaseClient; organizationId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw createError;

  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd ${randomUUID().slice(0, 6)}`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  });

  return { db, organizationId };
}

describe('the canonical catalogue', () => {
  let staff: SupabaseClient;
  let stranger: { db: SupabaseClient; organizationId: string };

  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    staff = await asPlatformStaff();
    stranger = await newTenant('catalogue-tenant');
  });

  it('has implementation evidence for every available or partial catalogue Feature', async () => {
    const [products, modules, features] = await Promise.all([
      listCatalogProducts(stranger.db),
      listCatalogModules(stranger.db),
      listCatalogFeatures(stranger.db),
    ]);
    const productById = new Map(products.map((product) => [product.id, product.key]));
    const moduleById = new Map(modules.map((module) => [module.id, module]));
    const expected = features.flatMap((feature) => {
      if (feature.implementationState === 'planned') return [];
      const catalogModule = moduleById.get(feature.moduleId);
      const product = catalogModule ? productById.get(catalogModule.productId) : undefined;
      return product && catalogModule ? [`${product}.${catalogModule.key}.${feature.key}`] : [];
    }).sort();
    expect(CATALOGUE_SURFACE_COVERAGE.map((entry) => entry.key).sort()).toEqual(expected);
  });

  it('has exactly the seven locked Products, readable by anyone signed in', async () => {
    const communications = await getCatalogProduct(stranger.db, 'communications');
    expect(communications?.label).toBe('Communications');

    const modules = await listCatalogModules(stranger.db, { productId: communications!.id });
    expect(modules.map((m) => m.key)).toEqual(expect.arrayContaining(['voice', 'sms', 'email']));

    const voice = modules.find((m) => m.key === 'voice')!;
    const features = await listCatalogFeatures(stranger.db, { moduleId: voice.id });
    expect(features.length).toBeGreaterThan(0);
    // implementation_state is truthful, not a single collapsed enum — all three real values appear.
    const states = new Set(features.map((f) => f.implementationState));
    expect(states.has('available')).toBe(true);
    expect(states.has('planned')).toBe(true);
  });

  it('lets one legacy runtime key back Features across two different Products', async () => {
    const reception = await listFeaturesByRuntimeMapping(stranger.db, { mappingKind: 'module_key', mappingValue: 'reception' });
    expect(reception.length).toBeGreaterThan(1);

    const moduleIds = new Set(reception.map((f) => f.moduleId));
    const modules = await Promise.all([...moduleIds].map((id) => listCatalogModules(stranger.db).then((all) => all.find((m) => m.id === id))));
    const productIds = new Set(modules.map((m) => m?.productId));
    // reception backs at least Communications/Voice and CRM/Sales — two different Products, one runtime key.
    expect(productIds.size).toBeGreaterThan(1);
  });

  it('refuses a catalogue edit from a tenant and allows it from staff', async () => {
    await expect(
      updateCatalogProduct(stranger.db, {
        key: 'crm',
        label: 'Hijacked',
        description: '',
        lifecycle: 'stable',
        saleStatus: 'active',
        displayOrder: 1,
      }),
    ).rejects.toMatchObject({ code: 'catalogue.update_product_failed' });

    const original = await getCatalogProduct(staff, 'crm');
    await updateCatalogProduct(staff, {
      key: 'crm',
      label: original!.label,
      description: 'Edited by staff for this test.',
      lifecycle: 'stable',
      saleStatus: 'active',
      displayOrder: original!.displayOrder,
    });

    const updated = await getCatalogProduct(stranger.db, 'crm');
    expect(updated?.description).toBe('Edited by staff for this test.');
  });
});

describe('Plans and Add-ons', () => {
  let staff: SupabaseClient;
  let tenant: { db: SupabaseClient; organizationId: string };
  let other: { db: SupabaseClient; organizationId: string };

  beforeAll(async () => {
    staff = await asPlatformStaff();
    tenant = await newTenant('plan-tenant');
    other = await newTenant('plan-other');
  });

  it('lets staff create a Plan and an Add-on as distinct kinds, and refuses a tenant', async () => {
    await expect(
      createPlan(tenant.db, { key: `refused_${randomUUID().slice(0, 8)}`, kind: 'plan', label: 'Nope', description: '', billable: true }),
    ).rejects.toMatchObject({ code: 'plans.create_failed' });

    const planKey = `growth_${randomUUID().slice(0, 8)}`;
    const planId = await createPlan(staff, { key: planKey, kind: 'plan', label: 'Growth', description: 'Test plan', billable: true });
    const addonKey = `intelligence_${randomUUID().slice(0, 8)}`;
    const addonId = await createPlan(staff, { key: addonKey, kind: 'addon', label: 'GOLD Intelligence', description: 'Test add-on', billable: true });

    expect((await getPlan(staff, planKey))?.kind).toBe('plan');
    expect((await getPlan(staff, addonKey))?.kind).toBe('addon');
    expect(planId).not.toBe(addonId);
  });

  it('resolves entitlement as override > module grant > product grant, restricted to available Features', async () => {
    const planKey = `resolve_${randomUUID().slice(0, 8)}`;
    const planId = await createPlan(staff, { key: planKey, kind: 'plan', label: 'Resolve test', description: '', billable: true });

    await grantPlanProduct(staff, { planId, productKey: 'communications' });

    const voiceModule = (await listCatalogModules(staff)).find((m) => m.key === 'voice')!;
    const features = await listCatalogFeatures(staff, { moduleId: voiceModule.id });
    const outbound = features.find((f) => f.key === 'outbound_calling')!; // available
    const transcription = features.find((f) => f.key === 'transcription')!; // planned

    let entitled = await planEntitledFeatureIds(staff, planId);
    expect(entitled.has(outbound.id)).toBe(true); // available, covered by the product grant
    expect(entitled.has(transcription.id)).toBe(false); // planned — never auto-included

    // A Feature-level override in either direction beats the product grant.
    await setPlanFeatureOverride(staff, { planId, featureId: outbound.id, included: false });
    await setPlanFeatureOverride(staff, { planId, featureId: transcription.id, included: true });

    entitled = await planEntitledFeatureIds(staff, planId);
    expect(entitled.has(outbound.id)).toBe(false);
    expect(entitled.has(transcription.id)).toBe(true);
  });

  it('lets an Add-on stack alongside a base Plan, but refuses two overlapping base Plans', async () => {
    const org = await newTenant('stack');
    const planKey = `base_${randomUUID().slice(0, 8)}`;
    const planId = await createPlan(staff, { key: planKey, kind: 'plan', label: 'Base', description: '', billable: true });
    const addonKey = `addon_${randomUUID().slice(0, 8)}`;
    const addonId = await createPlan(staff, { key: addonKey, kind: 'addon', label: 'Addon', description: '', billable: true });

    await recordPlanAssignment(staff, { organizationId: org.organizationId, planId, periodStart: '2026-01-01', periodEnd: '9999-12-31' });
    // An add-on for the same organization, same open period, must not collide with the base plan.
    await expect(
      recordPlanAssignment(staff, { organizationId: org.organizationId, planId: addonId, periodStart: '2026-01-01', periodEnd: '9999-12-31' }),
    ).resolves.toBeTruthy();

    const secondPlanKey = `second_base_${randomUUID().slice(0, 8)}`;
    const secondPlanId = await createPlan(staff, { key: secondPlanKey, kind: 'plan', label: 'Second base', description: '', billable: true });
    // A second base Plan overlapping the first must be refused.
    await expect(
      recordPlanAssignment(staff, { organizationId: org.organizationId, planId: secondPlanId, periodStart: '2026-06-01', periodEnd: '9999-12-31' }),
    ).rejects.toMatchObject({ code: 'organization_plans.assignment_overlap' });
  });

  it('never lets a Plan edit rewrite a historical organization assignment', async () => {
    const org = await newTenant('stable-history');
    const planKey = `stable_${randomUUID().slice(0, 8)}`;
    const planId = await createPlan(staff, { key: planKey, kind: 'plan', label: 'Before edit', description: 'v1', billable: true });
    await recordPlanAssignment(staff, { organizationId: org.organizationId, planId, periodStart: '2026-01-01', periodEnd: '9999-12-31' });

    const before = await currentPlanAssignment(org.db, { organizationId: org.organizationId });
    expect(before?.planId).toBe(planId);

    await updatePlan(staff, { planId, label: 'After edit', description: 'v2', billable: false, saleStatus: 'unlisted', displayOrder: 9 });

    const after = await currentPlanAssignment(org.db, { organizationId: org.organizationId });
    expect(after?.planId).toBe(planId);
    expect(after?.periodStart).toBe(before?.periodStart);
    expect(after?.periodEnd).toBe(before?.periodEnd);
  });

  it('stores quotas as structured fields, with no free-text parsing required', async () => {
    const planKey = `quota_${randomUUID().slice(0, 8)}`;
    const planId = await createPlan(staff, { key: planKey, kind: 'plan', label: 'Quota test', description: '', billable: true });

    await setPlanQuota(staff, {
      planId,
      allowanceKey: 'ai_tokens',
      label: 'AI tokens',
      unit: 'token',
      includedQuantity: 2000,
      period: 'month',
      hardLimit: 3000,
      overagePolicy: 'allowed',
    });

    const quotas = await listPlanQuotas(staff, planId);
    const aiTokens = quotas.find((q) => q.allowanceKey === 'ai_tokens')!;
    expect(aiTokens).toMatchObject({ includedQuantity: 2000, period: 'month', hardLimit: 3000, overagePolicy: 'allowed' });

    // A tenant cannot write a quota directly.
    await expect(
      tenant.db.from('platform_plan_quotas').update({ included_quantity: 999999 }).eq('id', aiTokens.id),
    ).resolves.toMatchObject({ error: expect.anything() });
  });

  it('resolves an organization override on top of the Plan default', async () => {
    const org = await newTenant('quota-override');
    const planKey = `override_${randomUUID().slice(0, 8)}`;
    const planId = await createPlan(staff, { key: planKey, kind: 'plan', label: 'Override test', description: '', billable: true });
    await setPlanQuota(staff, { planId, allowanceKey: 'voice_minutes', label: 'Voice minutes', unit: 'minute', includedQuantity: 500, period: 'month', overagePolicy: 'allowed' });
    await recordPlanAssignment(staff, { organizationId: org.organizationId, planId, periodStart: '2020-01-01', periodEnd: '9999-12-31', note: 'quota override test' });

    let effective = await organizationEffectiveQuotas(org.db, { organizationId: org.organizationId });
    let voice = effective.find((q) => q.allowanceKey === 'voice_minutes' && q.planKey === planKey)!;
    expect(voice.includedQuantity).toBe(500);
    expect(voice.overridden).toBe(false);

    await recordPlanQuotaOverride(staff, { organizationId: org.organizationId, planId, allowanceKey: 'voice_minutes', includedQuantity: 5000 });

    effective = await organizationEffectiveQuotas(org.db, { organizationId: org.organizationId });
    voice = effective.find((q) => q.allowanceKey === 'voice_minutes' && q.planKey === planKey)!;
    expect(voice.includedQuantity).toBe(5000);
    expect(voice.overridden).toBe(true);
  });

  it('keeps Plan price separate from Plan entitlements, and never sums Feature prices', async () => {
    const org = await newTenant('plan-price');
    const planKey = `price_${randomUUID().slice(0, 8)}`;
    const planId = await createPlan(staff, { key: planKey, kind: 'plan', label: 'Price test', description: '', billable: true });

    await recordPlanPrice(staff, { planId, currency: 'EUR', amountMinor: 29900, billingInterval: 'month', effectiveFrom: '2026-01-01T00:00:00Z', source: 'test' });
    await recordPlanPrice(staff, { planId, currency: 'EUR', amountMinor: 34900, billingInterval: 'month', effectiveFrom: '2026-06-01T00:00:00Z', source: 'test' });

    const prices = await listPlanPrices(staff, planId);
    expect(prices).toHaveLength(2);
    expect(prices.map((p) => p.amountMinor).sort()).toEqual([29900, 34900]);

    await recordPlanAssignment(staff, { organizationId: org.organizationId, planId, periodStart: '2026-01-01', periodEnd: '9999-12-31' });

    const standard = await organizationPlanPrice(staff, { organizationId: org.organizationId, planId, at: '2026-03-01T00:00:00Z' });
    expect(standard).toMatchObject({ amountMinor: 29900, currency: 'EUR', source: 'standard' });

    // A negotiated agreement overrides the standard price without touching its history.
    await recordPlanAgreement(staff, { organizationId: org.organizationId, planId, currency: 'EUR', amountMinor: 24900, effectiveFrom: '2026-10-01T00:00:00Z', note: 'negotiated' });

    const agreed = await organizationPlanPrice(staff, { organizationId: org.organizationId, planId, at: '2026-11-01T00:00:00Z' });
    expect(agreed).toMatchObject({ amountMinor: 24900, currency: 'EUR', source: 'agreement' });

    // Still effective before the agreement started, and the standard price rows are untouched.
    const beforeAgreement = await organizationPlanPrice(staff, { organizationId: org.organizationId, planId, at: '2026-07-01T00:00:00Z' });
    expect(beforeAgreement).toMatchObject({ amountMinor: 34900, source: 'standard' });

    const stillTwo = await listPlanPrices(staff, planId);
    expect(stillTwo).toHaveLength(2);

    const agreements = await listOrganizationPlanAgreements(staff, { organizationId: org.organizationId, planId });
    expect(agreements).toHaveLength(1);
  });

  it('assigns GOLD Internal to an ordinary organization through the same door as any other Plan — no tenancy bypass', async () => {
    const org = await newTenant('dogfood-check');
    goldInternalHolders.push(org.organizationId);
    const goldInternal = await getPlan(staff, 'gold_internal');
    expect(goldInternal).toBeTruthy();
    expect(goldInternal?.billable).toBe(false);

    await recordPlanAssignment(staff, { organizationId: org.organizationId, planId: goldInternal!.id, periodStart: '2026-01-01', periodEnd: '9999-12-31', note: 'dogfooding test' });

    const entitlements = await organizationEffectiveEntitlements(org.db, { organizationId: org.organizationId });
    // GOLD Internal grants every Product's currently-available Features — this organization now sees a real, non-empty resolved set through the identical RPC any tenant's Plan uses.
    expect(entitlements.length).toBeGreaterThan(50);
    expect(entitlements.every((e) => e.planKey === 'gold_internal')).toBe(true);
  });

  it('resolves GOLD Internal available Features through the canonical Plan resolver', async () => {
    const org = await newTenant('gold-internal-resolver');
    goldInternalHolders.push(org.organizationId);
    const goldInternal = await getPlan(staff, 'gold_internal');
    await recordPlanAssignment(staff, {
      organizationId: org.organizationId,
      planId: goldInternal!.id,
      periodStart: '2020-01-01',
      periodEnd: '9999-12-31',
    });

    const { error: clearModulesError } = await org.db
      .from('organization_modules')
      .delete()
      .eq('organization_id', org.organizationId);
    expect(clearModulesError).toBeNull();
    const { data: legacyModules, error: legacyModulesError } = await org.db
      .from('organization_modules')
      .select('module_key')
      .eq('organization_id', org.organizationId);
    expect(legacyModulesError).toBeNull();
    expect(legacyModules).toEqual([]);

    const [features, states] = await Promise.all([
      listCatalogFeatures(org.db),
      organizationResolvedFeatureStates(org.db, { organizationId: org.organizationId }),
    ]);
    const entitledAvailable = states.filter(
      (state) => state.implementationState === 'available' && state.entitled,
    );

    expect(entitledAvailable.length).toBeGreaterThan(0);
    expect(entitledAvailable.every((state) => state.activation === 'active')).toBe(true);
    expect(availableFeatureKeys(states)).toEqual(new Set(entitledAvailable.map((state) => state.featureKey)));
    expect(activeModuleKeys(states).size).toBeGreaterThan(0);
    expect(entitledAvailable).toHaveLength(features.filter((feature) => feature.implementationState === 'available').length);
  });

  it('leaves a legacy organization with no Plan assignment resolving exactly as before', async () => {
    const legacy = await newTenant('legacy-no-plan');

    const entitlements = await organizationEffectiveEntitlements(legacy.db, { organizationId: legacy.organizationId });
    expect(entitlements).toEqual([]);

    // The pre-existing wanted/paid machinery is untouched by this slice.
    const states = await moduleCommercialState(legacy.db, { organizationId: legacy.organizationId });
    expect(states.find((s) => s.moduleKey === 'billing')).toMatchObject({ wanted: true, paid: true });
  });

  it('never lets a tenant read another organization\'s Plan assignments, agreements or overrides', async () => {
    const planKey = `isolation_${randomUUID().slice(0, 8)}`;
    const planId = await createPlan(staff, { key: planKey, kind: 'plan', label: 'Isolation test', description: '', billable: true });
    await recordPlanAssignment(staff, { organizationId: tenant.organizationId, planId, periodStart: '2026-01-01', periodEnd: '9999-12-31' });
    await recordPlanAgreement(staff, { organizationId: tenant.organizationId, planId, currency: 'EUR', amountMinor: 100, note: 'secret to this tenant' });

    const crossAssignments = await currentPlanAssignment(other.db, { organizationId: tenant.organizationId });
    expect(crossAssignments).toBeNull();

    const { data, error } = await other.db.from('organization_plan_agreements').select('id').eq('organization_id', tenant.organizationId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getOrganization } from '@/lib/domain/tenancy/organizations';
import { listCatalogFeatures, listCatalogModules, listCatalogProducts, type CatalogFeature, type CatalogModule, type CatalogProduct } from './catalogue';
import type { PlanKind } from './plans';
import { featureOperationalState } from './feature-operational-state';
import { isModuleKey, moduleConfiguration, MODULES, featureConfigurationTarget, type ModuleKey } from '@/lib/navigation';
import { listUsableModules, outstandingModuleSetup } from '@/lib/domain/tenancy/modules';

/**
 * What one organization has, in the new Plan/Add-on model — entirely separate provenance from
 * `lib/domain/commercial/terms.ts`'s `organization_commercial_terms` (see the migration header
 * on `20260918000001` for why). A legacy organization with no row in
 * `organization_plan_assignments` simply has no rows here; its existing wanted/paid state
 * (`moduleCommercialState`, `usable_modules`) is untouched and keeps resolving exactly as before.
 */

export type PlanAssignment = {
  id: string;
  organizationId: string;
  planId: string;
  planKind: PlanKind;
  periodStart: string;
  periodEnd: string;
  assignedAt: string;
  note: string;
};

export type PlanQuotaOverride = {
  id: string;
  organizationId: string;
  planId: string;
  allowanceKey: string;
  includedQuantity: number;
  hardLimit: number | null;
  effectiveFrom: string;
  note: string;
};

export type EffectiveEntitlement = { featureId: string; planId: string; planKey: string };

/** `sourceId` is the deciding row's own id: the agreed subscription price (`subscription_agreed_prices.id`) for `'agreement'`, `price_book_item_prices.id` for `'standard'`. */
export type EffectivePrice = { amountMinor: number; currency: string; source: 'agreement' | 'standard'; sourceId: string };

export type EffectiveQuota = {
  allowanceKey: string;
  label: string;
  unit: string;
  includedQuantity: number;
  hardLimit: number | null;
  period: string;
  overagePolicy: string;
  serviceClass: string | null;
  meterId: string | null;
  planKey: string;
  overridden: boolean;
};

function staffOnly(error: { code?: string; message: string }, code: string): never {
  throw new DomainError(error.code === '42501' ? 'Changing a subscription needs the subscription permission in GildOps’ own business.' : error.message, code);
}

/** Every organization currently or historically assigned one Plan — the platform's "Organizations" tab on a Plan detail page. Staff-only in practice: RLS admits a tenant only its own rows. */
export async function listAssignmentsForPlan(db: Db, planId: string): Promise<PlanAssignment[]> {
  const { data, error } = await db
    .from('organization_plan_assignments')
    .select('id, organization_id, plan_id, plan_kind, period_start, period_end, assigned_at, note')
    .eq('plan_id', planId)
    .order('period_start', { ascending: false });
  if (error) throw fromDatabaseError(error, 'organization_plans.assignments_for_plan_failed');
  return (data ?? []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    planId: row.plan_id,
    planKind: row.plan_kind as PlanKind,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    assignedAt: row.assigned_at,
    note: row.note,
  }));
}

export async function listOrganizationPlanAssignments(db: Db, input: { organizationId: string }): Promise<PlanAssignment[]> {
  const { data, error } = await db
    .from('organization_plan_assignments')
    .select('id, organization_id, plan_id, plan_kind, period_start, period_end, assigned_at, note')
    .eq('organization_id', input.organizationId)
    .order('period_start', { ascending: false });
  if (error) throw fromDatabaseError(error, 'organization_plans.assignments_failed');
  return (data ?? []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    planId: row.plan_id,
    planKind: row.plan_kind as PlanKind,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    assignedAt: row.assigned_at,
    note: row.note,
  }));
}

/** The organization's current base Plan (not an Add-on), if any — for a "Current plan" card. */
/** Every business's plans and add-ons in force today, for GildOps' Finance Subscriptions. RLS decides whose rows are returned. */
export async function listCurrentPlanAssignments(db: Db): Promise<PlanAssignment[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db
    .from('organization_plan_assignments')
    .select('id, organization_id, plan_id, plan_kind, period_start, period_end, assigned_at, note')
    .lte('period_start', today)
    .gt('period_end', today)
    .order('period_start', { ascending: false });
  if (error) throw fromDatabaseError(error, 'organization_plans.current_assignments_failed');
  return (data ?? []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    planId: row.plan_id,
    planKind: row.plan_kind as PlanKind,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    assignedAt: row.assigned_at,
    note: row.note,
  }));
}

export async function currentPlanAssignment(db: Db, input: { organizationId: string }): Promise<PlanAssignment | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db
    .from('organization_plan_assignments')
    .select('id, organization_id, plan_id, plan_kind, period_start, period_end, assigned_at, note')
    .eq('organization_id', input.organizationId)
    .eq('plan_kind', 'plan')
    .lte('period_start', today)
    .gt('period_end', today)
    .order('period_start', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw fromDatabaseError(error, 'organization_plans.current_assignment_failed');
  if (!data) return null;
  return {
    id: data.id,
    organizationId: data.organization_id,
    planId: data.plan_id,
    planKind: data.plan_kind as PlanKind,
    periodStart: data.period_start,
    periodEnd: data.period_end,
    assignedAt: data.assigned_at,
    note: data.note,
  };
}

/** The organization's current Add-on assignments (stacked alongside its base Plan, if any). */
export async function currentAddonAssignments(db: Db, input: { organizationId: string }): Promise<PlanAssignment[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db
    .from('organization_plan_assignments')
    .select('id, organization_id, plan_id, plan_kind, period_start, period_end, assigned_at, note')
    .eq('organization_id', input.organizationId)
    .eq('plan_kind', 'addon')
    .lte('period_start', today)
    .gt('period_end', today)
    .order('period_start', { ascending: false });
  if (error) throw fromDatabaseError(error, 'organization_plans.current_addons_failed');
  return (data ?? []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    planId: row.plan_id,
    planKind: row.plan_kind as PlanKind,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    assignedAt: row.assigned_at,
    note: row.note,
  }));
}

export type RecordPlanQuotaOverrideInput = {
  organizationId: string;
  planId: string;
  allowanceKey: string;
  includedQuantity: number;
  hardLimit?: number | null;
  effectiveFrom?: string;
  note?: string;
};

/** Every override this organization has recorded, append-only — the History counterpart to `organizationEffectiveQuotas`'s current view. */
export async function listOrganizationPlanQuotaOverrides(
  db: Db,
  input: { organizationId: string },
): Promise<PlanQuotaOverride[]> {
  const { data, error } = await db
    .from('organization_plan_quota_overrides')
    .select('id, organization_id, plan_id, allowance_key, included_quantity, hard_limit, effective_from, note')
    .eq('organization_id', input.organizationId)
    .order('effective_from', { ascending: false });
  if (error) throw fromDatabaseError(error, 'organization_plans.quota_overrides_failed');
  return (data ?? []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    planId: row.plan_id,
    allowanceKey: row.allowance_key,
    includedQuantity: Number(row.included_quantity),
    hardLimit: row.hard_limit === null ? null : Number(row.hard_limit),
    effectiveFrom: row.effective_from,
    note: row.note,
  }));
}

export async function recordPlanQuotaOverride(db: Db, input: RecordPlanQuotaOverrideInput): Promise<string> {
  const { data, error } = await db.rpc('record_plan_quota_override', {
    p_organization_id: input.organizationId,
    p_plan_id: input.planId,
    p_allowance_key: input.allowanceKey,
    p_included_quantity: input.includedQuantity,
    p_hard_limit: input.hardLimit ?? undefined,
    p_effective_from: input.effectiveFrom ?? new Date().toISOString(),
    p_note: input.note ?? '',
  });
  if (error) staffOnly(error, 'organization_plans.record_quota_override_failed');
  return data as string;
}

/** Every Feature this organization's current Plan + Add-ons entitle it to. Empty for a legacy organization with no assignment — callers fall back to `usable_modules` for those. */
export async function organizationEffectiveEntitlements(
  db: Db,
  input: { organizationId: string; at?: string },
): Promise<EffectiveEntitlement[]> {
  const { data, error } = await db.rpc('organization_effective_entitlements', {
    p_organization_id: input.organizationId,
    p_at: input.at ?? new Date().toISOString(),
  });
  if (error) throw fromDatabaseError(error, 'organization_plans.effective_entitlements_failed');
  return (data ?? []).map((row: { feature_id: string; plan_id: string; plan_key: string }) => ({
    featureId: row.feature_id,
    planId: row.plan_id,
    planKey: row.plan_key,
  }));
}

export async function organizationPlanPrice(
  db: Db,
  input: { organizationId: string; planId: string; at?: string; billingInterval?: 'month' | 'year' | 'one_time' },
): Promise<EffectivePrice | null> {
  const { data, error } = await db.rpc('organization_plan_price', {
    p_organization_id: input.organizationId,
    p_plan_id: input.planId,
    p_at: input.at ?? new Date().toISOString(),
    p_billing_interval: input.billingInterval ?? 'month',
  });
  if (error) throw fromDatabaseError(error, 'organization_plans.plan_price_failed');
  const row = (data ?? [])[0] as
    | { amount_minor: string | number; currency: string; source: string; source_id: string }
    | undefined;
  if (!row) return null;
  return {
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    source: row.source as EffectivePrice['source'],
    sourceId: row.source_id,
  };
}

export async function organizationEffectiveQuotas(
  db: Db,
  input: { organizationId: string; at?: string },
): Promise<EffectiveQuota[]> {
  const { data, error } = await db.rpc('organization_effective_quotas', {
    p_organization_id: input.organizationId,
    p_at: input.at ?? new Date().toISOString(),
  });
  if (error) throw fromDatabaseError(error, 'organization_plans.effective_quotas_failed');
  return (data ?? []).map(
    (row: {
      allowance_key: string;
      label: string;
      unit: string;
      included_quantity: string | number;
      hard_limit: string | number | null;
      period: string;
      overage_policy: string;
      service_class: string | null;
      meter_id: string | null;
      plan_key: string;
      overridden: boolean;
    }) => ({
      allowanceKey: row.allowance_key,
      label: row.label,
      unit: row.unit,
      includedQuantity: Number(row.included_quantity),
      hardLimit: row.hard_limit === null ? null : Number(row.hard_limit),
      period: row.period,
      overagePolicy: row.overage_policy,
      serviceClass: row.service_class,
      meterId: row.meter_id,
      planKey: row.plan_key,
      overridden: row.overridden,
    }),
  );
}

export type ResolvedFeatureState = {
  featureId: string;
  featureKey: string;
  productKey: string;
  implementationState: 'planned' | 'partial' | 'available';
  /** Whether this organization's Plan(s), or (absent a Plan assignment) its legacy wanted∩paid module state, currently grant this Feature. */
  entitled: boolean;
  entitlementSource: 'plan' | 'legacy_module' | 'none';
  /**
   * The opt-out axis (domain-model.md): 'disabled' iff the organization has deliberately
   * switched an entitled feature off (`organization_feature_activation_overrides`). An
   * unentitled feature is always reported 'active' here — activation has nothing to say about a
   * feature this business was never granted, and the absence of an override must never be read
   * as "on" for something never entitled. Callers gate visible behaviour on `entitled` first.
   */
  activation: 'active' | 'disabled';
  /**
   * Readiness is a separate question from availability (domain-model.md): an available,
   * entitled, active feature can still have nothing configured yet. 'unavailable' covers
   * not-implemented or not-entitled; zero rows/zero connections is 'ready', never
   * 'setup_required' — only genuinely missing required configuration is.
   */
  readiness: 'ready' | 'setup_required' | 'unavailable';
  reason?: string;
  primaryHref?: string;
  setupHref?: string;
  /** The legacy `MODULES` key backing this Feature, if any — for a caller that wants a real "Configure" link via `moduleConfiguration()` rather than guessing one from catalogue labels. */
  moduleKey: ModuleKey | null;
};

/**
 * The authoritative feature-availability resolver (domain-model.md, the module-visibility rule and the wanted-versus-paid entitlement rule evolved): combines
 * catalogue implementation, entitlement, this organization's deliberate activation override, and
 * per-feature readiness. Role authorization is never an input here and never an output — it
 * stays `app.has_capability`'s question alone.
 *
 * A legacy organization with no Plan assignment falls back to its existing wanted∩paid module
 * resolution (`usable_modules`), so it keeps seeing meaningful entitlement information rather
 * than "not included" for everything.
 */
export async function organizationResolvedFeatureStates(
  db: Db,
  input: { organizationId: string },
  catalogue?: { features: CatalogFeature[]; modules: CatalogModule[]; products: CatalogProduct[] },
): Promise<ResolvedFeatureState[]> {
  const [features, modules, products, mappingsResult, planEntitlements, usable, overridesResult, planAssignment] =
    await Promise.all([
      catalogue ? Promise.resolve(catalogue.features) : listCatalogFeatures(db),
      catalogue ? Promise.resolve(catalogue.modules) : listCatalogModules(db),
      catalogue ? Promise.resolve(catalogue.products) : listCatalogProducts(db),
      db
        .from('platform_catalog_runtime_mappings')
        .select('feature_id, mapping_value')
        .eq('mapping_kind', 'module_key'),
      organizationEffectiveEntitlements(db, { organizationId: input.organizationId }),
      listUsableModules(db, { organizationId: input.organizationId }),
      db
        .from('organization_feature_activation_overrides')
        .select('feature_id')
        .eq('organization_id', input.organizationId),
      currentPlanAssignment(db, { organizationId: input.organizationId }),
    ]);
  if (mappingsResult.error) {
    throw fromDatabaseError(mappingsResult.error, 'organization_plans.resolved_features_failed');
  }
  if (overridesResult.error) {
    throw fromDatabaseError(overridesResult.error, 'organization_plans.resolved_features_failed');
  }

  const moduleKeyByFeature = new Map<string, ModuleKey>();
  for (const row of mappingsResult.data ?? []) {
    if (isModuleKey(row.mapping_value)) moduleKeyByFeature.set(row.feature_id, row.mapping_value);
  }
  const planEntitledIds = new Set(planEntitlements.map((e) => e.featureId));
  // Whether a Plan is authoritative for this organization is a fact about
  // `organization_plan_assignments`, never about how many rows the entitlement RPC happened to
  // return. A real base-Plan assignment that currently grants zero Features (a minimal or
  // placeholder Plan) must still be authoritative — inferring "no Plan" from an empty
  // entitlement list would silently fall an assigned business back to legacy wanted∩paid,
  // exactly the state the Plan replaced it with.
  const hasPlanAssignment = planAssignment !== null;
  const disabledFeatureIds = new Set((overridesResult.data ?? []).map((row) => row.feature_id));

  const moduleById = new Map(modules.map((m) => [m.id, m]));
  const productById = new Map(products.map((p) => [p.id, p]));

  // Readiness re-uses the one place per-module setup checks already live, restricted to the
  // modules this resolver is about to report entitled — a module never wanted/paid is never
  // "setup_required", it is simply not entitled.
  const active = new Set<ModuleKey>();
  for (const feature of features) {
    const key = readinessModuleKey({ featureKey: feature.key, moduleKey: moduleKeyByFeature.get(feature.id) ?? null });
    if (key && feature.implementationState === 'available' && !disabledFeatureIds.has(feature.id)
      && (hasPlanAssignment ? planEntitledIds.has(feature.id) : usable.has(key))) active.add(key);
  }
  const outstanding = await outstandingModuleSetup(db, {
    organizationId: input.organizationId,
    enabled: active,
  });

  return features.map((feature) => {
    const moduleKey = moduleKeyByFeature.get(feature.id) ?? null;
    let entitled = false;
    let entitlementSource: ResolvedFeatureState['entitlementSource'] = 'none';

    if (hasPlanAssignment) {
      entitled = planEntitledIds.has(feature.id);
      entitlementSource = entitled ? 'plan' : 'none';
    } else if (moduleKey && usable.has(moduleKey)) {
      entitled = true;
      entitlementSource = 'legacy_module';
    }

    const catalogModule = moduleById.get(feature.moduleId);
    const product = catalogModule ? productById.get(catalogModule.productId) : undefined;

    // Activation has no meaning for something never entitled — always reported 'active' so a
    // caller cannot mistake "never entitled" for "deliberately switched off".
    const activation: ResolvedFeatureState['activation'] =
      entitled && disabledFeatureIds.has(feature.id) ? 'disabled' : 'active';

    let readiness: ResolvedFeatureState['readiness'] = 'unavailable';
    let reason: string | undefined;
    if (feature.implementationState === 'available' && entitled && activation === 'active') {
      const readinessKey = readinessModuleKey({ featureKey: feature.key, moduleKey });
      const outstandingReason = readinessKey ? outstanding.get(readinessKey) : undefined;
      readiness = outstandingReason ? 'setup_required' : 'ready';
      reason = outstandingReason;
    }

    const moduleEntry = moduleKey ? MODULES.find((m) => m.key === moduleKey) : undefined;
    const target = featureConfigurationTarget(feature.key);
    const primaryHref = target ? `/organizations/${input.organizationId}/${target.path}`
      : moduleEntry ? moduleConfiguration(input.organizationId, moduleEntry).href : undefined;

    return {
      featureId: feature.id,
      featureKey: feature.key,
      productKey: product?.key ?? '',
      implementationState: feature.implementationState,
      entitled,
      entitlementSource,
      activation,
      readiness,
      reason,
      primaryHref,
      setupHref: readiness === 'setup_required' ? primaryHref : undefined,
      moduleKey,
    };
  });
}

/** Activation is only meaningful for an implemented, entitled Feature; refuse anything else before writing. */
async function requireActivatableFeature(db: Db, input: { organizationId: string; featureId: string }): Promise<void> {
  const states = await organizationResolvedFeatureStates(db, input);
  const state = states.find((candidate) => candidate.featureId === input.featureId);
  const operational = state ? featureOperationalState(state) : 'unsupported';
  if (operational === 'unsupported') {
    throw new DomainError('This feature is not available yet.', 'organization_plans.feature_unsupported');
  }
  if (operational === 'not_included') {
    throw new DomainError('This feature is not included for this business.', 'organization_plans.feature_not_entitled');
  }
}

/**
 * Enable (delete the override, idempotent if absent) an entitled feature this organization had
 * disabled. RLS (`organization_feature_activation_overrides_delete`) is the real enforcement —
 * this only maps its refusal to a clear error.
 */
export async function enableOrganizationFeature(
  db: Db,
  input: { organizationId: string; featureId: string },
): Promise<void> {
  await requireActor(db);
  const organization = await getOrganization(db, input.organizationId);
  if (!organization?.capabilities.includes('feature.manage')) {
    throw new DomainError('You cannot manage features here.', 'organization_plans.feature_forbidden');
  }
  await requireActivatableFeature(db, input);

  const { error } = await db
    .from('organization_feature_activation_overrides')
    .delete()
    .eq('organization_id', input.organizationId)
    .eq('feature_id', input.featureId);

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot manage features here.', 'organization_plans.feature_forbidden');
    }
    throw fromDatabaseError(error, 'organization_plans.enable_feature_failed');
  }
}

/**
 * Disable an entitled feature (insert the override, idempotent if already present — the same
 * `23505`-swallowing shape `setModuleEnabled` uses one axis over).
 */
export async function disableOrganizationFeature(
  db: Db,
  input: { organizationId: string; featureId: string },
): Promise<void> {
  const actor = await requireActor(db);
  await requireActivatableFeature(db, input);

  const { error } = await db.from('organization_feature_activation_overrides').insert({
    organization_id: input.organizationId,
    feature_id: input.featureId,
    disabled_by: actor.id,
  });

  if (error?.code === '23505') return;

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot manage features here.', 'organization_plans.feature_forbidden');
    }
    throw fromDatabaseError(error, 'organization_plans.disable_feature_failed');
  }
}

/**
 * Legacy `MODULES` keys this organization can currently act on, through the canonical
 * resolver — entitled *and* not deliberately disabled. A drop-in, stricter replacement for
 * `listUsableModules`'s raw wanted∩paid set at a presentation call site: everything
 * `listUsableModules` would say is on, minus anything this business has since switched off
 * through Settings > Features. Several canonical Features can share one legacy module key
 * (the capability catalogue's many-to-many seam); a key counts as active here if any of them does, matching how
 * `usable_modules` already treats the module axis as one fact per key.
 */
export function activeModuleKeys(states: readonly ResolvedFeatureState[]): Set<ModuleKey> {
  const keys = new Set<ModuleKey>();
  for (const state of states) {
    if (state.moduleKey && state.implementationState === 'available' && state.entitled && state.activation === 'active') {
      keys.add(state.moduleKey);
    }
  }
  return keys;
}

/** Runtime aliases do not imply shared setup requirements: CRM never needs a telephone account. */
export function readinessModuleKey(state: Pick<ResolvedFeatureState, 'featureKey' | 'moduleKey'>): ModuleKey | null {
  return ['pipeline', 'configurable_stages', 'qualification_state'].includes(state.featureKey) ? null : state.moduleKey;
}

/**
 * Canonical Feature keys this organization can currently act on — implemented, entitled and not
 * deliberately disabled. The feature-level counterpart to `activeModuleKeys`, and the one
 * `lib/navigation.ts`'s `Area.featureKeys` resolve against: two Features can share one legacy
 * `ModuleKey`, so a caller that only asked "is this module active" cannot tell them apart —
 * this can. Readiness is deliberately not a filter here: an available, entitled, active feature
 * that merely has nothing configured yet (`readiness: 'setup_required'`) still counts, since
 * setup-required is a reason to show the area with a "Set up" prompt, not to hide it.
 */
export function availableFeatureKeys(states: readonly ResolvedFeatureState[]): Set<string> {
  const keys = new Set<string>();
  for (const state of states) {
    if (state.implementationState === 'available' && state.entitled && state.activation === 'active') {
      keys.add(state.featureKey);
    }
  }
  return keys;
}

/**
 * The seller's subscription each of these businesses' plan assignments carry out (ADR-057): read
 * through the assignment's own link to the subscription line it came from. Empty for a business
 * this reader may not see the subscriptions of; `organizationId` is the seller.
 */
export async function subscriptionsForTenants(db: Db, input: { organizationId: string; tenantIds: string[] }): Promise<Map<string, string>> {
  if (input.tenantIds.length === 0) return new Map();
  const { data: assignments, error } = await db.from('organization_plan_assignments')
    .select('organization_id, subscription_line_id, period_start')
    .in('organization_id', input.tenantIds).not('subscription_line_id', 'is', null)
    .order('period_start', { ascending: false });
  if (error) throw fromDatabaseError(error, 'organization_plans.subscriptions_failed');
  const lineIds = [...new Set((assignments ?? []).map((row) => row.subscription_line_id as string))];
  if (lineIds.length === 0) return new Map();
  const { data: lines, error: linesError } = await db.from('subscription_lines').select('id, subscription_id')
    .eq('organization_id', input.organizationId).in('id', lineIds);
  if (linesError) throw fromDatabaseError(linesError, 'organization_plans.subscriptions_failed');
  const subscriptionByLine = new Map((lines ?? []).map((row) => [row.id, row.subscription_id]));
  const result = new Map<string, string>();
  for (const row of assignments ?? []) {
    const subscriptionId = subscriptionByLine.get(row.subscription_line_id as string);
    if (subscriptionId && !result.has(row.organization_id)) result.set(row.organization_id, subscriptionId);
  }
  return result;
}

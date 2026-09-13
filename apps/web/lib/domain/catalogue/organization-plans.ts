import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { listCatalogFeatures } from './catalogue';
import type { PlanKind } from './plans';
import { isModuleKey, type ModuleKey } from '@/lib/navigation';
import { listEnabledModules, listUsableModules } from '@/lib/domain/tenancy/modules';

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

export type PlanAgreement = {
  id: string;
  organizationId: string;
  planId: string;
  currency: string;
  amountMinor: number;
  effectiveFrom: string;
  recordedAt: string;
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

export type EffectivePrice = { amountMinor: number; currency: string; source: 'agreement' | 'standard' };

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
  throw new DomainError(error.code === '42501' ? 'Only platform staff may manage Plan assignments.' : error.message, code);
}

/** Every organization currently or historically assigned one Plan — the platform's "Organizations" tab on a Plan detail page. Staff-only in practice: RLS admits a tenant only its own rows. */
export async function listAssignmentsForPlan(db: Db, planId: string): Promise<PlanAssignment[]> {
  const { data, error } = await db
    .from('organization_plan_assignments')
    .select('id, organization_id, plan_id, plan_kind, period_start, period_end, assigned_at, note')
    .eq('plan_id', planId)
    .order('period_start', { ascending: false });
  if (error) throw new DomainError(error.message, 'organization_plans.assignments_for_plan_failed');
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
  if (error) throw new DomainError(error.message, 'organization_plans.assignments_failed');
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
  if (error) throw new DomainError(error.message, 'organization_plans.current_assignment_failed');
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
  if (error) throw new DomainError(error.message, 'organization_plans.current_addons_failed');
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

export type RecordPlanAssignmentInput = {
  organizationId: string;
  planId: string;
  periodStart: string;
  periodEnd: string;
  note?: string;
};

export async function recordPlanAssignment(db: Db, input: RecordPlanAssignmentInput): Promise<string> {
  const { data, error } = await db.rpc('record_plan_assignment', {
    p_organization_id: input.organizationId,
    p_plan_id: input.planId,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_note: input.note ?? '',
  });
  if (error) {
    if (error.code === '23P01') {
      throw new DomainError(
        'This business already has a base Plan covering part of this period. End it first, or choose a non-overlapping period.',
        'organization_plans.assignment_overlap',
      );
    }
    staffOnly(error, 'organization_plans.record_assignment_failed');
  }
  return data as string;
}

export async function listOrganizationPlanAgreements(
  db: Db,
  input: { organizationId: string; planId?: string },
): Promise<PlanAgreement[]> {
  let query = db
    .from('organization_plan_agreements')
    .select('id, organization_id, plan_id, currency, amount_minor, effective_from, recorded_at, note')
    .eq('organization_id', input.organizationId)
    .order('effective_from', { ascending: false });
  if (input.planId) query = query.eq('plan_id', input.planId);
  const { data, error } = await query;
  if (error) throw new DomainError(error.message, 'organization_plans.agreements_failed');
  return (data ?? []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    planId: row.plan_id,
    currency: row.currency,
    amountMinor: Number(row.amount_minor),
    effectiveFrom: row.effective_from,
    recordedAt: row.recorded_at,
    note: row.note,
  }));
}

export type RecordPlanAgreementInput = {
  organizationId: string;
  planId: string;
  currency: string;
  amountMinor: number;
  effectiveFrom?: string;
  note?: string;
};

export async function recordPlanAgreement(db: Db, input: RecordPlanAgreementInput): Promise<string> {
  const { data, error } = await db.rpc('record_plan_agreement', {
    p_organization_id: input.organizationId,
    p_plan_id: input.planId,
    p_currency: input.currency,
    p_amount_minor: input.amountMinor,
    p_effective_from: input.effectiveFrom ?? new Date().toISOString(),
    p_note: input.note ?? '',
  });
  if (error) staffOnly(error, 'organization_plans.record_agreement_failed');
  return data as string;
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
  if (error) throw new DomainError(error.message, 'organization_plans.effective_entitlements_failed');
  return (data ?? []).map((row: { feature_id: string; plan_id: string; plan_key: string }) => ({
    featureId: row.feature_id,
    planId: row.plan_id,
    planKey: row.plan_key,
  }));
}

export async function organizationPlanPrice(
  db: Db,
  input: { organizationId: string; planId: string; at?: string },
): Promise<EffectivePrice | null> {
  const { data, error } = await db.rpc('organization_plan_price', {
    p_organization_id: input.organizationId,
    p_plan_id: input.planId,
    p_at: input.at ?? new Date().toISOString(),
  });
  if (error) throw new DomainError(error.message, 'organization_plans.plan_price_failed');
  const row = (data ?? [])[0] as { amount_minor: string | number; currency: string; source: string } | undefined;
  if (!row) return null;
  return { amountMinor: Number(row.amount_minor), currency: row.currency, source: row.source as EffectivePrice['source'] };
}

export async function organizationEffectiveQuotas(
  db: Db,
  input: { organizationId: string; at?: string },
): Promise<EffectiveQuota[]> {
  const { data, error } = await db.rpc('organization_effective_quotas', {
    p_organization_id: input.organizationId,
    p_at: input.at ?? new Date().toISOString(),
  });
  if (error) throw new DomainError(error.message, 'organization_plans.effective_quotas_failed');
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
  implementationState: 'planned' | 'partial' | 'available';
  /** Whether this organization's Plan(s), or (absent a Plan assignment) its legacy wanted∩paid module state, currently grant this Feature. */
  entitled: boolean;
  entitlementSource: 'plan' | 'legacy_module' | 'none';
  /** Whether the organization has actually switched on the legacy module backing this Feature. `null` when the Feature has no `module_key` runtime mapping to ask that question of. */
  desired: boolean | null;
  /** The legacy `MODULES` key backing this Feature, if any — for a caller that wants a real "Configure" link via `moduleConfiguration()` rather than guessing one from catalogue labels. */
  moduleKey: ModuleKey | null;
};

/**
 * The one place implementation, entitlement and desired state are combined for presentation —
 * never collapsed into a single flag (section 11/21). A legacy organization with no Plan
 * assignment falls back to its existing wanted∩paid module resolution (`usable_modules`), so it
 * keeps seeing meaningful entitlement information rather than "not included" for everything.
 */
export async function organizationResolvedFeatureStates(
  db: Db,
  input: { organizationId: string },
): Promise<ResolvedFeatureState[]> {
  const [features, mappingsResult, planEntitlements, usable, enabled] = await Promise.all([
    listCatalogFeatures(db),
    db.from('platform_catalog_runtime_mappings').select('feature_id, mapping_value').eq('mapping_kind', 'module_key'),
    organizationEffectiveEntitlements(db, { organizationId: input.organizationId }),
    listUsableModules(db, { organizationId: input.organizationId }),
    listEnabledModules(db, { organizationId: input.organizationId }),
  ]);
  if (mappingsResult.error) throw new DomainError(mappingsResult.error.message, 'organization_plans.resolved_features_failed');

  const moduleKeyByFeature = new Map<string, ModuleKey>();
  for (const row of mappingsResult.data ?? []) {
    if (isModuleKey(row.mapping_value)) moduleKeyByFeature.set(row.feature_id, row.mapping_value);
  }
  const planEntitledIds = new Set(planEntitlements.map((e) => e.featureId));
  const hasPlanAssignment = planEntitlements.length > 0;

  return features.map((feature) => {
    const moduleKey = moduleKeyByFeature.get(feature.id);
    let entitled = false;
    let entitlementSource: ResolvedFeatureState['entitlementSource'] = 'none';

    if (hasPlanAssignment) {
      entitled = planEntitledIds.has(feature.id);
      entitlementSource = entitled ? 'plan' : 'none';
    } else if (moduleKey && usable.has(moduleKey)) {
      entitled = true;
      entitlementSource = 'legacy_module';
    }

    return {
      featureId: feature.id,
      implementationState: feature.implementationState,
      entitled,
      entitlementSource,
      desired: moduleKey ? enabled.has(moduleKey) : null,
      moduleKey: moduleKey ?? null,
    };
  });
}

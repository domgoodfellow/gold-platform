import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';

/**
 * Plans and Add-ons: reusable packaging over the canonical catalogue (`catalogue.ts`).
 *
 * A Plan is exclusive per organization at a time; an Add-on stacks freely (see
 * `organization_plan_assignments`' partial exclusion constraint, scoped to `plan_kind = 'plan'`).
 * Entitlement grants reference the canonical catalogue, never `platform_products` — see
 * `organization-plans.ts` for how an organization's assignments resolve into Features.
 */

export type PlanKind = 'plan' | 'addon';
export type SaleStatus = 'active' | 'unlisted' | 'archived';
export type OveragePolicy = 'allowed' | 'blocked' | 'not_applicable';
export type OverageBehavior = 'metered' | 'hard_limit' | 'soft_limit' | 'unmetered' | 'not_applicable';
export type AllowanceType = 'capacity' | 'recurring_resource' | 'usage' | 'boolean';
export type QuotaPeriod = 'day' | 'week' | 'month' | 'year' | 'none';

export type Plan = {
  id: string;
  key: string;
  kind: PlanKind;
  label: string;
  description: string;
  billable: boolean;
  saleStatus: SaleStatus;
  displayOrder: number;
};

export type PlanQuota = {
  id: string;
  planId: string;
  allowanceKey: string;
  label: string;
  unit: string;
  includedQuantity: number;
  period: QuotaPeriod;
  hardLimit: number | null;
  overagePolicy: OveragePolicy;
  serviceClass: string | null;
  meterId: string | null;
  displayOrder: number;
  allowanceType: AllowanceType;
  resetSemantics: 'billing_period' | 'calendar_period' | 'none';
  overageBehavior: OverageBehavior;
};

export type PlanPrice = {
  id: string;
  planId: string;
  currency: string;
  amountMinor: number;
  billingInterval: 'month' | 'year' | 'one_time';
  effectiveFrom: string;
  effectiveTo: string | null;
  approvalState: 'draft' | 'approved';
  source: string;
  note: string;
};

export type PlanOverageRate = {
  id: string;
  planId: string;
  meterId: string;
  currency: string;
  unitAmountMicros: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  source: string;
};

export type PlanMarginPolicy = { targetMargin: number; warningMargin: number; hardFloorMargin: number; currency: string; effectiveFrom: string };
export type PlanUtilizationAssumption = { scenario: 'low' | 'expected' | 'heavy' | 'max_allowance'; allowanceKey: string; utilization: number; effectiveFrom: string };

const PLAN_COLUMNS = 'id, key, kind, label, description, billable, sale_status, display_order';

function toPlan(row: {
  id: string;
  key: string;
  kind: string;
  label: string;
  description: string;
  billable: boolean;
  sale_status: string;
  display_order: number;
}): Plan {
  return {
    id: row.id,
    key: row.key,
    kind: row.kind as PlanKind,
    label: row.label,
    description: row.description,
    billable: row.billable,
    saleStatus: row.sale_status as SaleStatus,
    displayOrder: row.display_order,
  };
}

export async function listPlans(db: Db, input: { kind?: PlanKind } = {}): Promise<Plan[]> {
  let query = db.from('platform_plans').select(PLAN_COLUMNS).order('display_order');
  if (input.kind) query = query.eq('kind', input.kind);
  const { data, error } = await query;
  if (error) throw fromDatabaseError(error, 'plans.list_failed');
  return (data ?? []).map(toPlan);
}

export async function getPlan(db: Db, key: string): Promise<Plan | null> {
  const { data, error } = await db.from('platform_plans').select(PLAN_COLUMNS).eq('key', key).maybeSingle();
  if (error) throw fromDatabaseError(error, 'plans.get_failed');
  return data ? toPlan(data) : null;
}

export async function getPlanById(db: Db, planId: string): Promise<Plan | null> {
  const { data, error } = await db.from('platform_plans').select(PLAN_COLUMNS).eq('id', planId).maybeSingle();
  if (error) throw fromDatabaseError(error, 'plans.get_failed');
  return data ? toPlan(data) : null;
}

function staffOnly(error: { code?: string; message: string }, code: string): never {
  throw new DomainError(error.code === '42501' ? 'Only platform staff may manage Plans.' : error.message, code);
}

export type CreatePlanInput = {
  key: string;
  kind: PlanKind;
  label: string;
  description: string;
  billable: boolean;
  saleStatus?: SaleStatus;
  displayOrder?: number;
};

export async function createPlan(db: Db, input: CreatePlanInput): Promise<string> {
  const { data, error } = await db.rpc('create_plan', {
    p_key: input.key,
    p_kind: input.kind,
    p_label: input.label,
    p_description: input.description,
    p_billable: input.billable,
    p_sale_status: input.saleStatus ?? 'active',
    p_display_order: input.displayOrder ?? 0,
  });
  if (error) staffOnly(error, 'plans.create_failed');
  return data as string;
}

export type UpdatePlanInput = {
  planId: string;
  label: string;
  description: string;
  billable: boolean;
  saleStatus: SaleStatus;
  displayOrder: number;
};

export async function updatePlan(db: Db, input: UpdatePlanInput): Promise<void> {
  const { error } = await db.rpc('update_plan', {
    p_plan_id: input.planId,
    p_label: input.label,
    p_description: input.description,
    p_billable: input.billable,
    p_sale_status: input.saleStatus,
    p_display_order: input.displayOrder,
  });
  if (error) staffOnly(error, 'plans.update_failed');
}

/** `platform_plans.key` for a granted Product; joined for the caller's convenience. */
export async function listPlanProductGrants(db: Db, planId: string): Promise<string[]> {
  const { data, error } = await db
    .from('platform_plan_product_grants')
    .select('product:platform_catalog_products!inner(key)')
    .eq('plan_id', planId);
  if (error) throw fromDatabaseError(error, 'plans.product_grants_failed');
  return (data ?? []).map((row) => (row.product as unknown as { key: string }).key);
}

export type PlanProductGrant = { planId: string; productKey: string };

/** Canonical grant rows for several Plans; grouping belongs to the application caller. */
export async function listPlanProductGrantsForPlans(db: Db, planIds: string[]): Promise<PlanProductGrant[]> {
  if (planIds.length === 0) return [];
  const { data, error } = await db
    .from('platform_plan_product_grants')
    .select('plan_id, product:platform_catalog_products!inner(key)')
    .in('plan_id', [...new Set(planIds)]);
  if (error) throw fromDatabaseError(error, 'plans.product_grants_failed');
  return (data ?? []).map((row) => ({
    planId: row.plan_id,
    productKey: (row.product as unknown as { key: string }).key,
  }));
}

export async function listPlanModuleGrants(db: Db, planId: string): Promise<string[]> {
  const { data, error } = await db
    .from('platform_plan_module_grants')
    .select('module_id')
    .eq('plan_id', planId);
  if (error) throw fromDatabaseError(error, 'plans.module_grants_failed');
  return (data ?? []).map((row) => row.module_id);
}

export type PlanFeatureGrant = { featureId: string; included: boolean };

export async function listPlanFeatureGrants(db: Db, planId: string): Promise<PlanFeatureGrant[]> {
  const { data, error } = await db
    .from('platform_plan_feature_grants')
    .select('feature_id, included')
    .eq('plan_id', planId);
  if (error) throw fromDatabaseError(error, 'plans.feature_grants_failed');
  return (data ?? []).map((row) => ({ featureId: row.feature_id, included: row.included }));
}

/** Every Feature this Plan currently entitles, resolved server-side (override > module grant > product grant, `available` only). */
export async function planEntitledFeatureIds(db: Db, planId: string): Promise<Set<string>> {
  const { data, error } = await db.rpc('plan_entitled_features', { p_plan_id: planId });
  if (error) throw fromDatabaseError(error, 'plans.entitled_features_failed');
  return new Set((data ?? []).map((row: { feature_id: string }) => row.feature_id));
}

export type PlanEntitledFeature = { planId: string; featureId: string };

/** Bulk door over the same authoritative SQL calculation as `planEntitledFeatureIds`. */
export async function planEntitledFeatureIdsForPlans(db: Db, planIds: string[]): Promise<PlanEntitledFeature[]> {
  if (planIds.length === 0) return [];
  const { data, error } = await db.rpc('plan_entitled_features_bulk', { p_plan_ids: [...new Set(planIds)] });
  if (error) throw fromDatabaseError(error, 'plans.entitled_features_failed');
  return (data ?? []).map((row: { plan_id: string; feature_id: string }) => ({
    planId: row.plan_id,
    featureId: row.feature_id,
  }));
}

export async function grantPlanProduct(db: Db, input: { planId: string; productKey: string }): Promise<void> {
  const { error } = await db.rpc('grant_plan_product', { p_plan_id: input.planId, p_product_key: input.productKey });
  if (error) staffOnly(error, 'plans.grant_product_failed');
}

export async function revokePlanProduct(db: Db, input: { planId: string; productKey: string }): Promise<void> {
  const { error } = await db.rpc('revoke_plan_product', { p_plan_id: input.planId, p_product_key: input.productKey });
  if (error) staffOnly(error, 'plans.revoke_product_failed');
}

export async function grantPlanModule(db: Db, input: { planId: string; moduleId: string }): Promise<void> {
  const { error } = await db.rpc('grant_plan_module', { p_plan_id: input.planId, p_module_id: input.moduleId });
  if (error) staffOnly(error, 'plans.grant_module_failed');
}

export async function revokePlanModule(db: Db, input: { planId: string; moduleId: string }): Promise<void> {
  const { error } = await db.rpc('revoke_plan_module', { p_plan_id: input.planId, p_module_id: input.moduleId });
  if (error) staffOnly(error, 'plans.revoke_module_failed');
}

export async function setPlanFeatureOverride(
  db: Db,
  input: { planId: string; featureId: string; included: boolean },
): Promise<void> {
  const { error } = await db.rpc('set_plan_feature_override', {
    p_plan_id: input.planId,
    p_feature_id: input.featureId,
    p_included: input.included,
  });
  if (error) staffOnly(error, 'plans.set_feature_override_failed');
}

export async function clearPlanFeatureOverride(db: Db, input: { planId: string; featureId: string }): Promise<void> {
  const { error } = await db.rpc('clear_plan_feature_override', { p_plan_id: input.planId, p_feature_id: input.featureId });
  if (error) staffOnly(error, 'plans.clear_feature_override_failed');
}

function toQuota(row: {
  id: string;
  plan_id: string;
  allowance_key: string;
  label: string;
  unit: string;
  included_quantity: string | number;
  period: string;
  hard_limit: string | number | null;
  overage_policy: string;
  service_class: string | null;
  meter_id: string | null;
  display_order: number;
  allowance_type: string;
  reset_semantics: string;
  overage_behavior: string;
}): PlanQuota {
  return {
    id: row.id,
    planId: row.plan_id,
    allowanceKey: row.allowance_key,
    label: row.label,
    unit: row.unit,
    includedQuantity: Number(row.included_quantity),
    period: row.period as QuotaPeriod,
    hardLimit: row.hard_limit === null ? null : Number(row.hard_limit),
    overagePolicy: row.overage_policy as OveragePolicy,
    serviceClass: row.service_class,
    meterId: row.meter_id,
    displayOrder: row.display_order,
    allowanceType: row.allowance_type as AllowanceType,
    resetSemantics: row.reset_semantics as PlanQuota['resetSemantics'],
    overageBehavior: row.overage_behavior as OverageBehavior,
  };
}

export async function listPlanQuotas(db: Db, planId: string): Promise<PlanQuota[]> {
  const { data, error } = await db
    .from('platform_plan_quotas')
    .select('id, plan_id, allowance_key, label, unit, included_quantity, period, hard_limit, overage_policy, service_class, meter_id, display_order, allowance_type, reset_semantics, overage_behavior')
    .eq('plan_id', planId)
    .order('display_order');
  if (error) throw fromDatabaseError(error, 'plans.quotas_failed');
  return (data ?? []).map(toQuota);
}

export type SetPlanQuotaInput = {
  planId: string;
  allowanceKey: string;
  label: string;
  unit: string;
  includedQuantity: number;
  period?: QuotaPeriod;
  hardLimit?: number | null;
  overagePolicy?: OveragePolicy;
  serviceClass?: string | null;
  meterId?: string | null;
  displayOrder?: number;
  allowanceType?: AllowanceType;
  resetSemantics?: PlanQuota['resetSemantics'];
  overageBehavior?: OverageBehavior;
};

export async function setPlanQuota(db: Db, input: SetPlanQuotaInput): Promise<string> {
  const overageBehavior = input.overageBehavior ?? (input.overagePolicy === 'allowed' ? 'metered' : input.overagePolicy === 'blocked' ? 'hard_limit' : 'not_applicable');
  const { data, error } = await db.rpc('set_plan_allowance', ({
    p_plan_id: input.planId,
    p_allowance_key: input.allowanceKey,
    p_label: input.label,
    p_unit: input.unit,
    p_included_quantity: input.includedQuantity,
    p_period: input.period ?? 'month',
    p_hard_limit: input.hardLimit ?? null,
    p_overage_behavior: overageBehavior,
    p_allowance_type: input.allowanceType ?? (input.meterId ? 'usage' : 'capacity'),
    p_reset_semantics: input.resetSemantics ?? (input.period === 'none' ? 'none' : 'billing_period'),
    p_service_class: input.serviceClass ?? null,
    p_meter_id: input.meterId ?? null,
    p_display_order: input.displayOrder ?? 0,
  }) as never);
  if (error) staffOnly(error, 'plans.set_quota_failed');
  return data as string;
}

export async function removePlanQuota(db: Db, input: { planId: string; allowanceKey: string }): Promise<void> {
  const { error } = await db.rpc('remove_plan_quota', { p_plan_id: input.planId, p_allowance_key: input.allowanceKey });
  if (error) staffOnly(error, 'plans.remove_quota_failed');
}

function toPrice(row: {
  id: string;
  plan_id: string;
  currency: string;
  amount_minor: string | number;
  billing_interval: string;
  effective_from: string;
  effective_to: string | null;
  approval_state: string;
  source: string;
  note: string;
}): PlanPrice {
  return {
    id: row.id,
    planId: row.plan_id,
    currency: row.currency,
    amountMinor: Number(row.amount_minor),
    billingInterval: row.billing_interval as PlanPrice['billingInterval'],
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    approvalState: row.approval_state as PlanPrice['approvalState'],
    source: row.source,
    note: row.note,
  };
}

export async function listPlanPrices(db: Db, planId: string): Promise<PlanPrice[]> {
  const { data, error } = await db
    .from('platform_plan_prices')
    .select('id, plan_id, currency, amount_minor, billing_interval, effective_from, effective_to, approval_state, source, note')
    .eq('plan_id', planId)
    .order('effective_from', { ascending: false });
  if (error) throw fromDatabaseError(error, 'plans.prices_failed');
  return (data ?? []).map(toPrice);
}

/**
 * The one price in force right now for a currency and billing interval, or null if none is
 * approved yet. `prices` is already ordered newest-first (`listPlanPrices`), so the first
 * approved, currently-effective match is the answer — never a second resolution of "which price"
 * built separately from it.
 */
export function currentPlanPrice(
  prices: readonly PlanPrice[],
  input: { currency: string; billingInterval: PlanPrice['billingInterval']; asOf?: Date },
): PlanPrice | null {
  const asOf = input.asOf ?? new Date();
  return (
    prices.find(
      (price) =>
        price.currency === input.currency &&
        price.billingInterval === input.billingInterval &&
        price.approvalState === 'approved' &&
        new Date(price.effectiveFrom) <= asOf &&
        (price.effectiveTo === null || new Date(price.effectiveTo) > asOf),
    ) ?? null
  );
}

export type RecordPlanPriceInput = {
  planId: string;
  currency: string;
  amountMinor: number;
  billingInterval: 'month' | 'year' | 'one_time';
  effectiveFrom?: string;
  source?: string;
  note?: string;
};

export async function recordPlanPrice(db: Db, input: RecordPlanPriceInput): Promise<string> {
  const { data, error } = await db.rpc('record_plan_price', {
    p_plan_id: input.planId,
    p_currency: input.currency,
    p_amount_minor: input.amountMinor,
    p_billing_interval: input.billingInterval,
    p_effective_from: input.effectiveFrom ?? new Date().toISOString(),
    p_source: input.source ?? '',
    p_note: input.note ?? '',
  });
  if (error) staffOnly(error, 'plans.record_price_failed');
  return data as string;
}

export async function listPlanOverageRates(db: Db, planId: string): Promise<PlanOverageRate[]> {
  const { data, error } = await db.from('platform_retail_rates')
    .select('id,plan_id,meter_id,currency,unit_amount_micros,effective_from,effective_to,source')
    .eq('plan_id', planId).is('organization_id', null).order('effective_from', { ascending: false });
  if (error) throw fromDatabaseError(error, 'plans.overage_rates_failed');
  return (data ?? []).map((row) => ({ id: row.id, planId: row.plan_id!, meterId: row.meter_id, currency: row.currency, unitAmountMicros: Number(row.unit_amount_micros), effectiveFrom: row.effective_from, effectiveTo: row.effective_to, source: row.source }));
}

export async function recordPlanOverageRate(db: Db, input: { planId: string; meterId: string; currency: string; unitAmountMicros: number; effectiveFrom: string; source: string; note?: string }): Promise<string> {
  const { data, error } = await db.rpc('record_commercial_retail_rate', ({
    p_meter_id: input.meterId,
    p_currency: input.currency,
    p_unit_amount_micros: input.unitAmountMicros,
    p_effective_from: input.effectiveFrom,
    p_source: input.source,
    p_plan_id: input.planId,
    p_organization_id: null,
    p_billing_interval: 'month',
    p_effective_to: null,
    p_approval_state: 'approved',
    p_note: input.note ?? '',
  }) as never);
  if (error) staffOnly(error, 'plans.record_overage_rate_failed');
  return data as string;
}

export async function currentPlanMarginPolicy(db: Db, planId: string, currency: string): Promise<PlanMarginPolicy | null> {
  const { data, error } = await db.from('platform_plan_margin_policies').select('target_margin,warning_margin,hard_floor_margin,currency,effective_from').eq('plan_id', planId).eq('currency', currency).lte('effective_from', new Date().toISOString()).order('effective_from', { ascending: false }).limit(1).maybeSingle();
  if (error) throw fromDatabaseError(error, 'plans.margin_policy_failed');
  return data ? { targetMargin: Number(data.target_margin), warningMargin: Number(data.warning_margin), hardFloorMargin: Number(data.hard_floor_margin), currency: data.currency, effectiveFrom: data.effective_from } : null;
}

export async function listPlanUtilizationAssumptions(db: Db, planId: string): Promise<PlanUtilizationAssumption[]> {
  const { data, error } = await db.from('platform_plan_utilization_assumptions').select('scenario,allowance_key,utilization,effective_from').eq('plan_id', planId).lte('effective_from', new Date().toISOString()).order('effective_from', { ascending: false });
  if (error) throw fromDatabaseError(error, 'plans.utilization_assumptions_failed');
  const seen = new Set<string>();
  return (data ?? []).flatMap((row) => { const key = `${row.scenario}:${row.allowance_key}`; if (seen.has(key)) return []; seen.add(key); return [{ scenario: row.scenario as PlanUtilizationAssumption['scenario'], allowanceKey: row.allowance_key, utilization: Number(row.utilization), effectiveFrom: row.effective_from }]; });
}

export async function recordPlanMarginPolicy(db: Db, input: { planId: string; currency: string; targetMargin: number; warningMargin: number; hardFloorMargin: number; effectiveFrom: string; source: string }): Promise<string> {
  const { data, error } = await db.rpc('record_plan_margin_policy', { p_plan_id: input.planId, p_currency: input.currency, p_target_margin: input.targetMargin, p_warning_margin: input.warningMargin, p_hard_floor_margin: input.hardFloorMargin, p_effective_from: input.effectiveFrom, p_source: input.source, p_note: '' });
  if (error) staffOnly(error, 'plans.record_margin_policy_failed');
  return data as string;
}

export async function recordPlanUtilizationAssumption(db: Db, input: { planId: string; scenario: PlanUtilizationAssumption['scenario']; allowanceKey: string; utilization: number; effectiveFrom: string; source: string }): Promise<string> {
  const { data, error } = await db.rpc('record_plan_utilization_assumption', { p_plan_id: input.planId, p_scenario: input.scenario, p_allowance_key: input.allowanceKey, p_utilization: input.utilization, p_effective_from: input.effectiveFrom, p_source: input.source, p_note: '' });
  if (error) staffOnly(error, 'plans.record_utilization_failed');
  return data as string;
}

export async function listPlanAddonIds(db: Db, planId: string): Promise<string[]> {
  const { data, error } = await db.from('platform_plan_addons').select('addon_plan_id').eq('plan_id', planId);
  if (error) throw fromDatabaseError(error, 'plans.addons_failed');
  return (data ?? []).map((row) => row.addon_plan_id);
}

export async function setPlanAddon(db: Db, input: { planId: string; addonPlanId: string; attached: boolean }): Promise<void> {
  const { error } = input.attached
    ? await db.rpc('attach_plan_addon', { p_plan_id: input.planId, p_addon_plan_id: input.addonPlanId, p_included_by_default: false })
    : await db.rpc('detach_plan_addon', { p_plan_id: input.planId, p_addon_plan_id: input.addonPlanId });
  if (error) staffOnly(error, 'plans.set_addon_failed');
}

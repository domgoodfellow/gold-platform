import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

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
};

export type PlanPrice = {
  id: string;
  planId: string;
  currency: string;
  amountMinor: number;
  billingInterval: 'month' | 'year' | 'one_time';
  effectiveFrom: string;
  approvalState: 'draft' | 'approved';
  source: string;
  note: string;
};

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
  if (error) throw new DomainError(error.message, 'plans.list_failed');
  return (data ?? []).map(toPlan);
}

export async function getPlan(db: Db, key: string): Promise<Plan | null> {
  const { data, error } = await db.from('platform_plans').select(PLAN_COLUMNS).eq('key', key).maybeSingle();
  if (error) throw new DomainError(error.message, 'plans.get_failed');
  return data ? toPlan(data) : null;
}

export async function getPlanById(db: Db, planId: string): Promise<Plan | null> {
  const { data, error } = await db.from('platform_plans').select(PLAN_COLUMNS).eq('id', planId).maybeSingle();
  if (error) throw new DomainError(error.message, 'plans.get_failed');
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
  if (error) throw new DomainError(error.message, 'plans.product_grants_failed');
  return (data ?? []).map((row) => (row.product as unknown as { key: string }).key);
}

export async function listPlanModuleGrants(db: Db, planId: string): Promise<string[]> {
  const { data, error } = await db
    .from('platform_plan_module_grants')
    .select('module_id')
    .eq('plan_id', planId);
  if (error) throw new DomainError(error.message, 'plans.module_grants_failed');
  return (data ?? []).map((row) => row.module_id);
}

export type PlanFeatureGrant = { featureId: string; included: boolean };

export async function listPlanFeatureGrants(db: Db, planId: string): Promise<PlanFeatureGrant[]> {
  const { data, error } = await db
    .from('platform_plan_feature_grants')
    .select('feature_id, included')
    .eq('plan_id', planId);
  if (error) throw new DomainError(error.message, 'plans.feature_grants_failed');
  return (data ?? []).map((row) => ({ featureId: row.feature_id, included: row.included }));
}

/** Every Feature this Plan currently entitles, resolved server-side (override > module grant > product grant, `available` only). */
export async function planEntitledFeatureIds(db: Db, planId: string): Promise<Set<string>> {
  const { data, error } = await db.rpc('plan_entitled_features', { p_plan_id: planId });
  if (error) throw new DomainError(error.message, 'plans.entitled_features_failed');
  return new Set((data ?? []).map((row: { feature_id: string }) => row.feature_id));
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
  };
}

export async function listPlanQuotas(db: Db, planId: string): Promise<PlanQuota[]> {
  const { data, error } = await db
    .from('platform_plan_quotas')
    .select('id, plan_id, allowance_key, label, unit, included_quantity, period, hard_limit, overage_policy, service_class, meter_id, display_order')
    .eq('plan_id', planId)
    .order('display_order');
  if (error) throw new DomainError(error.message, 'plans.quotas_failed');
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
};

export async function setPlanQuota(db: Db, input: SetPlanQuotaInput): Promise<string> {
  const { data, error } = await db.rpc('set_plan_quota', {
    p_plan_id: input.planId,
    p_allowance_key: input.allowanceKey,
    p_label: input.label,
    p_unit: input.unit,
    p_included_quantity: input.includedQuantity,
    p_period: input.period ?? 'month',
    p_hard_limit: input.hardLimit ?? undefined,
    p_overage_policy: input.overagePolicy ?? 'not_applicable',
    p_service_class: input.serviceClass ?? undefined,
    p_meter_id: input.meterId ?? undefined,
    p_display_order: input.displayOrder ?? 0,
  });
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
    approvalState: row.approval_state as PlanPrice['approvalState'],
    source: row.source,
    note: row.note,
  };
}

export async function listPlanPrices(db: Db, planId: string): Promise<PlanPrice[]> {
  const { data, error } = await db
    .from('platform_plan_prices')
    .select('id, plan_id, currency, amount_minor, billing_interval, effective_from, approval_state, source, note')
    .eq('plan_id', planId)
    .order('effective_from', { ascending: false });
  if (error) throw new DomainError(error.message, 'plans.prices_failed');
  return (data ?? []).map(toPrice);
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

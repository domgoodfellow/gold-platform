import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';

/**
 * Every GildOps cost that is not a `usage_cost_components` reading: a recurring resource's
 * rental, a shared or attributed slice of a platform infrastructure bill, or a manually tracked
 * direct cost (Work Order B, B1/B2).
 *
 * **`usage_direct` stays where it already was.** This module never touches
 * `usage_cost_components` — the fourth stored category this repo's cost taxonomy recognises, and
 * the one Work Order A's `app.record_usage` already writes.
 */
export type CostCategory =
  | 'resource_direct'
  | 'infrastructure_attributable'
  | 'infrastructure_shared'
  | 'manual_direct';

/**
 * How sure GildOps is about whose cost this is — a fact kept beside every attributed or
 * deliberately-unattributed number, never inferred from the amount alone.
 */
export type AllocationQuality = 'direct' | 'measured' | 'estimated' | 'shared' | 'unallocated';

export type InfrastructureCostComponent = {
  id: string;
  organizationId: string | null;
  costCategory: CostCategory;
  allocationQuality: AllocationQuality;
  providerKey: string | null;
  providerAccountId: string | null;
  providerBindingId: string | null;
  providerResourceId: string | null;
  billingPeriod: string;
  nativeCostMicros: number;
  nativeCurrency: string;
  reportingCostMicros: number | null;
  reportingCurrency: string | null;
  driverBasis: string | null;
  driverQuantity: number | null;
  providerReference: string | null;
  source: string;
  note: string;
  recordedAt: string;
};

function toComponent(row: {
  id: string;
  organization_id: string | null;
  cost_category: string;
  allocation_quality: string;
  provider_key: string | null;
  provider_account_id: string | null;
  provider_binding_id: string | null;
  provider_resource_id: string | null;
  billing_period: string;
  native_cost_micros: number | string;
  native_currency: string;
  reporting_cost_micros: number | string | null;
  reporting_currency: string | null;
  driver_basis: string | null;
  driver_quantity: number | string | null;
  provider_reference: string | null;
  source: string;
  note: string;
  recorded_at: string;
}): InfrastructureCostComponent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    costCategory: row.cost_category as CostCategory,
    allocationQuality: row.allocation_quality as AllocationQuality,
    providerKey: row.provider_key,
    providerAccountId: row.provider_account_id,
    providerBindingId: row.provider_binding_id,
    providerResourceId: row.provider_resource_id,
    billingPeriod: row.billing_period,
    nativeCostMicros: Number(row.native_cost_micros),
    nativeCurrency: row.native_currency,
    reportingCostMicros: row.reporting_cost_micros === null ? null : Number(row.reporting_cost_micros),
    reportingCurrency: row.reporting_currency,
    driverBasis: row.driver_basis,
    driverQuantity: row.driver_quantity === null ? null : Number(row.driver_quantity),
    providerReference: row.provider_reference,
    source: row.source,
    note: row.note,
    recordedAt: row.recorded_at,
  };
}

const COLUMNS =
  'id, organization_id, cost_category, allocation_quality, provider_key, provider_account_id, provider_binding_id, provider_resource_id, billing_period, native_cost_micros, native_currency, reporting_cost_micros, reporting_currency, driver_basis, driver_quantity, provider_reference, source, note, recorded_at';

/** Every infrastructure cost component for one organization, newest billing period first. Staff-only (RLS). */
export async function listOrganizationInfrastructureCosts(
  db: Db,
  input: { organizationId: string; from?: string; to?: string },
): Promise<InfrastructureCostComponent[]> {
  let query = db.from('platform_infrastructure_cost_components').select(COLUMNS).eq('organization_id', input.organizationId);
  if (input.from) query = query.gte('billing_period', input.from);
  if (input.to) query = query.lt('billing_period', input.to);
  const { data, error } = await query.order('billing_period', { ascending: false });
  if (error) throw fromDatabaseError(error, 'infrastructure_costs.list_failed');
  return (data ?? []).map(toComponent);
}

/** Shared and unallocated platform costs for a period — organization_id is null by construction. */
export async function listSharedInfrastructureCosts(
  db: Db,
  input: { from?: string; to?: string },
): Promise<InfrastructureCostComponent[]> {
  let query = db.from('platform_infrastructure_cost_components').select(COLUMNS).is('organization_id', null);
  if (input.from) query = query.gte('billing_period', input.from);
  if (input.to) query = query.lt('billing_period', input.to);
  const { data, error } = await query.order('billing_period', { ascending: false });
  if (error) throw fromDatabaseError(error, 'infrastructure_costs.shared_list_failed');
  return (data ?? []).map(toComponent);
}

export type RecordInfrastructureCostInput = {
  costCategory: CostCategory;
  allocationQuality: AllocationQuality;
  billingPeriod: string;
  nativeCostMicros: number;
  nativeCurrency: string;
  source: string;
  organizationId?: string | null;
  providerKey?: string | null;
  providerAccountId?: string | null;
  providerBindingId?: string | null;
  providerResourceId?: string | null;
  reportingCostMicros?: number | null;
  reportingCurrency?: string | null;
  fxRateId?: string | null;
  fxRate?: number | null;
  driverBasis?: string | null;
  driverQuantity?: number | null;
  providerReference?: string | null;
  note?: string;
};

/** The one door onto `platform_infrastructure_cost_components`. Needs `platform.commercial`. */
export async function recordInfrastructureCost(db: Db, input: RecordInfrastructureCostInput): Promise<string> {
  const { data, error } = await db.rpc('record_infrastructure_cost', {
    p_cost_category: input.costCategory,
    p_allocation_quality: input.allocationQuality,
    p_billing_period: input.billingPeriod,
    p_native_cost_micros: input.nativeCostMicros,
    p_native_currency: input.nativeCurrency,
    p_source: input.source,
    p_organization_id: input.organizationId ?? undefined,
    p_provider_key: input.providerKey ?? undefined,
    p_provider_account_id: input.providerAccountId ?? undefined,
    p_provider_binding_id: input.providerBindingId ?? undefined,
    p_provider_resource_id: input.providerResourceId ?? undefined,
    p_reporting_cost_micros: input.reportingCostMicros ?? undefined,
    p_reporting_currency: input.reportingCurrency ?? undefined,
    p_fx_rate_id: input.fxRateId ?? undefined,
    p_fx_rate: input.fxRate ?? undefined,
    p_driver_basis: input.driverBasis ?? undefined,
    p_driver_quantity: input.driverQuantity ?? undefined,
    p_provider_reference: input.providerReference ?? undefined,
    p_note: input.note ?? '',
  } as never);
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'This needs the commercial platform permission.' : error.message,
      'infrastructure_costs.record_failed',
    );
  }
  return data as string;
}

export type OrganizationCostToServe = {
  reportingCurrency: string;
  directUsageCogsMicros: number;
  directUsageHasUnknown: boolean | null;
  resourceCogsMicros: number;
  infrastructureAttributableCogsMicros: number;
  manualDirectCogsMicros: number;
  /** usage_direct + resource_direct + infrastructure_attributable + manual_direct, known only. */
  attributableKnownCogsMicros: number;
  /** Whether any attributable component for this organization is only an estimate. */
  attributableHasEstimated: boolean;
  /** Platform-wide overhead this period — context, never added to this organization's own cost. */
  sharedPlatformCostMicros: number;
  /** A real cost with no valid allocation basis yet — also never attributed to this organization. */
  unallocatedCostMicros: number;
  componentCount: number;
  knownComponentCount: number;
  /** Fraction of cost components this read actually found priced in the reporting currency. 1 with zero components is "nothing to be incomplete about," not completeness over real missing data. */
  costCoverage: number;
};

/**
 * What it cost GildOps to serve this organization in this period — staff only. Shared platform
 * overhead and the unallocated residual are reported beside the attributable total, never folded
 * into it (the rule this whole work order repeats because a margin becomes a lie without it).
 */
export async function organizationCostToServe(
  db: Db,
  input: { organizationId: string; periodStart: string; periodEnd: string; reportingCurrency?: string },
): Promise<OrganizationCostToServe> {
  const { data, error } = await db.rpc('organization_cost_to_serve', {
    p_organization_id: input.organizationId,
    p_period_start: input.periodStart,
    p_period_end: input.periodEnd,
    p_reporting_currency: input.reportingCurrency ?? 'CAD',
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'Only platform staff may read this.' : error.message,
      'infrastructure_costs.cost_to_serve_failed',
    );
  }
  const row = (data ?? [])[0] as
    | {
        reporting_currency: string;
        direct_usage_cogs_micros: number | string;
        direct_usage_has_unknown: boolean | null;
        resource_cogs_micros: number | string;
        infrastructure_attributable_cogs_micros: number | string;
        manual_direct_cogs_micros: number | string;
        attributable_known_cogs_micros: number | string;
        attributable_has_unallocated_peer: boolean;
        shared_platform_cost_micros: number | string;
        unallocated_cost_micros: number | string;
        component_count: number | string;
        known_component_count: number | string;
        cost_coverage: number | string;
      }
    | undefined;
  if (!row) throw new DomainError('No cost-to-serve row was returned.', 'infrastructure_costs.cost_to_serve_failed');
  return {
    reportingCurrency: row.reporting_currency,
    directUsageCogsMicros: Number(row.direct_usage_cogs_micros),
    directUsageHasUnknown: row.direct_usage_has_unknown,
    resourceCogsMicros: Number(row.resource_cogs_micros),
    infrastructureAttributableCogsMicros: Number(row.infrastructure_attributable_cogs_micros),
    manualDirectCogsMicros: Number(row.manual_direct_cogs_micros),
    attributableKnownCogsMicros: Number(row.attributable_known_cogs_micros),
    attributableHasEstimated: Boolean(row.attributable_has_unallocated_peer),
    sharedPlatformCostMicros: Number(row.shared_platform_cost_micros),
    unallocatedCostMicros: Number(row.unallocated_cost_micros),
    componentCount: Number(row.component_count),
    knownComponentCount: Number(row.known_component_count),
    costCoverage: Number(row.cost_coverage),
  };
}

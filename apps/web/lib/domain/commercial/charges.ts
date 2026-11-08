import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';

/**
 * The customer-side charge model (Work Order B, B7/B8). **A charge is an obligation, not an
 * invoice and not a payment** — why a business owes what it owes for one billing period. Revenue
 * and payment state are two different questions; this module owns only the first.
 */

export type ChargeComponentType =
  | 'base_plan'
  | 'addon'
  | 'recurring_resource'
  | 'usage_overage'
  | 'one_time_service'
  | 'debit_adjustment'
  | 'credit_adjustment';

export type ChargeComponent = {
  id: string;
  organizationId: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  componentType: ChargeComponentType;
  /** Always the magnitude — `componentType` says which direction it moves the obligation. */
  amountMinor: number;
  currency: string;
  sourceDomain: string;
  sourceRecordId: string;
  description: string;
  provenance: Record<string, unknown>;
  computedAt: string;
  finalizedAt: string | null;
};

function toComponent(row: {
  id: string;
  organization_id: string;
  billing_period_start: string;
  billing_period_end: string;
  component_type: string;
  amount_minor: number | string;
  currency: string;
  source_domain: string;
  source_record_id: string;
  description: string;
  provenance: unknown;
  computed_at: string;
  finalized_at: string | null;
}): ChargeComponent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    billingPeriodStart: row.billing_period_start,
    billingPeriodEnd: row.billing_period_end,
    componentType: row.component_type as ChargeComponentType,
    amountMinor: Math.round(Number(row.amount_minor)),
    currency: row.currency,
    sourceDomain: row.source_domain,
    sourceRecordId: row.source_record_id,
    description: row.description,
    provenance: (row.provenance ?? {}) as Record<string, unknown>,
    computedAt: row.computed_at,
    finalizedAt: row.finalized_at,
  };
}

const COLUMNS =
  'id, organization_id, billing_period_start, billing_period_end, component_type, amount_minor, currency, source_domain, source_record_id, description, provenance, computed_at, finalized_at';

/**
 * Every charge component for one organization's billing period — a member reads their own
 * business's (revenue is a fact a tenant may read, the platform-economics separation's asymmetry, unlike cost); staff read any.
 */
export async function listOrganizationCharges(
  db: Db,
  input: { organizationId: string; billingPeriodStart: string; billingPeriodEnd: string },
): Promise<ChargeComponent[]> {
  const { data, error } = await db
    .from('organization_charge_components')
    .select(COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('billing_period_start', input.billingPeriodStart)
    .eq('billing_period_end', input.billingPeriodEnd)
    .order('component_type');
  if (error) throw fromDatabaseError(error, 'charges.list_failed');
  return (data ?? []).map(toComponent);
}

export type ComposeResultRow = { kind: ChargeComponentType; written: boolean; prorationRequired: boolean };

/**
 * Composes (or idempotently refreshes) every charge component for one organization and billing
 * period. Running twice never duplicates a component, and a finalized component is never
 * rewritten. A component kind whose commercial assignments disagree mid-period is skipped and
 * reported in `prorationRequired` rather than guessed. Needs `platform.commercial`.
 */
export async function composeOrganizationCharges(
  db: Db,
  input: { organizationId: string; billingPeriodStart: string; billingPeriodEnd: string },
): Promise<ComposeResultRow[]> {
  const { data, error } = await db.rpc('compose_organization_charges', {
    p_organization_id: input.organizationId,
    p_billing_period_start: input.billingPeriodStart,
    p_billing_period_end: input.billingPeriodEnd,
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'This needs the commercial platform permission.' : error.message,
      'charges.compose_failed',
    );
  }
  return ((data ?? []) as { kind: string; written: boolean; proration_required: boolean }[]).map((row) => ({
    kind: row.kind as ChargeComponentType,
    written: row.written,
    prorationRequired: row.proration_required,
  }));
}

/** Freezes every not-yet-finalized component of one organization's billing period. Needs `platform.commercial`. */
export async function finalizeOrganizationCharges(
  db: Db,
  input: { organizationId: string; billingPeriodStart: string; billingPeriodEnd: string },
): Promise<number> {
  const { data, error } = await db.rpc('finalize_organization_charges', {
    p_organization_id: input.organizationId,
    p_billing_period_start: input.billingPeriodStart,
    p_billing_period_end: input.billingPeriodEnd,
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'This needs the commercial platform permission.' : error.message,
      'charges.finalize_failed',
    );
  }
  return Number(data);
}

export type RecordAdjustmentInput = {
  organizationId: string;
  direction: 'debit' | 'credit';
  amountMinor: number;
  currency: string;
  reason: string;
  effectiveAt?: string;
};

/** The only writer of `organization_commercial_adjustments` — a minimal, staff-recorded debit or credit, never a refund/payment mechanism. Needs `platform.commercial`. */
export async function recordCommercialAdjustment(db: Db, input: RecordAdjustmentInput): Promise<string> {
  const { data, error } = await db.rpc('record_commercial_adjustment', {
    p_organization_id: input.organizationId,
    p_direction: input.direction,
    p_amount_minor: input.amountMinor,
    p_currency: input.currency,
    p_reason: input.reason,
    p_effective_at: input.effectiveAt ?? new Date().toISOString(),
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'This needs the commercial platform permission.' : error.message,
      'charges.record_adjustment_failed',
    );
  }
  return data as string;
}

export type OrganizationRevenueSummary = {
  reportingCurrency: string;
  basePlanMinor: number;
  addonMinor: number;
  recurringResourceMinor: number;
  usageOverageMinor: number;
  oneTimeServiceMinor: number;
  debitAdjustmentMinor: number;
  creditAdjustmentMinor: number;
  customerObligationMinor: number;
  hasMixedCurrency: boolean;
  knownCostToServeMinor: number;
  knownContributionMinor: number;
  /** Null when obligation is zero — a margin of nothing over nothing is not a number. */
  knownMargin: number | null;
  costCoverage: number;
};

/** Revenue by component type, known cost-to-serve, contribution and margin — staff only. */
export async function organizationRevenueSummary(
  db: Db,
  input: { organizationId: string; billingPeriodStart: string; billingPeriodEnd: string; reportingCurrency?: string },
): Promise<OrganizationRevenueSummary> {
  const { data, error } = await db.rpc('organization_revenue_summary', {
    p_organization_id: input.organizationId,
    p_billing_period_start: input.billingPeriodStart,
    p_billing_period_end: input.billingPeriodEnd,
    p_reporting_currency: input.reportingCurrency ?? 'CAD',
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'Only platform staff may read this.' : error.message,
      'charges.revenue_summary_failed',
    );
  }
  const row = (data ?? [])[0] as
    | {
        reporting_currency: string;
        base_plan_minor: number | string;
        addon_minor: number | string;
        recurring_resource_minor: number | string;
        usage_overage_minor: number | string;
        one_time_service_minor: number | string;
        debit_adjustment_minor: number | string;
        credit_adjustment_minor: number | string;
        customer_obligation_minor: number | string;
        has_mixed_currency: boolean;
        known_cost_to_serve_minor: number | string;
        known_contribution_minor: number | string;
        known_margin: number | string | null;
        cost_coverage: number | string;
      }
    | undefined;
  if (!row) throw new DomainError('No revenue summary was returned.', 'charges.revenue_summary_failed');
  return {
    reportingCurrency: row.reporting_currency,
    basePlanMinor: Number(row.base_plan_minor),
    addonMinor: Number(row.addon_minor),
    recurringResourceMinor: Number(row.recurring_resource_minor),
    usageOverageMinor: Number(row.usage_overage_minor),
    oneTimeServiceMinor: Number(row.one_time_service_minor),
    debitAdjustmentMinor: Number(row.debit_adjustment_minor),
    creditAdjustmentMinor: Number(row.credit_adjustment_minor),
    customerObligationMinor: Number(row.customer_obligation_minor),
    hasMixedCurrency: row.has_mixed_currency,
    knownCostToServeMinor: Number(row.known_cost_to_serve_minor),
    knownContributionMinor: Number(row.known_contribution_minor),
    knownMargin: row.known_margin === null ? null : Number(row.known_margin),
    costCoverage: Number(row.cost_coverage),
  };
}

export type PortfolioRow = {
  organizationId: string;
  organizationName: string;
  customerObligationMinor: number;
  knownCostToServeMinor: number;
  knownContributionMinor: number;
  knownMargin: number | null;
  costCoverage: number;
};

/** Every organization with a composed charge for this period, ranked by obligation — staff only. */
export async function platformRevenuePortfolio(
  db: Db,
  input: { billingPeriodStart: string; billingPeriodEnd: string; reportingCurrency?: string },
): Promise<PortfolioRow[]> {
  const { data, error } = await db.rpc('platform_revenue_portfolio', {
    p_billing_period_start: input.billingPeriodStart,
    p_billing_period_end: input.billingPeriodEnd,
    p_reporting_currency: input.reportingCurrency ?? 'CAD',
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'Only platform staff may read this.' : error.message,
      'charges.portfolio_failed',
    );
  }
  return ((data ?? []) as {
    organization_id: string;
    organization_name: string;
    customer_obligation_minor: number | string;
    known_cost_to_serve_minor: number | string;
    known_contribution_minor: number | string;
    known_margin: number | string | null;
    cost_coverage: number | string;
  }[]).map((row) => ({
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    customerObligationMinor: Number(row.customer_obligation_minor),
    knownCostToServeMinor: Number(row.known_cost_to_serve_minor),
    knownContributionMinor: Number(row.known_contribution_minor),
    knownMargin: row.known_margin === null ? null : Number(row.known_margin),
    costCoverage: Number(row.cost_coverage),
  }));
}

/** The calendar month containing `at`, as `[start, end)` ISO instants — the default billing period shape this module's callers use when no explicit Plan-anchored period applies. */
export function calendarMonthPeriod(at: Date = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

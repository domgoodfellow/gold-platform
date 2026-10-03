import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import type { AllowanceApplication, RetailState } from './usage';

export type CostState = 'estimated' | 'reconciled' | 'unknown';

/**
 * One usage event, read as two independent accounts and never as one blended rate:
 *
 *   **the customer's** — which allowance governed it, how much of it that allowance included,
 *     how much was therefore billable, and the retail charge that produced;
 *   **GildOps'** — the provider components beneath it, the known COGS and its cost state.
 *
 * Both come from `platform_usage_economics`, staff-only, so neither half can reach a tenant
 * screen through this type.
 */
export type EconomicsEvent = {
  id: string;
  organizationId: string;
  organizationName: string;
  meterId: string;
  quantity: number;
  occurredAt: string;
  sourceDomain: string;
  sourceRecordId: string | null;
  customerCurrency: string | null;
  customerChargeMicros: number | null;
  /** The customer side: allowance, the split of this event's quantity, and the rating state. */
  allowanceKey: string | null;
  allowanceIncludedTotal: number | null;
  includedQuantity: number | null;
  overageQuantity: number | null;
  allowanceWindow: { startsAt: string | null; endsAt: string | null; basis: string | null };
  allowanceApplication: AllowanceApplication;
  retailState: RetailState;
  retailRateId: string | null;
  /** GildOps' side. */
  componentCount: number;
  knownCostMicros: number;
  reportingCurrency: string | null;
  costState: CostState;
};

export type CostComponent = {
  id: string;
  key: string;
  providerKey: string;
  costMeterKey: string;
  quantity: number;
  unit: string;
  providerRateId: string | null;
  nativeCostMicros: number | null;
  nativeCurrency: string | null;
  reportingCostMicros: number | null;
  reportingCurrency: string | null;
  costState: CostState | 'adjusted';
  unknownReason: string | null;
};

export async function listEconomicsEvents(
  db: Db,
  input: {
    from?: string;
    to?: string;
    organizationId?: string;
    meterId?: string;
    providerKey?: string;
    costState?: CostState;
  } = {},
): Promise<EconomicsEvent[]> {
  const { data, error } = await db.rpc('platform_usage_economics', {
    p_from: input.from,
    p_to: input.to,
    p_organization_id: input.organizationId,
    p_meter_id: input.meterId,
    p_provider_key: input.providerKey,
    p_cost_state: input.costState,
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'Only platform staff may inspect provider economics.' : error.message,
      'commercial.economics_failed',
    );
  }
  return (data ?? []).map((row) => ({
    id: row.usage_event_id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    meterId: row.meter_id,
    quantity: Number(row.quantity),
    occurredAt: row.occurred_at,
    sourceDomain: row.source_domain,
    sourceRecordId: row.source_record_id,
    customerCurrency: row.customer_currency,
    customerChargeMicros: row.customer_charge_micros === null ? null : Number(row.customer_charge_micros),
    allowanceKey: row.allowance_key,
    allowanceIncludedTotal:
      row.allowance_included_total === null ? null : Number(row.allowance_included_total),
    includedQuantity:
      row.allowance_included_applied === null ? null : Number(row.allowance_included_applied),
    overageQuantity:
      row.allowance_overage_quantity === null ? null : Number(row.allowance_overage_quantity),
    allowanceWindow: {
      startsAt: row.allowance_window_start,
      endsAt: row.allowance_window_end,
      basis: row.allowance_window_basis,
    },
    allowanceApplication: row.allowance_state as AllowanceApplication,
    retailState: row.retail_state as RetailState,
    retailRateId: row.retail_rate_id,
    componentCount: Number(row.component_count),
    knownCostMicros: Number(row.known_cost_micros),
    reportingCurrency: row.reporting_currency,
    costState: row.cost_state as CostState,
  }));
}

export async function listCostComponents(db: Db, usageEventId: string): Promise<CostComponent[]> {
  const { data, error } = await db.rpc('platform_usage_cost_components', {
    p_usage_event_id: usageEventId,
  });
  if (error) throw new DomainError(error.message, 'commercial.cost_components_failed');
  return (data ?? []).map((row) => ({
    id: row.id,
    key: row.component_key,
    providerKey: row.provider_key,
    costMeterKey: row.cost_meter_key,
    quantity: Number(row.quantity),
    unit: row.unit,
    providerRateId: row.provider_rate_id,
    nativeCostMicros: row.native_cost_micros === null ? null : Number(row.native_cost_micros),
    nativeCurrency: row.native_currency,
    reportingCostMicros: row.reporting_cost_micros === null ? null : Number(row.reporting_cost_micros),
    reportingCurrency: row.reporting_currency,
    costState: row.effective_state as CostComponent['costState'],
    unknownReason: row.unknown_reason,
  }));
}

export function formatMicrosMoney(
  micros: number | null,
  currency: string | null,
  fractionDigits = 2,
): string {
  if (micros === null || currency === null) return '—';
  const amount = micros / 100_000_000;
  const symbol = currency === 'USD' || currency === 'CAD' ? '$' : '';
  return `${symbol}${amount.toLocaleString('en-CA', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  })} ${currency}`;
}

export function formatUsage(quantity: number, unit: string): string {
  const labels: Record<string, string> = {
    minute: 'min',
    participant_minute: 'pmin',
    segment: 'segments',
    message: 'messages',
    number_month: 'numbers',
  };
  return `${quantity.toLocaleString('en-CA', { maximumFractionDigits: 3 })} ${labels[unit] ?? unit}`;
}

import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * What a business used, and — on the staff-only path — what it cost GOLD. Two return shapes on
 * purpose: `UsageEvent` has no cost field to accidentally render on a tenant screen, and the
 * column grant on `usage_events` (`constraints.md` D43) is what actually withholds
 * `provider_cost_micros`/`provider_currency`/`provider_key` if a caller ever asks for them
 * anyway.
 *
 * **A provider's cost and a customer's charge are two currencies, not one** (D43's correction).
 * Nothing here converts between them — a mismatched pair reports no margin rather than a
 * guessed one, the same rule `jobEconomics` already applies across a tenant's own currencies
 * (I10).
 */

export type UsageEvent = {
  id: string;
  organizationId: string;
  meterId: string;
  quantity: number;
  occurredAt: string;
  /** What the tenant trades in — never GOLD's own cost, and never a provider's billing currency. */
  customerCurrency: string;
  /** The retail charge, in minor units — never GOLD's own cost. */
  customerChargeMinor: number;
  note: string;
};

/** Tenant-safe: selects only the columns `usage_events` grants `authenticated`. */
export async function listUsageEvents(
  db: Db,
  input: { organizationId: string; limit?: number },
): Promise<UsageEvent[]> {
  const { data, error } = await db
    .from('usage_events')
    .select('id, organization_id, meter_id, quantity, occurred_at, customer_currency, customer_charge_micros, note')
    .eq('organization_id', input.organizationId)
    .order('occurred_at', { ascending: false })
    .limit(input.limit ?? 100);

  if (error) throw new DomainError(error.message, 'commercial.usage_failed');

  return (data ?? []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    meterId: row.meter_id,
    quantity: Number(row.quantity),
    occurredAt: row.occurred_at,
    customerCurrency: row.customer_currency,
    customerChargeMinor: Math.round(Number(row.customer_charge_micros) / 1_000_000),
    note: row.note,
  }));
}

export type CommercialSummaryRow = {
  meterId: string;
  customerCurrency: string;
  customerChargeMinor: number;
  /** Null when nothing has ever been priced for this group — no provider has billed GOLD yet. */
  providerCurrency: string | null;
  providerCostMinor: number;
  quantity: number;
  /**
   * Null whenever `providerCurrency` and `customerCurrency` disagree and the cost is not exactly
   * zero — a real conversion is not built (D43), and this is honest about that rather than
   * subtracting unlike currencies.
   */
  marginMinor: number | null;
};

/**
 * Usage, GOLD's own **effective** cost (a reconciliation once one exists, otherwise the
 * original estimate — `organization_usage_detail` below is where both stay visible), the
 * customer's charge and the margin, grouped by meter and by each currency pair. Staff only —
 * `public.organization_commercial_summary` is granted to `platform_staff` and nobody else, so
 * this call fails closed for anyone else rather than needing a caller to remember not to show it
 * to a tenant.
 */
export async function organizationCommercialSummary(
  db: Db,
  input: { organizationId: string; from?: string; to?: string },
): Promise<CommercialSummaryRow[]> {
  const { data, error } = await db.rpc('organization_commercial_summary', {
    p_organization_id: input.organizationId,
    p_from: input.from,
    p_to: input.to,
  });

  if (error) {
    if (error.code === '42501' || error.code === 'PGRST202' || error.code === '42883') {
      throw new DomainError('Only platform staff may read this.', 'commercial.forbidden');
    }
    throw new DomainError(error.message, 'commercial.summary_failed');
  }

  return (data ?? []).map((row) => ({
    meterId: row.meter_id,
    customerCurrency: row.customer_currency,
    customerChargeMinor: Number(row.customer_charge_minor),
    providerCurrency: row.provider_currency,
    providerCostMinor: Number(row.provider_cost_minor),
    quantity: Number(row.quantity),
    marginMinor: row.margin_minor === null ? null : Number(row.margin_minor),
  }));
}

export type UsageEventDetail = {
  usageEventId: string;
  meterId: string;
  quantity: number;
  occurredAt: string;
  providerKey: string;
  /** What GOLD first estimated this reading cost, and in what currency — never overwritten. */
  estimatedCostMicros: number;
  estimatedCurrency: string | null;
  /** The latest reconciliation against this reading, if any — null on both fields when none exists yet. */
  reconciledCostMicros: number | null;
  reconciledCurrency: string | null;
  reconciledAt: string | null;
  customerCurrency: string;
  customerChargeMinor: number;
};

/**
 * Every usage event next to its own original estimate and its latest reconciliation, if any —
 * staff only. This is where the estimate stays inspectable after a correction lands
 * (`organization_commercial_summary` answers "what is true now"; this answers "what did we
 * think, and what did we learn since").
 */
export async function organizationUsageDetail(
  db: Db,
  input: { organizationId: string },
): Promise<UsageEventDetail[]> {
  const { data, error } = await db.rpc('organization_usage_detail', {
    p_organization_id: input.organizationId,
  });

  if (error) {
    if (error.code === '42501' || error.code === 'PGRST202' || error.code === '42883') {
      throw new DomainError('Only platform staff may read this.', 'commercial.forbidden');
    }
    throw new DomainError(error.message, 'commercial.usage_detail_failed');
  }

  return (data ?? []).map((row) => ({
    usageEventId: row.usage_event_id,
    meterId: row.meter_id,
    quantity: Number(row.quantity),
    occurredAt: row.occurred_at,
    providerKey: row.provider_key,
    estimatedCostMicros: Number(row.estimated_cost_micros),
    estimatedCurrency: row.estimated_currency,
    reconciledCostMicros: row.reconciled_cost_micros === null ? null : Number(row.reconciled_cost_micros),
    reconciledCurrency: row.reconciled_currency,
    reconciledAt: row.reconciled_at,
    customerCurrency: row.customer_currency,
    customerChargeMinor: Math.round(Number(row.customer_charge_micros) / 1_000_000),
  }));
}

export type RecordUsageReconciliationInput = {
  usageEventId: string;
  reconciledProviderCostMicros: number;
  providerCurrency: string;
  source: string;
  providerReference?: string;
  note?: string;
};

/**
 * The one door onto `usage_cost_reconciliations` — staff-only for now (there is no
 * provider-sync machine role yet; that arrives with the next slice, provider bindings). Adds no
 * quantity and no customer charge, so calling it can never duplicate either.
 */
export async function recordUsageReconciliation(
  db: Db,
  input: RecordUsageReconciliationInput,
): Promise<string> {
  const { data, error } = await db.rpc('record_usage_reconciliation', {
    p_usage_event_id: input.usageEventId,
    p_reconciled_provider_cost_micros: input.reconciledProviderCostMicros,
    p_provider_currency: input.providerCurrency,
    p_source: input.source,
    p_provider_reference: input.providerReference ?? '',
    p_note: input.note ?? '',
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('Only platform staff may record a reconciliation.', 'commercial.forbidden');
    }
    if (error.code === '23503') {
      throw new DomainError('No such usage event.', 'commercial.usage_event_missing');
    }
    throw new DomainError(error.message, 'commercial.record_reconciliation_failed');
  }

  return data as string;
}

export type ProviderSyncFailure = {
  id: string;
  organizationId: string | null;
  meterId: string | null;
  occurredAt: string;
  detail: string;
};

/**
 * A reconciliation that could not confirm GOLD's own estimate against a provider's real bill.
 * Ships empty in this slice — nothing writes here yet (`constraints.md` D43) — so an empty
 * result is the honest, expected answer, not a sign anything is broken.
 */
export async function listProviderSyncFailures(
  db: Db,
  input: { organizationId?: string; limit?: number } = {},
): Promise<ProviderSyncFailure[]> {
  let query = db
    .from('platform_provider_sync_failures')
    .select('id, organization_id, meter_id, occurred_at, detail')
    .order('occurred_at', { ascending: false })
    .limit(input.limit ?? 50);

  if (input.organizationId) query = query.eq('organization_id', input.organizationId);

  const { data, error } = await query;

  if (error) throw new DomainError(error.message, 'commercial.sync_failures_failed');

  return (data ?? []).map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    meterId: row.meter_id,
    occurredAt: row.occurred_at,
    detail: row.detail,
  }));
}

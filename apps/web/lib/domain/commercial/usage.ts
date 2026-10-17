import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * What a business used, and — on the staff-only path — what it cost GOLD. Two return shapes on
 * purpose: `UsageEvent` has no cost field to accidentally render on a tenant screen, and the
 * column grant on `usage_events` (the platform-economics separation, ADR-014) is what actually withholds
 * `provider_cost_micros`/`provider_currency`/`provider_key` if a caller ever asks for them
 * anyway.
 *
 * **A provider's cost and a customer's charge are two currencies, not one** (the platform-economics separation's correction).
 * Nothing here converts between them — a mismatched pair reports no margin rather than a
 * guessed one, the same rule `jobEconomics` already applies across a tenant's own currencies
 *.
 */

/**
 * Why this event's charge is what it is, on the rate axis. Unchanged vocabulary: `priced` covers
 * a price of nothing, which is a different fact from having no rate at all.
 */
export type RetailState = 'priced' | 'no_currency' | 'no_rate';

/**
 * How much of the event the allowance covered — the axis that is *not* about the rate. Read with
 * `retailState` it tells three financial facts apart that one zero used to hide: usage that was
 * **included** (covered, so nothing to charge), usage that was **zero-priced** (rated, at
 * nothing) and usage that is **unpriced** (no rate at all).
 */
export type AllowanceApplication = 'included' | 'partly_included' | 'overage' | 'ungoverned';

export type UsageEvent = {
  id: string;
  organizationId: string;
  meterId: string;
  /** The usage that happened, always in full — never only the chargeable part. */
  quantity: number;
  occurredAt: string;
  /** What the tenant trades in — never GildOps' own cost, and never a provider's billing currency. Null when the business has not said. */
  customerCurrency: string | null;
  /**
   * The retail charge, in minor units — never GildOps' own cost. **Null means not priced**, which
   * is not the same as a price of zero: the business has no currency, or the meter has no rate.
   */
  customerChargeMinor: number | null;
  /** The allowance that governed this event, or null when none in the package did. */
  allowanceKey: string | null;
  /** Of this event's quantity: what the allowance covered, and what was therefore billable. */
  includedQuantity: number | null;
  overageQuantity: number | null;
  /** The window the split was decided in, and which fact fixed its boundaries. */
  window: { startsAt: string | null; endsAt: string | null; basis: string | null };
  retailState: RetailState;
  allowanceApplication: AllowanceApplication;
  note: string;
};

/**
 * Both derivations live here rather than in two screens. Neither invents a number: each reads
 * columns `app.record_usage` wrote at the moment the usage occurred.
 */
function retailState(row: { customer_charge_micros: unknown; customer_currency: string | null }): RetailState {
  if (row.customer_charge_micros !== null) return 'priced';
  return row.customer_currency === null ? 'no_currency' : 'no_rate';
}

function allowanceApplication(row: {
  allowance_key: string | null;
  allowance_included_applied: string | number | null;
  allowance_overage_quantity: string | number | null;
}): AllowanceApplication {
  if (row.allowance_key === null) return 'ungoverned';
  if (Number(row.allowance_overage_quantity) === 0) return 'included';
  if (Number(row.allowance_included_applied) === 0) return 'overage';
  return 'partly_included';
}

/** Tenant-safe: selects only the columns `usage_events` grants `authenticated`. */
export async function listUsageEvents(
  db: Db,
  input: { organizationId: string; limit?: number },
): Promise<UsageEvent[]> {
  const { data, error } = await db
    .from('usage_events')
    .select('id, organization_id, meter_id, quantity, occurred_at, customer_currency, customer_charge_micros, note, allowance_key, allowance_included_applied, allowance_overage_quantity, allowance_window_start, allowance_window_end, allowance_window_basis')
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
    customerChargeMinor:
      row.customer_charge_micros === null ? null : Math.round(Number(row.customer_charge_micros) / 1_000_000),
    allowanceKey: row.allowance_key,
    includedQuantity: row.allowance_included_applied === null ? null : Number(row.allowance_included_applied),
    overageQuantity: row.allowance_overage_quantity === null ? null : Number(row.allowance_overage_quantity),
    window: {
      startsAt: row.allowance_window_start,
      endsAt: row.allowance_window_end,
      basis: row.allowance_window_basis,
    },
    retailState: retailState(row),
    allowanceApplication: allowanceApplication(row),
    note: row.note,
  }));
}

export type CommercialSummaryRow = {
  meterId: string;
  /** Null for usage of a business that has not said what it trades in. */
  customerCurrency: string | null;
  /** Only what has been priced; usage that has not is counted in `unpricedQuantity`. */
  customerChargeMinor: number;
  /** Null when nothing has ever been priced for this group — no provider has billed GOLD yet. */
  providerCurrency: string | null;
  providerCostMinor: number;
  quantity: number;
  /**
   * Null whenever `providerCurrency` and `customerCurrency` disagree and the cost is not exactly
   * zero — a real conversion is not built, and this is honest about that rather than
   * subtracting unlike currencies. Also null while any of the group is not priced or not costed:
   * a margin needs both.
   */
  marginMinor: number | null;
  /** Quantity with no retail price yet. Not free: nothing has been charged for it. */
  unpricedQuantity: number;
  /** Quantity with no provider cost yet, awaiting a provider rate or a reconciliation. */
  uncostedQuantity: number;
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
    unpricedQuantity: Number(row.unpriced_quantity),
    uncostedQuantity: Number(row.uncosted_quantity),
  }));
}

export type UsageEventDetail = {
  usageEventId: string;
  meterId: string;
  quantity: number;
  occurredAt: string;
  providerKey: string;
  /** What GOLD first estimated this reading cost, and in what currency — never overwritten. Null when it was not costed. */
  estimatedCostMicros: number | null;
  estimatedCurrency: string | null;
  /** The latest reconciliation against this reading, if any — null on both fields when none exists yet. */
  reconciledCostMicros: number | null;
  reconciledCurrency: string | null;
  reconciledAt: string | null;
  customerCurrency: string | null;
  /** Null means not priced, which is different from a price of zero — see `retailState`. */
  customerChargeMinor: number | null;
  /** Priced (a price of nothing included), or why it is not: no currency, or no rate. */
  retailState: RetailState;
  /** The allowance that governed it, the window the split was decided in, and the split itself. */
  allowanceKey: string | null;
  allowanceIncludedTotal: number | null;
  allowanceConsumedBefore: number | null;
  includedQuantity: number | null;
  overageQuantity: number | null;
  allowanceWindow: { startsAt: string | null; endsAt: string | null; basis: string | null };
  /** The allowance axis, orthogonal to `retailState` — see `AllowanceApplication`. */
  allowanceApplication: AllowanceApplication;
  /** Costed by a provider rate, not costed yet, or carrying no provider cost at all. */
  providerState: 'costed' | 'uncosted' | 'not_applicable';
  /** How the usage was carried: the business's own binding, GOLD's account, or not recorded. */
  fulfilledThrough: 'organization_binding' | 'platform_account' | 'unrecorded';
  /** An applicable provider cost that no provider statement has confirmed yet. */
  awaitingReconciliation: boolean;
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
    estimatedCostMicros: row.estimated_cost_micros === null ? null : Number(row.estimated_cost_micros),
    estimatedCurrency: row.estimated_currency,
    reconciledCostMicros: row.reconciled_cost_micros === null ? null : Number(row.reconciled_cost_micros),
    reconciledCurrency: row.reconciled_currency,
    reconciledAt: row.reconciled_at,
    customerCurrency: row.customer_currency,
    customerChargeMinor:
      row.customer_charge_micros === null ? null : Math.round(Number(row.customer_charge_micros) / 1_000_000),
    retailState: row.retail_state as RetailState,
    allowanceKey: row.allowance_key,
    allowanceIncludedTotal:
      row.allowance_included_total === null ? null : Number(row.allowance_included_total),
    allowanceConsumedBefore:
      row.allowance_consumed_before === null ? null : Number(row.allowance_consumed_before),
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
    providerState: row.provider_state as UsageEventDetail['providerState'],
    fulfilledThrough: row.fulfilled_through as UsageEventDetail['fulfilledThrough'],
    awaitingReconciliation: row.awaiting_reconciliation,
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
 * Ships empty in this slice — nothing writes here yet (the platform-economics separation, ADR-014) — so an empty
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

/** How many, for a summary tile that has no use for the rows themselves. */
export async function countProviderSyncFailures(db: Db): Promise<number> {
  const { count, error } = await db
    .from('platform_provider_sync_failures')
    .select('id', { count: 'exact' })
    .limit(1);

  if (error) throw new DomainError(error.message, 'commercial.sync_failures_failed');

  return count ?? 0;
}

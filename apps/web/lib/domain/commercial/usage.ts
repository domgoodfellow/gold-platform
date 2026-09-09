import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * What a business used, and — on the staff-only path — what it cost GOLD. Two return shapes on
 * purpose: `UsageEvent` has no cost field to accidentally render on a tenant screen, and the
 * column grant on `usage_events` (`constraints.md` D43) is what actually withholds
 * `provider_cost_micros` if a caller ever asks for it anyway.
 */

export type UsageEvent = {
  id: string;
  organizationId: string;
  meterId: string;
  quantity: number;
  occurredAt: string;
  currency: string;
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
    .select('id, organization_id, meter_id, quantity, occurred_at, currency, customer_charge_micros, note')
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
    currency: row.currency,
    customerChargeMinor: Math.round(Number(row.customer_charge_micros) / 1_000_000),
    note: row.note,
  }));
}

export type CommercialSummaryRow = {
  meterId: string;
  currency: string;
  quantity: number;
  providerCostMinor: number;
  customerChargeMinor: number;
  marginMinor: number;
};

/**
 * Usage, GOLD's own cost, the customer's charge and the margin, per meter and currency. Staff
 * only — `public.organization_commercial_summary` is granted to `platform_staff` and nobody
 * else, so this call fails closed for anyone else rather than needing a caller to remember not
 * to show it to a tenant.
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
    currency: row.currency,
    quantity: Number(row.quantity),
    providerCostMinor: Number(row.provider_cost_minor),
    customerChargeMinor: Number(row.customer_charge_minor),
    marginMinor: Number(row.margin_minor),
  }));
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

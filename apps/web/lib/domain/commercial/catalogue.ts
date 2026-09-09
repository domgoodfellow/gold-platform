import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * What can be metered, what GOLD sells, and what each costs — GOLD selling GOLD, never a
 * tenant's own catalogue (`price_book_items`, `lib/domain/billing/`, D42's two money paths).
 *
 * Every rate is a per-unit price in **micro-minor-units** — millionths of one minor currency
 * unit — because a provider's wholesale price is routinely sub-cent (`constraints.md` D43). A
 * caller wanting a number to show a person converts with `microsToMinor` below, once, at
 * render.
 */

export type Meter = {
  id: string;
  provider: string;
  unit: string;
  description: string;
};

export type Product = {
  key: string;
  kind: 'platform' | 'module' | 'seat';
  moduleKey: string | null;
  label: string;
};

export type Rate = {
  id: string;
  meterId: string;
  currency: string;
  unitAmountMicros: number;
  effectiveFrom: string;
  approvalState: 'draft' | 'approved';
  source: string;
  sourceUrl: string | null;
  capturedAt: string;
  note: string;
};

/** Micro-minor-units to minor units, rounded once, at the point a number is finally shown. */
export function microsToMinor(micros: number): number {
  return Math.round(micros / 1_000_000);
}

export async function listMeters(db: Db): Promise<Meter[]> {
  const { data, error } = await db
    .from('platform_meters')
    .select('id, provider, unit, description')
    .order('id');

  if (error) throw new DomainError(error.message, 'commercial.meters_failed');

  return data ?? [];
}

export async function listProducts(db: Db): Promise<Product[]> {
  const { data, error } = await db
    .from('platform_products')
    .select('key, kind, module_key, label')
    .order('kind')
    .order('key');

  if (error) throw new DomainError(error.message, 'commercial.products_failed');

  return (data ?? []).map((row) => ({
    key: row.key,
    kind: row.kind as Product['kind'],
    moduleKey: row.module_key,
    label: row.label,
  }));
}

function isApprovalState(value: string): value is Rate['approvalState'] {
  return value === 'draft' || value === 'approved';
}

/** GOLD's own cost. Never selectable by `authenticated` — this call only ever succeeds for staff. */
export async function listProviderRates(db: Db, input: { meterId?: string } = {}): Promise<Rate[]> {
  let query = db
    .from('platform_provider_rates')
    .select(
      'id, meter_id, currency, unit_amount_micros, effective_from, approval_state, source, source_url, captured_at, note',
    )
    .order('meter_id')
    .order('effective_from', { ascending: false });

  if (input.meterId) query = query.eq('meter_id', input.meterId);

  const { data, error } = await query;

  if (error) throw new DomainError(error.message, 'commercial.provider_rates_failed');

  return (data ?? []).map(toRate);
}

/** What GOLD charges. Readable by any signed-in member, matching `communication_rates_select`. */
export async function listRetailRates(db: Db, input: { meterId?: string } = {}): Promise<Rate[]> {
  let query = db
    .from('platform_retail_rates')
    .select(
      'id, meter_id, currency, unit_amount_micros, effective_from, approval_state, source, source_url, captured_at, note',
    )
    .order('meter_id')
    .order('effective_from', { ascending: false });

  if (input.meterId) query = query.eq('meter_id', input.meterId);

  const { data, error } = await query;

  if (error) throw new DomainError(error.message, 'commercial.retail_rates_failed');

  return (data ?? []).map(toRate);
}

function toRate(row: {
  id: string;
  meter_id: string;
  currency: string;
  unit_amount_micros: number;
  effective_from: string;
  approval_state: string;
  source: string;
  source_url: string | null;
  captured_at: string;
  note: string;
}): Rate {
  return {
    id: row.id,
    meterId: row.meter_id,
    currency: row.currency,
    unitAmountMicros: Number(row.unit_amount_micros),
    effectiveFrom: row.effective_from,
    approvalState: isApprovalState(row.approval_state) ? row.approval_state : 'approved',
    source: row.source,
    sourceUrl: row.source_url,
    capturedAt: row.captured_at,
    note: row.note,
  };
}

export type RecordRateInput = {
  meterId: string;
  currency: string;
  unitAmountMicros: number;
  source: string;
  sourceUrl?: string;
  approvalState?: 'draft' | 'approved';
  note?: string;
};

/** Staff only — `public.record_provider_rate` refuses anyone not listed in `platform_staff`. */
export async function recordProviderRate(db: Db, input: RecordRateInput): Promise<string> {
  const { data, error } = await db.rpc('record_provider_rate', {
    p_meter_id: input.meterId,
    p_currency: input.currency,
    p_unit_amount_micros: input.unitAmountMicros,
    p_source: input.source,
    p_source_url: input.sourceUrl,
    p_approval_state: input.approvalState ?? 'approved',
    p_note: input.note ?? '',
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('Only platform staff may record a provider rate.', 'commercial.forbidden');
    }
    throw new DomainError(error.message, 'commercial.record_provider_rate_failed');
  }

  return data as string;
}

/** Staff only — the retail twin of `recordProviderRate`. */
export async function recordRetailRate(db: Db, input: RecordRateInput): Promise<string> {
  const { data, error } = await db.rpc('record_retail_rate', {
    p_meter_id: input.meterId,
    p_currency: input.currency,
    p_unit_amount_micros: input.unitAmountMicros,
    p_source: input.source,
    p_source_url: input.sourceUrl,
    p_approval_state: input.approvalState ?? 'approved',
    p_note: input.note ?? '',
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('Only platform staff may record a retail rate.', 'commercial.forbidden');
    }
    throw new DomainError(error.message, 'commercial.record_retail_rate_failed');
  }

  return data as string;
}

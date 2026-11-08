import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';

/**
 * What can be metered, what GOLD sells, and what each costs — GOLD selling GOLD, never a
 * tenant's own catalogue (`price_book_items`, `lib/domain/billing/`, the two money paths).
 *
 * Every rate is a per-unit price in **micro-minor-units** — millionths of one minor currency
 * unit — because a provider's wholesale price is routinely sub-cent (the platform-economics separation, ADR-014). A
 * caller wanting a number to show a person converts with `microsToMinor` below, once, at
 * render.
 */

export type Meter = {
  id: string;
  /** What this meter is called where a person reads it. One string, never spelled from the id. */
  label: string;
  unit: string;
  description: string;
  /** How readings combine over an allowance window — `app.allowance_consumption` obeys it. */
  aggregation: 'sum' | 'high_water';
  /**
   * The function that records usage on this meter, or null for a meter that is vocabulary only.
   * **Defining a meter is not the same claim as recording it** — a Plan allowance over a meter
   * with no writer would promise tracking that does not happen.
   */
  writer: string | null;
};

export type Provider = {
  key: string;
  label: string;
};

export type Product = {
  key: string;
  kind: 'platform' | 'module' | 'seat';
  moduleKey: string | null;
  label: string;
  description: string;
  saleStatus: 'active' | 'unlisted' | 'archived';
  displayOrder: number;
};

/**
 * A product key as a URL path segment, and back.
 *
 * `platform_products.key` is `kind:name` for a module or a seat ("module:assistant",
 * "seat:reception_agent") — a real, load-bearing colon, not decoration. Next's own router does
 * not resolve a dynamic segment correctly when the requested path contains one, encoded or not
 * (confirmed empirically: an unencoded and a `%3A`-encoded colon both 404 against
 * `[productKey]`, while the identical route with no colon in the key resolves correctly) — so
 * the record route swaps it for `~`, a character RFC 3986 leaves unreserved and none of this
 * catalogue's keys otherwise use, and swaps it back on the way in. The key stored and compared
 * everywhere else in this file is never touched; only its spelling in a URL is.
 */
export function productKeyToUrlSegment(key: string): string {
  return key.replace(/:/g, '~');
}

export function productKeyFromUrlSegment(segment: string): string {
  return segment.replace(/~/g, ':');
}

export type ProductPrice = {
  id: string;
  productKey: string;
  currency: string;
  amountMinor: number;
  billingInterval: 'month' | 'year' | 'one_time';
  effectiveFrom: string;
  approvalState: 'draft' | 'approved';
  source: string;
  note: string;
};

/** A provider rate names who; a retail rate does not (`providerKey` is null on that one). */
export type Rate = {
  id: string;
  providerKey: string | null;
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

export type ProviderCostMeter = {
  key: string;
  service: string;
  unit: string;
  label: string;
};

export type ProviderCostRate = Rate & {
  costMeterKey: string;
  region: string | null;
  direction: string | null;
  resourceType: string | null;
  effectiveTo: string | null;
  importedAt: string;
};

/** Micro-minor-units to minor units, rounded once, at the point a number is finally shown. */
export function microsToMinor(micros: number): number {
  return Math.round(micros / 1_000_000);
}

export async function listMeters(db: Db): Promise<Meter[]> {
  const { data, error } = await db
    .from('platform_meters')
    .select('id, label, unit, description, aggregation, writer')
    .order('label');

  if (error) throw fromDatabaseError(error, 'commercial.meters_failed');

  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    unit: row.unit,
    description: row.description,
    aggregation: row.aggregation as Meter['aggregation'],
    writer: row.writer,
  }));
}

/**
 * Which meters something actually records, and which are vocabulary only. Derived from each
 * meter's own `writer`, which an architecture test checks against `pg_proc` — so "this is
 * tracked" is a claim the schema can be held to rather than one a document makes.
 */
export function meterIsRecorded(meter: Meter): boolean {
  return meter.writer !== null;
}

/** Who GOLD can pay for a unit of a meter — decoupled on purpose (the platform-economics separation's correction): two
 * providers may answer the same meter, and a meter names no provider of its own. */
export async function listProviders(db: Db): Promise<Provider[]> {
  const { data, error } = await db
    .from('platform_providers')
    .select('key, label')
    .order('key');

  if (error) throw fromDatabaseError(error, 'commercial.providers_failed');

  return data ?? [];
}

export async function listProviderCostMeters(db: Db): Promise<ProviderCostMeter[]> {
  const { data, error } = await db
    .from('platform_provider_cost_meters')
    .select('key, service, unit, label')
    .order('service')
    .order('label');
  if (error) throw fromDatabaseError(error, 'commercial.provider_cost_meters_failed');
  return data ?? [];
}

export async function listProviderCostRates(
  db: Db,
  input: { providerKey?: string; costMeterKey?: string; region?: string; currentOnly?: boolean } = {},
): Promise<ProviderCostRate[]> {
  let query = db
    .from('platform_provider_rates')
    .select('id, provider_key, meter_id, cost_meter_key, currency, unit_amount_micros, effective_from, effective_to, approval_state, source, source_url, captured_at, imported_at, note, region, direction, resource_type')
    .order('cost_meter_key')
    .order('effective_from', { ascending: false });
  if (input.providerKey) query = query.eq('provider_key', input.providerKey);
  if (input.costMeterKey) query = query.eq('cost_meter_key', input.costMeterKey);
  if (input.region) query = query.eq('region', input.region);
  if (input.currentOnly) query = query.lte('effective_from', new Date().toISOString()).or(`effective_to.is.null,effective_to.gt.${new Date().toISOString()}`);
  const { data, error } = await query;
  if (error) throw fromDatabaseError(error, 'commercial.provider_cost_rates_failed');
  return (data ?? []).map((row) => ({
    ...toRate(row),
    costMeterKey: row.cost_meter_key,
    region: row.region,
    direction: row.direction,
    resourceType: row.resource_type,
    effectiveTo: row.effective_to,
    importedAt: row.imported_at,
  }));
}

export async function recordProviderCostRate(
  db: Db,
  input: {
    providerKey: string;
    commercialMeterId: string;
    costMeterKey: string;
    currency: string;
    unitAmountMicros: number;
    effectiveFrom: string;
    source: string;
    region?: string;
    direction?: 'inbound' | 'outbound';
    resourceType?: string;
    effectiveTo?: string;
    note?: string;
  },
): Promise<string> {
  const { data, error } = await db.rpc('record_provider_cost_rate', {
    p_provider_key: input.providerKey,
    p_commercial_meter_id: input.commercialMeterId,
    p_cost_meter_key: input.costMeterKey,
    p_currency: input.currency,
    p_unit_amount_micros: input.unitAmountMicros,
    p_effective_from: input.effectiveFrom,
    p_source: input.source,
    p_region: input.region,
    p_direction: input.direction,
    p_resource_type: input.resourceType,
    p_effective_to: input.effectiveTo,
    p_provider_account_id: undefined,
    p_note: input.note ?? '',
  });
  if (error) throw new DomainError(error.code === '42501' ? 'Only platform staff may record vendor rates.' : error.message, 'commercial.record_provider_cost_rate_failed');
  return data as string;
}

export async function listProducts(db: Db): Promise<Product[]> {
  const { data, error } = await db
    .from('platform_products')
    .select('key, kind, module_key, label, description, sale_status, display_order')
    .order('display_order')
    .order('key');

  if (error) throw fromDatabaseError(error, 'commercial.products_failed');

  return (data ?? []).map((row) => ({
    key: row.key,
    kind: row.kind as Product['kind'],
    moduleKey: row.module_key,
    label: row.label,
    description: row.description,
    saleStatus: row.sale_status as Product['saleStatus'],
    displayOrder: row.display_order,
  }));
}

/** One product, or null — the record page's own read, rather than filtering `listProducts`. */
export async function getProduct(db: Db, key: string): Promise<Product | null> {
  const { data, error } = await db
    .from('platform_products')
    .select('key, kind, module_key, label, description, sale_status, display_order')
    .eq('key', key)
    .maybeSingle();

  if (error) throw fromDatabaseError(error, 'commercial.product_failed');
  if (!data) return null;

  return {
    key: data.key,
    kind: data.kind as Product['kind'],
    moduleKey: data.module_key,
    label: data.label,
    description: data.description,
    saleStatus: data.sale_status as Product['saleStatus'],
    displayOrder: data.display_order,
  };
}

export async function updateProduct(
  db: Db,
  input: Pick<Product, 'key' | 'label' | 'description' | 'saleStatus' | 'displayOrder'>,
): Promise<void> {
  const { error } = await db.rpc('update_platform_product', {
    p_product_key: input.key,
    p_label: input.label,
    p_description: input.description,
    p_sale_status: input.saleStatus,
    p_display_order: input.displayOrder,
  });
  if (error) {
    throw new DomainError(
      error.code === '42501' ? 'Only platform staff may update the product catalogue.' : error.message,
      'commercial.update_product_failed',
    );
  }
}

export async function listMeterUsageObservations(db: Db): Promise<Map<string, number>> {
  const { data, error } = await db.rpc('platform_meter_observations');
  if (error) throw fromDatabaseError(error, 'commercial.meter_observations_failed');
  return new Map((data ?? []).map((row) => [row.meter_id, Number(row.usage_event_count)]));
}

/** GOLD's global, append-only list-price card. It deliberately has no organization id. */
export async function listProductPrices(db: Db): Promise<ProductPrice[]> {
  const { data, error } = await db.from('platform_product_prices').select('id, product_key, currency, amount_minor, billing_interval, effective_from, approval_state, source, note').order('product_key').order('effective_from', { ascending: false });
  if (error) throw fromDatabaseError(error, 'commercial.product_prices_failed');
  return (data ?? []).map((row) => ({ id: row.id, productKey: row.product_key, currency: row.currency, amountMinor: Number(row.amount_minor), billingInterval: row.billing_interval as ProductPrice['billingInterval'], effectiveFrom: row.effective_from, approvalState: isApprovalState(row.approval_state) ? row.approval_state : 'approved', source: row.source, note: row.note }));
}

function isApprovalState(value: string): value is Rate['approvalState'] {
  return value === 'draft' || value === 'approved';
}

/** GOLD's own cost, per provider. Never selectable by `authenticated` — this call only ever succeeds for staff. */
export async function listProviderRates(
  db: Db,
  input: { meterId?: string; providerKey?: string } = {},
): Promise<Rate[]> {
  let query = db
    .from('platform_provider_rates')
    .select(
      'id, provider_key, meter_id, currency, unit_amount_micros, effective_from, approval_state, source, source_url, captured_at, note',
    )
    .order('meter_id')
    .order('effective_from', { ascending: false });

  if (input.meterId) query = query.eq('meter_id', input.meterId);
  if (input.providerKey) query = query.eq('provider_key', input.providerKey);

  const { data, error } = await query;

  if (error) throw fromDatabaseError(error, 'commercial.provider_rates_failed');

  return (data ?? []).map(toRate);
}

/** What GOLD charges. Readable by a member of any business or by staff. No provider dimension — a business is charged one retail price per meter regardless of which vendor GOLD used. */
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

  if (error) throw fromDatabaseError(error, 'commercial.retail_rates_failed');

  return (data ?? []).map((row) => toRate({ ...row, provider_key: null }));
}

function toRate(row: {
  id: string;
  provider_key: string | null;
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
    providerKey: row.provider_key,
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

export type RecordProviderRateInput = {
  providerKey: string;
  meterId: string;
  currency: string;
  unitAmountMicros: number;
  source: string;
  sourceUrl?: string;
  approvalState?: 'draft' | 'approved';
  note?: string;
};

export type RecordRetailRateInput = Omit<RecordProviderRateInput, 'providerKey'> & {
  /** When the price starts. Defaults to now; never in the past. */
  effectiveFrom?: string;
};

/** Staff only — `public.record_provider_rate` refuses anyone not listed in `platform_staff`. */
export async function recordProviderRate(db: Db, input: RecordProviderRateInput): Promise<string> {
  const { data, error } = await db.rpc('record_provider_rate', {
    p_provider_key: input.providerKey,
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
      throw new DomainError('Only platform staff may record a vendor rate.', 'commercial.forbidden');
    }
    throw fromDatabaseError(error, 'commercial.record_provider_rate_failed');
  }

  return data as string;
}

/** Staff only — the retail twin of `recordProviderRate`. Names no provider — see `RecordRetailRateInput`. */
export async function recordRetailRate(db: Db, input: RecordRetailRateInput): Promise<string> {
  const { data, error } = await db.rpc('record_retail_rate', {
    p_meter_id: input.meterId,
    p_currency: input.currency,
    p_unit_amount_micros: input.unitAmountMicros,
    p_source: input.source,
    p_source_url: input.sourceUrl,
    p_approval_state: input.approvalState ?? 'approved',
    p_note: input.note ?? '',
    p_effective_from: input.effectiveFrom,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('Only platform staff may record a retail rate.', 'commercial.forbidden');
    }
    throw fromDatabaseError(error, 'commercial.record_retail_rate_failed');
  }

  return data as string;
}

export async function recordProductPrice(db: Db, input: Omit<ProductPrice, 'id' | 'approvalState' | 'note'> & { approvalState?: ProductPrice['approvalState']; note?: string }): Promise<string> {
  const { data, error } = await db.rpc('record_product_price', { p_product_key: input.productKey, p_currency: input.currency, p_amount_minor: input.amountMinor, p_billing_interval: input.billingInterval, p_effective_from: input.effectiveFrom, p_approval_state: input.approvalState ?? 'approved', p_source: input.source, p_note: input.note ?? '' });
  if (error) throw new DomainError(error.code === '42501' ? 'Only platform staff may record a product price.' : error.message, 'commercial.record_product_price_failed');
  return data;
}

import { platformBillingProvider } from '@/lib/adapters/platform-billing';
import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { listItemPrices, type RecurringItem } from '@/lib/domain/pricing/recurring-items';

/**
 * GildOps' own recurring prices, provisioned with its billing provider so a business can subscribe
 * at checkout (ADR-057). Only GildOps' operating organization has a processing relationship for
 * subscriptions, so the database refuses any other seller. The provider call happens here; only
 * the resulting references are written, by `record_item_provider_price`. Idempotency keys are the
 * ones used before the move, so an existing provider product or price is found, never duplicated.
 */

export type ItemProviderPrice = { priceId: string; productReference: string; priceReference: string };

/** The billing provider environment GildOps sells in, or null when it is not configured. */
export async function billingEnvironment(): Promise<'sandbox' | 'live' | null> {
  return (await platformBillingProvider())?.environment ?? null;
}

export async function listItemProviderPrices(
  db: Db,
  input: { organizationId: string; priceIds: string[]; environment: 'sandbox' | 'live' },
): Promise<ItemProviderPrice[]> {
  if (input.priceIds.length === 0) return [];
  const { data, error } = await db
    .from('price_book_item_provider_prices')
    .select('plan_price_id, product_reference, price_reference')
    .eq('organization_id', input.organizationId)
    .in('plan_price_id', input.priceIds)
    .eq('environment', input.environment);
  if (error) throw fromDatabaseError(error, 'item_provider_prices.read_failed');
  return (data ?? []).map((row) => ({ priceId: row.plan_price_id, productReference: row.product_reference, priceReference: row.price_reference }));
}

export async function provisionItemPrice(
  db: Db,
  input: { organizationId: string; item: RecurringItem; priceId: string },
): Promise<ItemProviderPrice> {
  const provider = await platformBillingProvider();
  if (!provider) throw new DomainError('Billing isn’t set up for GildOps yet.', 'item_provider_prices.not_configured');
  if (!input.item.plan) throw new DomainError('Only items that sell a GildOps plan are provisioned for checkout.', 'item_provider_prices.not_a_plan');

  const price = (await listItemPrices(db, { organizationId: input.organizationId, itemIds: [input.item.id] })).find((candidate) => candidate.id === input.priceId);
  if (!price) throw new DomainError('No such price on this item.', 'item_provider_prices.price_not_found');

  const existing = (await listItemProviderPrices(db, { organizationId: input.organizationId, priceIds: [price.id], environment: provider.environment }))[0];
  if (existing) return existing;

  const { productId, priceId } = await provider.createPrice({
    productIdempotencyKey: `platform-plan-product:${input.item.plan.key}`,
    priceIdempotencyKey: `platform-plan-price:${price.id}`,
    planKey: input.item.plan.key,
    planLabel: input.item.name,
    currency: price.currency,
    amountMinor: price.amountMinor,
    billingInterval: price.billingInterval,
  });

  const { error } = await db.rpc('record_item_provider_price', {
    p_organization_id: input.organizationId,
    p_item_price_id: price.id,
    p_environment: provider.environment,
    p_product_reference: productId,
    p_price_reference: priceId,
    p_provider: provider.name,
  });
  if (error) {
    if (error.code === '42501') throw new DomainError('You cannot provision this business’s prices.', 'item_provider_prices.forbidden');
    throw fromDatabaseError(error, 'item_provider_prices.record_failed');
  }
  return { priceId: price.id, productReference: productId, priceReference: priceId };
}

export type MeteredAllowance = { allowanceKey: string; label: string; unit: string; meterId: string };
export type UsagePrice = { id: string; meterId: string; currency: string; unitAmountMicros: number; effectiveFrom: string };

/** The allowances of a plan item that are charged by use beyond what is included. */
export async function listMeteredAllowances(db: Db, input: { planId: string }): Promise<MeteredAllowance[]> {
  const { data, error } = await db
    .from('platform_plan_quotas')
    .select('allowance_key, label, unit, meter_id, display_order')
    .eq('plan_id', input.planId)
    .eq('overage_behavior', 'metered')
    .not('meter_id', 'is', null)
    .order('display_order');
  if (error) throw fromDatabaseError(error, 'usage_prices.allowances_failed');
  return (data ?? []).map((row) => ({ allowanceKey: row.allowance_key, label: row.label, unit: row.unit, meterId: row.meter_id as string }));
}

/** Standard usage prices of a plan item, newest first. */
export async function listUsagePrices(db: Db, input: { planId: string }): Promise<UsagePrice[]> {
  const { data, error } = await db
    .from('platform_retail_rates')
    .select('id, meter_id, currency, unit_amount_micros, effective_from')
    .eq('plan_id', input.planId)
    .is('organization_id', null)
    .eq('approval_state', 'approved')
    .order('effective_from', { ascending: false });
  if (error) throw fromDatabaseError(error, 'usage_prices.read_failed');
  return (data ?? []).map((row) => ({ id: row.id, meterId: row.meter_id, currency: row.currency, unitAmountMicros: Number(row.unit_amount_micros), effectiveFrom: row.effective_from }));
}

export async function recordUsagePrice(
  db: Db,
  input: { organizationId: string; itemId: string; meterId: string; currency: string; unitAmountMicros: number; effectiveFrom: string },
): Promise<string> {
  if (!Number.isInteger(input.unitAmountMicros) || input.unitAmountMicros < 0) {
    throw new DomainError('A usage price is zero or more.', 'usage_prices.amount_invalid');
  }
  const { data, error } = await db.rpc('record_item_usage_price', {
    p_organization_id: input.organizationId,
    p_item_id: input.itemId,
    p_meter_id: input.meterId,
    p_currency: input.currency,
    p_unit_amount_micros: input.unitAmountMicros,
    p_effective_from: input.effectiveFrom,
    p_note: '',
  });
  if (error) {
    if (error.code === '42501') throw new DomainError('You cannot set what this business charges.', 'usage_prices.forbidden');
    throw fromDatabaseError(error, 'usage_prices.record_failed');
  }
  return data as string;
}

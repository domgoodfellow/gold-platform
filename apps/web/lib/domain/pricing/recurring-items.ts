import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { formatMoney } from '@/lib/domain/work-items/consumption';

/**
 * Recurring items: what a business charges every month or year, with a price history by currency
 * and billing interval (ADR-057). Any business sells them; GildOps sells its plans and add-ons as
 * recurring items of its operating organization, and those items name the platform plan whose
 * switches they turn on. Amounts are integer minor units, as everywhere in the price book.
 */

export type BillingInterval = 'month' | 'year' | 'one_time';
export type ItemSaleStatus = 'active' | 'unlisted' | 'archived';

export type RecurringItem = {
  id: string;
  name: string;
  unit: string;
  description: string;
  saleStatus: ItemSaleStatus;
  createdAt: string;
  /** The platform plan this item sells, for GildOps' own items; null for any other item. */
  plan: { id: string; key: string; kind: 'plan' | 'addon'; billable: boolean } | null;
};

export type ItemPrice = {
  id: string;
  itemId: string;
  currency: string;
  amountMinor: number;
  billingInterval: BillingInterval;
  effectiveFrom: string;
  effectiveTo: string | null;
  approvalState: 'draft' | 'approved';
  note: string;
};

const ITEM_COLUMNS = 'id, name, unit, description, sale_status, created_at, plan:platform_plans(id, key, kind, billable)';
const PRICE_COLUMNS = 'id, item_id, currency, amount_minor, billing_interval, effective_from, effective_to, approval_state, note';

type ItemRow = { id: string; name: string; unit: string; description: string; sale_status: string; created_at: string; plan: unknown };
type PriceRow = { id: string; item_id: string | null; currency: string; amount_minor: number | string; billing_interval: string; effective_from: string; effective_to: string | null; approval_state: string; note: string };

function toItem(row: ItemRow): RecurringItem {
  const plan = (Array.isArray(row.plan) ? row.plan[0] : row.plan) as { id: string; key: string; kind: string; billable: boolean } | null | undefined;
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    description: row.description,
    saleStatus: row.sale_status as ItemSaleStatus,
    createdAt: row.created_at,
    plan: plan ? { id: plan.id, key: plan.key, kind: plan.kind as 'plan' | 'addon', billable: plan.billable } : null,
  };
}

function toPrice(row: PriceRow): ItemPrice {
  return {
    id: row.id,
    itemId: row.item_id ?? '',
    currency: row.currency,
    amountMinor: Number(row.amount_minor),
    billingInterval: row.billing_interval as BillingInterval,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    approvalState: row.approval_state as ItemPrice['approvalState'],
    note: row.note,
  };
}

const INTERVAL_LABEL: Record<BillingInterval, string> = { month: 'month', year: 'year', one_time: 'once' };

/** A price as read on screen: "CA$49.00 / month", "CA$490.00 / year", "CA$250.00 once". */
export function priceText(price: Pick<ItemPrice, 'amountMinor' | 'currency' | 'billingInterval'>): string {
  return price.billingInterval === 'one_time'
    ? `${formatMoney(price.amountMinor, price.currency)} once`
    : `${formatMoney(price.amountMinor, price.currency)} / ${INTERVAL_LABEL[price.billingInterval]}`;
}

export async function listRecurringItems(db: Db, input: { organizationId: string }): Promise<RecurringItem[]> {
  const { data, error } = await db
    .from('price_book_items')
    .select(ITEM_COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('pricing_model', 'recurring')
    .order('name');
  if (error) throw fromDatabaseError(error, 'recurring_items.list_failed');
  return ((data ?? []) as ItemRow[]).map(toItem);
}

export async function getRecurringItem(db: Db, input: { organizationId: string; itemId: string }): Promise<RecurringItem | null> {
  const { data, error } = await db
    .from('price_book_items')
    .select(ITEM_COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('id', input.itemId)
    .eq('pricing_model', 'recurring')
    .maybeSingle();
  if (error) throw fromDatabaseError(error, 'recurring_items.read_failed');
  return data ? toItem(data as ItemRow) : null;
}

/** Prices of the given items, or of every item of the business when `itemIds` is omitted, newest first. */
export async function listItemPrices(db: Db, input: { organizationId: string; itemIds?: string[] }): Promise<ItemPrice[]> {
  if (input.itemIds?.length === 0) return [];
  let query = db
    .from('price_book_item_prices')
    .select(PRICE_COLUMNS)
    .eq('organization_id', input.organizationId)
    .not('item_id', 'is', null);
  if (input.itemIds) query = query.in('item_id', input.itemIds);
  const { data, error } = await query.order('effective_from', { ascending: false });
  if (error) throw fromDatabaseError(error, 'recurring_items.prices_failed');
  return ((data ?? []) as PriceRow[]).map(toPrice);
}

/**
 * The prices in force at `at`, one per currency and billing interval: the newest approved price
 * that has started and not ended. `prices` must be newest first, as `listItemPrices` returns them.
 */
export function currentItemPrices(prices: readonly ItemPrice[], at: string = new Date().toISOString()): ItemPrice[] {
  const seen = new Set<string>();
  const current: ItemPrice[] = [];
  for (const price of prices) {
    const key = `${price.itemId}:${price.currency}:${price.billingInterval}`;
    if (seen.has(key) || price.approvalState !== 'approved') continue;
    if (price.effectiveFrom > at || (price.effectiveTo !== null && price.effectiveTo <= at)) continue;
    seen.add(key);
    current.push(price);
  }
  return current;
}

export async function createRecurringItem(
  db: Db,
  input: { organizationId: string; name: string; unit: string; description?: string },
): Promise<string> {
  const name = input.name.trim();
  const unit = input.unit.trim();
  if (!name) throw new DomainError('Give the item a name.', 'recurring_items.name_required');
  if (!unit) throw new DomainError('Say what one unit is, such as a month or a seat.', 'recurring_items.unit_required');
  const { data, error } = await db.rpc('create_recurring_price_book_item', {
    p_organization_id: input.organizationId,
    p_name: name,
    p_unit: unit,
    p_description: input.description?.trim() ?? '',
  });
  if (error) {
    if (error.code === '23505') throw new DomainError('An item already has this name.', 'recurring_items.name_taken');
    throw fromDatabaseError(error, 'recurring_items.create_failed');
  }
  return data as string;
}

export async function updateRecurringItem(
  db: Db,
  input: { organizationId: string; itemId: string; name: string; unit: string; description: string; saleStatus: ItemSaleStatus },
): Promise<void> {
  const name = input.name.trim();
  const unit = input.unit.trim();
  if (!name) throw new DomainError('Give the item a name.', 'recurring_items.name_required');
  if (!unit) throw new DomainError('Say what one unit is, such as a month or a seat.', 'recurring_items.unit_required');
  const { data, error } = await db
    .from('price_book_items')
    .update({ name, unit, description: input.description.trim(), sale_status: input.saleStatus })
    .eq('organization_id', input.organizationId)
    .eq('id', input.itemId)
    .eq('pricing_model', 'recurring')
    .select('id');
  if (error) {
    if (error.code === '23505') throw new DomainError('An item already has this name.', 'recurring_items.name_taken');
    throw fromDatabaseError(error, 'recurring_items.update_failed');
  }
  if (!data || data.length === 0) throw new DomainError('You cannot change this item.', 'recurring_items.forbidden');
}

export async function recordItemPrice(
  db: Db,
  input: { organizationId: string; itemId: string; currency: string; amountMinor: number; billingInterval: BillingInterval; effectiveFrom: string; note?: string },
): Promise<string> {
  if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0) {
    throw new DomainError('An amount is a whole number of cents, zero or more.', 'recurring_items.amount_invalid');
  }
  if (!/^[A-Z]{3}$/.test(input.currency.trim().toUpperCase())) {
    throw new DomainError('A currency is a three-letter code, such as CAD.', 'recurring_items.currency_invalid');
  }
  const { data, error } = await db.rpc('record_item_price', {
    p_organization_id: input.organizationId,
    p_item_id: input.itemId,
    p_currency: input.currency,
    p_amount_minor: input.amountMinor,
    p_billing_interval: input.billingInterval,
    p_effective_from: input.effectiveFrom,
    p_note: input.note ?? '',
  });
  if (error) {
    if (error.code === '42501') throw new DomainError('You cannot set what this business charges.', 'recurring_items.forbidden');
    if (error.code === '23505') throw new DomainError('A price for this currency and interval already starts at that moment.', 'recurring_items.price_moment_taken');
    throw fromDatabaseError(error, 'recurring_items.price_failed');
  }
  return data as string;
}

export type ItemAddon = { itemId: string; addonItemId: string; includedByDefault: boolean };

export async function listItemAddons(db: Db, input: { organizationId: string; itemIds: string[] }): Promise<ItemAddon[]> {
  if (input.itemIds.length === 0) return [];
  const { data, error } = await db
    .from('price_book_item_addons')
    .select('item_id, addon_item_id, included_by_default')
    .eq('organization_id', input.organizationId)
    .in('item_id', input.itemIds);
  if (error) throw fromDatabaseError(error, 'recurring_items.addons_failed');
  return (data ?? []).flatMap((row) =>
    row.item_id && row.addon_item_id ? [{ itemId: row.item_id, addonItemId: row.addon_item_id, includedByDefault: row.included_by_default }] : []);
}

export async function setItemAddon(
  db: Db,
  input: { organizationId: string; itemId: string; addonItemId: string; attached: boolean },
): Promise<void> {
  const { error } = await db.rpc('set_item_addon', {
    p_organization_id: input.organizationId,
    p_item_id: input.itemId,
    p_addon_item_id: input.addonItemId,
    p_attached: input.attached,
  });
  if (error) {
    if (error.code === '42501') throw new DomainError('You cannot set what this business charges.', 'recurring_items.forbidden');
    if (error.code === '22023') throw new DomainError(error.message, 'recurring_items.addon_invalid');
    throw fromDatabaseError(error, 'recurring_items.addon_failed');
  }
}

export type ItemSwitch = { kind: 'product' | 'module' | 'feature' | 'excluded_feature' | 'allowance'; label: string; detail: string };

/** What an item switches on when it sells a platform plan; empty for any other item. */
export async function itemSwitches(db: Db, input: { organizationId: string; itemId: string }): Promise<ItemSwitch[]> {
  const { data, error } = await db.rpc('price_book_item_switches', { p_organization_id: input.organizationId, p_item_id: input.itemId });
  if (error) throw fromDatabaseError(error, 'recurring_items.switches_failed');
  return ((data ?? []) as { kind: string; label: string; detail: string }[]).map((row) => ({
    kind: row.kind as ItemSwitch['kind'],
    label: row.label,
    detail: row.detail,
  }));
}

import type { Db } from '@/lib/db/types';
import {
  currentItemPrices,
  getRecurringItem,
  itemSwitches,
  listItemAddons,
  listItemPrices,
  listRecurringItems,
  type ItemPrice,
  type RecurringItem,
} from '@/lib/domain/pricing/recurring-items';
import {
  billingEnvironment,
  listItemProviderPrices,
  listMeteredAllowances,
  listUsagePrices,
} from '@/lib/domain/pricing/item-provider-prices';

/**
 * Catalog & Pricing's recurring items (ADR-057): what a business charges every period, for the
 * catalog list and for one item's page. Everything is read as the signed-in member, so the
 * database decides what they see.
 */

export type RecurringItemRow = RecurringItem & { current: ItemPrice[] };

export async function loadRecurringItems(db: Db, input: { organizationId: string }): Promise<RecurringItemRow[]> {
  const items = await listRecurringItems(db, input);
  // Every price of the business in one read: a list of item ids would not fit in a request.
  const prices = await listItemPrices(db, { organizationId: input.organizationId });
  const current = currentItemPrices(prices);
  return items.map((item) => ({ ...item, current: current.filter((price) => price.itemId === item.id) }));
}

export async function loadRecurringItem(db: Db, input: { organizationId: string; itemId: string }) {
  const item = await getRecurringItem(db, input);
  if (!item) return null;
  const [prices, addons, switches, others, environment] = await Promise.all([
    listItemPrices(db, { organizationId: input.organizationId, itemIds: [item.id] }),
    listItemAddons(db, { organizationId: input.organizationId, itemIds: [item.id] }),
    itemSwitches(db, input),
    listRecurringItems(db, { organizationId: input.organizationId }),
    item.plan ? billingEnvironment() : Promise.resolve(null),
  ]);
  const [provider, allowances, usagePrices] = await Promise.all([
    environment ? listItemProviderPrices(db, { organizationId: input.organizationId, priceIds: prices.map((price) => price.id), environment }) : Promise.resolve([]),
    item.plan ? listMeteredAllowances(db, { planId: item.plan.id }) : Promise.resolve([]),
    item.plan ? listUsagePrices(db, { itemId: item.id }) : Promise.resolve([]),
  ]);
  const attached = new Set(addons.map((addon) => addon.addonItemId));
  // A plan offers add-on items; an add-on and an item that sells no plan offer any other item.
  const addonOptions = others.filter((other) => other.id !== item.id && other.saleStatus !== 'archived' && (
    item.plan ? item.plan.kind === 'plan' && other.plan?.kind === 'addon' : !other.plan));
  return {
    item,
    prices,
    current: currentItemPrices(prices),
    addons: others.filter((other) => attached.has(other.id)),
    addonOptions: addonOptions.filter((other) => !attached.has(other.id)),
    mayCarryAddons: !item.plan || item.plan.kind === 'plan',
    switches,
    environment,
    providerByPrice: new Map(provider.map((row) => [row.priceId, row])),
    allowances,
    usagePrices,
  };
}

export type RecurringItemModel = NonNullable<Awaited<ReturnType<typeof loadRecurringItem>>>;

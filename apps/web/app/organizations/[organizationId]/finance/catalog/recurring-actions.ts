'use server';

import { revalidatePath } from 'next/cache';
import { DomainError } from '@/lib/domain/errors';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { parseMicrosInput, parseMoneyInput } from '@/lib/domain/pricing/money-input';
import {
  createRecurringItem,
  getRecurringItem,
  recordItemPrice,
  setItemAddon,
  updateRecurringItem,
  type BillingInterval,
  type ItemSaleStatus,
} from '@/lib/domain/pricing/recurring-items';
import { provisionItemPrice, recordUsagePrice } from '@/lib/domain/pricing/item-provider-prices';
import { requireOperatingArea } from '@/lib/route/workspace-configuration';

/**
 * Recurring items in Catalog & Pricing (ADR-057). Every action re-reads the member's area and
 * feature before writing; the database checks the pricing permission again.
 */

export type RecurringItemState = { error: string | null; success?: string; itemId?: string };

const INTERVALS: readonly BillingInterval[] = ['month', 'year', 'one_time'];
const SALE_STATUSES: readonly ItemSaleStatus[] = ['active', 'unlisted', 'archived'];

async function context(form: FormData) {
  const organizationId = String(form.get('organizationId') ?? '');
  const area = await requireOperatingArea(organizationId, 'finance-catalog');
  if (!area.gate.featureAvailability.has('recurring_items')) throw new DomainError('Recurring items are not available for this business.', 'recurring_items.unavailable');
  if (!area.organization.capabilities.includes('price.manage')) throw new DomainError('Your role cannot change prices.', 'recurring_items.forbidden');
  return { ...area, organizationId };
}

function refresh(organizationId: string, itemId?: string) {
  revalidatePath(`/organizations/${organizationId}/finance/catalog`);
  if (itemId) revalidatePath(`/organizations/${organizationId}/finance/catalog/${itemId}`);
}

function failed(error: unknown): RecurringItemState {
  if (error instanceof DomainError) return { error: error.message };
  throw error;
}

export async function createRecurringItemAction(_: RecurringItemState, form: FormData): Promise<RecurringItemState> {
  try {
    const { db, organizationId } = await context(form);
    const itemId = await createRecurringItem(db, {
      organizationId,
      name: String(form.get('name') ?? ''),
      unit: String(form.get('unit') ?? ''),
      description: String(form.get('description') ?? ''),
    });
    refresh(organizationId);
    // The drawer opens the new item and confirms it in a toast.
    return { error: null, success: 'Recurring item created.', itemId };
  } catch (error) {
    return failed(error);
  }
}

export async function updateRecurringItemAction(_: RecurringItemState, form: FormData): Promise<RecurringItemState> {
  try {
    const { db, organizationId } = await context(form);
    const itemId = String(form.get('itemId') ?? '');
    const saleStatus = String(form.get('saleStatus') ?? 'active') as ItemSaleStatus;
    if (!SALE_STATUSES.includes(saleStatus)) throw new DomainError('Choose whether the item is offered.', 'recurring_items.sale_status_invalid');
    await updateRecurringItem(db, {
      organizationId,
      itemId,
      name: String(form.get('name') ?? ''),
      unit: String(form.get('unit') ?? ''),
      description: String(form.get('description') ?? ''),
      saleStatus,
    });
    refresh(organizationId, itemId);
    return { error: null, success: 'Item saved.' };
  } catch (error) {
    return failed(error);
  }
}

export async function recordItemPriceAction(_: RecurringItemState, form: FormData): Promise<RecurringItemState> {
  try {
    const { db, organizationId } = await context(form);
    const itemId = String(form.get('itemId') ?? '');
    const currency = String(form.get('currency') ?? '').trim().toUpperCase();
    const billingInterval = String(form.get('billingInterval') ?? '') as BillingInterval;
    if (!INTERVALS.includes(billingInterval)) throw new DomainError('Choose how often it is charged.', 'recurring_items.interval_invalid');
    const effective = String(form.get('effectiveFrom') ?? '');
    const effectiveFrom = effective ? new Date(`${effective}T00:00:00`).toISOString() : new Date().toISOString();
    const amountMinor = parseMoneyInput(String(form.get('amount') ?? ''), currency);
    await recordItemPrice(db, { organizationId, itemId, currency, amountMinor, billingInterval, effectiveFrom });
    refresh(organizationId, itemId);
    return { error: null, success: `Price recorded: ${formatMoney(amountMinor, currency)}.` };
  } catch (error) {
    return failed(error);
  }
}

export async function setItemAddonAction(_: RecurringItemState, form: FormData): Promise<RecurringItemState> {
  try {
    const { db, organizationId } = await context(form);
    const itemId = String(form.get('itemId') ?? '');
    const attached = form.get('attached') === 'true';
    await setItemAddon(db, { organizationId, itemId, addonItemId: String(form.get('addonItemId') ?? ''), attached });
    refresh(organizationId, itemId);
    return { error: null, success: attached ? 'Add-on offered.' : 'Add-on removed.' };
  } catch (error) {
    return failed(error);
  }
}

export async function provisionItemPriceAction(_: RecurringItemState, form: FormData): Promise<RecurringItemState> {
  try {
    const { db, organizationId } = await context(form);
    const itemId = String(form.get('itemId') ?? '');
    const item = await getRecurringItem(db, { organizationId, itemId });
    if (!item) throw new DomainError('No such item.', 'recurring_items.not_found');
    await provisionItemPrice(db, { organizationId, item, priceId: String(form.get('priceId') ?? '') });
    refresh(organizationId, itemId);
    return { error: null, success: 'Ready for checkout.' };
  } catch (error) {
    return failed(error);
  }
}

export async function recordUsagePriceAction(_: RecurringItemState, form: FormData): Promise<RecurringItemState> {
  try {
    const { db, organizationId } = await context(form);
    const itemId = String(form.get('itemId') ?? '');
    const currency = String(form.get('currency') ?? '').trim().toUpperCase();
    const effective = String(form.get('effectiveFrom') ?? '');
    await recordUsagePrice(db, {
      organizationId,
      itemId,
      meterId: String(form.get('meterId') ?? ''),
      currency,
      unitAmountMicros: parseMicrosInput(String(form.get('amount') ?? ''), currency),
      effectiveFrom: effective ? new Date(`${effective}T00:00:00`).toISOString() : new Date().toISOString(),
    });
    refresh(organizationId, itemId);
    return { error: null, success: 'Usage price recorded.' };
  } catch (error) {
    return failed(error);
  }
}

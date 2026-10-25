'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import {
  createPriceBookItem,
  listPriceBookItems,
  updatePriceBookItem,
} from '@/lib/domain/pricing/price-book';
import { setTradingCurrency, updateOrganization } from '@/lib/domain/tenancy/organizations';
import { requireOrganization } from '@/lib/route/organization';

import { parseMoneyInput } from '@/lib/domain/pricing/money-input';

export type PriceItemState = { error: string | null; success?: string };

export async function createPriceItemAction(
  _previous: PriceItemState,
  formData: FormData,
): Promise<PriceItemState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const { organization } = await requireOrganization(organizationId);

  try {
    if (!organization.currency) throw new DomainError('Choose a trading currency before creating prices.', 'prices.currency_required');
    await createPriceBookItem(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      unit: String(formData.get('unit') ?? ''),
      unitAmountMinor: parseMoneyInput(String(formData.get('amount') ?? ''), organization.currency ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/finance/configuration/pricing`);
  revalidatePath(`/organizations/${organizationId}/finance/catalog`);
  revalidatePath(`/organizations/${organizationId}/finance`, 'layout');
  return { error: null, success: 'Saved.' };
}

export async function updatePriceItemAction(
  _previous: PriceItemState,
  formData: FormData,
): Promise<PriceItemState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    const item = (await listPriceBookItems(db, { organizationId })).find(item => item.id === String(formData.get('itemId') ?? ''));
    if (!item) throw new DomainError('Price item is unavailable.', 'prices.unavailable');
    await updatePriceBookItem(db, {
      id: String(formData.get('itemId') ?? ''),
      name: String(formData.get('name') ?? ''),
      unit: String(formData.get('unit') ?? ''),
      unitAmountMinor: parseMoneyInput(String(formData.get('amount') ?? ''), item.currency),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/finance/configuration/pricing`);
  revalidatePath(`/organizations/${organizationId}/finance/catalog`);
  revalidatePath(`/organizations/${organizationId}/finance`, 'layout');
  return { error: null, success: 'Saved.' };
}

/**
 * Answer what this business charges in, from the screen where it first matters.
 *
 * Calls the domain, which calls `updateOrganization` — so this is the same write, the same
 * capability check and the same event as changing it in Settings. A screen does not get its own
 * way to change what a business trades in just because it is the screen that noticed.
 */
export async function chooseCurrencyAction(
  _previous: PriceItemState,
  formData: FormData,
): Promise<PriceItemState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  const { organization } = await requireOrganization(organizationId);

  try {
    if (organization.currency === null) await setTradingCurrency(db, {
      organizationId,
      currency: String(formData.get('currency') ?? ''),
    });
    else await updateOrganization(db, { id: organizationId, name: organization.name, timezone: organization.timezone, bufferMinutes: organization.bufferMinutes, slug: organization.slug, currency: String(formData.get('currency') ?? '') });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/finance/configuration/pricing`);
  revalidatePath(`/organizations/${organizationId}/finance/catalog`);
  revalidatePath(`/organizations/${organizationId}/finance`, 'layout');
  return { error: null, success: 'Saved.' };
}

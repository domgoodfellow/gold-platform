'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import {
  createPriceBookItem,
  updatePriceBookItem,
} from '@/lib/domain/pricing/price-book';
import { setTradingCurrency } from '@/lib/domain/tenancy/organizations';
import { requireOrganization } from '@/lib/route/organization';

export type PriceItemState = { error: string | null };

/**
 * Read an amount a person typed as integer minor units.
 *
 * The one place in this action where money is converted, and it converts *into* minor units
 * rather than out of them — so everything downstream of here is an integer, which is what
 * "money is integer minor units" means in practice. `Math.round` is doing real work: 42.55
 * times 100 is 4254.999999999999 in binary floating point, and truncating would quietly
 * charge a cent less.
 *
 * The fraction digits are not assumed to be two. A tenant trading in JPY types 4250 and means
 * 4250 yen, and multiplying by 100 would overcharge them a hundredfold.
 */
function toMinorUnits(typed: string, currency: string): number {
  const value = Number(typed.trim());
  if (!Number.isFinite(value)) {
    throw new DomainError('That is not an amount.', 'prices.amount_not_a_number');
  }

  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat('en-GB', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    // A well-formed code ICU does not know. Two is the honest guess at that point, and the
    // domain layer still refuses anything that is not a whole number of minor units.
  }

  return Math.round(value * 10 ** digits);
}

export async function createPriceItemAction(
  _previous: PriceItemState,
  formData: FormData,
): Promise<PriceItemState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await createPriceBookItem(db, {
      organizationId,
      name: String(formData.get('name') ?? ''),
      unit: String(formData.get('unit') ?? ''),
      // The currency comes from the rendered form, which read it from the organization. It
      // is used only to decide how many decimal places the typed figure has — the currency
      // actually stored is read from the organization again inside the RPC, so a tampered
      // value cannot change what this business is recorded as pricing in.
      unitAmountMinor: toMinorUnits(
        String(formData.get('amount') ?? ''),
        String(formData.get('currency') ?? ''),
      ),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings/pricing`);
  return { error: null };
}

export async function updatePriceItemAction(
  _previous: PriceItemState,
  formData: FormData,
): Promise<PriceItemState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  try {
    await updatePriceBookItem(db, {
      id: String(formData.get('itemId') ?? ''),
      name: String(formData.get('name') ?? ''),
      unit: String(formData.get('unit') ?? ''),
      unitAmountMinor: toMinorUnits(
        String(formData.get('amount') ?? ''),
        String(formData.get('currency') ?? ''),
      ),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings/pricing`);
  return { error: null };
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
  await requireOrganization(organizationId);

  try {
    await setTradingCurrency(db, {
      organizationId,
      currency: String(formData.get('currency') ?? ''),
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return { error: error.message };
    }
    throw error;
  }

  revalidatePath(`/organizations/${organizationId}/settings/pricing`);
  return { error: null };
}

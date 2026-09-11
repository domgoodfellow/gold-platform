'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { recordProductPrice, recordProviderRate, recordRetailRate } from '@/lib/domain/commercial/catalogue';

export type PriceState = { error: string | null; recorded: boolean };
export const PRICE_INITIAL: PriceState = { error: null, recorded: false };

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? '').trim();
}

export async function recordProductPriceAction(_: PriceState, formData: FormData): Promise<PriceState> {
  try {
    const interval = value(formData, 'billingInterval');
    if (interval !== 'month' && interval !== 'year' && interval !== 'one_time') {
      throw new DomainError('Choose a supported billing interval.', 'commercial.interval_invalid');
    }
    await recordProductPrice(await getDb(), {
      productKey: value(formData, 'productKey'),
      currency: value(formData, 'currency').toUpperCase(),
      amountMinor: Number(formData.get('amountMinor')),
      billingInterval: interval,
      effectiveFrom: value(formData, 'effectiveFrom') || new Date().toISOString(),
      source: value(formData, 'source') || 'staff rate card',
      note: value(formData, 'note'),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, recorded: false };
    throw error;
  }
  revalidatePath('/platform/pricing');
  revalidatePath('/platform/catalog/products');
  return { error: null, recorded: true };
}

export async function recordProviderRateAction(_: PriceState, formData: FormData): Promise<PriceState> {
  try {
    await recordProviderRate(await getDb(), {
      providerKey: value(formData, 'providerKey'),
      meterId: value(formData, 'meterId'),
      currency: value(formData, 'currency').toUpperCase(),
      unitAmountMicros: Number(formData.get('unitAmountMicros')),
      source: value(formData, 'source'),
      note: value(formData, 'note'),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, recorded: false };
    throw error;
  }
  revalidatePath('/platform/pricing');
  revalidatePath('/platform/catalog/meters');
  revalidatePath('/platform/providers');
  return { error: null, recorded: true };
}

export async function recordRetailRateAction(_: PriceState, formData: FormData): Promise<PriceState> {
  try {
    await recordRetailRate(await getDb(), {
      meterId: value(formData, 'meterId'),
      currency: value(formData, 'currency').toUpperCase(),
      unitAmountMicros: Number(formData.get('unitAmountMicros')),
      source: value(formData, 'source'),
      note: value(formData, 'note'),
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, recorded: false };
    throw error;
  }
  revalidatePath('/platform/pricing');
  revalidatePath('/platform/catalog/meters');
  return { error: null, recorded: true };
}

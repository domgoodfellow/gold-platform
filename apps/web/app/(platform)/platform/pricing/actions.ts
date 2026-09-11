'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { recordProductPrice } from '@/lib/domain/commercial/catalogue';

export type ProductPriceState = { error: string | null; recorded: boolean };
export const PRODUCT_PRICE_INITIAL: ProductPriceState = { error: null, recorded: false };

export async function recordProductPriceAction(_: ProductPriceState, formData: FormData): Promise<ProductPriceState> {
  try {
    await recordProductPrice(await getDb(), { productKey: String(formData.get('productKey') ?? ''), currency: String(formData.get('currency') ?? ''), amountMinor: Number(formData.get('amountMinor') ?? 0), billingInterval: String(formData.get('billingInterval') ?? 'month') as 'month' | 'year' | 'one_time', effectiveFrom: String(formData.get('effectiveFrom') ?? new Date().toISOString()), source: String(formData.get('source') ?? 'staff rate card') });
  } catch (error) { if (error instanceof DomainError) return { error: error.message, recorded: false }; throw error; }
  revalidatePath('/platform/pricing'); return { error: null, recorded: true };
}

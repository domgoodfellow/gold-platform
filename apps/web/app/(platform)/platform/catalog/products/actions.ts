'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { updateProduct, type Product } from '@/lib/domain/commercial/catalogue';
import { DomainError } from '@/lib/domain/errors';

export type ProductState = { error: string | null; updated: boolean };
export const PRODUCT_INITIAL: ProductState = { error: null, updated: false };

export async function updateProductAction(_: ProductState, formData: FormData): Promise<ProductState> {
  const saleStatus = String(formData.get('saleStatus') ?? '');
  try {
    if (saleStatus !== 'active' && saleStatus !== 'unlisted' && saleStatus !== 'archived') {
      throw new DomainError('Choose a valid sale state.', 'commercial.sale_status_invalid');
    }
    await updateProduct(await getDb(), {
      key: String(formData.get('productKey') ?? ''),
      label: String(formData.get('label') ?? ''),
      description: String(formData.get('description') ?? ''),
      displayOrder: Number(formData.get('displayOrder')),
      saleStatus: saleStatus as Product['saleStatus'],
    });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message, updated: false };
    throw error;
  }
  revalidatePath('/platform/catalog/products');
  revalidatePath('/platform/catalog/modules');
  revalidatePath('/platform/pricing');
  return { error: null, updated: true };
}

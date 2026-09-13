'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { productKeyToUrlSegment, updateProduct, type Product } from '@/lib/domain/commercial/catalogue';
import { DomainError } from '@/lib/domain/errors';

// No `PRODUCT_INITIAL` constant here, even though every caller needs one: a file carrying
// `'use server'` may export only async functions — a plain object export makes Next.js refuse
// to build the client reference for this module at all ("A 'use server' file can only export
// async functions, found object"). The initial state lives in the client component that calls
// `useActionState`, the same place every other action-state constant in this codebase already
// lives (features/automations/shared.tsx, features/documents/upload-form.tsx) — this file was
// the one that had drifted from that pattern.
export type ProductState = { error: string | null; updated: boolean };

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
  const productKey = String(formData.get('productKey') ?? '');
  revalidatePath('/platform/catalog/products');
  revalidatePath(`/platform/catalog/products/${productKeyToUrlSegment(productKey)}`);
  revalidatePath('/platform/catalog/modules');
  revalidatePath('/platform/pricing');
  return { error: null, updated: true };
}

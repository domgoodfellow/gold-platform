'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, SelectInput, TextInput } from '@/components/controls/inputs';
import type { Product } from '@/lib/domain/commercial/catalogue';
import { PRODUCT_INITIAL, updateProductAction } from '@/app/(platform)/platform/catalog/products/actions';

export function ProductSettingsForm({ product }: { product: Product }) {
  const [state, action, pending] = useActionState(updateProductAction, PRODUCT_INITIAL);
  return (
    <details className="relative">
      <summary className="cursor-pointer text-sm font-medium underline underline-offset-4">Edit</summary>
      <div className="absolute right-0 z-10 mt-2 w-[min(22rem,calc(100vw-3rem))] rounded-lg border border-border bg-background p-4 shadow-lg">
        <form action={action} className="flex flex-col gap-2">
          <input type="hidden" name="productKey" value={product.key} />
          <TextInput name="label" required maxLength={120} defaultValue={product.label} aria-label="Product label" />
          <TextInput name="description" maxLength={500} defaultValue={product.description} placeholder="Description" aria-label="Product description" />
          <div className="flex gap-2">
            <SelectInput name="saleStatus" defaultValue={product.saleStatus} aria-label="Sale status">
              <option value="active">Available for sale</option>
              <option value="unlisted">Unlisted</option>
              <option value="archived">Archived</option>
            </SelectInput>
            <TextInput name="displayOrder" type="number" min={0} defaultValue={product.displayOrder} aria-label="Display order" className="w-24" />
          </div>
          <p className="text-xs text-muted-foreground">Key, kind, and module mapping are code/deployment-owned.</p>
          <ErrorText>{state.error}</ErrorText>
          {state.updated ? <p className="text-sm text-muted-foreground">Updated.</p> : null}
          <Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Saving…' : 'Save product'}</Button>
        </form>
      </div>
    </details>
  );
}

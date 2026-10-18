'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import type { Product } from '@/lib/domain/commercial/catalogue';
import { updateProductAction, type ProductState } from '@/app/platform/catalog/products/actions';

const PRODUCT_INITIAL: ProductState = { error: null, updated: false };

/**
 * A product's own edit form, on its own record page — not a `<details>` popover floating over
 * a data table row. The fields are unchanged from the popover this replaces; only where they
 * live changed.
 */
export function ProductForm({ product }: { product: Product }) {
  const [state, action, pending] = useActionState(updateProductAction, PRODUCT_INITIAL);

  return (
    <form action={action} className="mt-4 flex max-w-xl flex-col gap-3">
      <input type="hidden" name="productKey" value={product.key} />

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="label">Label</FieldLabel>
        <TextInput
          id="label"
          name="label"
          required
          maxLength={120}
          defaultValue={product.label}
        />
      </div>

      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="description">Description</FieldLabel>
        <TextInput
          id="description"
          name="description"
          maxLength={500}
          defaultValue={product.description}
          placeholder="Description"
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1">
          <FieldLabel htmlFor="saleStatus">Sale state</FieldLabel>
          <SelectInput id="saleStatus" name="saleStatus" defaultValue={product.saleStatus}>
            <option value="active">Available for sale</option>
            <option value="unlisted">Unlisted</option>
            <option value="archived">Archived</option>
          </SelectInput>
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor="displayOrder">Display order</FieldLabel>
          <TextInput
            id="displayOrder"
            name="displayOrder"
            type="number"
            min={0}
            defaultValue={product.displayOrder}
            className="w-28"
          />
        </div>
      </div>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Saving…' : 'Save product'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
      {state.updated ? <Hint role="status">Updated.</Hint> : null}
    </form>
  );
}

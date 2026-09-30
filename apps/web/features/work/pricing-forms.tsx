'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { FormError, FormField } from '@/components/controls/form';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import {
  addPricedLineAction,
  removePricedLineAction,
  type WorkItemActionState,
} from '@/app/organizations/[organizationId]/work/[workItemId]/actions';

const INITIAL: WorkItemActionState = { error: null };

export function AddPricedLineForm({ organizationId, workItemId, items }: {
  organizationId: string;
  workItemId: string;
  items: PriceBookItem[];
}) {
  const [state, formAction, pending] = useActionState(addPricedLineAction, INITIAL);
  return (
    <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_auto] sm:items-end">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <FormField id={`quote-item-${workItemId}`} label="Priced item">
        {(field) => <SelectInput {...field} name="priceBookItemId" required>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · per {item.unit}</option>)}</SelectInput>}
      </FormField>
      <FormField id={`quote-quantity-${workItemId}`} label="Quantity">
        {(field) => <TextInput {...field} name="quantity" type="number" required min={1} step={1} defaultValue={1} />}
      </FormField>
      <Button type="submit" disabled={pending} tone="secondary">{pending ? 'Adding…' : 'Add to quote'}</Button>
      <FormError className="sm:col-span-3">{state.error}</FormError>
    </form>
  );
}

export function RemovePricedLineForm({ organizationId, workItemId, lineId, description }: {
  organizationId: string;
  workItemId: string;
  lineId: string;
  description: string;
}) {
  const [state, formAction, pending] = useActionState(removePricedLineAction, INITIAL);
  const formId = `remove-priced-line-${lineId}`;
  return (
    <form id={formId} action={formAction} className="inline">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <input type="hidden" name="lineId" value={lineId} />
      <ConfirmSubmit formId={formId} label="Remove" confirmLabel="Remove line" description={`Remove "${description}" from this quote?`} ariaLabel={`Remove ${description}`} tone="text" size="tiny" pending={pending} />
      <FormError className="ml-2 inline text-xs">{state.error}</FormError>
    </form>
  );
}

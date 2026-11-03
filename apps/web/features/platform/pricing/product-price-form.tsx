'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import { PRICE_INITIAL, recordProductPriceAction } from '@/app/platform/pricing/actions';
import { SelectField } from '@/components/controls/select-field';

export function ProductPriceForm({ products }: { products: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState(recordProductPriceAction, PRICE_INITIAL);
  return <form action={action} className="flex max-w-sm flex-col gap-2"><SelectField name="productKey" aria-label="Product" required options={[{ value: '', label: 'Product…' }, ...products.map((product) => ({ value: product.value, label: product.label }))]} /><div className="flex gap-2"><TextInput name="amountMinor" type="number" min={0} required placeholder="Minor units" className="w-36" /><TextInput name="currency" required maxLength={3} placeholder="USD" className="w-20" /></div><SelectField name="billingInterval" aria-label="Billing interval" options={[{ value: 'month', label: 'Monthly' }, { value: 'year', label: 'Yearly' }, { value: 'one_time', label: 'One time' }]} /><TextInput name="effectiveFrom" type="datetime-local" aria-label="Effective from" /><TextInput name="source" required defaultValue="staff rate card" placeholder="Source" /><ErrorText>{state.error}</ErrorText>{state.recorded ? <p className="text-sm text-muted-foreground">Recorded.</p> : null}<Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Recording…' : 'Record list price'}</Button></form>;
}

'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, SelectInput, TextInput } from '@/components/controls/inputs';
import { PRODUCT_PRICE_INITIAL, recordProductPriceAction } from '@/app/(platform)/platform/pricing/actions';

export function ProductPriceForm({ products }: { products: { value: string; label: string }[] }) {
  const [state, action, pending] = useActionState(recordProductPriceAction, PRODUCT_PRICE_INITIAL);
  return <form action={action} className="flex max-w-sm flex-col gap-2"><SelectInput name="productKey" aria-label="Product" required><option value="">Product…</option>{products.map((product) => <option key={product.value} value={product.value}>{product.label}</option>)}</SelectInput><div className="flex gap-2"><TextInput name="amountMinor" type="number" min={0} required placeholder="Minor units" className="w-36" /><TextInput name="currency" required maxLength={3} placeholder="USD" className="w-20" /></div><SelectInput name="billingInterval" aria-label="Billing interval"><option value="month">Monthly</option><option value="year">Yearly</option><option value="one_time">One time</option></SelectInput><TextInput name="effectiveFrom" type="datetime-local" aria-label="Effective from" /><TextInput name="source" required defaultValue="staff rate card" placeholder="Source" /><ErrorText>{state.error}</ErrorText>{state.recorded ? <p className="text-sm text-muted-foreground">Recorded.</p> : null}<Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Recording…' : 'Record list price'}</Button></form>;
}

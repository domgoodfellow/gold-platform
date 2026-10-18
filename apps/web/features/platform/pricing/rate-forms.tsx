'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, SelectInput, TextInput } from '@/components/controls/inputs';
import { PRICE_INITIAL, recordProviderRateAction, recordRetailRateAction } from '@/app/platform/pricing/actions';

type Option = { value: string; label: string };

function RateFields({ meters, providers }: { meters: Option[]; providers?: Option[] }) {
  return <>{providers ? <SelectInput name="providerKey" required aria-label="Provider"><option value="">Provider…</option>{providers.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</SelectInput> : null}<SelectInput name="meterId" required aria-label="Meter"><option value="">Meter…</option>{meters.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</SelectInput><div className="flex gap-2"><TextInput name="currency" required maxLength={3} placeholder="USD" aria-label="Currency" className="w-24" /><TextInput name="unitAmountMicros" type="number" min={0} step={1} required placeholder="Micro-minor units" aria-label="Micro-minor units per unit" /></div><TextInput name="source" required maxLength={200} placeholder="Invoice or rate-card source" /><TextInput name="note" maxLength={500} placeholder="Optional note" /></>;
}

export function ProviderRateForm({ meters, providers }: { meters: Option[]; providers: Option[] }) {
  const [state, action, pending] = useActionState(recordProviderRateAction, PRICE_INITIAL);
  return <form action={action} className="flex max-w-sm flex-col gap-2"><RateFields meters={meters} providers={providers} /><ErrorText>{state.error}</ErrorText>{state.recorded ? <p className="text-sm text-muted-foreground">Recorded.</p> : null}<Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Recording…' : 'Record provider rate'}</Button></form>;
}

export function RetailRateForm({ meters }: { meters: Option[] }) {
  const [state, action, pending] = useActionState(recordRetailRateAction, PRICE_INITIAL);
  return <form action={action} className="flex max-w-sm flex-col gap-2"><RateFields meters={meters} /><ErrorText>{state.error}</ErrorText>{state.recorded ? <p className="text-sm text-muted-foreground">Recorded.</p> : null}<Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Recording…' : 'Record retail rate'}</Button></form>;
}

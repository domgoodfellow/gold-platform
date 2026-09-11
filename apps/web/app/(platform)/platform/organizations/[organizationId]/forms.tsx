'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, SelectInput, TextInput } from '@/components/controls/inputs';
import {
  PROVISION_TWILIO_INITIAL,
  REGISTER_RESOURCE_INITIAL,
  SET_RESOURCE_STATUS_INITIAL,
  TERM_INITIAL,
  provisionTwilioAction,
  recordCommercialTermAction,
  registerPhoneNumberAction,
  setResourceStatusAction,
} from './actions';

type Option = { value: string; label: string };

export function ProvisionTwilioForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(provisionTwilioAction, PROVISION_TWILIO_INITIAL);
  return <form action={action} className="flex flex-col gap-2"><input type="hidden" name="organizationId" value={organizationId} /><ErrorText>{state.error}</ErrorText>{state.provisioned ? <p className="text-sm text-muted-foreground">Provisioned.</p> : null}<Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Provisioning…' : 'Provision Twilio subaccount'}</Button></form>;
}

export function RegisterPhoneNumberForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(registerPhoneNumberAction, REGISTER_RESOURCE_INITIAL);
  return <form action={action} className="flex max-w-sm flex-col gap-2"><input type="hidden" name="organizationId" value={organizationId} /><TextInput name="number" required placeholder="+14165550142" aria-label="Phone number" /><ErrorText>{state.error}</ErrorText>{state.recorded ? <p className="text-sm text-muted-foreground">Recorded.</p> : null}<Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Recording…' : 'Register number'}</Button></form>;
}

export function SetResourceStatusForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(setResourceStatusAction, SET_RESOURCE_STATUS_INITIAL);
  return <form action={action} className="flex max-w-sm flex-col gap-2"><input type="hidden" name="organizationId" value={organizationId} /><TextInput name="resourceId" required placeholder="Resource ID" /><SelectInput name="status" required aria-label="Status"><option value="">Status…</option><option value="active">Active / verified</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="disabled">Disabled</option></SelectInput><TextInput name="errorDetail" placeholder="Error detail, if failed" /><ErrorText>{state.error}</ErrorText>{state.recorded ? <p className="text-sm text-muted-foreground">Recorded.</p> : null}<Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Recording…' : 'Update resource'}</Button></form>;
}

export function RecordCommercialTermForm({ organizationId, products }: { organizationId: string; products: Option[] }) {
  const [state, action, pending] = useActionState(recordCommercialTermAction, TERM_INITIAL);
  return <form action={action} className="flex max-w-sm flex-col gap-2"><input type="hidden" name="organizationId" value={organizationId} /><SelectInput name="productKey" required aria-label="Product"><option value="">What was sold…</option>{products.map((product) => <option key={product.value} value={product.value}>{product.label}</option>)}</SelectInput><div className="grid grid-cols-2 gap-2"><TextInput name="periodStart" type="date" required aria-label="Period start" /><TextInput name="periodEnd" type="date" required aria-label="Period end" /></div><div className="flex gap-2"><TextInput name="priceMinor" type="number" min={0} step={1} required placeholder="Minor units" /><TextInput name="currency" maxLength={3} placeholder="USD" className="w-24" /></div><ErrorText>{state.error}</ErrorText>{state.recorded ? <p className="text-sm text-muted-foreground">Recorded.</p> : null}<Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Recording…' : 'Record term'}</Button></form>;
}

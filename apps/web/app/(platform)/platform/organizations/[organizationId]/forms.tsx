'use client';

import { useActionState, useState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@gold/ui/components/sheet';
import {
  PLAN_ASSIGNMENT_INITIAL,
  PROVISION_TWILIO_INITIAL,
  REGISTER_RESOURCE_INITIAL,
  SET_RESOURCE_STATUS_INITIAL,
  TERM_INITIAL,
  provisionTwilioAction,
  recordCommercialTermAction,
  recordPlanAssignmentAction,
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

export function AssignPlanSheet({ organizationId, plans }: { organizationId: string; plans: Option[] }) {
  const [state, action, pending] = useActionState(recordPlanAssignmentAction, PLAN_ASSIGNMENT_INITIAL);
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" size="small">
          Change Plan
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Assign a Plan</SheetTitle>
          <SheetDescription>
            The Plan determines entitlement. Available entitled features are active by default;
            the organization can switch them off. Provider-backed features may still need setup.
          </SheetDescription>
        </SheetHeader>
        <form action={action} className="flex flex-col gap-3 px-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <SelectInput name="planId" required aria-label="Plan">
            <option value="">Choose a Plan or Add-on…</option>
            {plans.map((plan) => (
              <option key={plan.value} value={plan.value}>
                {plan.label}
              </option>
            ))}
          </SelectInput>
          <div className="grid grid-cols-2 gap-2">
            <TextInput name="periodStart" type="date" required aria-label="Period start" />
            <TextInput name="periodEnd" type="date" required aria-label="Period end" defaultValue="9999-12-31" />
          </div>
          <TextInput name="note" placeholder="Note (optional)" />
          <ErrorText role="alert">{state.error}</ErrorText>
          {state.recorded ? <Hint role="status">Assigned.</Hint> : null}
          <Button type="submit" size="small" className="w-fit" disabled={pending}>
            {pending ? 'Assigning…' : 'Assign'}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function RecordCommercialTermForm({ organizationId, products }: { organizationId: string; products: Option[] }) {
  const [state, action, pending] = useActionState(recordCommercialTermAction, TERM_INITIAL);
  return <form action={action} className="flex max-w-sm flex-col gap-2"><input type="hidden" name="organizationId" value={organizationId} /><SelectInput name="productKey" required aria-label="Product"><option value="">What was sold…</option>{products.map((product) => <option key={product.value} value={product.value}>{product.label}</option>)}</SelectInput><div className="grid grid-cols-2 gap-2"><TextInput name="periodStart" type="date" required aria-label="Period start" /><TextInput name="periodEnd" type="date" required aria-label="Period end" /></div><div className="flex gap-2"><TextInput name="priceMinor" type="number" min={0} step={1} required placeholder="Minor units" /><TextInput name="currency" maxLength={3} placeholder="USD" className="w-24" /></div><ErrorText>{state.error}</ErrorText>{state.recorded ? <p className="text-sm text-muted-foreground">Recorded.</p> : null}<Button type="submit" size="small" className="w-fit" disabled={pending}>{pending ? 'Recording…' : 'Record term'}</Button></form>;
}

'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { FormActions, FormError } from '@/components/controls/form';
import { requestCardPaymentAction } from '@/app/organizations/[organizationId]/work/[workItemId]/actions';

export function RequestCardPaymentForm({ organizationId, workItemId }: { organizationId: string; workItemId: string }) {
  const [state, formAction, pending] = useActionState(requestCardPaymentAction, { error: null, payUrl: null });
  return (
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <FormActions><Button type="submit" disabled={pending} tone="secondary">{pending ? 'Asking…' : 'Take card payment'}</Button></FormActions>
      {state.payUrl ? <p className="text-sm"><a href={state.payUrl} target="_blank" rel="noreferrer" className="underline underline-offset-4">Payment link</a><span className="text-subtle"> — send this to the customer. Nothing is recorded until the processor confirms it.</span></p> : null}
      <FormError>{state.error}</FormError>
    </form>
  );
}

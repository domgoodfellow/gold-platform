'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { FormActions, FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import {
  issueInvoiceAction,
  recordPaymentAction,
  requestCardPaymentAction,
  type WorkItemActionState,
} from '@/app/organizations/[organizationId]/work/[workItemId]/actions';

const INITIAL: WorkItemActionState = { error: null };

export function IssueInvoiceForm({ organizationId, workItemId }: { organizationId: string; workItemId: string }) {
  const [state, formAction, pending] = useActionState(issueInvoiceAction, INITIAL);
  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={`invoice-date-${workItemId}`} label="Invoice date" optional hint="Leave blank to use today.">
          {(field) => <TextInput {...field} name="issuedAt" type="date" />}
        </FormField>
        <FormField id={`invoice-due-${workItemId}`} label="Due date" optional>
          {(field) => <TextInput {...field} name="dueAt" type="date" />}
        </FormField>
      </div>
      <FormActions><Button type="submit" disabled={pending} tone="secondary">{pending ? 'Issuing…' : 'Issue invoice'}</Button></FormActions>
      <FormError>{state.error}</FormError>
    </form>
  );
}

export function RecordPaymentForm({ organizationId, workItemId, invoiceId, currency }: {
  organizationId: string;
  workItemId: string;
  invoiceId: string;
  currency: string;
}) {
  const [state, formAction, pending] = useActionState(recordPaymentAction, INITIAL);
  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FormField id={`payment-amount-${invoiceId}`} label={`Amount in minor units (${currency})`}>
          {(field) => <TextInput {...field} name="amountMinor" type="number" required step={1} />}
        </FormField>
        <FormField id={`payment-note-${invoiceId}`} label="Note" optional>
          {(field) => <TextInput {...field} name="note" maxLength={1000} placeholder="Cash on the driveway" />}
        </FormField>
        <FormField id={`payment-date-${invoiceId}`} label="Received" optional hint="Leave blank to use now.">
          {(field) => <TextInput {...field} name="receivedAt" type="date" />}
        </FormField>
      </div>
      <FormActions><Button type="submit" disabled={pending} tone="secondary">{pending ? 'Recording…' : 'Record payment'}</Button></FormActions>
      <FormError>{state.error}</FormError>
    </form>
  );
}

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

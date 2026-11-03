'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText } from '@/components/controls/inputs';
import { linkCallCustomerAction, type FormState } from '@/app/organizations/[organizationId]/calls/actions';
import { SelectField } from '@/components/controls/select-field';

const INITIAL: FormState = { error: null };

/**
 * An unknown caller becomes a known one when a person says who it was. Only offered for a call with
 * no customer, and only a customer of this business; nothing is created, and what is linked is the
 * call, not the customer's record.
 */
export function LinkCustomerForm({
  organizationId,
  callId,
  customers,
}: {
  organizationId: string;
  callId: string;
  customers: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(linkCallCustomerAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="callId" value={callId} />
      <SelectField name="customerId" required aria-label="Customer this call was with" defaultValue="" options={[{ value: '', label: 'Choose a customer…', disabled: true }, ...customers.map((customer) => ({ value: customer.id, label: customer.name }))]} />
      <Button type="submit" tone="secondary" size="small" disabled={pending}>{pending ? 'Linking…' : 'Link to customer'}</Button>
      <ErrorText>{state.error}</ErrorText>
    </form>
  );
}

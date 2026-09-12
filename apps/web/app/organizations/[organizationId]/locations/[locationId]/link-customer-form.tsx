'use client';

import { Hint, SelectInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';
import { linkCustomerAction } from './actions';

const INITIAL = { error: null as string | null };

/**
 * Serve a customer from this location.
 *
 * The list page's own form offers a location select too, because it has no location of its own
 * in view. Here the location is fixed by the route, so this asks for one thing rather than two.
 */
export function LinkCustomerToLocationForm({
  organizationId,
  locationId,
  customers,
}: {
  organizationId: string;
  locationId: string;
  customers: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(linkCustomerAction, INITIAL);

  if (customers.length === 0) {
    return <Hint className="mt-2">Add a customer before linking one here.</Hint>;
  }

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="locationId" value={locationId} />

      <SelectInput name="customerId" aria-label="Customer" className="flex-1 sm:flex-none">
        {customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.name}
          </option>
        ))}
      </SelectInput>

      <Button type="submit" disabled={pending} tone="secondary" size="small">
        {pending ? '…' : 'Link'}
      </Button>

      {state.error ? (
        <span role="alert" className="text-sm text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

'use client';
import { BusinessLabel } from '@/lib/context/business-vocabulary';

import { Field, FieldLabel } from '@gold/ui/components/field';
import { Button } from '@/components/controls/button';
import { useActionState, useId } from 'react';
import {
  linkCustomerAction,
  type LocationActionState,
} from '@/app/organizations/[organizationId]/locations/actions';
import { SelectField } from '@/components/controls/select-field';

const INITIAL: LocationActionState = { error: null, created: false };

type Customer = { id: string; name: string };
type LocationOption = { id: string; label: string };

type Props =
  | {
      organizationId: string;
      customers: Customer[];
      /** Fixed by the route — the detail page's own context, where only the customer is chosen. */
      locationId: string;
      locations?: undefined;
      action?: (previous: LocationActionState, formData: FormData) => Promise<LocationActionState>;
    }
  | {
      organizationId: string;
      customers: Customer[];
      locationId?: undefined;
      /** Offered because there is no location of its own in view — the collection's context. */
      locations: LocationOption[];
      action?: (previous: LocationActionState, formData: FormData) => Promise<LocationActionState>;
    };

/**
 * Serve a customer from a location — the one Customer↔Location relationship, wherever it is
 * linked from. The collection page has no location of its own in view and offers both selects;
 * the location's own detail page fixes the location and asks for one thing rather than two. Both
 * post through the same domain call; only which route-owned action (and so which paths it
 * revalidates) differs, exactly as coordinate saving already does.
 */
export function LinkCustomerLocationForm({ organizationId, customers, locationId, locations, action = linkCustomerAction }: Props) {
  const [state, formAction, pending] = useActionState(action, INITIAL);
  const customerFieldId = useId();
  const locationFieldId = useId();

  if (customers.length === 0 || (locations && locations.length === 0)) {
    return (
      <p className="mt-2 text-sm text-muted">
        {locations ? 'Add a customer and a location before linking them.' : 'Add a customer before linking one here.'}
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-end gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      {locationId ? <input type="hidden" name="locationId" value={locationId} /> : null}

      <Field className="min-w-40 flex-1 gap-1">
        <FieldLabel htmlFor={customerFieldId}><BusinessLabel>Customer</BusinessLabel></FieldLabel>
        <SelectField id={customerFieldId} name="customerId" className="flex-1" options={[...customers.map((customer) => ({ value: customer.id, label: customer.name }))]} />
      </Field>

      {locations ? (
        <Field className="min-w-40 flex-1 gap-1">
          <FieldLabel htmlFor={locationFieldId}>Location</FieldLabel>
          <SelectField id={locationFieldId} name="locationId" className="flex-1" options={[...locations.map((location) => ({ value: location.id, label: location.label }))]} />
        </Field>
      ) : null}

      <Button type="submit" disabled={pending} tone="secondary" size="small">
        {pending ? 'Linking…' : 'Link'}
      </Button>

      {state.error ? (
        <span role="alert" className="w-full text-sm text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

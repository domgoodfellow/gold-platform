'use client';

import { useActionState } from 'react';
import { CustomFieldInputs } from '@/components/custom-field-inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { Location } from '@/lib/domain/locations/locations';
import {
  createLocationAction,
  linkCustomerAction,
  type LocationActionState,
} from './actions';

const INITIAL: LocationActionState = { error: null };

const INPUT_CLASS = 'flex-1 rounded border border-black/15 px-3 py-2 dark:border-white/20';

export function CreateLocationForm({
  organizationId,
  definitions,
}: {
  organizationId: string;
  definitions: FieldDefinition[];
}) {
  const [state, formAction, pending] = useActionState(createLocationAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <h2 className="text-sm font-medium">New location</h2>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="label"
          type="text"
          required
          maxLength={200}
          placeholder="Label, e.g. North depot"
          aria-label="Label"
          className={INPUT_CLASS}
        />
        <input
          name="address"
          type="text"
          required
          maxLength={500}
          placeholder="Address"
          aria-label="Address"
          className={INPUT_CLASS}
        />
      </div>

      <textarea
        name="accessNotes"
        rows={2}
        maxLength={2000}
        placeholder="Access notes (optional) — gate codes, key safe, who to ask for"
        aria-label="Access notes"
        className="rounded border border-black/15 px-3 py-2 dark:border-white/20"
      />

      <CustomFieldInputs definitions={definitions} />

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add location'}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function LinkCustomerForm({
  organizationId,
  locations,
  customers,
}: {
  organizationId: string;
  locations: Location[];
  customers: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(linkCustomerAction, INITIAL);

  if (locations.length === 0 || customers.length === 0) {
    return (
      <p className="mt-8 text-sm opacity-70">
        Add a customer and a location before linking them.
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <h2 className="text-sm font-medium">Serve a customer from a location</h2>

      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          name="customerId"
          aria-label="Customer"
          className="flex-1 rounded border border-black/15 px-3 py-2 dark:border-white/20"
        >
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </select>
        <select
          name="locationId"
          aria-label="Location"
          className="flex-1 rounded border border-black/15 px-3 py-2 dark:border-white/20"
        >
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.label}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? 'Linking…' : 'Link'}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

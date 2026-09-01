'use client';

import { useActionState } from 'react';
import { CustomFieldInputs } from '@/components/custom-field-inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { Location } from '@/lib/domain/locations/locations';
import {
  createLocationAction,
  linkCustomerAction,
  locationCoordinatesAction,
  type CoordinatesActionState,
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

const NO_COORDINATES: CoordinatesActionState = { error: null, suggested: null, notFound: false };

const COORDINATE_INPUT = 'w-36 rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20';

/**
 * Where one place is.
 *
 * **A lookup fills the fields; it does not save them.** The suggestion arrives as a new
 * `key` on the inputs, which remounts them with the provider's answer as their starting value —
 * so a person sees what was found, can correct it, and presses Save. That is the screen half of
 * the split `locateAddress` makes in the domain layer, and the reason for it is that a
 * provider's best guess about a customer's site is where a technician gets sent.
 *
 * **A deployment with no lookup says so rather than showing nothing** (D31). Two empty boxes and
 * no explanation is the same silence a switch with no inputs produces: the person cannot tell
 * whether the feature is missing, broken, or theirs to fill in.
 */
export function LocationCoordinatesForm({
  organizationId,
  location,
  mayLookUp,
}: {
  organizationId: string;
  location: Location;
  /** Whether this deployment can ask anybody. Typing them in works either way. */
  mayLookUp: boolean;
}) {
  const [state, formAction, pending] = useActionState(locationCoordinatesAction, NO_COORDINATES);

  const suggested = state.suggested;
  // Remounts the two inputs when a suggestion arrives, so they show what was found rather than
  // what was saved. Without it React keeps the first `defaultValue` for the life of the form.
  const seed = suggested ? `${suggested.latitude},${suggested.longitude}` : 'saved';

  return (
    <form action={formAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="locationId" value={location.id} />
      <input type="hidden" name="address" value={location.address} />

      <input
        key={`lat-${seed}`}
        name="latitude"
        type="text"
        inputMode="decimal"
        aria-label={`Latitude of ${location.label}`}
        placeholder="Latitude"
        defaultValue={suggested?.latitude ?? location.coordinates?.latitude ?? ''}
        className={COORDINATE_INPUT}
      />
      <input
        key={`lon-${seed}`}
        name="longitude"
        type="text"
        inputMode="decimal"
        aria-label={`Longitude of ${location.label}`}
        placeholder="Longitude"
        defaultValue={suggested?.longitude ?? location.coordinates?.longitude ?? ''}
        className={COORDINATE_INPUT}
      />

      <button
        type="submit"
        name="intent"
        value="save"
        disabled={pending}
        className="rounded border border-black/15 px-3 py-1 text-sm disabled:opacity-50 dark:border-white/20"
      >
        {pending ? '…' : 'Save'}
      </button>

      {mayLookUp ? (
        <button
          type="submit"
          name="intent"
          value="look-up"
          disabled={pending}
          className="rounded border border-black/15 px-3 py-1 text-sm disabled:opacity-50 dark:border-white/20"
        >
          Look up from the address
        </button>
      ) : (
        <span className="text-xs opacity-60">
          This deployment cannot look an address up, so these are typed in.
        </span>
      )}

      {suggested ? (
        <span className="text-xs opacity-70">Found. Check it, then save.</span>
      ) : null}

      {state.notFound ? (
        <span className="text-xs opacity-70">
          That address was not recognised. Type the coordinates in, or edit the address.
        </span>
      ) : null}

      {state.error ? (
        <span role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

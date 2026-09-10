'use client';

import { SectionHeading } from '@/components/containers/section';
import { ErrorText, Hint, SelectInput, TextArea, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
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

      <SectionHeading>New location</SectionHeading>

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="label"
          type="text"
          required
          maxLength={200}
          placeholder="Label, e.g. North depot"
          aria-label="Label"
          className="flex-1"
        />
        <TextInput
          name="address"
          type="text"
          required
          maxLength={500}
          placeholder="Address"
          aria-label="Address"
          className="flex-1"
        />
      </div>

      <TextArea
        name="accessNotes"
        rows={2}
        maxLength={2000}
        placeholder="Access notes (optional) — gate codes, key safe, who to ask for"
        aria-label="Access notes"
      />

      <CustomFieldInputs definitions={definitions} />

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Adding…' : 'Add location'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
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
      <Hint className="mt-8">
        Add a customer and a location before linking them.
      </Hint>
    );
  }

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <SectionHeading>Serve a customer from a location</SectionHeading>

      <div className="flex flex-col gap-2 sm:flex-row">
        <SelectInput name="customerId" aria-label="Customer" className="flex-1">
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.name}
            </option>
          ))}
        </SelectInput>
        <SelectInput name="locationId" aria-label="Location" className="flex-1">
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.label}
            </option>
          ))}
        </SelectInput>
      </div>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Linking…' : 'Link'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

const NO_COORDINATES: CoordinatesActionState = { error: null, suggested: null, notFound: false };

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

      <TextInput
        key={`lat-${seed}`}
        name="latitude"
        type="text"
        inputMode="decimal"
        aria-label={`Latitude of ${location.label}`}
        placeholder="Latitude"
        defaultValue={suggested?.latitude ?? location.coordinates?.latitude ?? ''}
        size="small"
        className="w-36"
      />
      <TextInput
        key={`lon-${seed}`}
        name="longitude"
        type="text"
        inputMode="decimal"
        aria-label={`Longitude of ${location.label}`}
        placeholder="Longitude"
        defaultValue={suggested?.longitude ?? location.coordinates?.longitude ?? ''}
        size="small"
        className="w-36"
      />

      <Button
        type="submit"
        name="intent"
        value="save"
        disabled={pending}
        tone="secondary"
        size="small"
      >
        {pending ? '…' : 'Save'}
      </Button>

      {mayLookUp ? (
        <Button
          type="submit"
          name="intent"
          value="look-up"
          disabled={pending}
          tone="secondary"
          size="small"
        >
          Look up from the address
        </Button>
      ) : (
        <span className="text-xs text-subtle">
          This deployment cannot look an address up, so these are typed in.
        </span>
      )}

      {suggested ? (
        <span className="text-xs text-muted">Found. Check it, then save.</span>
      ) : null}

      {state.notFound ? (
        <span className="text-xs text-muted">
          That address was not recognised. Type the coordinates in, or edit the address.
        </span>
      ) : null}

      {state.error ? (
        <span role="alert" className="text-sm text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

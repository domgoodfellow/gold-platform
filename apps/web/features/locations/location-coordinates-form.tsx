'use client';

import { TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';
import type { Location } from '@/lib/domain/locations/locations';
import {
  locationCoordinatesAction,
  type CoordinatesActionState,
} from '@/app/organizations/[organizationId]/locations/actions';

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
 * **A deployment with no lookup says so rather than showing nothing**. Two empty boxes and
 * no explanation is the same silence a switch with no inputs produces: the person cannot tell
 * whether the feature is missing, broken, or theirs to fill in.
 *
 * One implementation, two hosts: the collection's row-level `LocationCoordinatesDrawer` and the
 * detail page's own Overview section both render this, passing whichever route-owned `action`
 * revalidates for their own context.
 */
export function LocationCoordinatesForm({
  organizationId,
  location,
  mayLookUp,
  action = locationCoordinatesAction,
}: {
  organizationId: string;
  location: Location;
  /** Whether this deployment can ask anybody. Typing them in works either way. */
  mayLookUp: boolean;
  /** Defaults to the list page's own action; the record page passes one that revalidates itself. */
  action?: (
    previous: CoordinatesActionState,
    formData: FormData,
  ) => Promise<CoordinatesActionState>;
}) {
  const [state, formAction, pending] = useActionState(action, NO_COORDINATES);

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

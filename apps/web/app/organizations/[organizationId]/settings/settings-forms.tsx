'use client';

import { ErrorText, SelectInput, TextInput } from '@/components/controls/inputs';
import { FormField } from '@/components/controls/form';
import { Button } from '@/components/controls/button';
import { ConfirmSubmit } from '@/components/containers/dialog';
import { useActionState } from 'react';
import { CurrencyField, TimeZoneField } from '@/features/locale/locale-fields';
import type { OperatingHours } from '@/lib/domain/scheduling/operating-hours';
import {
  addOperatingHoursAction,
  removeOperatingHoursAction,
  updateOrganizationAction,
  type SettingsActionState,
} from './actions';

const INITIAL: SettingsActionState = { error: null };

/**
 * The names of the days, from the reader's own locale.
 *
 * Not a constant, and not a per-tenant setting either. The platform stores a number 1–7 and
 * has no word for any day in any language; this turns that number into whatever the person
 * looking at the screen calls it. A hardcoded `['Monday', …]` would be an English assumption
 * baked into the product, and a per-tenant list would be asking a business to translate the
 * calendar for us.
 */
function dayName(dayOfWeek: number): string {
  // 2024-01-01 was a Monday, so day N is the Nth of that January. Any anchor week would do;
  // this one only has to be a real week for `Intl` to name its days.
  const date = new Date(Date.UTC(2024, 0, dayOfWeek));
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(date);
}

const DAYS = [1, 2, 3, 4, 5, 6, 7];

export function OrganizationSettingsForm({
  organizationId,
  name,
  timezone,
  currency,
  bufferMinutes,
  slug,
}: {
  organizationId: string;
  name: string;
  timezone: string;
  /** Null when this business has not said yet — signing up no longer asks. */
  currency: string | null;
  bufferMinutes: number;
  slug: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateOrganizationAction, INITIAL);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <FormField id="org-name" label="Organization name" className="flex-1">
          {(field) => (
            <TextInput {...field} name="name" type="text" required maxLength={200} defaultValue={name} />
          )}
        </FormField>
      </div>

      {/* The same two controls the founding form uses, so there is one answer to "how does a
          business say where it is" rather than a picker in one place and a text box in the
          other. Whatever they offer, the database still checks the zone against
          `pg_timezone_names` — a list in the application is never the authority. */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <TimeZoneField defaultValue={timezone} label="Where is this business?" />
        <CurrencyField defaultValue={currency ?? undefined} />
      </div>

      {/* Why a business wants one is its own affair — driving to the next address, cleaning
          the room, inspecting the machine — so the label describes the effect rather than any
          one reason. Zero is a real answer and the default: a business that has said nothing
          gets no gap invented on its behalf. */}
      <FormField
        id="org-buffer-minutes"
        label="Time a resource stays busy after a job (minutes)"
        hint="Nothing else can be booked on that resource until this has passed. Changing it moves nothing, but work already scheduled too close together will be refused."
      >
        {(field) => (
          <TextInput {...field} name="bufferMinutes" type="number" required min={0} max={1440} step={1} defaultValue={bufferMinutes} />
        )}
      </FormField>

      {/* Empty until the business asks for one. The platform does not invent a slug from the
          name: that would be the platform naming a business, and the first tenant called
          "Smith & Sons" would find it had opinions about apostrophes. */}
      <FormField
        id="org-slug"
        label="Public booking address"
        optional
        hint="Customers book at /book/<this>. Leave it empty to have no public page. Changing it breaks links already shared."
      >
        {(field) => (
          <TextInput
            {...field}
            name="slug"
            type="text"
            maxLength={63}
            pattern="[a-z0-9][a-z0-9-]{1,62}"
            defaultValue={slug ?? ''}
            placeholder="your-business"
          />
        )}
      </FormField>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Saving…' : 'Save'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

export function AddOperatingHoursForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(addOperatingHoursAction, INITIAL);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-wrap items-center gap-2">
        <SelectInput name="dayOfWeek" aria-label="Day" size="small">
          {DAYS.map((day) => (
            <option key={day} value={day}>
              {dayName(day)}
            </option>
          ))}
        </SelectInput>
        <TextInput name="opensAt" type="time" required aria-label="Opens at" size="small" />
        <TextInput name="closesAt" type="time" required aria-label="Closes at" size="small" />
        <Button type="submit" disabled={pending} tone="secondary" size="small">
          {pending ? 'Adding…' : 'Add hours'}
        </Button>
      </div>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

export function OperatingHoursRow({
  organizationId,
  hours,
}: {
  organizationId: string;
  hours: OperatingHours;
}) {
  const [state, formAction, pending] = useActionState(removeOperatingHoursAction, INITIAL);
  const formId = `remove-hours-${hours.id}`;

  return (
    <form id={formId} action={formAction} className="flex items-center gap-3 py-2 text-sm">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="id" value={hours.id} />

      <span className="w-28">{dayName(hours.dayOfWeek)}</span>
      <span className="text-muted">
        {hours.opensAt.slice(0, 5)}–{hours.closesAt.slice(0, 5)}
      </span>
      <ConfirmSubmit
        formId={formId}
        label="Remove"
        confirmLabel="Remove hours"
        description={`Remove ${dayName(hours.dayOfWeek)}'s hours? That day goes back to unconfigured.`}
        tone="secondary"
        size="tiny"
        pending={pending}
      />

      {state.error ? (
        <span role="alert" className="text-danger">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

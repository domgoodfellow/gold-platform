'use client';

import { useActionState } from 'react';
import { CurrencyField, TimeZoneField } from '@/components/locale-fields';
import type { OperatingHours } from '@/lib/domain/scheduling/operating-hours';
import {
  addOperatingHoursAction,
  removeOperatingHoursAction,
  updateOrganizationAction,
  type SettingsActionState,
} from './actions';

const INITIAL: SettingsActionState = { error: null };

const INPUT_CLASS = 'flex-1 rounded border border-black/15 px-3 py-2 dark:border-white/20';
const SMALL_INPUT = 'rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20';

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
  currency: string;
  bufferMinutes: number;
  slug: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateOrganizationAction, INITIAL);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="name"
          type="text"
          required
          maxLength={200}
          defaultValue={name}
          aria-label="Organization name"
          className={INPUT_CLASS}
        />
      </div>

      {/* The same two controls the founding form uses, so there is one answer to "how does a
          business say where it is" rather than a picker in one place and a text box in the
          other. Whatever they offer, the database still checks the zone against
          `pg_timezone_names` — a list in the application is never the authority. */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <TimeZoneField defaultValue={timezone} label="Where is this business?" />
        <CurrencyField defaultValue={currency} />
      </div>

      {/* Why a business wants one is its own affair — driving to the next address, cleaning
          the room, inspecting the machine — so the label describes the effect rather than any
          one reason. Zero is a real answer and the default: a business that has said nothing
          gets no gap invented on its behalf. */}
      <label className="flex flex-col gap-1 text-sm">
        <span>Time a resource stays busy after a job (minutes)</span>
        <input
          name="bufferMinutes"
          type="number"
          required
          min={0}
          max={1440}
          step={1}
          defaultValue={bufferMinutes}
          className={INPUT_CLASS}
        />
        <span className="text-xs opacity-70">
          Nothing else can be booked on that resource until this has passed. Changing it moves
          nothing, but work already scheduled too close together will be refused.
        </span>
      </label>

      {/* Empty until the business asks for one. The platform does not invent a slug from the
          name: that would be the platform naming a business, and the first tenant called
          "Smith & Sons" would find it had opinions about apostrophes. */}
      <label className="flex flex-col gap-1 text-sm">
        <span>Public booking address</span>
        <input
          name="slug"
          type="text"
          maxLength={63}
          pattern="[a-z0-9][a-z0-9-]{1,62}"
          defaultValue={slug ?? ''}
          placeholder="your-business"
          className={INPUT_CLASS}
        />
        <span className="text-xs opacity-70">
          Customers book at /book/&lt;this&gt;. Leave it empty to have no public page. Changing
          it breaks links already shared.
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function AddOperatingHoursForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(addOperatingHoursAction, INITIAL);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-wrap items-center gap-2">
        <select name="dayOfWeek" aria-label="Day" className={SMALL_INPUT}>
          {DAYS.map((day) => (
            <option key={day} value={day}>
              {dayName(day)}
            </option>
          ))}
        </select>
        <input name="opensAt" type="time" required aria-label="Opens at" className={SMALL_INPUT} />
        <input name="closesAt" type="time" required aria-label="Closes at" className={SMALL_INPUT} />
        <button
          type="submit"
          disabled={pending}
          className="rounded border border-black/15 px-3 py-1 text-sm disabled:opacity-50 dark:border-white/20"
        >
          {pending ? 'Adding…' : 'Add hours'}
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
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

  return (
    <form action={formAction} className="flex items-center gap-3 py-2 text-sm">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="id" value={hours.id} />

      <span className="w-28">{dayName(hours.dayOfWeek)}</span>
      <span className="opacity-70">
        {hours.opensAt.slice(0, 5)}–{hours.closesAt.slice(0, 5)}
      </span>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-black/15 px-2 py-1 text-xs disabled:opacity-50 dark:border-white/20"
      >
        Remove
      </button>

      {state.error ? (
        <span role="alert" className="text-red-600 dark:text-red-400">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

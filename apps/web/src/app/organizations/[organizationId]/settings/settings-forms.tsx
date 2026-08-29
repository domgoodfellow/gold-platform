'use client';

import { useActionState } from 'react';
import { CurrencyField, TimeZoneField } from '@/components/locale-fields';
import type { OperatingHours } from '@/lib/domain/scheduling/operating-hours';
import {
  addOperatingHoursAction,
  removeOperatingHoursAction,
  updateOrganizationAction,
  type SettingsActionState,
  setModuleEnabledAction,
  disconnectPaymentAccountAction,
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

/**
 * One module's switch.
 *
 * A form per row rather than one form with checkboxes, because each is a separate decision
 * with its own failure — turning the portal on can fail while turning booking off succeeds,
 * and a single submit would have to invent an order and a partial-success message.
 *
 * The core modules render no switch at all rather than a disabled one. A disabled control says
 * "you could do this if something changed"; there is nothing a business could change that would
 * let it run with no way to record work.
 */
export function ModuleSwitch({
  organizationId,
  moduleKey,
  label,
  description,
  enabled,
  required,
  mayConfigure,
}: {
  organizationId: string;
  moduleKey: string;
  label: string;
  description: string;
  enabled: boolean;
  required: boolean;
  mayConfigure: boolean;
}) {
  const [state, formAction, pending] = useActionState(setModuleEnabledAction, { error: null });

  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {label}
          {enabled ? null : <span className="ml-2 font-normal opacity-60">off</span>}
        </p>
        <p className="text-sm opacity-70">{description}</p>
        {state.error ? (
          <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        ) : null}
      </div>

      {required ? (
        <p className="shrink-0 text-sm opacity-60">Always on</p>
      ) : mayConfigure ? (
        <form action={formAction} className="shrink-0">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="moduleKey" value={moduleKey} />
          <input type="hidden" name="enabled" value={enabled ? '0' : '1'} />
          <button
            type="submit"
            disabled={pending}
            className="rounded border border-black/15 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/20"
          >
            {pending ? '…' : enabled ? 'Switch off' : 'Switch on'}
          </button>
        </form>
      ) : null}
    </div>
  );
}

/**
 * Where this business is paid.
 *
 * **The connect side is a link, not a form**, and that is the design rather than a shortcut: an
 * account id comes back from the provider, authenticated with the platform's own key, and is
 * never typed. Disconnecting is a form because it is a write this application performs itself.
 */
export function PaymentAccountRow({
  organizationId,
  provider,
  accountId,
  connectedAt,
  mayManage,
}: {
  organizationId: string;
  provider: string;
  accountId: string | null;
  connectedAt: string | null;
  mayManage: boolean;
}) {
  const [state, formAction, pending] = useActionState(disconnectPaymentAccountAction, {
    error: null,
  });

  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {accountId ? 'Connected' : 'Not connected'}
          {connectedAt ? (
            <span className="ml-2 font-normal opacity-60">
              since {new Date(connectedAt).toLocaleDateString('en-GB')}
            </span>
          ) : null}
        </p>
        <p className="text-sm opacity-70">
          {accountId
            ? // The id, because an operator with two accounts needs to know which one this is.
              // It is not a secret: on its own it grants nothing.
              `Card payments are collected into ${accountId} and paid out by ${provider} directly to this business. GOLD never holds the money.`
            : `Connect an account with ${provider} to take card payments. The money goes straight to this business; GOLD never holds it, and this business keeps its own login.`}
        </p>
        {state.error ? (
          <p role="alert" className="mt-1 text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        ) : null}
      </div>

      {!mayManage ? null : accountId ? (
        <form action={formAction} className="shrink-0">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="provider" value={provider} />
          <button
            type="submit"
            disabled={pending}
            className="rounded border border-black/15 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/20"
          >
            {pending ? '…' : 'Disconnect'}
          </button>
        </form>
      ) : (
        <a
          href={`/organizations/${organizationId}/settings/payments/connect`}
          className="shrink-0 rounded border border-black/15 px-3 py-1.5 text-sm dark:border-white/20"
        >
          Connect
        </a>
      )}
    </div>
  );
}

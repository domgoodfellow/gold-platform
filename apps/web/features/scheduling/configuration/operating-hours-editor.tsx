'use client';

import { useActionState } from 'react';
import {
  addOperatingHoursAction,
  removeOperatingHoursAction,
  type ScheduleConfigActionState,
} from '@/app/organizations/[organizationId]/schedule/configuration/actions';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import type { OperatingHours } from '@/lib/domain/scheduling/operating-hours';

const INITIAL: ScheduleConfigActionState = { error: null };

/**
 * The names of the days, from the reader's own locale.
 *
 * Not a constant, and not a per-tenant setting either. The platform stores a number 1–7 and has
 * no word for any day in any language; this turns that number into whatever the person looking
 * at the screen calls it.
 */
function dayName(dayOfWeek: number): string {
  // 2024-01-01 was a Monday, so day N is the Nth of that January. Any anchor week would do;
  // this one only has to be a real week for `Intl` to name its days.
  const date = new Date(Date.UTC(2024, 0, dayOfWeek));
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(date);
}

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

function AddPeriodForm({ organizationId, dayOfWeek }: { organizationId: string; dayOfWeek: number }) {
  const [state, formAction, pending] = useActionState(addOperatingHoursAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="dayOfWeek" value={dayOfWeek} />
      <TextInput
        name="opensAt"
        type="time"
        required
        aria-label={`${dayName(dayOfWeek)} opens at`}
        size="small"
        className="w-32 flex-none"
      />
      <span aria-hidden className="text-muted">
        –
      </span>
      <TextInput
        name="closesAt"
        type="time"
        required
        aria-label={`${dayName(dayOfWeek)} closes at`}
        size="small"
        className="w-32 flex-none"
      />
      <Button type="submit" disabled={pending} tone="secondary" size="small">
        {pending ? 'Adding…' : '+ Add period'}
      </Button>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

function PeriodRow({ organizationId, entry }: { organizationId: string; entry: OperatingHours }) {
  const [state, formAction, pending] = useActionState(removeOperatingHoursAction, INITIAL);
  const formId = `remove-hours-${entry.id}`;
  const label = `${entry.opensAt.slice(0, 5)}–${entry.closesAt.slice(0, 5)}`;

  return (
    <div className="flex items-center gap-3 text-sm">
      <form id={formId} action={formAction}>
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="id" value={entry.id} />
      </form>
      <span className="tabular-nums">{label}</span>
      <ConfirmSubmit
        formId={formId}
        label="Remove"
        confirmLabel="Remove period"
        description={`Remove ${label} on ${dayName(entry.dayOfWeek)}? That period goes back to unconfigured.`}
        tone="secondary"
        size="tiny"
        pending={pending}
      />
      {state.error ? (
        <span role="alert" className="text-danger">
          {state.error}
        </span>
      ) : null}
    </div>
  );
}

function DayEditor({
  organizationId,
  dayOfWeek,
  periods,
  mayConfigure,
  anyConfigured,
}: {
  organizationId: string;
  dayOfWeek: number;
  periods: OperatingHours[];
  mayConfigure: boolean;
  /** Whether this business has set hours anywhere at all — see `OperatingHoursEditor`. */
  anyConfigured: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0">
      <div className="font-medium">{dayName(dayOfWeek)}</div>

      {periods.length === 0 ? (
        <Hint weight="subtle">
          {anyConfigured
            ? 'Closed'
            : 'Not set'}
        </Hint>
      ) : (
        <div className="flex flex-col gap-1.5">
          {periods.map((entry) =>
            mayConfigure ? (
              <PeriodRow key={entry.id} organizationId={organizationId} entry={entry} />
            ) : (
              <Hint key={entry.id}>
                {entry.opensAt.slice(0, 5)}–{entry.closesAt.slice(0, 5)}
              </Hint>
            ),
          )}
        </div>
      )}

      {mayConfigure ? <AddPeriodForm organizationId={organizationId} dayOfWeek={dayOfWeek} /> : null}
    </div>
  );
}

/**
 * Every day of the week, explicit — not a toggle that would silently mean "enabled = 09:00–17:00".
 * A day can hold zero, one or several periods (a split shift is two rows, not a break rule every
 * reader would have to know about), so a checkbox model was never right for it.
 *
 * **The two kinds of "no hours configured" say different things, on purpose.** A business that
 * has configured nothing at all, anywhere, is read as open around the clock (`openWindows`) — so
 * every day says *Nothing configured* under one shared explanation above the list. The moment any
 * day holds a period, an unconfigured day stops meaning "no claim" and starts meaning *Closed*:
 * the business has spoken for the week, and this day is not one of the times it answered. Getting
 * this backwards would silently change what the schedule believes is bookable.
 */
export function OperatingHoursEditor({
  organizationId,
  role,
  mayConfigure,
  hours,
  timezone,
}: {
  organizationId: string;
  role: string;
  mayConfigure: boolean;
  hours: OperatingHours[];
  timezone: string;
}) {
  const byDay = new Map<number, OperatingHours[]>();
  for (const entry of hours) {
    const existing = byDay.get(entry.dayOfWeek) ?? [];
    existing.push(entry);
    byDay.set(entry.dayOfWeek, existing);
  }
  const anyConfigured = hours.length > 0;

  return (
    <div className="flex flex-col gap-1">
      <Hint>Times are read in {timezone}.</Hint>

      {anyConfigured ? null : (
        <Hint className="mt-1">
          No opening hours yet. Until you add some, every hour counts as open.
        </Hint>
      )}

      {mayConfigure ? null : <Hint className="mt-1">Your role, {role}, cannot set opening hours.</Hint>}

      <div className="mt-2">
        {DAYS.map((day) => (
          <DayEditor
            key={day}
            organizationId={organizationId}
            dayOfWeek={day}
            periods={byDay.get(day) ?? []}
            mayConfigure={mayConfigure}
            anyConfigured={anyConfigured}
          />
        ))}
      </div>
    </div>
  );
}

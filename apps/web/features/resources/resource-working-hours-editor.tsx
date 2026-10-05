'use client';

import { useActionState, useId, useState } from 'react';
import {
  saveWorkingHoursAction,
  type ResourceAvailabilityState,
} from '@/app/organizations/[organizationId]/resources/availability-actions';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import type { ResourceWorkingHours } from '@/lib/domain/scheduling/resource-availability';

const INITIAL: ResourceAvailabilityState = { error: null };
const DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** A day's name from the reader's own locale — the platform stores 1–7 and holds no word for a day. */
function dayName(dayOfWeek: number): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2024, 0, dayOfWeek)),
  );
}

type Row = { key: string; dayOfWeek: number; opensAt: string; closesAt: string };

let counter = 0;
const nextKey = () => `row-${(counter += 1)}`;

/**
 * When this resource works. Two explicit modes — inherit the business's hours, or follow its own —
 * because *no periods* in the second is a resource that never works, and the first is the only way to
 * say "I have not said". Saved as one act: the whole week replaces the last.
 */
export function ResourceWorkingHoursEditor({
  organizationId,
  resourceId,
  resourceName,
  timezone,
  initial,
  mayChange,
}: {
  organizationId: string;
  resourceId: string;
  resourceName: string;
  timezone: string;
  initial: ResourceWorkingHours;
  mayChange: boolean;
}) {
  const [state, formAction, pending] = useActionState(saveWorkingHoursAction, INITIAL);
  const [mode, setMode] = useState<'inherit' | 'custom'>(initial.mode);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.mode === 'custom'
      ? initial.periods.map((period) => ({
          key: nextKey(),
          dayOfWeek: period.dayOfWeek,
          opensAt: period.opensAt.slice(0, 5),
          closesAt: period.closesAt.slice(0, 5),
        }))
      : [],
  );
  const errorId = useId();

  const update = (key: string, patch: Partial<Row>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  if (!mayChange) {
    return (
      <div className="flex flex-col gap-1 text-sm">
        {initial.mode === 'inherit' ? (
          <p>Uses the business&rsquo;s opening hours.</p>
        ) : initial.periods.length === 0 ? (
          <p>Custom hours, with no working days.</p>
        ) : (
          <ul>
            {DAYS.flatMap((day) => {
              const periods = initial.periods.filter((period) => period.dayOfWeek === day);
              return periods.length === 0
                ? []
                : [
                    <li key={day}>
                      {dayName(day)}: {periods.map((p) => `${p.opensAt.slice(0, 5)}–${p.closesAt.slice(0, 5)}`).join(', ')}
                    </li>,
                  ];
            })}
          </ul>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" aria-describedby={state.error ? errorId : undefined}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="resourceId" value={resourceId} />
      <input type="hidden" name="mode" value={mode} />
      <input
        type="hidden"
        name="periods"
        value={JSON.stringify(rows.map(({ dayOfWeek, opensAt, closesAt }) => ({ dayOfWeek, opensAt, closesAt })))}
      />

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-muted">Working hours for {resourceName}</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="modeChoice" checked={mode === 'inherit'} onChange={() => setMode('inherit')} />
          Use business hours
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="modeChoice" checked={mode === 'custom'} onChange={() => setMode('custom')} />
          Custom working hours
        </label>
      </fieldset>

      {mode === 'custom' ? (
        <div className="flex flex-col">
          <Hint>
            Times are read in {timezone}. They narrow the business&rsquo;s hours and never widen them. A day with no
            period is a day this resource does not work.
          </Hint>
          {DAYS.map((day) => {
            const dayRows = rows.filter((row) => row.dayOfWeek === day);
            return (
              <div key={day} className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0">
                <div className="font-medium">{dayName(day)}</div>
                {dayRows.length === 0 ? <Hint weight="subtle">Not working.</Hint> : null}
                {dayRows.map((row, index) => (
                  <div key={row.key} className="flex flex-wrap items-center gap-2">
                    <TextInput
                      type="time"
                      required
                      size="small"
                      className="w-32 flex-none"
                      aria-label={`${dayName(day)} period ${index + 1} starts at`}
                      value={row.opensAt}
                      onChange={(event) => update(row.key, { opensAt: event.target.value })}
                    />
                    <span aria-hidden className="text-muted">
                      –
                    </span>
                    <TextInput
                      type="time"
                      required
                      size="small"
                      className="w-32 flex-none"
                      aria-label={`${dayName(day)} period ${index + 1} ends at`}
                      value={row.closesAt}
                      onChange={(event) => update(row.key, { closesAt: event.target.value })}
                    />
                    <Button
                      type="button"
                      tone="secondary"
                      size="tiny"
                      aria-label={`Remove ${dayName(day)} period ${index + 1}`}
                      onClick={() => setRows((current) => current.filter((candidate) => candidate.key !== row.key))}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <div>
                  <Button
                    type="button"
                    tone="secondary"
                    size="small"
                    aria-label={`Add a period on ${dayName(day)}`}
                    onClick={() =>
                      setRows((current) => [
                        ...current,
                        { key: nextKey(), dayOfWeek: day, opensAt: '09:00', closesAt: '17:00' },
                      ])
                    }
                  >
                    + Add period
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Hint>This resource follows the business&rsquo;s opening hours, and changes when they change.</Hint>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} size="small">
          {pending ? 'Saving…' : 'Save working hours'}
        </Button>
        {state.saved && !state.error ? (
          <span role="status" className="text-sm text-muted">
            Saved.
          </span>
        ) : null}
      </div>
      <ErrorText id={errorId} role="alert">
        {state.error}
      </ErrorText>
      {state.warning ? (
        <p role="status" className="text-sm font-medium">
          ! {state.warning}
        </p>
      ) : null}
    </form>
  );
}

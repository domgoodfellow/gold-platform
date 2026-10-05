'use client';

import { useActionState, useId, useState } from 'react';
import {
  addExceptionAction,
  deleteExceptionAction,
  type ResourceAvailabilityState,
} from '@/app/organizations/[organizationId]/resources/availability-actions';
import { Button } from '@/components/controls/button';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import { ErrorText, FieldLabel, Hint, TextInput } from '@/components/controls/inputs';
import { formatWindow } from '@/lib/domain/scheduling/window';
import type { ResourceAvailabilityException } from '@/lib/domain/scheduling/resource-availability';

const INITIAL: ResourceAvailabilityState = { error: null };

function ExceptionRow({
  organizationId,
  resourceId,
  exception,
  timezone,
  mayChange,
}: {
  organizationId: string;
  resourceId: string;
  exception: ResourceAvailabilityException;
  timezone: string;
  mayChange: boolean;
}) {
  const [state, formAction, pending] = useActionState(deleteExceptionAction, INITIAL);
  const formId = `remove-exception-${exception.id}`;
  const label = `${formatWindow(exception.window, timezone)}${exception.reason ? ` — ${exception.reason}` : ''}`;

  return (
    <li className="flex flex-wrap items-center gap-3 py-2 text-sm">
      <span>
        <span className="font-medium">Unavailable</span> · {label}
      </span>
      {mayChange ? (
        <>
          <form id={formId} action={formAction}>
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="resourceId" value={resourceId} />
            <input type="hidden" name="id" value={exception.id} />
          </form>
          <ConfirmSubmit
            formId={formId}
            label="Remove"
            confirmLabel="Remove time off"
            description={`Remove ${label}? This resource is available then again.`}
            tone="secondary"
            size="tiny"
            pending={pending}
            ariaLabel={`Remove time off ${label}`}
          />
        </>
      ) : null}
      <ErrorText role="alert">{state.error}</ErrorText>
    </li>
  );
}

/**
 * Time a resource cannot take part — a person's leave, a van's servicing, a machine's calibration.
 * Entered as the business reads dates and times and converted in the organization's zone on the
 * server. Adding one over booked work refuses nothing and moves nothing; it says what it touches.
 */
export function ResourceExceptionsPanel({
  organizationId,
  resourceId,
  timezone,
  exceptions,
  mayChange,
}: {
  organizationId: string;
  resourceId: string;
  timezone: string;
  exceptions: ResourceAvailabilityException[];
  mayChange: boolean;
}) {
  const [state, formAction, pending] = useActionState(addExceptionAction, INITIAL);
  const [allDay, setAllDay] = useState(true);
  const id = useId();

  // A successful add resets the form's own fields, so the all-day choice must come back with them.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.saved && !state.error) setAllDay(true);
  }

  return (
    <div className="flex flex-col gap-3">
      {exceptions.length === 0 ? (
        <Hint>No time off or unavailable periods are recorded.</Hint>
      ) : (
        <ul className="divide-y divide-border">
          {exceptions.map((exception) => (
            <ExceptionRow
              key={exception.id}
              organizationId={organizationId}
              resourceId={resourceId}
              exception={exception}
              timezone={timezone}
              mayChange={mayChange}
            />
          ))}
        </ul>
      )}

      {mayChange ? (
        <form action={formAction} className="flex flex-col gap-3" aria-describedby={state.error ? `${id}-error` : undefined}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="resourceId" value={resourceId} />
          <Hint>Dates and times are read in {timezone}.</Hint>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={`${id}-start`}>From</FieldLabel>
              <TextInput id={`${id}-start`} name="startDate" type="date" required size="small" className="w-40" />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={`${id}-end`}>To (optional)</FieldLabel>
              <TextInput id={`${id}-end`} name="endDate" type="date" size="small" className="w-40" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="allDay" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />
            All day
          </label>
          {allDay ? null : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={`${id}-from-time`}>Starts at</FieldLabel>
                <TextInput id={`${id}-from-time`} name="startTime" type="time" required size="small" className="w-32" />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor={`${id}-to-time`}>Ends at</FieldLabel>
                <TextInput id={`${id}-to-time`} name="endTime" type="time" required size="small" className="w-32" />
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={`${id}-reason`}>Reason</FieldLabel>
            <TextInput
              id={`${id}-reason`}
              name="reason"
              maxLength={200}
              size="small"
              placeholder="Vacation, maintenance, appointment…"
              className="max-w-md"
            />
          </div>
          <div>
            <Button type="submit" size="small" disabled={pending}>
              {pending ? 'Adding…' : '+ Add exception'}
            </Button>
          </div>
          <ErrorText id={`${id}-error`} role="alert">
            {state.error}
          </ErrorText>
          {state.warning ? (
            <p role="status" className="text-sm font-medium">
              ! {state.warning}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

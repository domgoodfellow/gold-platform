'use client';

import { useActionState } from 'react';
import {
  changeStatusAction,
  scheduleWorkItemAction,
  type WorkActionState,
} from '@/app/organizations/[organizationId]/work/actions';
import { Button } from '@/components/controls/button';
import { FormActions, FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { OptionalSelect, type SelectOption } from '@/components/controls/optional-select';

const INITIAL: WorkActionState = { error: null };

export function MoveWorkItemForm({
  organizationId,
  workItemId,
  moves,
}: {
  organizationId: string;
  workItemId: string;
  moves: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(changeStatusAction, INITIAL);

  if (moves.length === 0) return null;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2" aria-label="Change stage">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      {moves.map((move) => (
        <Button
          key={move.id}
          type="submit"
          name="toStatusId"
          value={move.id}
          disabled={pending}
          tone="secondary"
          size="small"
        >
          Move to {move.name}
        </Button>
      ))}
      <FormError className="w-full">{state.error}</FormError>
    </form>
  );
}

export function ScheduleWorkItemForm({
  organizationId,
  workItemId,
  resources,
  scheduled,
}: {
  organizationId: string;
  workItemId: string;
  resources: SelectOption[];
  scheduled: boolean;
}) {
  const [state, formAction, pending] = useActionState(scheduleWorkItemAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={`schedule-start-${workItemId}`} label="Starts">
          {(field) => <TextInput {...field} name="startsAt" type="datetime-local" />}
        </FormField>
        <FormField id={`schedule-end-${workItemId}`} label="Ends">
          {(field) => <TextInput {...field} name="endsAt" type="datetime-local" />}
        </FormField>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted">
          Assign to <span className="text-subtle">(optional)</span>
        </span>
        <OptionalSelect name="resourceId" label="Assign to" options={resources} />
      </label>
      <FormActions>
        <Button type="submit" disabled={pending} tone="secondary" size="small">
          {pending ? 'Scheduling…' : scheduled ? 'Reschedule' : 'Schedule'}
        </Button>
        {scheduled ? (
          <Button
            type="submit"
            name="clear"
            value="1"
            disabled={pending}
            tone="secondary"
            size="small"
          >
            Clear schedule
          </Button>
        ) : null}
      </FormActions>
      <FormError>{state.error}</FormError>
    </form>
  );
}

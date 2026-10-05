'use client';

import { useActionState } from 'react';
import {
  changeStatusAction,
  scheduleWorkItemAction,
  setWorkItemResourcesAction,
  type WorkActionState,
} from '@/app/organizations/[organizationId]/work/actions';
import { Button } from '@/components/controls/button';
import { FormActions, FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import type { SelectOption } from '@/components/controls/optional-select';
import { ResourceChecklist } from '@/components/controls/resource-checklist';
import type { ResourceNeedsView } from '@/lib/domain/work-items/requirements';

/** What the picker needs from a type's requirements: its groups, as plain props. */
function needsProps(needs: ResourceNeedsView | null | undefined) {
  if (!needs || needs.groups.length === 0) return {};
  return {
    groups: needs.groups.map((group) => ({
      key: group.requirementId,
      title: group.title,
      hint: `${group.quantity} required`,
      resourceIds: group.resourceIds,
    })),
    additionalIds: needs.additionalIds,
  };
}

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
  assigned,
  needs,
  scheduled,
}: {
  organizationId: string;
  workItemId: string;
  resources: SelectOption[];
  /** Ids of the resources on the job now — what the boxes start ticked as. */
  assigned: string[];
  /** What this kind of work needs, with the resources eligible for each — absent when it says nothing. */
  needs?: ResourceNeedsView | null;
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
      <ResourceChecklist
        legend="Resources"
        options={resources}
        selected={assigned}
        hint="Everyone ticked takes part for this whole time. Tick none for work nobody is on yet."
        {...needsProps(needs)}
      />
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

/**
 * Who is on this job, changed on its own — the time stays exactly where it is. If any resource is
 * busy for the job's time the whole change is refused and the job keeps who it had.
 */
export function AssignResourcesForm({
  organizationId,
  workItemId,
  resources,
  assigned,
  needs,
}: {
  organizationId: string;
  workItemId: string;
  resources: SelectOption[];
  assigned: string[];
  needs?: ResourceNeedsView | null;
}) {
  const [state, formAction, pending] = useActionState(setWorkItemResourcesAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <ResourceChecklist legend="Assigned to" options={resources} selected={assigned} {...needsProps(needs)} />
      <FormActions>
        <Button type="submit" disabled={pending} tone="secondary" size="small">
          {pending ? 'Saving…' : 'Save resources'}
        </Button>
      </FormActions>
      <FormError>{state.error}</FormError>
    </form>
  );
}

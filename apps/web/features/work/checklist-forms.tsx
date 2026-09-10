'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { FormActions, FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import {
  addChecklistItemAction,
  setChecklistItemDoneAction,
  type WorkItemActionState,
} from '@/app/organizations/[organizationId]/work/[workItemId]/actions';

const INITIAL: WorkItemActionState = { error: null };

export function ChecklistItemControl({
  organizationId,
  workItemId,
  checklistItemId,
  label,
  done,
}: {
  organizationId: string;
  workItemId: string;
  checklistItemId: string;
  label: string;
  done: boolean;
}) {
  const [state, formAction, pending] = useActionState(setChecklistItemDoneAction, INITIAL);

  return (
    <form action={formAction} className="flex min-w-0 flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <input type="hidden" name="checklistItemId" value={checklistItemId} />
      <input type="hidden" name="done" value={done ? '0' : '1'} />
      <Button
        type="submit"
        disabled={pending}
        aria-pressed={done}
        aria-label={`${done ? 'Mark incomplete' : 'Mark complete'}: ${label}`}
        tone="secondary"
        size="tiny"
      >
        <span aria-hidden>{done ? '☑' : '☐'}</span>
      </Button>
      <span className={done ? 'min-w-0 text-sm line-through text-subtle' : 'min-w-0 text-sm'}>
        {label}
      </span>
      <FormError className="w-full">{state.error}</FormError>
    </form>
  );
}

export function AddChecklistItemForm({ organizationId, workItemId, position }: {
  organizationId: string;
  workItemId: string;
  position: number;
}) {
  const [state, formAction, pending] = useActionState(addChecklistItemAction, INITIAL);
  const id = `checklist-label-${workItemId}`;

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <input type="hidden" name="position" value={position} />
      <FormField id={id} label="New step" className="sm:max-w-xl">
        {(field) => (
          <TextInput {...field} name="label" required maxLength={200} placeholder="Photograph the meter" />
        )}
      </FormField>
      <FormActions>
        <Button type="submit" disabled={pending} tone="secondary">
          {pending ? 'Adding…' : 'Add step'}
        </Button>
      </FormActions>
      <FormError>{state.error}</FormError>
    </form>
  );
}

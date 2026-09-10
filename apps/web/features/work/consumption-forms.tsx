'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { FormActions, FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { OptionalSelect, type SelectOption } from '@/components/controls/optional-select';
import {
  recordCostAction,
  recordTimeAction,
  type WorkItemActionState,
} from '@/app/organizations/[organizationId]/work/[workItemId]/actions';

const INITIAL: WorkItemActionState = { error: null };

export function RecordTimeForm({ organizationId, workItemId, resources }: {
  organizationId: string;
  workItemId: string;
  resources: SelectOption[];
}) {
  const [state, formAction, pending] = useActionState(recordTimeAction, INITIAL);
  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FormField id={`time-start-${workItemId}`} label="Started">
          {(field) => <TextInput {...field} name="startedAt" type="datetime-local" />}
        </FormField>
        <FormField id={`time-end-${workItemId}`} label="Ended">
          {(field) => <TextInput {...field} name="endedAt" type="datetime-local" />}
        </FormField>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Worked by <span className="text-subtle">(optional)</span></span>
          <OptionalSelect name="resourceId" label="Worked by" options={resources} />
        </label>
      </div>
      <FormField id={`time-note-${workItemId}`} label="Work note" optional>
        {(field) => <TextInput {...field} name="note" maxLength={1000} placeholder="What was done" />}
      </FormField>
      <FormActions><Button type="submit" disabled={pending} tone="secondary">{pending ? 'Recording…' : 'Record time'}</Button></FormActions>
      <FormError>{state.error}</FormError>
    </form>
  );
}

export function RecordCostForm({ organizationId, workItemId, currency }: {
  organizationId: string;
  workItemId: string;
  currency: string;
}) {
  const [state, formAction, pending] = useActionState(recordCostAction, INITIAL);
  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <FormField id={`cost-description-${workItemId}`} label="Description">
          {(field) => <TextInput {...field} name="description" required maxLength={200} placeholder="Replacement valve" />}
        </FormField>
        <FormField id={`cost-amount-${workItemId}`} label={`Amount in minor units (${currency})`}>
          {(field) => <TextInput {...field} name="amountMinor" type="number" required step={1} />}
        </FormField>
        <FormField id={`cost-date-${workItemId}`} label="Incurred" optional hint="Leave blank to use today.">
          {(field) => <TextInput {...field} name="incurredAt" type="date" />}
        </FormField>
      </div>
      <FormActions><Button type="submit" disabled={pending} tone="secondary">{pending ? 'Recording…' : 'Record cost'}</Button></FormActions>
      <FormError>{state.error}</FormError>
    </form>
  );
}

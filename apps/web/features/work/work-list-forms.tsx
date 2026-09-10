'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { FormActions, FormError, FormField } from '@/components/controls/form';
import { Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import { OptionalSelect, type SelectOption } from '@/components/controls/optional-select';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { WorkItemStatus } from '@/lib/domain/work-items/statuses';
import {
  changeStatusAction,
  createWorkItemAction,
  scheduleWorkItemAction,
  type WorkActionState,
} from '@/app/organizations/[organizationId]/work/actions';

const INITIAL: WorkActionState = { error: null };

export function CreateWorkItemForm({ organizationId, statuses, customers, locations, resources, assets, assetsEnabled, definitions }: {
  organizationId: string;
  statuses: WorkItemStatus[];
  customers: SelectOption[];
  locations: SelectOption[];
  resources: SelectOption[];
  assets: SelectOption[];
  assetsEnabled: boolean;
  definitions: FieldDefinition[];
}) {
  const [state, formAction, pending] = useActionState(createWorkItemAction, INITIAL);
  if (statuses.length === 0) return <Hint className="mt-8">Add a status before recording work. A work item without a state is not on the board.</Hint>;
  return (
    <form action={formAction} className="mt-10 flex flex-col gap-4 rounded border border-border p-4" aria-labelledby="create-work-heading">
      <input type="hidden" name="organizationId" value={organizationId} />
      <h2 id="create-work-heading" className="text-base font-semibold">Add work</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={`new-work-title-${organizationId}`} label="Job title">{(field) => <TextInput {...field} name="title" required maxLength={300} placeholder="What needs doing" />}</FormField>
        <FormField id={`new-work-status-${organizationId}`} label="Starting stage">{(field) => <SelectInput {...field} name="statusId">{statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}</SelectInput>}</FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Customer <span className="text-subtle">(optional)</span></span><OptionalSelect name="customerId" label="Customer" options={customers} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Location <span className="text-subtle">(optional)</span></span><OptionalSelect name="locationId" label="Location" options={locations} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Assigned to <span className="text-subtle">(optional)</span></span><OptionalSelect name="resourceId" label="Assigned to" options={resources} /></label>
        {assetsEnabled ? <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Asset <span className="text-subtle">(optional)</span></span><OptionalSelect name="assetId" label="Asset" options={assets} /></label> : null}
      </div>
      <CustomFieldInputs definitions={definitions} />
      <FormActions><Button type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add work item'}</Button></FormActions>
      <FormError>{state.error}</FormError>
    </form>
  );
}

export function MoveWorkItemForm({ organizationId, workItemId, moves }: { organizationId: string; workItemId: string; moves: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(changeStatusAction, INITIAL);
  if (moves.length === 0) return null;
  return <form action={formAction} className="flex flex-wrap items-center gap-2" aria-label="Change stage"><input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="workItemId" value={workItemId} />{moves.map((move) => <Button key={move.id} type="submit" name="toStatusId" value={move.id} disabled={pending} tone="secondary" size="tiny">Move to {move.name}</Button>)}<FormError className="w-full">{state.error}</FormError></form>;
}

export function ScheduleWorkItemForm({ organizationId, workItemId, resources, scheduled }: { organizationId: string; workItemId: string; resources: SelectOption[]; scheduled: boolean }) {
  const [state, formAction, pending] = useActionState(scheduleWorkItemAction, INITIAL);
  return <form action={formAction} className="mt-3 flex flex-col gap-3"><input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="workItemId" value={workItemId} /><div className="grid gap-3 sm:grid-cols-2"><FormField id={`schedule-start-${workItemId}`} label="Starts">{(field) => <TextInput {...field} name="startsAt" type="datetime-local" />}</FormField><FormField id={`schedule-end-${workItemId}`} label="Ends">{(field) => <TextInput {...field} name="endsAt" type="datetime-local" />}</FormField></div><label className="flex flex-col gap-1 text-sm"><span className="text-muted">Assign to <span className="text-subtle">(optional)</span></span><OptionalSelect name="resourceId" label="Assign to" options={resources} /></label><FormActions><Button type="submit" disabled={pending} tone="secondary" size="small">{pending ? 'Scheduling…' : 'Schedule'}</Button>{scheduled ? <Button type="submit" name="clear" value="1" disabled={pending} tone="secondary" size="small">Clear schedule</Button> : null}</FormActions><FormError>{state.error}</FormError></form>;
}

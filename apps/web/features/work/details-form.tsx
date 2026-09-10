'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { FormActions, FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { OptionalSelect, type SelectOption } from '@/components/controls/optional-select';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import type { CustomValues, FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { WorkItem } from '@/lib/domain/work-items/work-items';
import {
  updateWorkItemAction,
  type WorkItemActionState,
} from '@/app/organizations/[organizationId]/work/[workItemId]/actions';

const INITIAL: WorkItemActionState = { error: null };

export function EditWorkItemForm({ organizationId, workItem, customers, locations, assets, assetsEnabled, definitions }: {
  organizationId: string;
  workItem: WorkItem;
  customers: SelectOption[];
  locations: SelectOption[];
  assets: SelectOption[];
  assetsEnabled: boolean;
  definitions: FieldDefinition[];
}) {
  const [state, formAction, pending] = useActionState(updateWorkItemAction, INITIAL);
  const titleId = `work-title-${workItem.id}`;
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItem.id} />
      <FormField id={titleId} label="Job title">
        {(field) => <TextInput {...field} name="title" required maxLength={300} defaultValue={workItem.title} />}
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Customer <span className="text-subtle">(optional)</span></span><OptionalSelect name="customerId" label="Customer" options={customers} value={workItem.customer?.id} /></label>
        <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Location <span className="text-subtle">(optional)</span></span><OptionalSelect name="locationId" label="Location" options={locations} value={workItem.location?.id} /></label>
        {assetsEnabled ? <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Asset <span className="text-subtle">(optional)</span></span><OptionalSelect name="assetId" label="Asset" options={assets} value={workItem.asset?.id} /></label> : null}
      </div>
      <CustomFieldInputs definitions={definitions} values={workItem.custom as CustomValues} />
      <FormActions><Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save details'}</Button></FormActions>
      <FormError>{state.error}</FormError>
    </form>
  );
}

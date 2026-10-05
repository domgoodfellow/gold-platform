'use client';

import { useActionState } from 'react';
import { createWorkItemAction, type WorkActionState } from '@/app/organizations/[organizationId]/work/actions';
import { Button } from '@/components/controls/button';
import { FormActions, FormError, FormField } from '@/components/controls/form';
import { Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import { OptionalSelect, type SelectOption } from '@/components/controls/optional-select';
import { ResourceChecklist } from '@/components/controls/resource-checklist';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { WorkItemStatus } from '@/lib/domain/work-items/statuses';

const INITIAL: WorkActionState = { error: null };

/** Creation is the Work board's primary action; stage and schedule controls live with operations. */
export function CreateWorkItemForm({
  organizationId,
  statuses,
  customers,
  locations,
  resources,
  assets,
  assetsEnabled,
  definitions,
}: {
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

  if (statuses.length === 0) {
    return (
      <Hint>
        Add a status before recording work. A work item without a state is not on the board.
      </Hint>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id={`new-work-title-${organizationId}`} label="Job title">
          {(field) => (
            <TextInput
              {...field}
              name="title"
              required
              maxLength={300}
              placeholder="What needs doing"
            />
          )}
        </FormField>
        <FormField id={`new-work-status-${organizationId}`} label="Starting stage">
          {(field) => (
            <SelectInput {...field} name="statusId">
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">
            Customer <span className="text-subtle">(optional)</span>
          </span>
          <OptionalSelect name="customerId" label="Customer" options={customers} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">
            Location <span className="text-subtle">(optional)</span>
          </span>
          <OptionalSelect name="locationId" label="Location" options={locations} />
        </label>
        <ResourceChecklist legend="Assigned to (optional)" options={resources} />
        {assetsEnabled ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">
              Asset <span className="text-subtle">(optional)</span>
            </span>
            <OptionalSelect name="assetId" label="Asset" options={assets} />
          </label>
        ) : null}
      </div>
      <CustomFieldInputs definitions={definitions} />
      <FormActions>
        <Button type="submit" disabled={pending}>
          {pending ? 'Adding…' : 'Add work item'}
        </Button>
      </FormActions>
      <FormError>{state.error}</FormError>
    </form>
  );
}

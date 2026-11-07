'use client';

import { useActionState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createWorkItemAction, type WorkActionState } from '@/app/organizations/[organizationId]/work/actions';
import { Button, ButtonLink } from '@/components/controls/button';
import { FormActions, FormError, FormField } from '@/components/controls/form';
import { Hint, TextInput } from '@/components/controls/inputs';
import { OptionalSelect, type SelectOption } from '@/components/controls/optional-select';
import { ResourceChecklist } from '@/components/controls/resource-checklist';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { WorkItemStatus } from '@/lib/domain/work-items/statuses';
import { withSetupContext } from '@/lib/route/setup-context';
import { SelectField } from '@/components/controls/select-field';

const INITIAL: WorkActionState = { error: null };

/** Creation is the Work board's primary action; stage and schedule controls live with operations. */
export function CreateWorkItemForm({
  organizationId,
  typeId,
  statuses,
  customers,
  locations,
  resources,
  assets,
  assetsEnabled,
  definitions,
  cancelHref,
  onDirtyChange,
  returnToQuote = false,
  setupStep,
}: {
  organizationId: string;
  typeId: string;
  statuses: WorkItemStatus[];
  customers: SelectOption[];
  locations: SelectOption[];
  resources: SelectOption[];
  assets: SelectOption[];
  assetsEnabled: boolean;
  definitions: FieldDefinition[];
  cancelHref?: string;
  onDirtyChange?: (dirty: boolean) => void;
  returnToQuote?: boolean;
  setupStep?: string;
}) {
  const [state, formAction, pending] = useActionState(createWorkItemAction, INITIAL);
  const router = useRouter();
  useEffect(() => {
    if (state.success && cancelHref) {
      onDirtyChange?.(false);
      const financials = `/organizations/${organizationId}/work/${state.createdWorkItemId}?tab=financials`;
      router.push(returnToQuote && state.createdWorkItemId ? setupStep ? withSetupContext(financials, setupStep) : financials : cancelHref);
    }
  }, [state.success, state.createdWorkItemId, organizationId, returnToQuote, setupStep, cancelHref, onDirtyChange, router]);

  if (statuses.length === 0) {
    return (
      <Hint>
        Add a stage before recording work.{' '}
        <Link href={`/organizations/${organizationId}/work/configuration?${new URLSearchParams({ type: typeId, tab: 'workflow' })}`}
          className="text-accent-text underline-offset-4 hover:underline">Add a stage</Link>
      </Hint>
    );
  }

  return (
    <form action={formAction} onChange={() => onDirtyChange?.(true)} onReset={event => event.preventDefault()} className="flex flex-col gap-4" aria-label="Create work">
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
            <SelectField {...field} name="statusId" defaultValue={statuses[0].id} options={[...statuses.map((status) => ({ value: status.id, label: status.name }))]} />
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
          {pending ? 'Creating…' : 'Create work'}
        </Button>
        {cancelHref ? <ButtonLink href={cancelHref} tone="secondary">Cancel</ButtonLink> : null}
      </FormActions>
      <FormError>{state.error}</FormError>
      {state.success ? <p role="status" className="text-sm text-success">Work created.</p> : null}
    </form>
  );
}

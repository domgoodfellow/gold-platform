'use client';

import { useActionState, useEffect, useId, useState } from 'react';
import { Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { OptionalSelect, type SelectOption } from '@/components/controls/optional-select';
import { useFormDirty } from '@/components/controls/use-form-dirty';
import { useDrawerFormSubmit } from '@/components/controls/use-drawer-form-submit';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { GuardedDialog, useGuardedDialogClose, useGuardedDialogDirty } from '@/components/panels/guarded-dialog';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import { BusinessLabel } from '@/lib/context/business-vocabulary';
import type { CustomValues, FieldDefinition } from '@/lib/domain/fields/field-definitions';
import type { WorkItem } from '@/lib/domain/work-items/work-items';
import { updateWorkItemAction, type UpdateWorkItemState } from '@/app/organizations/[organizationId]/work/[workItemId]/actions';

const INITIAL: UpdateWorkItemState = { error: null, updated: false };

/**
 * Edit details: the job's title, who it is for, where, on what, and the business's own fields, in
 * the shared focused dialog. Unsaved input asks before it is discarded, a refused save keeps what
 * was typed and says why, and focus returns to the button that opened it. Only the middle scrolls,
 * so a long set of custom fields never pushes Save off a short screen. The update action and its
 * permission check are unchanged; the page offers this only to someone who may update work.
 */
export function EditWorkItemDialog({ organizationId, workItem, customers, locations, assets, assetsEnabled, definitions }: {
  organizationId: string;
  workItem: WorkItem;
  customers: SelectOption[];
  locations: SelectOption[];
  assets: SelectOption[];
  assetsEnabled: boolean;
  definitions: FieldDefinition[];
}) {
  const [open, setOpen] = useState(false);
  // A fresh form each time it opens, so it always starts from the record as it is now.
  const [key, setKey] = useState(0);
  return <>
    <Button type="button" tone="secondary" size="small" onClick={() => { setKey(value => value + 1); setOpen(true); }}><Pencil aria-hidden />Edit details</Button>
    <GuardedDialog open={open} onOpenChange={setOpen}>
      <EditWorkItemForm key={key} organizationId={organizationId} workItem={workItem} customers={customers} locations={locations} assets={assets}
        assetsEnabled={assetsEnabled} definitions={definitions} onUpdated={() => setOpen(false)} />
    </GuardedDialog>
  </>;
}

function EditWorkItemForm({ organizationId, workItem, customers, locations, assets, assetsEnabled, definitions, onUpdated }: {
  organizationId: string;
  workItem: WorkItem;
  customers: SelectOption[];
  locations: SelectOption[];
  assets: SelectOption[];
  assetsEnabled: boolean;
  definitions: FieldDefinition[];
  onUpdated: () => void;
}) {
  const formId = useId();
  const [state, formAction, pending] = useActionState(updateWorkItemAction, INITIAL);
  const { ref, dirty, onChange } = useFormDirty();
  useGuardedDialogDirty(dirty);
  const { onSubmit, errorRef } = useDrawerFormSubmit(formAction, state, pending);
  const cancel = useGuardedDialogClose();
  useEffect(() => {
    if (state.updated) { toast.success('Work details saved'); onUpdated(); }
  }, [state.updated, onUpdated]);
  return <>
    <StepHeader title="Edit details" />
    <DialogBody>
      <form id={formId} ref={ref} onSubmit={onSubmit} onChange={onChange} className="flex flex-col gap-5">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="workItemId" value={workItem.id} />
        <FormField id={`${formId}-title`} label="Title">
          {(field) => <TextInput {...field} name="title" required maxLength={300} defaultValue={workItem.title} />}
        </FormField>
        <div data-slot="field-group" className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm"><span className="text-muted"><BusinessLabel>Customer</BusinessLabel> <span className="text-subtle">(optional)</span></span><OptionalSelect name="customerId" label="Customer" options={customers} value={workItem.customer?.id} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Location <span className="text-subtle">(optional)</span></span><OptionalSelect name="locationId" label="Location" options={locations} value={workItem.location?.id} /></label>
          {assetsEnabled ? <label className="flex flex-col gap-1 text-sm"><span className="text-muted">Asset <span className="text-subtle">(optional)</span></span><OptionalSelect name="assetId" label="Asset" options={assets} value={workItem.asset?.id} /></label> : null}
        </div>
        {definitions.length ? <div data-slot="field-group" className="grid gap-3"><CustomFieldInputs definitions={definitions} values={workItem.custom as CustomValues} /></div> : null}
        <div ref={errorRef} tabIndex={-1} className="outline-none"><FormError>{state.error}</FormError></div>
      </form>
    </DialogBody>
    <DialogFooterBar>
      <Button type="submit" form={formId} disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</Button>
      <Button type="button" tone="secondary" onClick={cancel}>Cancel</Button>
    </DialogFooterBar>
  </>;
}

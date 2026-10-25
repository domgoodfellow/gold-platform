'use client';
import { useActionState, useEffect, useId, useState, type ReactNode } from 'react';
import { Building2, CircleHelp, Pencil, User } from 'lucide-react';
import { tabListStyles, tabTriggerStyles } from '@gold/ui/components/tab-styles';
import { Button, type ButtonTone } from '@/components/controls/button';
import { FormError, FormField } from '@/components/controls/form';
import { PhoneInput } from '@/components/controls/phone-input';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import { useDrawerFormSubmit } from '@/components/controls/use-drawer-form-submit';
import { useFormDirty } from '@/components/controls/use-form-dirty';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { GuardedDialog, useGuardedDialogClose, useGuardedDialogDirty } from '@/components/panels/guarded-dialog';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import type { Contact } from '@/lib/domain/contacts/contacts';
import type { CustomerStage } from '@/lib/domain/customers/stages';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { editCustomerAction, type EditCustomerState } from '@/app/organizations/[organizationId]/crm/contacts/[contactId]/actions';
import { ContactClassificationFields } from './contact-classification-fields';
import { IdentityChoice } from './create-contact-form';

export type EditSection = 'identity' | 'relationship' | 'fields';
const INITIAL: EditCustomerState = { error: null, updated: false };

/**
 * Edit a contact in a focused dialog rather than a long drawer. One form, three sections a person
 * can jump between (hidden sections keep their values, so nothing is lost), the same canonical
 * `editCustomerAction`, and the shared unsaved-change protection. "Classify contact" is this
 * dialog opened on Identity: Person or Company is chosen explicitly, never guessed from the name.
 */
export function EditContactDialog({ organizationId, customer, definitions, stages, label = 'Edit', tone = 'secondary', initialSection = 'identity', icon = true }: {
  organizationId: string; customer: Contact; definitions: FieldDefinition[]; stages: CustomerStage[];
  label?: ReactNode; tone?: ButtonTone; initialSection?: EditSection; icon?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return <>
    <Button type="button" tone={tone} onClick={() => { setKey(value => value + 1); setOpen(true); }}>{icon ? <Pencil aria-hidden /> : null}{label}</Button>
    <GuardedDialog open={open} onOpenChange={setOpen}>
      <EditContactForm key={key} organizationId={organizationId} customer={customer} definitions={definitions} stages={stages} initialSection={initialSection} onUpdated={() => setOpen(false)} />
    </GuardedDialog>
  </>;
}

function EditContactForm({ organizationId, customer, definitions, stages, initialSection, onUpdated }: {
  organizationId: string; customer: Contact; definitions: FieldDefinition[]; stages: CustomerStage[]; initialSection: EditSection; onUpdated: () => void;
}) {
  const formId = useId();
  const [section, setSection] = useState<EditSection>(initialSection === 'fields' && !definitions.length ? 'identity' : initialSection);
  const [identity, setIdentity] = useState(customer.contactType ?? 'unspecified');
  const [state, formAction, pending] = useActionState(editCustomerAction, INITIAL);
  const { ref, dirty, onChange } = useFormDirty();
  useGuardedDialogDirty(dirty);
  const { onSubmit, errorRef } = useDrawerFormSubmit(formAction, state, pending);
  const cancel = useGuardedDialogClose();
  useEffect(() => { if (state.updated) onUpdated(); }, [state.updated, onUpdated]);
  // Existing identity rules: an Unspecified record may become a Person or a Company; a classified one keeps its kind.
  const unspecified = !customer.contactType || customer.contactType === 'unspecified';
  const choices = [
    ...(unspecified || customer.contactType === 'person' ? [{ value: 'person' as const, label: 'Person', description: 'An individual.', Icon: User }] : []),
    ...(unspecified || customer.contactType === 'company' ? [{ value: 'company' as const, label: 'Company', description: 'An organization.', Icon: Building2 }] : []),
    ...(unspecified ? [{ value: 'unspecified' as const, label: 'Not decided', description: 'Keep it in Needs review.', Icon: CircleHelp }] : []),
  ];
  const sections: { key: EditSection; label: string }[] = [{ key: 'identity', label: 'Identity & essentials' }, { key: 'relationship', label: 'Relationship' }, ...(definitions.length ? [{ key: 'fields' as const, label: 'Additional fields' }] : [])];
  return <>
    <StepHeader title={unspecified && initialSection === 'identity' ? 'Classify and edit contact' : 'Edit contact'} />
    <div className="border-b border-border px-5 py-2">
      <div role="group" aria-label="Contact sections" data-slot="tabs-list" data-variant="segmented" className={tabListStyles()}>
        {sections.map(entry => <button key={entry.key} type="button" aria-pressed={section === entry.key} onClick={() => setSection(entry.key)} data-slot="tabs-trigger" className={tabTriggerStyles}>{entry.label}</button>)}
      </div>
    </div>
    <DialogBody>
      <form id={formId} ref={ref} onSubmit={onSubmit} onChange={onChange} onClick={onChange} className="flex flex-col gap-5">
        <input type="hidden" name="organizationId" value={organizationId} />
        <input type="hidden" name="customerId" value={customer.id} />
        <div hidden={section !== 'identity'} className="flex flex-col gap-5">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Contact type</legend>
            {choices.length > 1 ? <div className="grid gap-2 sm:grid-cols-3">{choices.map(choice => <IdentityChoice key={choice.value} value={choice.value} checked={identity === choice.value} onChange={() => { setIdentity(choice.value); onChange(); }} label={choice.label} description={choice.description} Icon={choice.Icon} />)}</div>
              : <><input type="hidden" name="contactType" value={identity} /><p className="text-sm">{identity === 'company' ? 'Company' : 'Person'}</p></>}
          </fieldset>
          <div data-slot="field-group" className="grid gap-3 sm:grid-cols-2">
            <FormField id={`${formId}-name`} label={identity === 'company' ? 'Company name' : 'Name'} className="sm:col-span-2">{field => <TextInput {...field} name="name" required maxLength={200} defaultValue={customer.name} />}</FormField>
            <FormField id={`${formId}-email`} label={identity === 'company' ? 'General email' : 'Email'} optional>{field => <TextInput {...field} name="email" type="email" maxLength={320} defaultValue={customer.email ?? ''} />}</FormField>
            <FormField id={`${formId}-phone`} label="Phone" optional>{field => <PhoneInput {...field} name="phone" type="tel" maxLength={50} defaultValue={customer.phone ?? ''} />}</FormField>
          </div>
        </div>
        <div hidden={section !== 'relationship'} className="flex flex-col gap-4">
          <ContactClassificationFields id={formId} lifecycle={customer.lifecycle ?? null} temperature={customer.leadTemperature} />
          {stages.length ? <FormField id={`${formId}-stage`} label="Relationship stage" optional>{field => <SelectInput {...field} name="stageId" defaultValue={customer.stageId ?? ''} className="w-fit"><option value="">No stage</option>{stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</SelectInput>}</FormField>
            : <input type="hidden" name="stageId" value={customer.stageId ?? ''} />}
        </div>
        {definitions.length ? <div hidden={section !== 'fields'} data-slot="field-group" className="grid gap-3"><CustomFieldInputs definitions={definitions} values={customer.custom} /></div> : null}
        <div ref={errorRef} tabIndex={-1} className="outline-none"><FormError>{state.error}</FormError></div>
      </form>
    </DialogBody>
    <DialogFooterBar>
      <Button type="submit" form={formId} disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</Button>
      <Button type="button" tone="secondary" onClick={cancel}>Cancel</Button>
    </DialogFooterBar>
  </>;
}

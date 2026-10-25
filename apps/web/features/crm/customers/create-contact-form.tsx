'use client';
import { useActionState, useEffect, useId, useState } from 'react';
import { Building2, Plus, User } from 'lucide-react';
import { Button } from '@/components/controls/button';
import { FormError, FormField } from '@/components/controls/form';
import { PhoneInput } from '@/components/controls/phone-input';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import { useDrawerFormSubmit } from '@/components/controls/use-drawer-form-submit';
import { useFormDirty } from '@/components/controls/use-form-dirty';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { createCustomerAction, companyOptionsAction, type CreateCustomerState } from '@/app/organizations/[organizationId]/crm/contacts/actions';
import { ContactClassificationFields } from './contact-classification-fields';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { useGuardedDialogClose, useGuardedDialogDirty } from '@/components/panels/guarded-dialog';

const INITIAL: CreateCustomerState = { error: null, created: false };
type Identity = 'person' | 'company' | '';
/** Industry classification fields come first in Additional information when this business defines them. */
const INDUSTRY_KEYS = ['industry', 'sic', 'sic_code', 'naics', 'naics_code'];

export function IdentityChoice({ value, checked, onChange, label, description, Icon }: { value: 'person' | 'company' | 'unspecified'; checked: boolean; onChange: () => void; label: string; description: string; Icon: typeof User }) {
  return <label data-slot="selectable-card" className="flex min-h-20 cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface p-4 text-left transition-colors hover:bg-hover has-[:checked]:border-accent has-[:checked]:ring-2 has-[:checked]:ring-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent">
    <input type="radio" name="contactType" value={value} checked={checked} onChange={onChange} required className="sr-only" />
    <Icon aria-hidden className="mt-0.5 size-5 shrink-0 text-muted" />
    <span><span className="block text-sm font-medium">{label}</span><span className="block text-xs text-muted">{description}</span></span>
  </label>;
}

/**
 * Manual contact creation in two stages over one form: essentials, then optional additional
 * information. Stages are shown and hidden rather than mounted and unmounted, so moving between
 * them (or into the inline company step and back) never loses a typed value. Saving is possible
 * from either stage; the canonical `createCustomerAction` returns the new contact's id.
 */
export function CreateContactForm({ organizationId, definitions, initialType = '', onCreated }: {
  organizationId: string; definitions: FieldDefinition[]; initialType?: Identity; onCreated: (created: CreateCustomerState) => void;
}) {
  const onCancel = useGuardedDialogClose();
  const formId = useId();
  const [identity, setIdentity] = useState<Identity>(initialType);
  const [stage, setStage] = useState<'essentials' | 'details' | 'company'>('essentials');
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);
  const [companyId, setCompanyId] = useState('');
  const [companiesError, setCompaniesError] = useState('');
  useEffect(() => { let active = true; companyOptionsAction(organizationId).then(rows => { if (active) setCompanies(rows); }).catch(() => { if (active) setCompaniesError('Company options could not be loaded.'); }); return () => { active = false; }; }, [organizationId]);
  const [state, formAction, pending] = useActionState(createCustomerAction, INITIAL);
  const { ref, dirty, onChange } = useFormDirty();
  useGuardedDialogDirty(dirty);
  const { onSubmit, errorRef } = useDrawerFormSubmit(formAction, state, pending);
  useEffect(() => { if (state.created) onCreated(state); }, [state, onCreated]);

  const website = identity === 'company' ? definitions.find(definition => definition.key === 'website') : undefined;
  const additional = definitions.filter(definition => definition !== website)
    .sort((a, b) => Number(!INDUSTRY_KEYS.includes(a.key)) - Number(!INDUSTRY_KEYS.includes(b.key)));
  const person = identity === 'person'; const company = identity === 'company';

  return <>
    <div hidden={stage === 'company'} className={stage === 'company' ? undefined : 'contents'}>
      {/* One dialog title at a time: the inline company step supplies its own while this stage is hidden. */}
      {stage !== 'company' ? <StepHeader title="Add a contact" steps={['Essentials', 'Additional information']} current={stage === 'details' ? 1 : 0} /> : null}
      <DialogBody>
        <form id={formId} ref={ref} onSubmit={onSubmit} onChange={onChange} onClick={onChange} className="flex flex-col gap-5" noValidate={false}>
          <input type="hidden" name="organizationId" value={organizationId} />
          <div hidden={stage !== 'essentials'} className="flex flex-col gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-medium">Is this a person or a company?</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <IdentityChoice value="person" checked={person} onChange={() => { setIdentity('person'); onChange(); }} label="Person" description="An individual, optionally linked to a company." Icon={User} />
                <IdentityChoice value="company" checked={company} onChange={() => { setIdentity('company'); onChange(); }} label="Company" description="An organization you work with." Icon={Building2} />
              </div>
            </fieldset>
            {identity ? <div data-slot="field-group" className="grid gap-3 sm:grid-cols-2">
              <FormField id={`${formId}-name`} label={company ? 'Company name' : 'Name'} className="sm:col-span-2">{field => <TextInput {...field} name="name" required maxLength={200} autoComplete="off" />}</FormField>
              <FormField id={`${formId}-email`} label={company ? 'General email' : 'Email'} optional>{field => <TextInput {...field} name="email" type="email" />}</FormField>
              <FormField id={`${formId}-phone`} label="Phone" optional>{field => <PhoneInput {...field} name="phone" type="tel" />}</FormField>
              {person ? <>
                <FormField id={`${formId}-company`} label="Company" optional hint={companiesError || undefined}>{field => <div className="flex gap-2">
                  <SelectInput {...field} name="companyId" value={companyId} onChange={event => { setCompanyId(event.target.value); onChange(); }} className="min-w-0 flex-1"><option value="">No company</option>{companies.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}</SelectInput>
                  <Button type="button" tone="secondary" onClick={() => setStage('company')} aria-label="New company"><Plus aria-hidden /><span className="hidden sm:inline">New</span></Button>
                </div>}</FormField>
                <FormField id={`${formId}-title`} label="Job title" optional>{field => <TextInput {...field} name="affiliationTitle" maxLength={200} />}</FormField>
              </> : null}
              {website ? <div className="sm:col-span-2"><CustomFieldInputs definitions={[website]} /></div> : null}
            </div> : <p className="text-sm text-muted">Choose one to see the fields that apply. GildOps never guesses this from the name.</p>}
          </div>
          <div hidden={stage !== 'details'} className="flex flex-col gap-5">
            <section aria-labelledby={`${formId}-classification`} className="flex flex-col gap-3">
              <h3 id={`${formId}-classification`} className="text-sm font-medium">Relationship</h3>
              <ContactClassificationFields id={formId} />
            </section>
            {additional.length ? <section aria-labelledby={`${formId}-fields`} className="flex flex-col gap-3">
              <h3 id={`${formId}-fields`} className="text-sm font-medium">Details this business records</h3>
              <div data-slot="field-group" className="grid gap-3"><CustomFieldInputs definitions={additional} /></div>
            </section> : null}
          </div>
          <div ref={errorRef} tabIndex={-1} className="outline-none"><FormError>{state.error}</FormError></div>
        </form>
      </DialogBody>
      <DialogFooterBar>
        <Button type="submit" form={formId} disabled={pending || !identity}>{pending ? 'Saving…' : 'Save contact'}</Button>
        {stage === 'essentials'
          ? <Button type="button" tone="secondary" disabled={!identity} onClick={() => setStage('details')}>Add more details</Button>
          : <Button type="button" tone="secondary" onClick={() => setStage('essentials')}>Back to essentials</Button>}
        <Button type="button" tone="text" onClick={onCancel} className="sm:mr-auto">Cancel</Button>
      </DialogFooterBar>
    </div>
    {stage === 'company' ? <InlineCompany organizationId={organizationId} onBack={() => setStage('essentials')}
      onCreated={created => { setCompanies(rows => [...rows, created].sort((a, b) => a.name.localeCompare(b.name))); setCompanyId(created.id); onChange(); setStage('essentials'); }} /> : null}
  </>;
}

/**
 * The inline company step: a second form beside (never inside) the person's, through the same
 * canonical command. The person's form stays mounted and hidden, so returning restores it intact.
 */
function InlineCompany({ organizationId, onBack, onCreated }: { organizationId: string; onBack: () => void; onCreated: (company: { id: string; name: string }) => void }) {
  const formId = useId();
  const [state, formAction, pending] = useActionState(createCustomerAction, INITIAL);
  const { onSubmit, errorRef } = useDrawerFormSubmit(formAction, state, pending);
  useEffect(() => { if (state.created && state.id) onCreated({ id: state.id, name: state.name ?? '' }); }, [state, onCreated]);
  return <>
    <StepHeader title="New company" description="Create the company, then return to the person you were adding." />
    <DialogBody>
      <form id={formId} onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="organizationId" value={organizationId} /><input type="hidden" name="contactType" value="company" />
        <FormField id={`${formId}-name`} label="Company name" className="sm:col-span-2">{field => <TextInput {...field} name="name" required maxLength={200} autoFocus />}</FormField>
        <FormField id={`${formId}-email`} label="General email" optional>{field => <TextInput {...field} name="email" type="email" />}</FormField>
        <FormField id={`${formId}-phone`} label="Phone" optional>{field => <PhoneInput {...field} name="phone" type="tel" />}</FormField>
        <div ref={errorRef} tabIndex={-1} className="outline-none sm:col-span-2"><FormError>{state.error}</FormError></div>
      </form>
    </DialogBody>
    <DialogFooterBar>
      <Button type="submit" form={formId} disabled={pending}>{pending ? 'Creating…' : 'Create company'}</Button>
      <Button type="button" tone="secondary" onClick={onBack}>Back to person</Button>
    </DialogFooterBar>
  </>;
}

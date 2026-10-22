'use client';
import { ContactClassificationFields } from './contact-classification-fields';

import { PhoneInput } from '@/components/controls/phone-input';
import { FormError, FormField } from '@/components/controls/form';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import { useDrawerFormSubmit } from '@/components/controls/use-drawer-form-submit';
import { useFormDirty } from '@/components/controls/use-form-dirty';
import { usePageDrawerUnsavedChanges } from '@/components/panels/page-drawer';
import { useActionState, useEffect, useState } from 'react';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import {
  createCustomerAction, companyOptionsAction,
  type CreateCustomerState,
} from '@/app/organizations/[organizationId]/crm/contacts/actions';

const INITIAL: CreateCustomerState = { error: null, created: false };

/** The new-customer form. Its drawer owns the submit button, which names this form by `formId`. */
export function CreateCustomerForm({
  organizationId,
  definitions,
  formId,
  onCreated,
  onPendingChange,
  initialType='',
}: {
  initialType?: 'person' | 'company' | '';
  organizationId: string;
  definitions: FieldDefinition[];
  formId: string;
  onCreated?: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [contactType,setContactType]=useState(initialType);
  const [companies,setCompanies]=useState<{id:string;name:string}[]>([]);
  const [companiesError,setCompaniesError]=useState('');
  const refreshCompanies=async()=>{try{setCompanies(await companyOptionsAction(organizationId));setCompaniesError('');}catch{setCompaniesError('Company options could not be loaded. Try again.');}};
  useEffect(()=>{let active=true;companyOptionsAction(organizationId).then(rows=>{if(active)setCompanies(rows);}).catch(()=>{if(active)setCompaniesError('Company options could not be loaded. Try again.');});return()=>{active=false;};},[organizationId]);
  const [state, formAction, pending] = useActionState(createCustomerAction, INITIAL);
  const { ref, dirty, onChange } = useFormDirty();
  usePageDrawerUnsavedChanges(dirty);
  const { onSubmit, errorRef } = useDrawerFormSubmit(formAction, state, pending, onPendingChange);

  useEffect(() => {
    if (state.created) onCreated?.();
  }, [state.created, onCreated]);

  return (
    <form id={formId} ref={ref} onSubmit={onSubmit} onChange={onChange} onClick={onChange} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />

      <FormField id="new-contact-type" label="Contact type">
        {field=><SelectInput {...field} name="contactType" required value={contactType} onChange={event=>setContactType(event.target.value as 'person'|'company'|'')}><option value="" disabled>Choose Person or Company</option><option value="person">Person</option><option value="company">Company</option></SelectInput>}
      </FormField>
      <div className="flex flex-col gap-3">
        <FormField id="new-customer-name" label={contactType==='company'?'Company name':contactType==='person'?'Person name':'Name'} className="flex-1">
          {(field) => <TextInput {...field} name="name" type="text" required maxLength={200} />}
        </FormField>
        <FormField id="new-customer-email" label="Email" optional className="flex-1">
          {(field) => <TextInput {...field} name="email" type="email" />}
        </FormField>
        <FormField id="new-customer-phone" label="Phone" optional className="flex-1">
          {(field) => <PhoneInput {...field} name="phone" type="tel" />}
        </FormField>
      </div>

      {contactType==='person'?<>
        <FormField id="new-contact-company" label="Company" optional>{field=><SelectInput {...field} name="companyId"><option value="">No affiliation</option>{companies.map(company=><option key={company.id} value={company.id}>{company.name}</option>)}</SelectInput>}</FormField>
        <FormField id="new-contact-title" label="Role or title" optional>{field=><TextInput {...field} name="affiliationTitle" maxLength={200}/>}</FormField>
        <div className="flex flex-wrap gap-3 text-sm"><a href={`/organizations/${organizationId}/crm/contacts?create=1&type=company`} target="_blank" rel="noreferrer" className="underline">Add a company in a new tab</a><button type="button" onClick={refreshCompanies} className="underline">Refresh companies</button></div>
        <FormError>{companiesError}</FormError>
      </>:null}
      <ContactClassificationFields id="new-contact" />
      <CustomFieldInputs definitions={definitions} />

      <div ref={errorRef} tabIndex={-1} className="outline-none">
        <FormError>{state.error}</FormError>
      </div>
    </form>
  );
}

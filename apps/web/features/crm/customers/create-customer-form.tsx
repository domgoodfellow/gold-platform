'use client';

import { PhoneInput } from '@/components/controls/phone-input';
import { FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { useDrawerFormSubmit } from '@/components/controls/use-drawer-form-submit';
import { useFormDirty } from '@/components/controls/use-form-dirty';
import { usePageDrawerUnsavedChanges } from '@/components/panels/page-drawer';
import { useActionState, useEffect } from 'react';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import {
  createCustomerAction,
  type CreateCustomerState,
} from '@/app/organizations/[organizationId]/customers/actions';

const INITIAL: CreateCustomerState = { error: null, created: false };

/** The new-customer form. Its drawer owns the submit button, which names this form by `formId`. */
export function CreateCustomerForm({
  organizationId,
  definitions,
  formId,
  onCreated,
  onPendingChange,
}: {
  organizationId: string;
  definitions: FieldDefinition[];
  formId: string;
  onCreated?: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
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

      <div className="flex flex-col gap-3">
        <FormField id="new-customer-name" label="Name" className="flex-1">
          {(field) => <TextInput {...field} name="name" type="text" required maxLength={200} />}
        </FormField>
        <FormField id="new-customer-email" label="Email" optional className="flex-1">
          {(field) => <TextInput {...field} name="email" type="email" />}
        </FormField>
        <FormField id="new-customer-phone" label="Phone" optional className="flex-1">
          {(field) => <PhoneInput {...field} name="phone" type="tel" />}
        </FormField>
      </div>

      <CustomFieldInputs definitions={definitions} />

      <div ref={errorRef} tabIndex={-1} className="outline-none">
        <FormError>{state.error}</FormError>
      </div>
    </form>
  );
}

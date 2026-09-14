'use client';

import { Button } from '@/components/controls/button';
import { FormActions, FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { useActionState, useEffect } from 'react';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import {
  createCustomerAction,
  type CreateCustomerState,
} from '@/app/organizations/[organizationId]/customers/actions';

const INITIAL: CreateCustomerState = { error: null, created: false };

export function CreateCustomerForm({
  organizationId,
  definitions,
  onCreated,
}: {
  organizationId: string;
  definitions: FieldDefinition[];
  onCreated?: () => void;
}) {
  const [state, formAction, pending] = useActionState(createCustomerAction, INITIAL);

  useEffect(() => {
    if (state.created) onCreated?.();
  }, [state.created, onCreated]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-col gap-3">
        <FormField id="new-customer-name" label="Name" className="flex-1">
          {(field) => <TextInput {...field} name="name" type="text" required maxLength={200} />}
        </FormField>
        <FormField id="new-customer-email" label="Email" optional className="flex-1">
          {(field) => <TextInput {...field} name="email" type="email" />}
        </FormField>
        <FormField id="new-customer-phone" label="Phone" optional className="flex-1">
          {(field) => <TextInput {...field} name="phone" type="tel" />}
        </FormField>
      </div>

      <CustomFieldInputs definitions={definitions} />

      <FormActions>
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? 'Adding…' : 'Add customer'}
        </Button>
      </FormActions>

      <FormError>{state.error}</FormError>
    </form>
  );
}

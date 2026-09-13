'use client';

import { SectionHeading } from '@/components/containers/section';
import { Button } from '@/components/controls/button';
import { FormActions, FormError, FormField } from '@/components/controls/form';
import { TextInput } from '@/components/controls/inputs';
import { useActionState } from 'react';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import {
  createCustomerAction,
  type CreateCustomerState,
} from '@/app/organizations/[organizationId]/customers/actions';

const INITIAL: CreateCustomerState = { error: null };

export function CreateCustomerForm({
  organizationId,
  definitions,
}: {
  organizationId: string;
  definitions: FieldDefinition[];
}) {
  const [state, formAction, pending] = useActionState(createCustomerAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <SectionHeading>New customer</SectionHeading>

      <div className="flex flex-col gap-2 sm:flex-row">
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

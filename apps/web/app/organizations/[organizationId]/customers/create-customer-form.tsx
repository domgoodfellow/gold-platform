'use client';

import { SectionHeading } from '@/components/containers/section';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { createCustomerAction, type CreateCustomerState } from './actions';

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
        <TextInput
          name="name"
          type="text"
          required
          maxLength={200}
          placeholder="Name"
          aria-label="Name"
          className="flex-1"
        />
        <TextInput
          name="email"
          type="email"
          placeholder="Email (optional)"
          aria-label="Email"
          className="flex-1"
        />
        <TextInput
          name="phone"
          type="tel"
          placeholder="Phone (optional)"
          aria-label="Phone"
          className="flex-1"
        />
      </div>

      <CustomFieldInputs definitions={definitions} />

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Adding…' : 'Add customer'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

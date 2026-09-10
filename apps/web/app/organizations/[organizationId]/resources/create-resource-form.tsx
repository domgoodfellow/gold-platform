'use client';

import { SectionHeading } from '@/components/containers/section';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { createResourceAction, type CreateResourceState } from './actions';

const INITIAL: CreateResourceState = { error: null };

export function CreateResourceForm({
  organizationId,
  definitions,
}: {
  organizationId: string;
  definitions: FieldDefinition[];
}) {
  const [state, formAction, pending] = useActionState(createResourceAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <SectionHeading>New resource</SectionHeading>

      <TextInput
        name="name"
        type="text"
        required
        maxLength={200}
        placeholder="Name, e.g. Sam Okafor, or Van 3"
        aria-label="Name"
      />

      <CustomFieldInputs definitions={definitions} />

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Adding…' : 'Add resource'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

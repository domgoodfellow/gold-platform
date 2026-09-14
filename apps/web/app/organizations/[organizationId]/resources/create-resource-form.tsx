'use client';

import { SectionHeading } from '@/components/containers/section';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState, useEffect } from 'react';
import { toast } from 'sonner';
import { CustomFieldInputs } from '@/features/custom-fields/inputs';
import type { FieldDefinition } from '@/lib/domain/fields/field-definitions';
import { createResourceAction, type CreateResourceState } from './actions';

const INITIAL: CreateResourceState = { error: null, created: false };

export function CreateResourceForm({
  organizationId,
  definitions,
  onCreated,
}: {
  organizationId: string;
  definitions: FieldDefinition[];
  onCreated?: () => void;
}) {
  const [state, formAction, pending] = useActionState(createResourceAction, INITIAL);

  useEffect(() => {
    if (state.created) {
      toast.success('Resource added');
      onCreated?.();
    }
  }, [state.created, onCreated]);

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

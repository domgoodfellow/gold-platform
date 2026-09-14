'use client';

import { SectionHeading } from '@/components/containers/section';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';
import { CapabilitySelector } from '@/features/tenancy/capability-selector';
import { createRoleAction, type CreateRoleState } from './actions';

const INITIAL: CreateRoleState = { error: null };

export function CreateRoleForm({ organizationId }: { organizationId: string }) {
  const [state, formAction, pending] = useActionState(createRoleAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <SectionHeading>New role</SectionHeading>

      <TextInput
        name="name"
        type="text"
        required
        maxLength={64}
        placeholder="Name, e.g. Dispatcher"
        aria-label="Role name"
      />

      <CapabilitySelector idPrefix="create-role" />

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Creating…' : 'Create role'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

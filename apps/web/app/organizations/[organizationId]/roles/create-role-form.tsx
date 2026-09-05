'use client';

import { SectionHeading } from '@/components/containers/section';
import { ErrorText, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';
import { CAPABILITIES, CAPABILITY_LABELS } from '@/lib/domain/tenancy/capabilities';
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

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm text-muted">Can</legend>
        {CAPABILITIES.map((capability) => (
          <label key={capability} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="capabilities" value={capability} />
            {CAPABILITY_LABELS[capability]}
          </label>
        ))}
      </fieldset>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Creating…' : 'Create role'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

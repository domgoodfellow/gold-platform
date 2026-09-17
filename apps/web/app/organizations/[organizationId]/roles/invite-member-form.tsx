'use client';

import { useActionState, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import type { Role } from '@/lib/domain/tenancy/roles';
import { inviteMemberAction, type InviteMemberState } from './actions';

const INITIAL: InviteMemberState = { error: null, link: null };

/**
 * The shared Add Member Sheet owns the bounded creation surface; this component owns only the
 * invite-by-email operation, including its post-success copyable-link state.
 */
export function InviteMemberForm({
  organizationId,
  roles,
}: {
  organizationId: string;
  roles: Role[];
}) {
  const [state, formAction, pending] = useActionState(inviteMemberAction, INITIAL);
  const [copied, setCopied] = useState(false);

  if (roles.length === 0) {
    return <Hint className="mt-4">Create a role before inviting people.</Hint>;
  }

  if (state.link) {
    return (
      <div className="mt-4 flex flex-col gap-3">
        <Hint>Invitation created. Copy this link if you&rsquo;d like to send it yourself:</Hint>
        <div className="flex gap-2">
          <TextInput readOnly value={state.link} className="flex-1" aria-label="Invitation link" />
          <Button
            type="button"
            tone="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(state.link ?? '');
              setCopied(true);
              toast.success('Invitation link copied');
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <Hint weight="subtle">
        They don&rsquo;t need an account yet. This creates a link that grants the role you
        choose — send it yourself, or GOLD will try to email it for you.
      </Hint>

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="email"
          type="email"
          required
          placeholder="Their email address"
          aria-label="Email address"
          className="flex-1"
        />
        <SelectInput name="roleId" aria-label="Role" className="flex-1">
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
            </option>
          ))}
        </SelectInput>
      </div>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Inviting…' : 'Send invitation'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

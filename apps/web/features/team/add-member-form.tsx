'use client';

import { ErrorText, Hint, SelectInput, TextInput } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState, useEffect } from 'react';
import type { Role } from '@/lib/domain/tenancy/roles';
import { addMemberAction, type AddMemberState } from '@/app/organizations/[organizationId]/settings/access/actions';

const INITIAL: AddMemberState = { error: null, created: false };

export function AddMemberForm({
  organizationId,
  roles,
  onAdded,
}: {
  organizationId: string;
  roles: Role[];
  /** Called once the write succeeds — the Add Member Sheet uses this to close itself. */
  onAdded?: () => void;
}) {
  const [state, formAction, pending] = useActionState(addMemberAction, INITIAL);

  useEffect(() => {
    if (state.created) onAdded?.();
  }, [state.created, onAdded]);

  if (roles.length === 0) {
    return <Hint className="mt-4">Create a role before adding people.</Hint>;
  }

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <TextInput
          name="email"
          type="email"
          required
          placeholder="Their email address"
          aria-label="Email address"
          className="flex-1"
        />
        {/* What this organization calls them. Not a profile: the same account can be "Sam"
            here and something else entirely to another tenant (D19). */}
        <TextInput
          name="displayName"
          type="text"
          maxLength={120}
          placeholder="Business name override (optional)"
          aria-label="Name in this business (optional)"
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
        {pending ? 'Adding…' : 'Add person'}
      </Button>

      <Hint weight="subtle">They need an account already — invite them by email instead if not.</Hint>

      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

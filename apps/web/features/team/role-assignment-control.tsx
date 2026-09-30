'use client';

import { useActionState, useState } from 'react';
import { ErrorText, SelectInput } from '@/components/controls/inputs';
import type { Role } from '@/lib/domain/tenancy/roles';
import { assignRoleAction, type AssignRoleState } from '@/app/organizations/[organizationId]/settings/access/actions';

const INITIAL: AssignRoleState = { error: null };

/**
 * One member's role, changed in place. Deliberately not a whole-table edit form: reassigning one
 * person is one independent command, so it submits itself rather than waiting on a screen-wide
 * save button.
 *
 * `SelectInput` is controlled rather than left to the browser, for one reason: if `assign_role`
 * refuses the change (most often the last-manager invariant, `roles.last_manager`), the row must
 * visibly revert to the role that is actually still assigned — an uncontrolled control would
 * keep showing the rejected choice, silently lying about the caller's own membership.
 */
export function RoleAssignmentControl({
  organizationId,
  membershipId,
  currentRoleId,
  roles,
}: {
  organizationId: string;
  membershipId: string;
  currentRoleId: string;
  roles: Role[];
}) {
  const [state, formAction, pending] = useActionState(assignRoleAction, INITIAL);
  const [value, setValue] = useState(currentRoleId);

  // Reverting on refusal is a render-time adjustment, not an effect: React's own recommended
  // shape for "reset local state when something the parent doesn't own has changed" is to
  // compare against the previous render inline and call setState during render, which bails out
  // before painting rather than committing the stale value and then re-rendering a second time.
  // A successful change is never reverted here — it already matches what the caller picked.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.error) {
      setValue(currentRoleId);
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <SelectInput
        name="roleId"
        size="small"
        value={value}
        disabled={pending}
        aria-label="Role"
        onChange={(event) => {
          setValue(event.target.value);
          event.currentTarget.form?.requestSubmit();
        }}
      >
        {roles.map((role) => (
          <option key={role.id} value={role.id}>
            {role.name}
          </option>
        ))}
      </SelectInput>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

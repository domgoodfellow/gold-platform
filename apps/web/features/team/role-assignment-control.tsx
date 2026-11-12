'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import { ErrorText } from '@/components/controls/inputs';
import { SelectField } from '@/components/controls/select-field';
import type { Role } from '@/lib/domain/tenancy/roles';
import { assignRoleAction, type AssignRoleState } from '@/app/organizations/[organizationId]/settings/access/actions';

const INITIAL: AssignRoleState = { error: null };

/**
 * One member's role, changed in place. Reassigning one person is one independent command, so it
 * is not part of a screen-wide save; but it changes what that person can do the moment it lands,
 * so choosing a role only proposes it. The change is made from the confirmation, which names the
 * person and both roles.
 *
 * If `assign_role` refuses (most often the last-manager invariant, `roles.last_manager`), the row
 * returns to the role that is actually still assigned and says why.
 */
export function RoleAssignmentControl({
  organizationId,
  membershipId,
  memberName,
  currentRoleId,
  roles,
  assignableRoleIds,
}: {
  organizationId: string;
  membershipId: string;
  memberName: string;
  currentRoleId: string;
  roles: Role[];
  assignableRoleIds: ReadonlySet<string>;
}) {
  const [state, formAction, pending] = useActionState(assignRoleAction, INITIAL);
  const [value, setValue] = useState(currentRoleId);
  // What is stored, as far as this row knows: the role it was given, or the one it just saved.
  const [stored, setStored] = useState(currentRoleId);

  // Settling after the action is a render-time adjustment. A refusal returns the row to the stored
  // role; a success makes the chosen role the stored one, whether or not the page's own copy has
  // arrived yet; a role arriving from the page always wins.
  const [seenState, setSeenState] = useState(state);
  const [seenRole, setSeenRole] = useState(currentRoleId);
  if (currentRoleId !== seenRole) {
    setSeenRole(currentRoleId);
    setSeenState(state);
    setStored(currentRoleId);
    setValue(currentRoleId);
  } else if (state !== seenState) {
    setSeenState(state);
    if (state.error) setValue(stored);
    else setStored(value);
  }

  useEffect(() => {
    if (state.savedAt) toast.success('Role changed');
  }, [state.savedAt]);

  const formId = `assign-role-${membershipId}`;
  const name = (id: string) => roles.find((role) => role.id === id)?.name ?? 'this role';
  const proposed = value !== stored;

  return (
    <form id={formId} action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="membershipId" value={membershipId} />
      <div className="flex flex-wrap items-center gap-2">
        <SelectField name="roleId" size="small" value={value} disabled={pending} aria-label={`Role for ${memberName}`} onValueChange={(next) => setValue(next)} options={[...roles.map((role) => ({ value: role.id, label: role.name, disabled: role.id !== stored && !assignableRoleIds.has(role.id) }))]} />
        {proposed ? (
          <ConfirmSubmit
            formId={formId}
            label="Change role"
            ariaLabel={`Change role for ${memberName}`}
            confirmLabel="Change role"
            description={`Change ${memberName} from ${name(stored)} to ${name(value)}? What they can do changes straight away.`}
            tone="primary"
            pending={pending}
          />
        ) : null}
      </div>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

'use client';

import { useActionState, useState } from 'react';
import { ErrorText, SelectInput } from '@/components/controls/inputs';
import type { AvailableMember } from './member-options';
import {
  setResourceMembershipAction,
  type SetResourceMembershipState,
} from '@/app/organizations/[organizationId]/resources/actions';

const INITIAL: SetResourceMembershipState = { error: null };
const UNLINKED = '';

/**
 * A Resource's own Membership link, changed in place — the same shape
 * `RoleAssignmentControl` already gives role reassignment, for the same reason: one
 * independent command submits itself, and a refusal (most often `resources.member_already_linked`)
 * must visibly revert the control to what is actually still linked rather than leave it showing
 * a choice that was never written.
 */
export function ResourceMembershipControl({
  organizationId,
  resourceId,
  currentMembershipId,
  availableMembers,
}: {
  organizationId: string;
  resourceId: string;
  currentMembershipId: string | null;
  availableMembers: AvailableMember[];
}) {
  const [state, formAction, pending] = useActionState(setResourceMembershipAction, INITIAL);
  const [value, setValue] = useState(currentMembershipId ?? UNLINKED);

  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.error) {
      setValue(currentMembershipId ?? UNLINKED);
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="resourceId" value={resourceId} />
      <SelectInput
        name="membershipId"
        size="small"
        value={value}
        disabled={pending}
        aria-label="Represents member"
        onChange={(event) => {
          setValue(event.target.value);
          event.currentTarget.form?.requestSubmit();
        }}
      >
        <option value={UNLINKED}>None — not a member</option>
        {availableMembers.map((member) => (
          <option key={member.membershipId} value={member.membershipId}>
            {member.displayName}
          </option>
        ))}
      </SelectInput>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

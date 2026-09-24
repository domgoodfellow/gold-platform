'use client';

import { useActionState } from 'react';
import { ErrorText } from '@/components/controls/inputs';
import { ConfirmSubmit } from '@/components/containers/dialog';
import type { PendingInvitation } from '@/lib/domain/tenancy/invitations';
import { revokeInvitationAction, type RevokeInvitationState } from '@/app/organizations/[organizationId]/roles/actions';

const INITIAL: RevokeInvitationState = { error: null };

/** Revoking is destructive — the recipient's link stops working — so it goes through the shared confirmation dialog rather than a direct submit. */
export function RevokeInvitationDialog({
  organizationId,
  invitation,
}: {
  organizationId: string;
  invitation: PendingInvitation;
}) {
  const [state, formAction, pending] = useActionState(revokeInvitationAction, INITIAL);
  const formId = `revoke-invitation-${invitation.id}`;

  return (
    <form id={formId} action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="id" value={invitation.id} />
      <ConfirmSubmit
        formId={formId}
        label="Revoke"
        confirmLabel="Revoke invitation"
        description={`Revoke the invitation sent to "${invitation.email}"? Its link stops working immediately.`}
        tone="secondary"
        size="small"
        pending={pending}
      />
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

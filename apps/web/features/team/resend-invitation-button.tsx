'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { CopyField } from '@/components/controls/copy-field';
import { ErrorText, Hint } from '@/components/controls/inputs';
import type { PendingInvitation } from '@/lib/domain/tenancy/invitations';
import {
  reissueInvitationAction,
  type ReissueInvitationState,
} from '@/app/organizations/[organizationId]/settings/access/actions';

const INITIAL: ReissueInvitationState = { error: null, link: null, emailSent: null };

/**
 * A fresh token, a fresh link, a fresh send attempt. Never offers the original link again —
 * the hashed-token rule's own invariant (only the hash is ever stored) makes that impossible, not merely withheld —
 * so pressing this is the only way back once the first link is lost or stale.
 */
export function ResendInvitationButton({
  organizationId,
  invitation,
}: {
  organizationId: string;
  invitation: PendingInvitation;
}) {
  const [state, formAction, pending] = useActionState(reissueInvitationAction, INITIAL);

  if (state.link) {
    return (
      <div className="flex flex-col gap-2">
        <Hint>{state.emailSent ? 'Sent. The previous link no longer works.' : 'Created. The previous link no longer works — copy this one:'}</Hint>
        <CopyField value={state.link} label="New invitation link" copiedMessage="Invitation link copied" size="small" />
      </div>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="id" value={invitation.id} />
      <Button type="submit" tone="secondary" size="small" disabled={pending}>
        {pending ? 'Sending…' : 'Resend'}
      </Button>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

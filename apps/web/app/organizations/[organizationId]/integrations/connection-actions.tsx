'use client';

import { useActionState } from 'react';
import { ConfirmSubmit } from '@/components/containers/dialog';
import { ErrorText } from '@/components/controls/inputs';
import { disconnectAction, type DisconnectState } from './actions';

const DISCONNECT_INITIAL: DisconnectState = { error: null };

export function DisconnectForm({
  organizationId,
  connectionId,
}: {
  organizationId: string;
  connectionId: string;
}) {
  const [state, formAction, pending] = useActionState(disconnectAction, DISCONNECT_INITIAL);
  const formId = `disconnect-${connectionId}`;

  return (
    <form id={formId} action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="connectionId" value={connectionId} />
      <ConfirmSubmit
        formId={formId}
        label="Disconnect"
        confirmLabel="Disconnect this connection?"
        description="GOLD stops using it. Every customer already imported through it stays exactly as it is — nothing is deleted."
        tone="secondary"
        size="small"
        pending={pending}
      />
      <ErrorText>{state.error}</ErrorText>
    </form>
  );
}

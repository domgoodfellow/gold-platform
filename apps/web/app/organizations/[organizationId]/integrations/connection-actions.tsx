'use client';

import { useActionState } from 'react';
import { ConfirmSubmit } from '@/components/containers/dialog';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { checkConnectionAction, disconnectAction, type CheckState, type DisconnectState } from './actions';

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

const CHECK_INITIAL: CheckState = { error: null, checked: false };

export function CheckConnectionForm({ organizationId, connectionId }: { organizationId: string; connectionId: string }) {
  const [state, formAction, pending] = useActionState(checkConnectionAction, CHECK_INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="connectionId" value={connectionId} />
      <Button type="submit" tone="secondary" size="small" disabled={pending}>
        {pending ? 'Checking…' : 'Check connection'}
      </Button>
      <ErrorText role="alert">{state.error}</ErrorText>
      {state.checked ? <Hint role="status">Checked.</Hint> : null}
    </form>
  );
}

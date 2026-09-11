'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText } from '@/components/controls/inputs';
import { connectCsvAction, type ConnectState } from './actions';

const CONNECT_INITIAL: ConnectState = { error: null };

export function ConnectCsvForm({
  organizationId,
  alreadyConnected,
}: {
  organizationId: string;
  alreadyConnected: boolean;
}) {
  const [state, formAction, pending] = useActionState(connectCsvAction, CONNECT_INITIAL);

  if (alreadyConnected) {
    return (
      <Button type="button" tone="primary" size="small" disabled>
        Connected
      </Button>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />
      <Button type="submit" tone="primary" size="small" disabled={pending}>
        {pending ? 'Connecting…' : 'Connect'}
      </Button>
      <ErrorText>{state.error}</ErrorText>
    </form>
  );
}

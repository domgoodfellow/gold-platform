'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, FieldLabel, TextInput } from '@/components/controls/inputs';
import { acceptInvitationAction, type AcceptInvitationState } from './actions';

const INITIAL: AcceptInvitationState = { error: null };

export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(acceptInvitationAction, INITIAL);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="displayName">Name in this business (optional)</FieldLabel>
        <TextInput id="displayName" name="displayName" type="text" maxLength={120} autoFocus />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? 'Joining…' : 'Accept invitation'}
      </Button>
      <ErrorText role="alert">{state.error}</ErrorText>
    </form>
  );
}

'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import {
  requestSendingDomainAction,
  type EmailDomainState,
} from '@/app/organizations/[organizationId]/comms/configuration/email/actions';

const INITIAL: EmailDomainState = { error: null, notice: null, done: false };

/**
 * A business naming its own sending domain. Nothing here proposes one, and nothing here promises
 * what verifying it will do beyond what it does: authorize mail *from* addresses at that domain.
 *
 * Submitting both records the name and asks the provider for it, so a person is never left with a
 * row that was typed but never requested — the state they land on is the provider's own answer.
 */
export function AddSendingDomainForm({ organizationId }: { organizationId: string }) {
  const [state, run, pending] = useActionState(requestSendingDomainAction, INITIAL);

  return (
    <form action={run} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="flex flex-wrap items-center gap-3">
        <TextInput
          name="domain"
          type="text"
          required
          autoComplete="off"
          placeholder="mail.yourbusiness.com"
          aria-label="Sending domain"
          className="w-full max-w-72"
        />
        <Button type="submit" disabled={pending}>
          {pending ? 'Setting up…' : 'Set up sending domain'}
        </Button>
      </div>
      <Hint>
        A subdomain you do not use for anything else — <span className="font-mono text-xs">mail.</span> or{' '}
        <span className="font-mono text-xs">send.</span> — keeps this separate from the rest of your DNS.
      </Hint>
      {state.error ? <ErrorText>{state.error}</ErrorText> : null}
    </form>
  );
}

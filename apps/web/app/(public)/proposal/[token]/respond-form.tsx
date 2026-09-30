'use client';

import { useActionState } from 'react';
import { Button } from '@/components/controls/button';
import { FormError } from '@/components/controls/form';
import { acceptProposalAction, declineProposalAction, type RespondToProposalState } from './actions';

const INITIAL: RespondToProposalState = { error: null };

export function RespondForm({
  token,
  proposalId,
}: {
  token: string;
  proposalId: string;
}) {
  const [acceptState, acceptFormAction, acceptPending] = useActionState(acceptProposalAction, INITIAL);
  const [declineState, declineFormAction, declinePending] = useActionState(declineProposalAction, INITIAL);

  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <form action={acceptFormAction}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="proposalId" value={proposalId} />
          <Button type="submit" disabled={acceptPending || declinePending}>
            {acceptPending ? 'Accepting…' : 'Accept'}
          </Button>
        </form>
        <form action={declineFormAction}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="proposalId" value={proposalId} />
          <Button type="submit" tone="secondary" disabled={acceptPending || declinePending}>
            {declinePending ? 'Declining…' : 'Decline'}
          </Button>
        </form>
      </div>
      <FormError>{acceptState.error}</FormError>
      <FormError>{declineState.error}</FormError>
    </div>
  );
}

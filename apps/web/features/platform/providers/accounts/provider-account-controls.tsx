'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ErrorText } from '@/components/controls/inputs';
import {
  makeProviderAccountDefaultAction,
  setProviderAccountStatusAction,
  verifyProviderAccountAction,
} from '@/app/platform/providers/[providerKey]/actions';
import type { AccountCommandState } from '@/app/platform/providers/[providerKey]/action-states';

const INITIAL: AccountCommandState = { error: null, done: false };

/** One account-scoped command: a hidden id, a button, the refusal in words, a toast on success. */
function useCommand(action: typeof verifyProviderAccountAction, success: string) {
  const [state, run, pending] = useActionState(action, INITIAL);
  useEffect(() => {
    if (state.done) toast.success(success);
  }, [state, success]);
  return { state, run, pending };
}

export function VerifyProviderAccountButton({ accountId }: { accountId: string }) {
  const { state, run, pending } = useCommand(verifyProviderAccountAction, 'The provider accepted this credential.');
  return (
    <form action={run} className="flex flex-col gap-1">
      <input type="hidden" name="accountId" value={accountId} />
      <Button type="submit" tone="secondary" size="small" className="w-fit" disabled={pending}>
        {pending ? 'Verifying…' : 'Verify connection'}
      </Button>
      <ErrorText>{state.error}</ErrorText>
    </form>
  );
}

export function MakeProviderAccountDefaultButton({ accountId }: { accountId: string }) {
  const { state, run, pending } = useCommand(makeProviderAccountDefaultAction, 'Default account changed.');
  return (
    <form action={run} className="flex flex-col gap-1">
      <input type="hidden" name="accountId" value={accountId} />
      <Button type="submit" tone="secondary" size="small" className="w-fit" disabled={pending}>
        Make default
      </Button>
      <ErrorText>{state.error}</ErrorText>
    </form>
  );
}

/**
 * Disabling stops new use of an account. Confirmed in place, and it says out loud what it does not
 * touch — an existing runtime assignment naming this account keeps naming it, and answering
 * through it fails honestly rather than silently, exactly as `app.ai.runtime` promises.
 */
export function ProviderAccountStatusControl({ accountId, status }: { accountId: string; status: 'active' | 'disabled' }) {
  const [confirming, setConfirming] = useState(false);
  const { state, run, pending } = useCommand(
    setProviderAccountStatusAction,
    status === 'active' ? 'Account disabled.' : 'Account enabled.',
  );
  const next = status === 'active' ? 'disabled' : 'active';

  if (status === 'disabled') {
    return (
      <form action={run} className="flex flex-col gap-1">
        <input type="hidden" name="accountId" value={accountId} />
        <input type="hidden" name="status" value={next} />
        <Button type="submit" tone="secondary" size="small" className="w-fit" disabled={pending}>
          Enable account
        </Button>
        <ErrorText>{state.error}</ErrorText>
      </form>
    );
  }

  return (
    <form action={run} className="flex flex-col gap-2">
      <input type="hidden" name="accountId" value={accountId} />
      <input type="hidden" name="status" value={next} />
      {confirming ? (
        <>
          <p className="text-sm text-muted">
            Any AI runtime assignment naming this account keeps naming it, and will fail rather than
            silently answer through another provider.
          </p>
          <div className="flex gap-2">
            <Button type="submit" tone="danger" size="small" disabled={pending}>Confirm disable</Button>
            <Button type="button" tone="secondary" size="small" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </>
      ) : (
        <Button type="button" tone="danger" size="small" className="w-fit" onClick={() => setConfirming(true)}>
          Disable account
        </Button>
      )}
      <ErrorText>{state.error}</ErrorText>
    </form>
  );
}

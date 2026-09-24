'use client';

import { ErrorText, Hint } from '@/components/controls/inputs';
import { Button } from '@/components/controls/button';
import { useActionState } from 'react';
import { disconnectPaymentAccountAction } from '@/app/organizations/[organizationId]/settings/actions';

/**
 * Where this business is paid.
 *
 * **The connect side is a link, not a form**, and that is the design rather than a shortcut: an
 * account id comes back from the provider, authenticated with the platform's own key, and is
 * never typed. Disconnecting is a form because it is a write this application performs itself.
 */
export function PaymentAccountRow({
  organizationId,
  provider,
  accountId,
  connectedAt,
  mayManage,
}: {
  organizationId: string;
  provider: string;
  accountId: string | null;
  connectedAt: string | null;
  mayManage: boolean;
}) {
  const [state, formAction, pending] = useActionState(disconnectPaymentAccountAction, {
    error: null,
  });

  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {accountId ? 'Connected' : 'Not connected'}
          {connectedAt ? (
            <span className="ml-2 font-normal text-subtle">
              since {new Date(connectedAt).toLocaleDateString('en-GB')}
            </span>
          ) : null}
        </p>
        <Hint>
          {accountId
            ? // The id, because an operator with two accounts needs to know which one this is.
              // It is not a secret: on its own it grants nothing.
              `Card payments are collected into ${accountId} and paid out by ${provider} directly to this business. GOLD never holds the money.`
            : `Connect an account with ${provider} to take card payments. The money goes straight to this business; GOLD never holds it, and this business keeps its own login.`}
        </Hint>
        <ErrorText role="alert" className="mt-1">{state.error}</ErrorText>
      </div>

      {!mayManage ? null : accountId ? (
        <form action={formAction} className="shrink-0">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="provider" value={provider} />
          <Button type="submit" disabled={pending} tone="secondary" size="small">
            {pending ? '…' : 'Disconnect'}
          </Button>
        </form>
      ) : (
        <a
          href={`/organizations/${organizationId}/settings/payments/connect`}
          className="shrink-0 rounded border border-border px-3 py-1.5 text-sm"
        >
          Connect
        </a>
      )}
    </div>
  );
}

'use client';

import { useActionState, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@gold/ui/components/alert';
import { Button } from '@/components/controls/button';
import { ErrorText } from '@/components/controls/inputs';
import {
  makeDefaultAccountAction,
  reconcileTelephonyAction,
  setAccountStatusAction,
  verifyTelephonyAccountAction,
} from '@/app/organizations/[organizationId]/platform/providers/twilio/actions';
import { ACCOUNT_COMMAND_INITIAL, RECONCILE_INITIAL } from '@/app/organizations/[organizationId]/platform/providers/twilio/action-states';

/** One account-scoped command: a hidden id, a button, the refusal in words, a toast on success. */
function useCommand(action: typeof verifyTelephonyAccountAction, success: string) {
  const [state, run, pending] = useActionState(action, ACCOUNT_COMMAND_INITIAL);
  useEffect(() => {
    if (state.done) toast.success(success);
  }, [state, success]);
  return { state, run, pending };
}

export function VerifyAccountButton({ accountId }: { accountId: string }) {
  const { state, run, pending } = useCommand(verifyTelephonyAccountAction, 'The provider accepted this credential.');
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

export function MakeDefaultButton({ accountId }: { accountId: string }) {
  const { state, run, pending } = useCommand(makeDefaultAccountAction, 'Default account changed.');
  return (
    <form action={run} className="flex flex-col gap-1">
      <input type="hidden" name="accountId" value={accountId} />
      <Button type="submit" tone="secondary" size="small" className="w-fit" disabled={pending}>Make default</Button>
      <ErrorText>{state.error}</ErrorText>
    </form>
  );
}

/**
 * Disabling stops new provisioning under an account. It is confirmed in place because it changes
 * what every later provisioning does, and it says out loud what it does not touch.
 */
export function AccountStatusControl({ accountId, status }: { accountId: string; status: 'active' | 'disabled' }) {
  const [confirming, setConfirming] = useState(false);
  const { state, run, pending } = useCommand(
    setAccountStatusAction,
    status === 'active' ? 'Account disabled.' : 'Account enabled.',
  );
  const next = status === 'active' ? 'disabled' : 'active';

  if (status === 'disabled') {
    return (
      <form action={run} className="flex flex-col gap-1">
        <input type="hidden" name="accountId" value={accountId} />
        <input type="hidden" name="status" value={next} />
        <Button type="submit" tone="secondary" size="small" className="w-fit" disabled={pending}>Enable account</Button>
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
            No new organization can be provisioned under this account. Existing organizations, their
            subaccounts and their numbers are left exactly as they are.
          </p>
          <div className="flex gap-2">
            <Button type="submit" tone="danger" size="small" disabled={pending}>Confirm disable</Button>
            <Button type="button" tone="secondary" size="small" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </>
      ) : (
        <Button type="button" tone="danger" size="small" className="w-fit" onClick={() => setConfirming(true)}>Disable account</Button>
      )}
      <ErrorText>{state.error}</ErrorText>
    </form>
  );
}

const HEALTH_LABEL: Record<string, string> = {
  in_sync: 'in sync',
  remote_missing: 'missing at the provider',
  remote_changed: 'changed at the provider',
  unchecked: 'not compared',
  not_provisioned: 'not provisioned',
  provisioning: 'provisioning',
  failed: 'failed',
  suspended: 'suspended',
};

/** Compares GOLD's records with the provider. Reports; repairs, adopts and deletes nothing. */
export function ReconcileControl({
  accountId,
  organizationNames,
}: {
  accountId: string;
  organizationNames: Record<string, string>;
}) {
  const [state, run, pending] = useActionState(reconcileTelephonyAction, RECONCILE_INITIAL);
  const attention = state.findings.length + state.unmanaged.length;

  return (
    <div className="flex flex-col gap-3">
      <form action={run} className="flex items-center gap-3">
        <input type="hidden" name="accountId" value={accountId} />
        <Button type="submit" tone="secondary" size="small" disabled={pending}>
          {pending ? 'Reconciling…' : 'Reconcile with provider'}
        </Button>
        {state.checkedAt ? (
          <span className="text-sm text-muted">
            {Object.entries(state.counts)
              .map(([key, n]) => `${n} ${HEALTH_LABEL[key] ?? key}`)
              .join(' · ')}
          </span>
        ) : null}
      </form>
      <ErrorText>{state.error}</ErrorText>
      {state.checkedAt && attention === 0 ? (
        <Alert>
          <AlertTitle>Nothing needs attention</AlertTitle>
          <AlertDescription>
            Every active subaccount GildOps expects exists, and the provider holds none GildOps does not know.
          </AlertDescription>
        </Alert>
      ) : null}
      {state.findings.length > 0 ? (
        <Alert variant="destructive">
          <AlertTitle>Organizations that differ from the provider</AlertTitle>
          <AlertDescription>
            <ul className="mt-1 list-disc pl-4">
              {state.findings.map((finding) => (
                <li key={finding.organizationId}>
                  {organizationNames[finding.organizationId] ?? finding.organizationId}: {HEALTH_LABEL[finding.health]}
                  {finding.detail ? ` — ${finding.detail}` : ''}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {state.unmanaged.length > 0 ? (
        <Alert>
          <AlertTitle>Subaccounts GildOps has no record of</AlertTitle>
          <AlertDescription>
            <p>Reported only. GildOps does not adopt or close these; decide what each is at the provider.</p>
            <ul className="mt-1 list-disc pl-4">
              {state.unmanaged.map((row) => (
                <li key={row.sid}>
                  <span className="font-mono text-xs">{row.sid}</span>
                  {row.friendlyName ? ` “${row.friendlyName}”` : ''}
                  {row.status ? ` (${row.status})` : ''}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

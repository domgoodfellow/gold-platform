'use client';

import { useActionState, useEffect, useId } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ErrorText } from '@/components/controls/inputs';
import { ConfirmSubmit } from '@/components/containers/dialog';
import {
  recheckDomainAction,
  removeDomainAction,
  setPrimaryDomainAction,
  type DomainCommandState,
} from '@/app/organizations/[organizationId]/settings/domains/actions';

const INITIAL: DomainCommandState = { error: null, done: false };

function useCommand(action: typeof recheckDomainAction, success: string) {
  const [state, run, pending] = useActionState(action, INITIAL);
  useEffect(() => {
    if (state.done) toast.success(success);
  }, [state, success]);
  return { state, run, pending };
}

/** Recheck, make primary, and remove — each a form with the ids hidden in it, the refusal in words. */
export function DomainRowActions({
  organizationId,
  domainId,
  hostname,
  canRecheck,
  canMakePrimary,
}: {
  organizationId: string;
  domainId: string;
  hostname: string;
  canRecheck: boolean;
  canMakePrimary: boolean;
}) {
  const recheck = useCommand(recheckDomainAction, 'Checked with the hosting provider.');
  const primary = useCommand(setPrimaryDomainAction, `${hostname} is now the primary domain.`);
  const remove = useCommand(removeDomainAction, `${hostname} removed.`);
  const removeFormId = `remove-domain-${useId().replace(/:/g, '')}`;

  const hidden = (
    <>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="domainId" value={domainId} />
    </>
  );

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {canRecheck ? (
          <form action={recheck.run}>
            {hidden}
            <Button type="submit" tone="secondary" size="small" disabled={recheck.pending}>
              {recheck.pending ? 'Checking…' : 'Check again'}
            </Button>
          </form>
        ) : null}
        {canMakePrimary ? (
          <form action={primary.run}>
            {hidden}
            <Button type="submit" tone="secondary" size="small" disabled={primary.pending}>Make primary</Button>
          </form>
        ) : null}
        <form id={removeFormId} action={remove.run}>
          {hidden}
        </form>
        <ConfirmSubmit
          formId={removeFormId}
          label="Remove"
          confirmLabel="Remove domain"
          description={`${hostname} stops opening your site, and anybody may connect it afterwards. Your DNS records are not changed.`}
          pending={remove.pending}
          ariaLabel={`Remove ${hostname}`}
        />
      </div>
      <ErrorText>{recheck.state.error ?? primary.state.error ?? remove.state.error}</ErrorText>
    </div>
  );
}

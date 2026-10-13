'use client';

import { useActionState, useEffect, useId } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import { ErrorText, Hint } from '@/components/controls/inputs';
import {
  applySendingDomainDnsAction,
  checkSendingDomainAction,
  releaseSendingDomainAction,
  requestSendingDomainAction,
  type EmailDomainState,
} from '@/app/organizations/[organizationId]/comms/configuration/email/actions';

const INITIAL: EmailDomainState = { error: null, notice: null, done: false };

function useCommand(action: typeof checkSendingDomainAction, success: string) {
  const [state, run, pending] = useActionState(action, INITIAL);
  useEffect(() => {
    if (state.done && !state.notice) toast.success(success);
  }, [state, success]);
  return { state, run, pending };
}

function notice(...states: EmailDomainState[]): string | null {
  return states.find((state) => state.notice)?.notice ?? null;
}

/**
 * Check verification, apply (only when this business's own connected DNS can publish what is
 * outstanding), start setup (for a domain the provider has never been asked about), and remove —
 * each a form with the ids hidden in it, the refusal in words.
 *
 * **Apply is never the default and never automatic.** It appears only once the records are
 * already on the page to read, which is the review this platform owes somebody before it writes
 * to DNS it does not own. A record it could not prove it owns comes back as a notice rather than
 * a success, because a toast saying "published" over a conflict it refused would be the one lie
 * this whole screen exists to avoid.
 */
export function SendingDomainActions({
  organizationId,
  resourceId,
  domain,
  canStart,
  canApply,
}: {
  organizationId: string;
  resourceId: string;
  domain: string;
  canStart: boolean;
  canApply: boolean;
}) {
  const check = useCommand(checkSendingDomainAction, `Checked ${domain} with the email provider.`);
  const apply = useCommand(applySendingDomainDnsAction, `Published DNS for ${domain}.`);
  const start = useCommand(requestSendingDomainAction, `Set up ${domain} with the email provider.`);
  const remove = useCommand(releaseSendingDomainAction, `${domain} removed.`);
  const removeFormId = `release-sending-domain-${useId().replace(/:/g, '')}`;

  const hidden = (
    <>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="resourceId" value={resourceId} />
    </>
  );

  return (
    <div className="flex w-full flex-col items-stretch gap-1 @min-[38rem]:items-end">
      <div className="flex flex-wrap gap-2 @min-[38rem]:justify-end">
        {canStart ? (
          <form action={start.run}>
            {hidden}
            {/* The name is what `record_organization_email_domain` keys on, so re-requesting the
                same one resumes this row rather than making a second. */}
            <input type="hidden" name="domain" value={domain} />
            <Button type="submit" size="small" disabled={start.pending}>
              {start.pending ? 'Starting…' : 'Start setup'}
            </Button>
          </form>
        ) : (
          <form action={check.run}>
            {hidden}
            <Button type="submit" tone="secondary" size="small" disabled={check.pending}>
              {check.pending ? 'Checking…' : 'Check verification'}
            </Button>
          </form>
        )}
        {canApply ? (
          <form action={apply.run}>
            {hidden}
            <Button type="submit" size="small" disabled={apply.pending}>
              {apply.pending ? 'Publishing…' : 'Apply and verify'}
            </Button>
          </form>
        ) : null}
        <form id={removeFormId} action={remove.run}>
          {hidden}
        </form>
        <ConfirmSubmit
          formId={removeFormId}
          label="Remove"
          confirmLabel="Remove domain"
          description={`${domain} stops being authorized for sending, and the email provider forgets it. Your DNS records are not changed.`}
          pending={remove.pending}
          ariaLabel={`Remove ${domain}`}
        />
      </div>
      <ErrorText>{check.state.error ?? apply.state.error ?? start.state.error ?? remove.state.error}</ErrorText>
      {notice(apply.state, check.state) ? (
        <Hint className="text-left @min-[38rem]:text-right">{notice(apply.state, check.state)}</Hint>
      ) : null}
    </div>
  );
}

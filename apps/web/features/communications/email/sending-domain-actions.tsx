'use client';

import { useActionState, useEffect, useId } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/controls/button';
import { ConfirmSubmit } from '@/components/controls/confirm-submit';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { cx } from '@/components/class-names';
import {
  applySendingDomainDnsAction,
  checkSendingDomainAction,
  releaseSendingDomainAction,
  requestSendingDomainAction,
  type EmailDomainState,
} from '@/app/organizations/[organizationId]/settings/email/actions';
import type { DomainCheckResult } from '@/lib/domain/email/sending-domains';

const INITIAL: EmailDomainState = { error: null, notice: null, done: false };

/** Runs a command; a toast confirms it only when `done` is true and nothing needs reading. */
function useCommand(action: typeof checkSendingDomainAction, success: string) {
  const [state, run, pending] = useActionState(action, INITIAL);
  useEffect(() => {
    if (state.done && !state.notice) toast.success(success);
  }, [state, success]);
  return { state, run, pending };
}

const RESULT_TONE: Record<DomainCheckResult['kind'], string> = {
  verified: 'text-success',
  pending: '',
  records_missing: 'text-danger',
  provider_unavailable: '',
  provider_error: 'text-danger',
  rejected: 'text-danger',
};

/** A time as a sentence ends it: some locales already end it with a full stop (p.m.). */
function time(value: string): string {
  const text = new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return text.endsWith('.') ? text : `${text}.`;
}

/**
 * Check verification (or Start setup, for a domain the provider has never been asked about),
 * Apply and verify (only when this business's own connected DNS can publish what is outstanding),
 * and Remove — each a form with the ids hidden in it.
 *
 * **A check reports what the provider said, on the domain itself.** Only a verified domain is
 * confirmed with a toast; a pending one says how many records are outstanding and when it was
 * checked, so pressing the button never reads as success when nothing was verified. Apply is
 * never automatic and appears only beside the records it would publish.
 */
export function SendingDomainActions({
  organizationId,
  resourceId,
  domain,
  canStart,
  canCheck = true,
  canApply,
}: {
  organizationId: string;
  resourceId: string;
  domain: string;
  canStart: boolean;
  /** False once verified: there is nothing left to check. */
  canCheck?: boolean;
  canApply: boolean;
}) {
  const check = useCommand(checkSendingDomainAction, `${domain} is verified.`);
  const apply = useCommand(applySendingDomainDnsAction, `${domain} is verified.`);
  const start = useCommand(requestSendingDomainAction, `Setting up ${domain}. Publish its DNS records next.`);
  const remove = useCommand(releaseSendingDomainAction, `${domain} removed.`);
  const removeFormId = `release-sending-domain-${useId().replace(/:/g, '')}`;
  // The latest answer from either way of asking the provider.
  const result = [check.state.result, apply.state.result]
    .filter((candidate): candidate is DomainCheckResult => Boolean(candidate))
    .sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0];
  const error = check.state.error ?? apply.state.error ?? start.state.error ?? remove.state.error;
  const notice = apply.state.notice;

  const hidden = (
    <>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="resourceId" value={resourceId} />
    </>
  );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
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
        ) : canCheck ? (
          <form action={check.run}>
            {hidden}
            <Button type="submit" tone={canApply ? 'secondary' : 'primary'} size="small" disabled={check.pending} aria-label={`Check verification for ${domain}`}>
              {check.pending ? 'Checking…' : 'Check verification'}
            </Button>
          </form>
        ) : null}
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
          tone="ghost"
          confirmLabel="Remove domain"
          description={`${domain} can no longer be used for sending. Your DNS records are not changed.`}
          pending={remove.pending}
          ariaLabel={`Remove ${domain}`}
        />
      </div>
      {result ? (
        <p role="status" className={cx('text-sm', RESULT_TONE[result.kind])}>
          {result.message} <span className="text-xs text-muted">Checked {time(result.checkedAt)}</span>
        </p>
      ) : null}
      {notice ? <Hint role="status">{notice}</Hint> : null}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

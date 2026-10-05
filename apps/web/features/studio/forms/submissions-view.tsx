'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { FORM_SOURCE_LABEL } from '@gold/schemas';
import { Button } from '@/components/controls/button';
import { ErrorText, Hint } from '@/components/controls/inputs';
import { customerCandidatesAction, linkSubmissionCustomerAction } from '@/app/organizations/[organizationId]/studio/forms/actions';
import { displayAnswer } from '@/features/forms/answer-display';
import { cx, FOCUS_RING } from '@/components/class-names';
import { EmptyState } from '@/components/surfaces/section';
import type { FormCustomerCandidate, FormSubmissionEntry, FormSubmissionsRead } from '@/lib/domain/forms/forms';

/**
 * Master and detail: who responded and when on one side, the answers on the other. Each response is
 * read against the revision it was answered under — so a question renamed or removed since still
 * reads as it was asked, and an answer to a field that no longer exists is still shown.
 */
/**
 * Who a response is about. A portal response already knows (the link said); any other is a response,
 * not a customer, until somebody with authority says so — and "who might it be" is CRM's own
 * matching rule, offered as candidates, never applied on its own.
 */
function CustomerLine({ organizationId, formId, submission }: { organizationId: string; formId: string; submission: FormSubmissionEntry }) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<FormCustomerCandidate[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const link = (customerId: string | null) => startTransition(async () => {
    setError(null);
    const result = await linkSubmissionCustomerAction({ organizationId, formId, submissionId: submission.id, customerId });
    if (result.error) setError(result.error);
    else { setCandidates(null); router.refresh(); }
  });

  if (submission.customerId) {
    return (
      <>
        <dt>Customer</dt>
        <dd>
          <Link href={`/organizations/${organizationId}/customers/${submission.customerId}`} className="underline underline-offset-4">{submission.customerName ?? 'Customer'}</Link>
          {submission.source !== 'portal' && submission.source !== 'booking' ? <Button tone="text" size="tiny" disabled={pending} onClick={() => link(null)}>Unlink</Button> : null}
        </dd>
      </>
    );
  }
  return (
    <>
      <dt>Customer</dt>
      <dd className="grid gap-1">
        <span>Not linked</span>
        {candidates === null ? (
          <span>
            <Button tone="secondary" size="tiny" disabled={pending} onClick={() => startTransition(async () => {
              const result = await customerCandidatesAction({ organizationId, submissionId: submission.id });
              if (result.error) setError(result.error); else setCandidates(result.candidates);
            })}>Find matching customers</Button>
          </span>
        ) : candidates.length === 0 ? (
          <Hint>No customer has this email address or phone number.</Hint>
        ) : (
          <ul className="grid gap-1">
            {candidates.map((candidate) => (
              <li key={candidate.id} className="flex items-center gap-2">
                <span>{candidate.name}</span>
                <Button tone="secondary" size="tiny" disabled={pending} onClick={() => link(candidate.id)}>Link</Button>
              </li>
            ))}
          </ul>
        )}
        <ErrorText role="alert">{error}</ErrorText>
      </dd>
    </>
  );
}

export function SubmissionsView({ organizationId, formId, formName, read }: { organizationId: string; formId: string; formName: string; read: FormSubmissionsRead }) {
  const [selectedId, setSelectedId] = useState<string | null>(read.submissions[0]?.id ?? null);
  const revisions = new Map(read.revisions.map((revision) => [revision.id, revision]));
  const selected = read.submissions.find((submission) => submission.id === selectedId) ?? null;
  const revision = selected ? revisions.get(selected.revisionId) : undefined;

  if (read.submissions.length === 0) {
    return <EmptyState title="No responses yet" description={`Responses to ${formName} appear here once someone submits the published form.`} />;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="rounded-lg border border-border bg-surface">
        <p className="border-b border-border px-3 py-2 text-xs text-subtle">
          {read.total} response{read.total === 1 ? '' : 's'}{read.total > read.submissions.length ? ` · showing the latest ${read.submissions.length}` : ''}
        </p>
        <ul aria-label="Responses" className="max-h-[70vh] divide-y divide-border overflow-y-auto">
          {read.submissions.map((submission) => (
            <li key={submission.id}>
              <button
                type="button"
                onClick={() => setSelectedId(submission.id)}
                aria-current={submission.id === selectedId ? 'true' : undefined}
                className={cx('block w-full px-3 py-2 text-left text-sm transition', FOCUS_RING, submission.id === selectedId ? 'bg-secondary' : 'hover:bg-secondary')}
              >
                <span className="block font-medium">{new Date(submission.submittedAt).toLocaleString()}</span>
                <span className="block truncate text-xs text-subtle">
                  Revision {revisions.get(submission.revisionId)?.number ?? '?'}
                  {' · '}
                  {displayAnswer(revisions.get(submission.revisionId)?.definition.fields[0], submission.answers[revisions.get(submission.revisionId)?.definition.fields[0]?.id ?? ''])}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selected && revision ? (
        <article aria-label="Response detail" className="rounded-lg border border-border bg-surface p-5">
          <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-muted">
            <dt>Submitted</dt><dd>{new Date(selected.submittedAt).toLocaleString()}</dd>
            <dt>Form</dt><dd>{formName}</dd>
            <dt>Revision</dt><dd>{revision.number}</dd>
            <dt>Source</dt><dd>{FORM_SOURCE_LABEL[selected.source]}</dd>
            {selected.bookingWorkItemId ? (
              <>
                <dt>Booking</dt>
                <dd><Link href={`/organizations/${organizationId}/work/${selected.bookingWorkItemId}`} className="underline underline-offset-4">Open the booking</Link></dd>
              </>
            ) : null}
            <CustomerLine key={selected.id} organizationId={organizationId} formId={formId} submission={selected} />
          </dl>
          <dl className="grid gap-4 border-t border-border pt-4">
            {revision.definition.fields.map((field) => (
              <div key={field.id}>
                <dt className="text-sm font-medium">{field.label}</dt>
                <dd className="mt-0.5 whitespace-pre-line text-sm">{displayAnswer(field, selected.answers[field.id])}</dd>
              </div>
            ))}
          </dl>
        </article>
      ) : null}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Mail, Paperclip } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextArea, TextInput } from '@/components/controls/inputs';
import { FormField } from '@/components/controls/form';
import { useGuardedDialogDirty } from '@/components/panels/guarded-dialog';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { ConfirmationPanel, RecordSummary } from '@/components/patterns/transaction-review';
import { invoiceEmailDraft, retryInvoiceEmailSend, sendInvoiceEmail, type InvoiceEmailDraft } from '@/app/organizations/[organizationId]/finance/actions';
import type { InvoiceEmailOutcome } from '@/lib/application/finance/send-invoice-email';
import type { InvoiceEmailState } from '@/lib/domain/billing/invoice-emails';
import { CancelButton, TransactionDialog, TransactionError } from '../transactions/transaction-dialog';

/**
 * Emailing an issued invoice from its inspector. The dialog shows what the database would use --
 * the business's own sender, the customer's own address and the invoice's recorded PDF -- and lets
 * the person word the subject and message; nothing else is theirs to choose. Status is reported as
 * it is: queued, accepted by the provider and delivered are different sentences, and only a
 * delivery the provider reported is called delivered.
 */

export const conversationHref = (organizationId: string, conversationId: string) => `/organizations/${organizationId}/comms/inbox/${conversationId}`;
const settingsHref = (organizationId: string) => `/organizations/${organizationId}/settings/email`;
const contactHref = (organizationId: string, customerId: string) => `/organizations/${organizationId}/crm/contacts/${customerId}`;

const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const TONE: Record<InvoiceEmailState, string> = {
  queued: 'border-border bg-surface',
  not_sent: 'border-warning/40 bg-warning/10',
  sending: 'border-border bg-surface',
  accepted: 'border-border bg-surface',
  delivered: 'border-success/30 bg-success/10',
  failed: 'border-danger/30 bg-danger/10',
};

/** One send's state in words, with no more confidence than the record holds. */
export function InvoiceEmailStatus({ state, label, detail, children }: { state: InvoiceEmailState; label: string; detail: string | null; children?: React.ReactNode }) {
  return <div role="status" data-email-state={state} className={`flex flex-col gap-2 rounded-[var(--visual-radius,0.625rem)] border p-3 text-sm ${TONE[state]}`}>
    <p className="font-semibold">{label}</p>
    {detail ? <p className="text-muted">{detail}</p> : null}
    {children ? <div className="flex flex-wrap gap-2">{children}</div> : null}
  </div>;
}

/** Try a send that has not left once more: the same message, never a second email. */
export function RetryInvoiceEmail({ organizationId, invoiceId, invoiceEmailId }: { organizationId: string; invoiceId: string; invoiceEmailId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [unsent, setUnsent] = useState<string | null>(null);
  return <>
    <Button type="button" tone="secondary" size="small" disabled={pending} onClick={() => start(async () => {
      setError(null); setUnsent(null);
      const result = await retryInvoiceEmailSend(organizationId, invoiceId, invoiceEmailId);
      if ('error' in result) setError(result.error);
      else if (result.outcome.state === 'not_sent') setUnsent(result.outcome.detail);
      else router.refresh();
    })}>{pending ? 'Sending…' : 'Try sending again'}</Button>
    {error ? <p role="alert" className="w-full text-xs text-danger">{error}</p> : null}
    {unsent ? <p className="w-full text-xs text-muted">Not sent: {unsent}</p> : null}
  </>;
}

export function SendInvoiceDialog({ organizationId, invoiceId, sendAgain, inboxOpen }: { organizationId: string; invoiceId: string; sendAgain: boolean; inboxOpen: boolean }) {
  return <TransactionDialog label={sendAgain ? 'Send again' : 'Send invoice'} icon={<Mail aria-hidden className="size-4" />} tone={sendAgain ? 'secondary' : 'primary'} size="small">
    {close => <SendInvoiceBody organizationId={organizationId} invoiceId={invoiceId} sendAgain={sendAgain} inboxOpen={inboxOpen} close={close} />}
  </TransactionDialog>;
}

function SendInvoiceBody({ organizationId, invoiceId, sendAgain, inboxOpen, close }: { organizationId: string; invoiceId: string; sendAgain: boolean; inboxOpen: boolean; close: () => void }) {
  const id = useId();
  const router = useRouter();
  const [draft, setDraft] = useState<InvoiceEmailDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InvoiceEmailOutcome | null>(null);
  const [pending, start] = useTransition();
  // One key per opening: submitting again after a failure is the same email, never a second one.
  const [key] = useState(() => globalThis.crypto.randomUUID());

  useEffect(() => {
    let live = true;
    void invoiceEmailDraft(organizationId, invoiceId).then(result => {
      if (!live) return;
      if ('error' in result) { setLoadError(result.error); return; }
      setDraft(result.draft); setSubject(result.draft.subject); setText(result.draft.text);
    });
    return () => { live = false; };
  }, [organizationId, invoiceId]);

  useGuardedDialogDirty(!outcome && !!draft && (subject !== draft.subject || text !== draft.text));

  const header = <StepHeader title={sendAgain ? 'Send this invoice again' : 'Send invoice'} description="The invoice’s PDF, from your business’s email address to the customer." />;
  if (loadError) return <>{header}<DialogBody><TransactionError error={loadError} /></DialogBody><DialogFooterBar><CancelButton label="Close" /></DialogFooterBar></>;
  if (!draft) return <>{header}<DialogBody><p role="status" className="text-sm text-muted">Preparing the email…</p></DialogBody><DialogFooterBar><CancelButton /></DialogFooterBar></>;

  const { preview } = draft;
  const sender = 'problem' in preview.sender ? null : preview.sender;
  const blocked = !sender || !preview.recipient.address || !preview.document;

  if (outcome) return <>{header}<DialogBody>
    <InvoiceEmailStatus state={outcome.state} label={outcome.label} detail={outcome.detail}>
      {inboxOpen ? <ButtonLink href={conversationHref(organizationId, outcome.conversationId)} tone="secondary" size="small">Open conversation</ButtonLink> : null}
    </InvoiceEmailStatus>
  </DialogBody><DialogFooterBar><Button type="button" tone="secondary" onClick={() => { close(); router.refresh(); }}>Close</Button></DialogFooterBar></>;

  const submit = () => start(async () => {
    setError(null);
    const result = await sendInvoiceEmail({ organizationId, invoiceId, recipient: preview.recipient.address ?? '', subject, text, idempotencyKey: key, sendAgain });
    if ('error' in result) setError(result.error); else setOutcome(result.outcome);
  });

  return <>{header}<DialogBody><div className="flex flex-col gap-4">
    <RecordSummary title={`Invoice #${draft.number}`} subtitle={draft.customer} facts={[
      { label: 'From', value: sender ? <span className="break-all">{sender.address}</span> : <span className="text-danger">Not set up</span> },
      { label: 'To', value: preview.recipient.address ? <span className="break-all">{preview.recipient.address}</span> : <span className="text-danger">No address</span> },
      { label: 'Amount', value: <span className="tabular-nums">{draft.amount}</span> },
    ]}>
      {preview.document
        ? <p className="flex items-center gap-2 text-muted"><Paperclip aria-hidden className="size-4 shrink-0" /><span className="break-all">{preview.document.fileName}</span><span className="tabular-nums">· {size(preview.document.sizeBytes)}</span></p>
        : <p className="text-danger">This invoice has no PDF yet. Create it from the invoice first.</p>}
      {preview.recipient.address && preview.recipient.confirmedByCustomer ? <p className="text-xs text-muted">The customer confirmed this address through the portal.</p> : null}
    </RecordSummary>
    {!sender ? <p role="alert" className="text-sm text-danger">{'problem' in preview.sender ? preview.sender.problem : ''} <Link className="underline underline-offset-4" href={settingsHref(organizationId)}>Open Settings → Email</Link></p> : null}
    {preview.recipient.problem ? <p role="alert" className="text-sm text-danger">{preview.recipient.problem}{preview.recipient.customerId ? <> <Link className="underline underline-offset-4" href={contactHref(organizationId, preview.recipient.customerId)}>Open the contact record</Link></> : null}</p> : null}
    {sendAgain ? <ConfirmationPanel tone="caution" title="This invoice was emailed before" statement="Sending it again emails the customer a second time, with the same PDF. It is recorded as a separate send." /> : null}
    <FormField id={`${id}-subject`} label="Subject">{field => <TextInput {...field} value={subject} onChange={event => setSubject(event.target.value)} maxLength={300} required disabled={blocked} />}</FormField>
    <FormField id={`${id}-message`} label="Message">{field => <TextArea {...field} value={text} onChange={event => setText(event.target.value)} rows={7} maxLength={10000} required disabled={blocked} />}</FormField>
    <TransactionError error={error} />
  </div></DialogBody>
  <DialogFooterBar>
    <CancelButton />
    <Button type="button" tone="primary" disabled={blocked || pending || !subject.trim() || !text.trim()} onClick={submit}><Mail aria-hidden className="size-4" />{pending ? 'Sending…' : sendAgain ? 'Send again' : 'Send invoice'}</Button>
  </DialogFooterBar></>;
}

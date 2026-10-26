'use client';

import { useId, useState } from 'react';
import { FileText } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { FormField } from '@/components/controls/form';
import { useGuardedDialogDirty } from '@/components/panels/guarded-dialog';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { ConfirmationPanel, LineItems, MoneyTotals, RecordPicker, RecordSummary, TransactionResult } from '@/components/patterns/transaction-review';
import { priceWorkItem } from '@/lib/domain/pricing/prices';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import type { FinanceActionState } from '@/app/organizations/[organizationId]/finance/actions';
import { CancelButton, TransactionDialog, TransactionError, type TransactionTriggerProps } from './transaction-dialog';
import { choiceStatus, useFinanceRecord, useFinanceSubmit } from './use-finance-record';
import { lineItem } from './quote-dialog';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const readable = (day: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`));

/**
 * Issue an invoice from priced Work, in two deliberate steps: review what the invoice will hold
 * (contact, lines, total, dates), then confirm. Issuance is the existing `issue_invoice`: it numbers
 * the invoice, freezes its lines and refuses a second invoice for the same Work. The server also
 * refuses an issue that did not come through the confirmation step.
 */
export function InvoiceDialog({ organizationId, workItemId, tone, size, initiallyOpen, label = 'New invoice', ariaLabel, open, onOpenChange, trigger, today }: TransactionTriggerProps & { today: string }) {
  return <TransactionDialog label={label} icon={<FileText aria-hidden className="size-4" />} tone={tone} size={size} initiallyOpen={initiallyOpen} ariaLabel={ariaLabel} open={open} onOpenChange={onOpenChange} trigger={trigger}>
    {close => <InvoiceBody organizationId={organizationId} workItemId={workItemId} today={today} close={close} />}
  </TransactionDialog>;
}

function InvoiceBody({ organizationId, workItemId, today, close }: { organizationId: string; workItemId?: string; today: string; close: () => void }) {
  const id = useId();
  const record = useFinanceRecord(organizationId, 'invoice', workItemId);
  const [issuedAt, setIssuedAt] = useState(today);
  const [dueAt, setDueAt] = useState('');
  const [step, setStep] = useState<'review' | 'confirm'>('review');
  const [done, setDone] = useState<FinanceActionState | null>(null);
  // A refusal returns to the review, where the reason and the dates can be seen together.
  const { state, pending, submit, errorRef } = useFinanceSubmit(result => { if (result.success) { setDone(result); record.reload(); } else if (result.error) setStep('review'); });
  const { review } = record;
  useGuardedDialogDirty(!done && (issuedAt !== today || dueAt !== '' || step === 'confirm'));
  const total = review ? priceWorkItem(review.lines) : null;
  const contact = review?.work.customer?.label ?? 'No contact';
  const dateProblem = !ISO.test(issuedAt) ? 'Enter the invoice date.' : dueAt && !ISO.test(dueAt) ? 'Enter a valid due date.' : dueAt && dueAt < issuedAt ? 'The due date must be on or after the invoice date.' : null;
  const eligible = Boolean(review && !review.invoice && total);
  const base = `/organizations/${organizationId}`;
  return <>
    <StepHeader title="New invoice" steps={done ? undefined : ['Review', 'Confirm']} current={step === 'review' ? 0 : 1} />
    <DialogBody><div className="flex flex-col gap-4">
      {!record.fixed && !record.selected && !done ? <RecordPicker legend="Priced Work to invoice" search={{ value: record.q, onChange: record.setQ, label: 'Search priced Work', placeholder: 'Work title or contact' }}
        choices={(record.choices?.rows ?? []).map(row => ({ id: row.id, title: row.title, detail: row.detail, meta: row.meta }))} selected={record.selected} onSelect={record.choose}
        status={choiceStatus(record.searching, record.choices, 'priced Work items')}
        empty={record.choices && !record.searching && !record.q ? <p className="text-sm">No priced Work is waiting to be invoiced. Add priced lines to a Work item first.</p> : null} /> : null}
      {record.selected && !review ? <p role="status" className="text-sm text-muted">{record.loadingReview ? 'Loading Work item…' : ''}</p> : null}
      {done ? <TransactionResult title={done.record ? `${done.record} issued` : done.success} detail={`${contact}${total ? ` · ${formatMoney(total.totalMinor, total.currency)}` : ''}`} actions={<ButtonLink size="small" tone="secondary" href={done.href!}>Open invoice</ButtonLink>} />
        : review && step === 'review' ? <>
          <RecordSummary title={review.work.title} subtitle={contact} action={!record.fixed ? <Button type="button" tone="text" size="small" onClick={() => record.choose('')}>Change</Button> : null}
            facts={total ? [{ label: 'Currency', value: total.currency }, { label: 'Lines', value: review.lines.length }] : []}>
            <LineItems label="Invoice lines" items={review.lines.map(line => lineItem(line))} empty="Nothing is priced on this Work." />
            {total ? <MoneyTotals label="Invoice total" rows={[{ label: 'Invoice total', value: formatMoney(total.totalMinor, total.currency), emphasis: true }]} /> : null}
          </RecordSummary>
          {review.invoice ? <div className="flex flex-col items-start gap-2 text-sm"><p>This Work is already invoiced as #{review.invoice.number}. A Work item has one invoice.</p><ButtonLink size="small" tone="secondary" href={`${base}/work/${review.work.id}?tab=financials`}>Open invoice #{review.invoice.number}</ButtonLink></div>
            : !total ? <div className="flex flex-col items-start gap-2 text-sm"><p>Add priced lines to this Work before invoicing it.</p><ButtonLink size="small" tone="secondary" href={`${base}/work/${review.work.id}?tab=financials`}>Open Work financials</ButtonLink></div>
            : <div className="grid gap-3 sm:grid-cols-2">
              <FormField id={`${id}-issued`} label="Invoice date">{field => <TextInput {...field} type="date" value={issuedAt} onChange={event => setIssuedAt(event.target.value)} required />}</FormField>
              <FormField id={`${id}-due`} label="Due date" optional>{field => <TextInput {...field} type="date" value={dueAt} min={ISO.test(issuedAt) ? issuedAt : undefined} onChange={event => setDueAt(event.target.value)} />}</FormField>
              {dateProblem ? <p className="text-xs text-danger sm:col-span-2">{dateProblem}</p> : null}
            </div>}
        </> : review && total ? <ConfirmationPanel title={`Issue invoice to ${contact}?`}
          statement={<><strong className="tabular-nums">{formatMoney(total.totalMinor, total.currency)}</strong> for {review.work.title}, dated {readable(issuedAt)}{dueAt ? `, due ${readable(dueAt)}` : ', with no due date'}.</>}
          consequences={['The invoice is numbered, and its lines and prices are fixed once issued.', 'Payments and corrections are recorded against it afterwards; the invoice itself is not edited.']} /> : null}
      <TransactionError error={state.error} errorRef={errorRef} />
    </div></DialogBody>
    <DialogFooterBar>
      {done ? <Button type="button" onClick={close}>Done</Button>
        : step === 'review' ? <><Button type="button" disabled={!eligible || Boolean(dateProblem)} onClick={() => setStep('confirm')}>Continue</Button><CancelButton /></>
        : <><Button type="button" disabled={pending || !eligible} onClick={() => review && submit({ organizationId, kind: 'invoice', workItemId: review.work.id, issuedAt, dueAt, confirmed: '1' })}>{pending ? 'Issuing…' : 'Issue invoice'}</Button><Button type="button" tone="secondary" disabled={pending} onClick={() => setStep('review')}>Back</Button></>}
    </DialogFooterBar>
  </>;
}

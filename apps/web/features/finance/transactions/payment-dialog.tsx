'use client';

import { useId, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { FieldLabel, TextInput } from '@/components/controls/inputs';
import { FormField } from '@/components/controls/form';
import { Checkbox } from '@gold/ui/components/checkbox';
import { useGuardedDialogDirty } from '@/components/panels/guarded-dialog';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { ChoiceRow, ConfirmationPanel, LineItems, MoneyTotals, RecordPicker, RecordSummary, TransactionResult } from '@/components/patterns/transaction-review';
import { invoiceStanding } from '@/lib/domain/billing/invoices';
import { parseMoneyInput } from '@/lib/domain/pricing/money-input';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { financePaymentReview, type FinanceActionState } from '@/app/organizations/[organizationId]/finance/actions';
import { CancelButton, TransactionDialog, TransactionError, type TransactionTriggerProps } from './transaction-dialog';
import { choiceStatus, useFinanceRecord, useFinanceSubmit } from './use-finance-record';

type Entry = 'receipt' | 'correction';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function amountMinor(raw: string, currency: string): number | null {
  try { const minor = parseMoneyInput(raw, currency); return minor > 0 ? minor : null; } catch { return null; }
}

/**
 * Record money against an issued invoice, by hand. A receipt adds a positive entry; a correction or
 * refund adds a negative one after its own confirmation. Earlier entries are never changed — the
 * history is append-only — and a manual entry claims nothing about a payment processor. Recording
 * is the existing `record_payment` through `financeMutation`. The dialog chooses an invoice, of
 * either source; `invoiceId` preselects one.
 */
export function PaymentDialog({ organizationId, invoiceId, tone, size, initiallyOpen, label = 'Record payment', ariaLabel, open, onOpenChange, trigger, today, entry = 'receipt' }: Omit<TransactionTriggerProps, 'workItemId'> & { invoiceId?: string; today: string; entry?: Entry }) {
  return <TransactionDialog label={label} icon={<CreditCard aria-hidden className="size-4" />} tone={tone} size={size} initiallyOpen={initiallyOpen} ariaLabel={ariaLabel} open={open} onOpenChange={onOpenChange} trigger={trigger}>
    {close => <PaymentBody organizationId={organizationId} invoiceId={invoiceId} today={today} initialEntry={entry} close={close} />}
  </TransactionDialog>;
}

function PaymentBody({ organizationId, invoiceId, today, initialEntry, close }: { organizationId: string; invoiceId?: string; today: string; initialEntry: Entry; close: () => void }) {
  const id = useId();
  const [includeSettled, setIncludeSettled] = useState(false);
  const record = useFinanceRecord(organizationId, 'payment', invoiceId, { includeSettled, load: financePaymentReview });
  // Fixed when the dialog opens: the page behind may refresh after a save (a settled row becoming unpaid again).
  const [opening] = useState<Entry>(initialEntry);
  const [entry, setEntry] = useState<Entry>(initialEntry);
  const [amount, setAmount] = useState('');
  const [receivedAt, setReceivedAt] = useState(today);
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'entry' | 'confirm'>('entry');
  const [done, setDone] = useState<FinanceActionState | null>(null);
  const invoice = record.review?.invoice ?? null;
  useGuardedDialogDirty(!done && (amount !== '' || note !== '' || receivedAt !== today || step === 'confirm'));
  const { state, pending, submit, errorRef } = useFinanceSubmit(result => { if (result.success) { setDone(result); setAmount(''); setNote(''); setStep('entry'); record.reload(); } else if (result.error) setStep('entry'); });
  const standing = invoice ? invoiceStanding(invoice) : null;
  const minor = invoice ? amountMinor(amount, invoice.currency) : null;
  const signed = minor === null ? null : entry === 'correction' ? -minor : minor;
  const outstanding = standing?.outstandingMinor ?? null;
  const after = outstanding !== null && signed !== null ? outstanding - signed : null;
  const money = (value: number) => formatMoney(value, invoice!.currency);
  const problem = amount && minor === null ? `Enter a positive amount in ${invoice?.currency ?? 'the invoice currency'}${amount.trim().startsWith('-') ? ' without a minus sign' : ''}.` : !ISO.test(receivedAt) ? 'Enter the date the money was received.' : null;
  const ready = Boolean(invoice && minor !== null && !problem);
  const send = () => invoice && submit({ organizationId, kind: 'payment', invoiceId: invoice.id, entry, amount, receivedAt, note, confirmed: entry === 'correction' ? '1' : '' });
  return <>
    {/* Named for how it was opened and kept while open, so assistive technology never meets a renamed dialog mid-task. */}
    <StepHeader title={opening === 'correction' ? 'Record correction' : 'Record payment'} steps={entry === 'correction' && !done ? ['Enter', 'Confirm'] : undefined} current={step === 'entry' ? 0 : 1} />
    <DialogBody><div className="flex flex-col gap-4">
      {!record.fixed && !record.selected && !done ? <>
        <RecordPicker legend="Invoice" search={{ value: record.q, onChange: record.setQ, label: 'Search invoices', placeholder: 'Contact or invoice number' }}
          choices={(record.choices?.rows ?? []).map(row => ({ id: row.id, title: row.title, detail: row.detail, meta: row.meta }))} selected={record.selected} onSelect={record.choose}
          status={choiceStatus(record.searching, record.choices, 'invoices')}
          empty={record.choices && !record.searching && !record.q ? <p className="text-sm">{includeSettled ? 'No invoices have been issued yet.' : 'No invoice has a balance outstanding.'}</p> : null} />
        <div className="flex items-center gap-2"><Checkbox id={`${id}-settled`} checked={includeSettled} onCheckedChange={value => setIncludeSettled(value === true)} /><FieldLabel htmlFor={`${id}-settled`} className="font-normal">Include settled invoices, for a correction or refund</FieldLabel></div>
      </> : null}
      {record.selected && !record.review ? <p role="status" className="text-sm text-muted">{record.loadingReview ? 'Loading invoice…' : ''}</p> : null}
      {invoice && standing ? <RecordSummary title={`Invoice #${invoice.number}`} subtitle={invoice.billedTo} action={!record.fixed && !done && step === 'entry' ? <Button type="button" tone="text" size="small" onClick={() => record.choose('')}>Change</Button> : null}
        facts={[{ label: 'Currency', value: invoice.currency }, { label: 'Total', value: standing.total ? money(standing.total.totalMinor) : '—' }, { label: 'Already paid', value: money(standing.paidMinor) }]}>
        <MoneyTotals label="Balance" rows={[
          { label: standing.settled ? 'Outstanding (settled)' : 'Outstanding', value: outstanding === null ? '—' : money(Math.max(outstanding, 0)), emphasis: signed === null },
          ...(outstanding !== null && outstanding < 0 ? [{ label: 'Paid beyond the total', value: money(-outstanding), tone: 'muted' as const }] : []),
          ...(signed !== null && after !== null && !done ? [{ label: entry === 'correction' ? 'This correction' : 'This payment', value: money(signed), tone: entry === 'correction' ? 'danger' as const : undefined }, { label: after < 0 ? 'Paid beyond the total after this' : 'Outstanding after this', value: money(Math.abs(after)), emphasis: true }] : []),
        ]} />
        {invoice.payments.length ? <details className="text-sm"><summary className="cursor-pointer text-muted">Payment history ({invoice.payments.length})</summary>
          <LineItems label="Payment history" items={invoice.payments.map(payment => ({ key: payment.id, tone: payment.amountMinor < 0 ? 'correction' as const : undefined, description: payment.amountMinor < 0 ? 'Correction' : payment.provider ? `Paid through ${payment.provider === 'stripe' ? 'Stripe' : 'card payment'}` : 'Recorded by hand', detail: [new Date(payment.receivedAt).toLocaleDateString('en-CA'), payment.note].filter(Boolean).join(' · '), amount: money(payment.amountMinor) }))} />
        </details> : null}
      </RecordSummary> : null}
      {done ? <TransactionResult title={done.success} detail={done.record} actions={<ButtonLink size="small" tone="secondary" href={done.href!}>Open invoice</ButtonLink>} />
        : invoice && step === 'entry' ? <>
          <ChoiceRow legend="Entry" value={entry} onChange={setEntry} options={[
            { value: 'receipt', label: 'Payment received', hint: 'Money this customer paid.' },
            { value: 'correction', label: 'Correction or refund', hint: 'Money returned, or a receipt reversed. Earlier entries stay as recorded.' },
          ]} />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id={`${id}-amount`} label={`Amount (${invoice.currency})`}>{field => <TextInput {...field} value={amount} onChange={event => setAmount(event.target.value)} inputMode="decimal" placeholder="0.00" required className="tabular-nums" />}</FormField>
            <FormField id={`${id}-received`} label={entry === 'correction' ? 'Date' : 'Received on'}>{field => <TextInput {...field} type="date" value={receivedAt} onChange={event => setReceivedAt(event.target.value)} required />}</FormField>
            <div className="sm:col-span-2"><FormField id={`${id}-note`} label="Note" optional>{field => <TextInput {...field} value={note} onChange={event => setNote(event.target.value)} maxLength={1000} placeholder={entry === 'correction' ? 'Why, e.g. refund of deposit' : 'Reference, e.g. cheque number'} />}</FormField></div>
            {problem ? <p className="text-xs text-danger sm:col-span-2">{problem}</p> : null}
            {entry === 'receipt' && after !== null && after < 0 ? <p className="text-xs text-muted sm:col-span-2">This is more than the outstanding balance.</p> : null}
          </div>
          <p className="text-xs text-muted">Recorded by hand. This does not confirm the money with a payment processor.</p>
        </> : invoice && signed !== null && after !== null ? <ConfirmationPanel tone="caution" title={`Record a correction of ${money(signed)}?`}
          statement={<>Against invoice #{invoice.number} for {invoice.billedTo}, dated {receivedAt}.</>}
          consequences={['It is added to the payment history as its own entry; earlier payments stay unchanged.', after < 0 ? `The invoice will show ${money(-after)} paid beyond its total.` : `${money(after)} will be outstanding.`]} /> : null}
      <TransactionError error={state.error} errorRef={errorRef} />
    </div></DialogBody>
    <DialogFooterBar>
      {done ? <><Button type="button" onClick={close}>Done</Button><Button type="button" tone="secondary" onClick={() => { setDone(null); setEntry('receipt'); }}>Record another</Button></>
        : step === 'confirm' ? <><Button type="button" tone="danger" disabled={pending} onClick={send}>{pending ? 'Recording…' : 'Record correction'}</Button><Button type="button" tone="secondary" disabled={pending} onClick={() => setStep('entry')}>Back</Button></>
        : entry === 'correction' ? <><Button type="button" disabled={!ready} onClick={() => setStep('confirm')}>Continue</Button><CancelButton /></>
        : <><Button type="button" disabled={pending || !ready} onClick={send}>{pending ? 'Recording…' : 'Record payment'}</Button><CancelButton /></>}
    </DialogFooterBar>
  </>;
}

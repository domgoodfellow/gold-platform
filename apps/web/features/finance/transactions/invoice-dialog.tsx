'use client';

import { useId, useState, type ReactNode } from 'react';
import { FileText, Plus, Trash2 } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { SelectInput, TextInput } from '@/components/controls/inputs';
import { FormField } from '@/components/controls/form';
import { useGuardedDialogDirty } from '@/components/panels/guarded-dialog';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { ChoiceRow, ConfirmationPanel, LineItems, MoneyTotals, RecordPicker, RecordSummary, TransactionResult } from '@/components/patterns/transaction-review';
import { priceWorkItem, type PricedLine } from '@/lib/domain/pricing/prices';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import { financeDirectInvoiceReview, type FinanceActionState } from '@/app/organizations/[organizationId]/finance/actions';
import { CancelButton, TransactionDialog, TransactionError, type TransactionTriggerProps } from './transaction-dialog';
import { choiceStatus, useFinanceRecord, useFinanceSubmit } from './use-finance-record';
import { lineItem } from './quote-dialog';
import { DraftDocumentPreview } from './document-preview';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const readable = (day: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(`${day}T12:00:00Z`));

/**
 * Issue an invoice, in two deliberate steps: review what the invoice will hold (contact, lines,
 * total, dates), then confirm. From priced Work, issuance is the existing `issue_invoice`: it
 * numbers the invoice, freezes its lines and refuses a second invoice for the same Work. For a
 * customer directly, the person chooses catalog items and quantities and `issue_direct_invoice`
 * copies their prices. From an accepted proposal, the lines are the proposal's and cannot be
 * changed; `issue_invoice_from_proposal` copies them. The server refuses an issue that did not come
 * through the confirmation step. Opened from a Work item, the dialog only invoices that Work.
 */
export function InvoiceDialog({ organizationId, workItemId, proposal, tone, size, initiallyOpen, label = 'New invoice', ariaLabel, open, onOpenChange, trigger, today }: TransactionTriggerProps & { today: string; proposal?: ProposalToInvoice }) {
  return <TransactionDialog label={label} icon={<FileText aria-hidden className="size-4" />} tone={tone} size={size} initiallyOpen={initiallyOpen} ariaLabel={ariaLabel} open={open} onOpenChange={onOpenChange} trigger={trigger}>
    {close => proposal ? <ProposalInvoiceBody organizationId={organizationId} proposal={proposal} today={today} close={close} /> : workItemId ? <InvoiceBody organizationId={organizationId} workItemId={workItemId} today={today} close={close} /> : <InvoiceSourceChoice organizationId={organizationId} today={today} close={close} />}
  </TransactionDialog>;
}

type Source = 'work' | 'catalog';

/** The question a new invoice from Finance asks first: what it is for. Each answer keeps its own review, and the choice closes once a record is chosen. */
function InvoiceSourceChoice({ organizationId, today, close }: { organizationId: string; today: string; close: () => void }) {
  const [source, setSource] = useState<Source>('work');
  const chooser = <ChoiceRow legend="Invoice for" value={source} onChange={setSource} options={[
    { value: 'work', label: 'Priced Work', hint: 'Copies the quote on a Work item.' },
    { value: 'catalog', label: 'A customer, from catalog items', hint: 'Choose items and quantities. Prices come from Catalog & Pricing.' },
  ]} />;
  return source === 'work'
    ? <InvoiceBody organizationId={organizationId} today={today} close={close} chooser={chooser} />
    : <DirectInvoiceBody organizationId={organizationId} today={today} close={close} chooser={chooser} />;
}

function InvoiceBody({ organizationId, workItemId, today, close, chooser = null }: { organizationId: string; workItemId?: string; today: string; close: () => void; chooser?: ReactNode }) {
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
      {!record.selected && !done ? chooser : null}
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
          {eligible && !dateProblem && review ? <DraftDocumentPreview fields={{ organizationId, workItemId: review.work.id, issuedAt, dueAt }} /> : null}
        </> : review && total ? <ConfirmationPanel title={`Issue invoice to ${contact}?`}
          statement={<><strong className="tabular-nums">{formatMoney(total.totalMinor, total.currency)}</strong> for {review.work.title}, dated {readable(issuedAt)}{dueAt ? `, due ${readable(dueAt)}` : ', with no due date'}.</>}
          consequences={['The invoice is numbered, and its lines and prices are fixed once issued.', 'Payments and corrections are recorded against it afterwards; the invoice itself is not edited.']} /> : null}
      <TransactionError error={state.error} errorRef={errorRef} />
      {done?.documentError ? <p role="status" className="text-sm text-danger">The invoice is issued, but its PDF was not created: {done.documentError} Open the invoice to try again.</p> : null}
    </div></DialogBody>
    <DialogFooterBar>
      {done ? <Button type="button" onClick={close}>Done</Button>
        : step === 'review' ? <><Button type="button" disabled={!eligible || Boolean(dateProblem)} onClick={() => setStep('confirm')}>Continue</Button><CancelButton /></>
        : <><Button type="button" disabled={pending || !eligible} onClick={() => review && submit({ organizationId, kind: 'invoice', workItemId: review.work.id, issuedAt, dueAt, confirmed: '1' })}>{pending ? 'Issuing…' : 'Issue invoice'}</Button><Button type="button" tone="secondary" disabled={pending} onClick={() => setStep('review')}>Back</Button></>}
    </DialogFooterBar>
  </>;
}

/** An accepted proposal as the dialog shows it. The lines are the proposal's own snapshot, shown for review and never sent. */
export type ProposalToInvoice = { id: string; version: number; customerName: string; lines: PricedLine[] };

/**
 * An accepted proposal, invoiced whole: the lines and prices are the ones the customer accepted and
 * there is nothing to change but the dates. One issuance key per dialog, so a retried confirmation
 * returns the invoice already issued.
 */
function ProposalInvoiceBody({ organizationId, proposal, today, close }: { organizationId: string; proposal: ProposalToInvoice; today: string; close: () => void }) {
  const id = useId();
  const [issuedAt, setIssuedAt] = useState(today);
  const [dueAt, setDueAt] = useState('');
  const [step, setStep] = useState<'review' | 'confirm'>('review');
  const [done, setDone] = useState<FinanceActionState | null>(null);
  const [issuanceKey] = useState(() => crypto.randomUUID());
  const { state, pending, submit, errorRef } = useFinanceSubmit(result => { if (result.success) setDone(result); else if (result.error) setStep('review'); });
  useGuardedDialogDirty(!done && (issuedAt !== today || dueAt !== '' || step === 'confirm'));
  const total = priceWorkItem(proposal.lines);
  const dateProblem = !ISO.test(issuedAt) ? 'Enter the invoice date.' : dueAt && !ISO.test(dueAt) ? 'Enter a valid due date.' : dueAt && dueAt < issuedAt ? 'The due date must be on or after the invoice date.' : null;
  const title = `Proposal version ${proposal.version}`;
  return <>
    <StepHeader title="New invoice" steps={done ? undefined : ['Review', 'Confirm']} current={step === 'review' ? 0 : 1} />
    <DialogBody><div className="flex flex-col gap-4">
      {done ? <TransactionResult title={done.record ? `${done.record} issued` : done.success} detail={`${proposal.customerName}${total ? ` · ${formatMoney(total.totalMinor, total.currency)}` : ''}`} actions={<ButtonLink size="small" tone="secondary" href={done.href!} onClick={close}>Open invoice</ButtonLink>} />
        : step === 'review' ? <>
          <RecordSummary title={title} subtitle={`${proposal.customerName} · accepted`}
            facts={total ? [{ label: 'Currency', value: total.currency }, { label: 'Lines', value: proposal.lines.length }] : []}>
            <LineItems label="Invoice lines" items={proposal.lines.map(line => lineItem(line))} empty="This proposal has no lines." />
            {total ? <MoneyTotals label="Invoice total" rows={[{ label: 'Invoice total', value: formatMoney(total.totalMinor, total.currency), emphasis: true }]} /> : null}
          </RecordSummary>
          <p className="text-sm text-muted">The lines and prices are the ones the customer accepted. They are not changed by today’s catalog.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id={`${id}-issued`} label="Invoice date">{field => <TextInput {...field} type="date" value={issuedAt} onChange={event => setIssuedAt(event.target.value)} required />}</FormField>
            <FormField id={`${id}-due`} label="Due date" optional>{field => <TextInput {...field} type="date" value={dueAt} min={ISO.test(issuedAt) ? issuedAt : undefined} onChange={event => setDueAt(event.target.value)} />}</FormField>
            {dateProblem ? <p className="text-xs text-danger sm:col-span-2">{dateProblem}</p> : null}
          </div>
          {total && !dateProblem ? <DraftDocumentPreview fields={{ organizationId, source: 'proposal', proposalId: proposal.id, issuedAt, dueAt }} /> : null}
        </> : total ? <ConfirmationPanel title={`Issue invoice to ${proposal.customerName}?`}
          statement={<><strong className="tabular-nums">{formatMoney(total.totalMinor, total.currency)}</strong> for {title.toLowerCase()}, dated {readable(issuedAt)}{dueAt ? `, due ${readable(dueAt)}` : ', with no due date'}.</>}
          consequences={['The whole proposal is invoiced once. Its lines and prices are fixed on the invoice.', 'No payment is recorded. Payments and corrections are recorded against the invoice afterwards.']} /> : null}
      <TransactionError error={state.error} errorRef={errorRef} />
      {done?.documentError ? <p role="status" className="text-sm text-danger">The invoice is issued, but its PDF was not created: {done.documentError} Open the invoice to try again.</p> : null}
    </div></DialogBody>
    <DialogFooterBar>
      {done ? <Button type="button" onClick={close}>Done</Button>
        : step === 'review' ? <><Button type="button" disabled={!total || Boolean(dateProblem)} onClick={() => setStep('confirm')}>Continue</Button><CancelButton /></>
        : <><Button type="button" disabled={pending || !total} onClick={() => submit({ organizationId, kind: 'invoice', source: 'proposal', proposalId: proposal.id, issuanceKey, issuedAt, dueAt, confirmed: '1' })}>{pending ? 'Issuing…' : 'Issue invoice'}</Button><Button type="button" tone="secondary" disabled={pending} onClick={() => setStep('review')}>Back</Button></>}
    </DialogFooterBar>
  </>;
}

type DraftLine = { key: string; itemId: string; quantity: string };
const newLine = (): DraftLine => ({ key: crypto.randomUUID(), itemId: '', quantity: '1' });
const wholeQuantity = (value: string) => /^\d{1,7}$/.test(value) && Number(value) >= 1 && Number(value) <= 1_000_000 ? Number(value) : null;

/**
 * A direct invoice: a customer, catalog items and whole quantities. The prices shown are the
 * catalog's, for review only, and are never sent; issuance copies them from the catalog itself.
 * One issuance key per dialog, so a retried confirmation returns the invoice already issued.
 */
function DirectInvoiceBody({ organizationId, today, close, chooser }: { organizationId: string; today: string; close: () => void; chooser: ReactNode }) {
  const id = useId();
  const record = useFinanceRecord(organizationId, 'customer', undefined, { load: financeDirectInvoiceReview });
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine()]);
  const [issuedAt, setIssuedAt] = useState(today);
  const [dueAt, setDueAt] = useState('');
  const [step, setStep] = useState<'review' | 'confirm'>('review');
  const [done, setDone] = useState<FinanceActionState | null>(null);
  const [issuanceKey] = useState(() => crypto.randomUUID());
  const { state, pending, submit, errorRef } = useFinanceSubmit(result => { if (result.success) setDone(result); else if (result.error) setStep('review'); });
  const { review } = record;
  useGuardedDialogDirty(!done && (lines.length > 1 || lines.some(line => line.itemId !== '' || line.quantity !== '1') || issuedAt !== today || dueAt !== '' || step === 'confirm'));
  const items = review?.items ?? [];
  const priced: PricedLine[] = lines.flatMap(line => {
    const item = items.find(entry => entry.id === line.itemId);
    const quantity = wholeQuantity(line.quantity);
    return item && quantity ? [{ id: line.key, description: item.name, unit: item.unit, unitAmountMinor: item.unitAmountMinor, currency: item.currency, quantity }] : [];
  });
  const foreign = review ? priced.filter(line => line.currency !== review.currency) : [];
  const total = priced.length && !foreign.length ? priceWorkItem(priced) : null;
  const dateProblem = !ISO.test(issuedAt) ? 'Enter the invoice date.' : dueAt && !ISO.test(dueAt) ? 'Enter a valid due date.' : dueAt && dueAt < issuedAt ? 'The due date must be on or after the invoice date.' : null;
  const eligible = Boolean(review && priced.length === lines.length && total);
  const update = (key: string, change: Partial<DraftLine>) => setLines(current => current.map(line => line.key === key ? { ...line, ...change } : line));
  const send = () => review && submit({ organizationId, kind: 'invoice', source: 'direct', customerId: review.customer.id, lines: JSON.stringify(lines.map(line => ({ priceBookItemId: line.itemId, quantity: wholeQuantity(line.quantity) }))), issuanceKey, issuedAt, dueAt, confirmed: '1' });
  return <>
    <StepHeader title="New invoice" steps={done ? undefined : ['Review', 'Confirm']} current={step === 'review' ? 0 : 1} />
    <DialogBody><div className="flex flex-col gap-4">
      {!record.selected && !done ? chooser : null}
      {!record.selected && !done ? <RecordPicker legend="Customer" search={{ value: record.q, onChange: record.setQ, label: 'Search customers', placeholder: 'Name, email or phone' }}
        choices={(record.choices?.rows ?? []).map(row => ({ id: row.id, title: row.title, detail: row.detail }))} selected={record.selected} onSelect={record.choose}
        status={choiceStatus(record.searching, record.choices, 'customers')}
        empty={record.choices && !record.searching ? <p className="text-sm">{record.q ? 'No customer matches this search.' : 'There are no contacts to invoice yet.'}</p> : null} /> : null}
      {record.selected && !review ? <p role="status" className="text-sm text-muted">{record.loadingReview ? 'Loading customer…' : ''}</p> : null}
      {done ? <TransactionResult title={done.record ? `${done.record} issued` : done.success} detail={`${review?.customer.name ?? ''}${total ? ` · ${formatMoney(total.totalMinor, total.currency)}` : ''}`} actions={<ButtonLink size="small" tone="secondary" href={done.href!} onClick={close}>Open invoice</ButtonLink>} />
        : review && step === 'review' ? <>
          <RecordSummary title={review.customer.name} subtitle="Invoiced directly, with no Work item" action={<Button type="button" tone="text" size="small" onClick={() => record.choose('')}>Change</Button>}
            facts={total ? [{ label: 'Currency', value: total.currency }, { label: 'Lines', value: priced.length }] : []}>
            <LineItems label="Invoice lines" items={priced.map(line => lineItem(line))} empty="Choose a catalog item for each line." />
            {total ? <MoneyTotals label="Invoice total" rows={[{ label: 'Invoice total', value: formatMoney(total.totalMinor, total.currency), emphasis: true }]} /> : null}
          </RecordSummary>
          {!items.length ? <div className="flex flex-col items-start gap-2 text-sm"><p>Nothing is in Catalog & Pricing yet, so there is nothing to invoice.</p><ButtonLink size="small" tone="secondary" href={`/organizations/${organizationId}/finance/catalog`}>Open Catalog & Pricing</ButtonLink></div>
            : <fieldset className="flex flex-col gap-3"><legend className="mb-1 text-sm font-semibold">Catalog items</legend>
              {lines.map((line, index) => <div key={line.key} className="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] items-end gap-2">
                <FormField id={`${id}-item-${line.key}`} label={`Item ${index + 1}`}>{field => <SelectInput {...field} value={line.itemId} onChange={event => update(line.key, { itemId: event.target.value })} required><option value="">Choose a catalog item</option>{items.map(entry => <option key={entry.id} value={entry.id}>{entry.name} · {formatMoney(entry.unitAmountMinor, entry.currency)} / {entry.unit}</option>)}</SelectInput>}</FormField>
                <FormField id={`${id}-quantity-${line.key}`} label="Quantity">{field => <TextInput {...field} value={line.quantity} onChange={event => update(line.key, { quantity: event.target.value })} type="number" inputMode="numeric" min={1} max={1000000} step={1} required className="tabular-nums" />}</FormField>
                <Button type="button" tone="ghost" size="small" aria-label={`Remove item ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines(current => current.filter(entry => entry.key !== line.key))}><Trash2 aria-hidden className="size-4" /></Button>
              </div>)}
              {lines.some(line => line.quantity !== '' && !wholeQuantity(line.quantity)) ? <p className="text-xs text-danger">Quantity is a whole number from 1 to 1,000,000.</p> : null}
              {foreign.length ? <p className="text-xs text-danger">This business trades in {review.currency ?? 'no currency yet'}, and {foreign.map(line => line.description).join(', ')} {foreign.length === 1 ? 'is' : 'are'} priced in another currency. An invoice has one currency.</p> : null}
              <div><Button type="button" tone="secondary" size="small" disabled={lines.length >= 100} onClick={() => setLines(current => [...current, newLine()])}><Plus aria-hidden className="size-4" />Add item</Button></div>
            </fieldset>}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id={`${id}-issued`} label="Invoice date">{field => <TextInput {...field} type="date" value={issuedAt} onChange={event => setIssuedAt(event.target.value)} required />}</FormField>
            <FormField id={`${id}-due`} label="Due date" optional>{field => <TextInput {...field} type="date" value={dueAt} min={ISO.test(issuedAt) ? issuedAt : undefined} onChange={event => setDueAt(event.target.value)} />}</FormField>
            {dateProblem ? <p className="text-xs text-danger sm:col-span-2">{dateProblem}</p> : null}
          </div>
          {eligible && !dateProblem ? <DraftDocumentPreview fields={{ organizationId, source: 'direct', customerId: review.customer.id, lines: JSON.stringify(lines.map(line => ({ priceBookItemId: line.itemId, quantity: wholeQuantity(line.quantity) }))), issuedAt, dueAt }} /> : null}
        </> : review && total ? <ConfirmationPanel title={`Issue invoice to ${review.customer.name}?`}
          statement={<><strong className="tabular-nums">{formatMoney(total.totalMinor, total.currency)}</strong> for {priced.length} {priced.length === 1 ? 'catalog item' : 'catalog items'}, dated {readable(issuedAt)}{dueAt ? `, due ${readable(dueAt)}` : ', with no due date'}.</>}
          consequences={['Prices are taken from Catalog & Pricing when the invoice is issued, and are fixed from then on.', 'The invoice is not attached to any Work item. Payments and corrections are recorded against it afterwards; the invoice itself is not edited.']} /> : null}
      <TransactionError error={record.error} />
      <TransactionError error={state.error} errorRef={errorRef} />
      {done?.documentError ? <p role="status" className="text-sm text-danger">The invoice is issued, but its PDF was not created: {done.documentError} Open the invoice to try again.</p> : null}
    </div></DialogBody>
    <DialogFooterBar>
      {done ? <Button type="button" onClick={close}>Done</Button>
        : step === 'review' ? <>{review ? <Button type="button" disabled={!eligible || Boolean(dateProblem)} onClick={() => setStep('confirm')}>Continue</Button> : null}<CancelButton /></>
        : <><Button type="button" disabled={pending || !eligible} onClick={send}>{pending ? 'Issuing…' : 'Issue invoice'}</Button><Button type="button" tone="secondary" disabled={pending} onClick={() => setStep('review')}>Back</Button></>}
    </DialogFooterBar>
  </>;
}

'use client';

import { useEffect, useId, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, ButtonLink } from '@/components/controls/button';
import { TextInput } from '@/components/controls/inputs';
import { FormField } from '@/components/controls/form';
import { useGuardedDialogDirty } from '@/components/panels/guarded-dialog';
import { DialogBody, DialogFooterBar, StepHeader } from '@/components/panels/dialog-layout';
import { LineItems, MoneyTotals, RecordPicker, RecordSummary, TransactionResult, type LineItem } from '@/components/patterns/transaction-review';
import { priceWorkItem, type PricedLine } from '@/lib/domain/pricing/prices';
import { formatMoney } from '@/lib/domain/work-items/consumption';
import type { FinanceActionState } from '@/app/organizations/[organizationId]/finance/actions';
import { CancelButton, TransactionDialog, TransactionError, type TransactionTriggerProps } from './transaction-dialog';
import { choiceStatus, useFinanceRecord, useFinanceSubmit } from './use-finance-record';
import { newWorkHref } from '@/features/work/new-work-action';
import { SelectField } from '@/components/controls/select-field';
import { financeDirectInvoiceReview } from '@/app/organizations/[organizationId]/finance/actions';
import { TextArea } from '@/components/controls/inputs';

/** One priced line as the review shows it; its amount is `priceWorkItem` over that line, so no component multiplies money itself. */
export const lineItem = (line: PricedLine, tone?: LineItem['tone']): LineItem => {
  const amount = priceWorkItem([line])!;
  return { key: line.id, tone, description: line.description, detail: `${line.quantity} × ${formatMoney(line.unitAmountMinor, line.currency)} / ${line.unit}`, amount: formatMoney(amount.totalMinor, amount.currency) };
};

/** Customer quotes use the existing catalog proposal command. Priced Work retains its own
 * snapshot operation, and a Work record opens that source directly. Neither path accepts prices
 * from the browser, creates a type or creates Work. */
export function QuoteDialog({ organizationId, workItemId, customerId, initialSource, tone, size, initiallyOpen, label = 'New quote', ariaLabel, open, onOpenChange, trigger, mayCreateWork = false, mayManageCatalog = false }: TransactionTriggerProps & { customerId?: string; initialSource?: 'work' | 'customer'; mayCreateWork?: boolean; mayManageCatalog?: boolean }) {
  return <TransactionDialog label={label} icon={<Plus aria-hidden className="size-4" />} tone={tone} size={size} initiallyOpen={initiallyOpen} ariaLabel={ariaLabel} open={open} onOpenChange={onOpenChange} trigger={trigger}>
    {close => <QuoteSource organizationId={organizationId} workItemId={workItemId} customerId={customerId} initialSource={initialSource} mayCreateWork={mayCreateWork} mayManageCatalog={mayManageCatalog} close={close} />}
  </TransactionDialog>;
}

function QuoteSource(props: { organizationId: string; workItemId?: string; customerId?: string; initialSource?: 'work' | 'customer'; mayCreateWork: boolean; mayManageCatalog: boolean; close: () => void }) {
  const id = useId();
  const [source, setSource] = useState(props.workItemId || !props.mayManageCatalog ? 'work' : props.initialSource ?? 'customer');
  const [dirty, setDirty] = useState(false);
  // Each source body owns its discard guard; the shared dialog close remains guarded too.
  const chooser = !props.workItemId ? <fieldset className="flex flex-wrap gap-4"><legend className="sr-only">Quote source</legend>
    {(['customer', 'work'] as const).map(value => <label key={value} className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name={`${id}-source`} value={value} checked={source === value} disabled={value === 'customer' && !props.mayManageCatalog} onChange={() => {
      if (dirty && !window.confirm('Change quote source? Unsaved quote lines will be discarded.')) return;
      setDirty(false); setSource(value);
    }} />{value === 'customer' ? 'Customer quote' : 'Price existing Work'}</label>)}
  </fieldset> : null;
  return <>{source === 'customer' ? <CustomerQuoteBody organizationId={props.organizationId} customerId={props.customerId} close={props.close} onDirtyChange={setDirty} chooser={chooser} /> : <QuoteBody {...props} onDirtyChange={setDirty} chooser={chooser} />}</>;
}

type DraftQuoteLine = { key: number; itemId: string; quantity: string };
function CustomerQuoteBody({ organizationId, customerId, close, onDirtyChange, chooser }: { chooser: React.ReactNode; organizationId: string; customerId?: string; close: () => void; onDirtyChange: (dirty: boolean) => void }) {
  const id = useId();
  const record = useFinanceRecord(organizationId, 'customer', customerId, { load: financeDirectInvoiceReview });
  const [lines, setLines] = useState<DraftQuoteLine[]>([{ key: 0, itemId: '', quantity: '1' }]);
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState<FinanceActionState | null>(null);
  const { state, pending, submit, errorRef } = useFinanceSubmit(result => { if (result.success) setDone(result); });
  const dirty = !done && (notes !== '' || lines.length > 1 || lines.some(line => line.itemId !== '' || line.quantity !== '1'));
  useGuardedDialogDirty(dirty);
  useEffect(() => { onDirtyChange(dirty); }, [onDirtyChange, dirty]);
  const review = record.review;
  const priced = lines.flatMap(line => {
    const item = review?.items.find(item => item.id === line.itemId);
    const quantity = /^\d+$/.test(line.quantity) ? Number(line.quantity) : 0;
    return item && Number.isInteger(quantity) && quantity >= 1 && quantity <= 1000000 ? [{ id: String(line.key), description: item.name, unit: item.unit, unitAmountMinor: item.unitAmountMinor, currency: item.currency, quantity }] : [];
  });
  const foreign = priced.some(line => line.currency !== review?.currency);
  const total = priced.length && !foreign ? priceWorkItem(priced) : null;
  const update = (key: number, patch: Partial<DraftQuoteLine>) => setLines(lines => lines.map(line => line.key === key ? { ...line, ...patch } : line));
  return <>
    <StepHeader title="New quote" />
    <DialogBody><div className="flex flex-col gap-4">{chooser}
      {!record.selected ? <RecordPicker legend="Contact" search={{ value: record.q, onChange: record.setQ, label: 'Search contacts', placeholder: 'Name, email or phone' }} choices={record.choices?.rows ?? []} selected={record.selected} onSelect={record.choose} status={choiceStatus(record.searching, record.choices, 'contacts')} /> : null}
      {record.loadingReview ? <p role="status">Loading contact…</p> : null}
      {review && !done ? <>
        <RecordSummary title={review.customer.name} action={!record.fixed ? <Button tone="text" size="small" onClick={() => record.choose('')}>Change contact</Button> : undefined} />
        {!review.items.length ? <ButtonLink href={`/organizations/${organizationId}/finance/catalog?returnTo=quote`} tone="secondary">Set up pricing</ButtonLink> : <>
          {lines.map((line, index) => <div key={line.key} className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_auto]">
            <FormField id={`${id}-${line.key}-item`} label={`Price item ${index + 1}`}>{field => <SelectField {...field} value={line.itemId} onValueChange={itemId => update(line.key, { itemId })} options={[{ value: '', label: 'Choose a price item' }, ...review.items.map(item => ({ value: item.id, label: `${item.name} · ${formatMoney(item.unitAmountMinor, item.currency)} / ${item.unit}` }))]} />}</FormField>
            <FormField id={`${id}-${line.key}-quantity`} label={`Quantity ${index + 1}`}>{field => <TextInput {...field} type="number" min={1} max={1000000} step={1} value={line.quantity} onChange={event => update(line.key, { quantity: event.target.value })} />}</FormField>
            {lines.length > 1 ? <Button type="button" size="small" tone="secondary" aria-label={`Remove line ${index + 1}`} onClick={() => setLines(lines => lines.filter(entry => entry.key !== line.key))}>Remove</Button> : null}
          </div>)}
          <Button type="button" tone="secondary" size="small" disabled={lines.length >= 100} onClick={() => setLines(lines => [...lines, { key: Math.max(...lines.map(line => line.key)) + 1, itemId: '', quantity: '1' }])}>Add line</Button>
          {foreign ? <p role="alert" className="text-sm text-danger">Choose items in {review.currency}. A quote has one currency.</p> : null}
          {total ? <MoneyTotals label="Quote total" rows={[{ label: 'Quote total', value: formatMoney(total.totalMinor, total.currency), emphasis: true }]} /> : null}
          <FormField id={`${id}-notes`} label="Notes" optional>{field => <TextArea {...field} maxLength={4000} value={notes} onChange={event => setNotes(event.target.value)} />}</FormField>
        </>}
      </> : null}
      {done ? <TransactionResult title="Customer quote created" actions={<ButtonLink href={done.href!} tone="secondary" onClick={close}>Open quote</ButtonLink>} /> : null}
      <TransactionError error={record.error} /><TransactionError error={state.error} errorRef={errorRef} />
    </div></DialogBody>
    <DialogFooterBar>{done ? <Button onClick={close}>Done</Button> : <><Button disabled={pending || !review || !total || priced.length !== lines.length} onClick={() => review && submit({ organizationId, kind: 'quote', source: 'catalog', customerId: review.customer.id, lines: JSON.stringify(lines.map(line => ({ priceBookItemId: line.itemId, quantity: Number(line.quantity) }))), notes })}>{pending ? 'Creating…' : 'Create quote'}</Button><CancelButton /></>}</DialogFooterBar>
  </>;
}

function QuoteBody({ organizationId, workItemId, mayCreateWork, mayManageCatalog, close, onDirtyChange, chooser }: { chooser: React.ReactNode; onDirtyChange: (dirty: boolean) => void; organizationId: string; workItemId?: string; mayCreateWork: boolean; mayManageCatalog: boolean; close: () => void }) {
  const id = useId();
  const record = useFinanceRecord(organizationId, 'quote', workItemId);
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [done, setDone] = useState<FinanceActionState | null>(null);
  // Each success once: reset the line and re-read the Work so its lines include the one just added.
  const { state, pending, submit, errorRef } = useFinanceSubmit(result => { if (result.success) { setDone(result); setItemId(''); setQuantity('1'); record.reload(); } });
  const { review } = record;
  const dirty = !done && (itemId !== '' || quantity !== '1');
  useGuardedDialogDirty(dirty);
  useEffect(() => { onDirtyChange(dirty); }, [onDirtyChange, dirty]);
  const item = review?.items.find(entry => entry.id === itemId);
  const count = /^\d+$/.test(quantity) ? Number(quantity) : NaN;
  const validQuantity = Number.isInteger(count) && count >= 1;
  const preview: PricedLine | null = item && validQuantity ? { id: 'preview', description: item.name, unit: item.unit, unitAmountMinor: item.unitAmountMinor, currency: item.currency, quantity: count } : null;
  const current = review ? priceWorkItem(review.lines) : null;
  const mixed = Boolean(preview && current && preview.currency !== current.currency);
  const next = preview && !mixed && review ? priceWorkItem([...review.lines, preview]) : null;
  const base = `/organizations/${organizationId}`;
  const workHref = review ? `${base}/work/${review.work.id}?tab=financials` : '';
  const prerequisite = record.choices?.quotePrerequisite ?? (record.choices?.total === 0 && !record.q.trim() && !record.searching ? 'work' : null);
  const canCreateWork = record.choices?.mayCreateWork ?? mayCreateWork;
  const canManageCatalog = record.choices?.mayManageCatalog ?? mayManageCatalog;
  return <>
    <StepHeader title="New quote" />
    <DialogBody><div className="flex flex-col gap-4">{chooser}
      {!record.fixed && !record.selected && prerequisite ? <section aria-label="Before you can quote" className="space-y-3 text-sm">
        {prerequisite === 'forbidden' ? <p>Your role cannot price Work. Ask an authorized member to prepare this quote.</p>
          : prerequisite === 'catalog' ? <><p>Add a price-book item before pricing Work. Catalog & pricing owns what this business charges.</p>{canManageCatalog ? <ButtonLink size="small" tone="primary" href={`${base}/finance/catalog?returnTo=quote`}>Open Catalog & pricing</ButtonLink> : <p className="text-muted">Ask someone who manages the catalog to add a price item.</p>}</>
          : <><p>To price existing Work, choose a Work item or create one first. Customer quotes can be prepared without Work.</p>{canCreateWork ? <ButtonLink size="small" tone="primary" href={newWorkHref(organizationId, undefined, { returnTo: 'quote' })}>Create Work</ButtonLink> : <p className="text-muted">Your role cannot create Work. Ask an authorized member to add it.</p>}</>}
      </section> : null}
      {!record.fixed && !record.selected && !prerequisite ? <RecordPicker legend="Work item" search={{ value: record.q, onChange: record.setQ, label: 'Search Work items', placeholder: 'Work title or contact' }}
        choices={(record.choices?.rows ?? []).map(row => ({ id: row.id, title: row.title, detail: row.detail }))} selected={record.selected} onSelect={record.choose}
        status={choiceStatus(record.searching, record.choices, 'Work items')}
        empty={record.choices && !record.searching && record.q.trim() ? <p className="text-sm text-muted">No Work matches this search. Try another title or contact.</p> : null} /> : null}
      {record.selected && !review ? <p role="status" className="text-sm text-muted">{record.loadingReview ? 'Loading Work item…' : ''}</p> : null}
      {review ? <RecordSummary title={review.work.title} subtitle={review.work.customer?.label ?? 'No contact'} action={!record.fixed && !done ? <Button type="button" tone="text" size="small" onClick={() => record.choose('')}>Change</Button> : null}>
        <LineItems label="Quoted lines" items={[...review.lines.map(line => lineItem(line)), ...(preview && !mixed ? [lineItem(preview, 'added')] : [])]} empty="Nothing priced yet." />
        <MoneyTotals label="Quote totals" rows={[
          ...(preview && !mixed && current ? [{ label: 'Current quote', value: formatMoney(current.totalMinor, current.currency), tone: 'muted' as const }] : []),
          { label: preview && !mixed ? 'Quote after this line' : 'Quote total', value: next ? formatMoney(next.totalMinor, next.currency) : current ? formatMoney(current.totalMinor, current.currency) : '—', emphasis: true },
        ]} />
        {review.invoice ? <p className="text-xs text-muted">Invoice #{review.invoice.number} is already issued for this Work. It keeps its own lines; new lines change the quote only.</p> : null}
      </RecordSummary> : null}
      {done ? <TransactionResult title={done.success} detail={review ? `${review.work.title}${current ? ` · quote now ${formatMoney(current.totalMinor, current.currency)}` : ''}` : undefined} actions={<ButtonLink size="small" tone="secondary" href={done.href ?? workHref}>Open Work financials</ButtonLink>} /> : null}
      {review && !done ? review.items.length ? <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <FormField id={`${id}-service`} label="Price item">{field => <SelectField {...field} value={itemId} onValueChange={(next) => setItemId(next)} required options={[{ value: '', label: 'Choose a priced item' }, ...review.items.map((entry) => ({ value: entry.id, label: `${entry.name} · ${formatMoney(entry.unitAmountMinor, entry.currency)} / ${entry.unit}` }))]} />}</FormField>
        <FormField id={`${id}-quantity`} label="Quantity">{field => <TextInput {...field} value={quantity} onChange={event => setQuantity(event.target.value)} type="number" inputMode="numeric" min={1} step={1} required className="tabular-nums" />}</FormField>
        {!validQuantity ? <p className="text-xs text-danger sm:col-span-2">Quantity is a whole number, one or more.</p> : null}
        {mixed ? <p className="text-xs text-danger sm:col-span-2">This Work is priced in {current!.currency}; this price item is in {preview!.currency}. A quote has one currency.</p> : null}
      </div> : <div className="flex flex-col items-start gap-2 text-sm"><p>Nothing is in the price book yet, so there is nothing to quote.</p>{mayManageCatalog ? <ButtonLink size="small" tone="secondary" href={`${base}/finance/catalog?returnTo=quote`}>Open Catalog & pricing</ButtonLink> : <p>Ask someone who manages the catalog to add a price item.</p>}</div> : null}
      <TransactionError error={record.error} />
      <TransactionError error={state.error} errorRef={errorRef} />
    </div></DialogBody>
    <DialogFooterBar>
      {done ? <><Button type="button" onClick={() => setDone(null)}>Add another line</Button><Button type="button" tone="secondary" onClick={close}>Done</Button></>
        : <>{!prerequisite || review ? <Button type="button" disabled={pending || !review || !item || !validQuantity || mixed} onClick={() => review && submit({ organizationId, kind: 'quote', workItemId: review.work.id, priceBookItemId: itemId, quantity: String(count) })}>{pending ? 'Adding…' : 'Add to quote'}</Button> : null}<CancelButton /></>}
    </DialogFooterBar>
  </>;
}

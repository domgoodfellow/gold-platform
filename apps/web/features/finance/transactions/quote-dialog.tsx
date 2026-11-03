'use client';

import { useId, useState } from 'react';
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

/** One priced line as the review shows it; its amount is `priceWorkItem` over that line, so no component multiplies money itself. */
export const lineItem = (line: PricedLine, tone?: LineItem['tone']): LineItem => {
  const amount = priceWorkItem([line])!;
  return { key: line.id, tone, description: line.description, detail: `${line.quantity} × ${formatMoney(line.unitAmountMinor, line.currency)} / ${line.unit}`, amount: formatMoney(amount.totalMinor, amount.currency) };
};

/**
 * Add one priced line to a Work item's quote. A quote here is priced Work — not a standalone
 * proposal — so the dialog starts from Work, shows its contact and current lines, and adds a
 * price item from the price book. It never creates Work or a Work type. The line is a snapshot through `add_work_item_priced_line`; the
 * amount is never sent, and later price changes never reach it. Fuller review stays on the Work
 * item's Financials.
 */
export function QuoteDialog({ organizationId, workItemId, tone, size, initiallyOpen, label = 'New quote', ariaLabel, open, onOpenChange, trigger, mayCreateWork = false, mayManageCatalog = false }: TransactionTriggerProps & { mayCreateWork?: boolean; mayManageCatalog?: boolean }) {
  return <TransactionDialog label={label} icon={<Plus aria-hidden className="size-4" />} tone={tone} size={size} initiallyOpen={initiallyOpen} ariaLabel={ariaLabel} open={open} onOpenChange={onOpenChange} trigger={trigger}>
    {close => <QuoteBody organizationId={organizationId} workItemId={workItemId} mayCreateWork={mayCreateWork} mayManageCatalog={mayManageCatalog} close={close} />}
  </TransactionDialog>;
}

function QuoteBody({ organizationId, workItemId, mayCreateWork, mayManageCatalog, close }: { organizationId: string; workItemId?: string; mayCreateWork: boolean; mayManageCatalog: boolean; close: () => void }) {
  const id = useId();
  const record = useFinanceRecord(organizationId, 'quote', workItemId);
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [done, setDone] = useState<FinanceActionState | null>(null);
  // Each success once: reset the line and re-read the Work so its lines include the one just added.
  const { state, pending, submit, errorRef } = useFinanceSubmit(result => { if (result.success) { setDone(result); setItemId(''); setQuantity('1'); record.reload(); } });
  const { review } = record;
  useGuardedDialogDirty(!done && (itemId !== '' || quantity !== '1'));
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
    <DialogBody><div className="flex flex-col gap-4">
      {!record.fixed && !record.selected && prerequisite ? <section aria-label="Quote prerequisite" className="space-y-3 text-sm">
        {prerequisite === 'forbidden' ? <p>Your role cannot price Work. Ask an authorized member to prepare this quote.</p>
          : prerequisite === 'catalog' ? <><p>Add a price-book item before pricing Work. Catalog & pricing owns what this business charges.</p>{canManageCatalog ? <ButtonLink size="small" tone="primary" href={`${base}/finance/catalog?returnTo=quote`}>Open Catalog & pricing</ButtonLink> : <p className="text-muted">Ask someone who manages the catalog to add a price item.</p>}</>
          : <><p>A quote starts from a Work item. Create Work first, then add a price from its Financials.</p>{canCreateWork ? <ButtonLink size="small" tone="primary" href={newWorkHref(organizationId, undefined, { returnTo: 'quote' })}>Create Work</ButtonLink> : <p className="text-muted">Your role cannot create Work. Ask an authorized member to add it.</p>}</>}
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

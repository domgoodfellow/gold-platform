'use client';

import { useId, type ReactNode } from 'react';
import { Check, Search } from 'lucide-react';
import { Card } from '../surfaces/card';
import { TextInput } from '../controls/inputs';
import { cx, FOCUS_RING, FOCUS_RING_WITHIN } from '../class-names';

/**
 * The shared grammar of a money-moving dialog: choose the record, review what it holds, see the
 * totals, confirm, and read the result. Domain data, formatting and the command stay with the
 * caller — every value arrives formatted — so a quote, an invoice, a payment or a future
 * subscription change reads the same way without this file knowing what any of them are.
 */

export type RecordChoice = { id: string; title: ReactNode; detail?: ReactNode; meta?: ReactNode };

/**
 * Search, then one choice from a short list of records. A radio group rather than a select, so each
 * choice can carry its identity, owner and amount, and arrow keys move through it natively. The
 * status line says how many records matched and when the list was cut at its limit.
 */
export function RecordPicker({ legend, search, choices, selected, onSelect, status, empty }: {
  legend: string;
  search: { value: string; onChange: (value: string) => void; label: string; placeholder?: string };
  choices: RecordChoice[]; selected: string; onSelect: (id: string) => void;
  status: ReactNode; empty?: ReactNode;
}) {
  const name = useId();
  return <fieldset className="flex min-w-0 flex-col gap-2">
    <legend className="mb-2 text-sm font-medium">{legend}</legend>
    <div className="relative">
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <TextInput type="search" value={search.value} onChange={event => search.onChange(event.target.value)} aria-label={search.label} placeholder={search.placeholder ?? search.label} className="w-full pl-9" />
    </div>
    <p role="status" className="text-xs text-muted">{status}</p>
    {choices.length ? <div data-slot="record-choices" className="flex max-h-64 flex-col divide-y divide-border overflow-y-auto rounded-[var(--visual-radius,0.625rem)] border border-border">
      {choices.map(choice => {
        const checked = choice.id === selected;
        return <label key={choice.id} className={cx('flex cursor-pointer items-start gap-3 px-3 py-2.5 text-sm hover:bg-hover [--focus-offset:-2px]', FOCUS_RING_WITHIN, checked && 'bg-secondary')}>
          <input type="radio" name={name} value={choice.id} checked={checked} onChange={() => onSelect(choice.id)} className="peer sr-only" />
          <span aria-hidden className={cx('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border', checked ? 'border-accent bg-accent text-on-accent' : 'border-border')}>{checked ? <Check className="size-3" /> : null}</span>
          <span className="min-w-0 flex-1"><span className="block break-words font-medium">{choice.title}</span>{choice.detail ? <span className="block break-words text-xs text-muted">{choice.detail}</span> : null}</span>
          {choice.meta ? <span className="shrink-0 text-right text-xs tabular-nums text-muted">{choice.meta}</span> : null}
        </label>;
      })}
    </div> : empty ?? null}
  </fieldset>;
}

/** The record under review: what it is, who it is for, and a few labelled facts. */
export function RecordSummary({ title, subtitle, facts = [], action, children }: { title: ReactNode; subtitle?: ReactNode; facts?: { label: ReactNode; value: ReactNode }[]; action?: ReactNode; children?: ReactNode }) {
  return <Card variant="quiet" className="flex min-w-0 flex-col gap-3 text-sm" data-slot="record-summary">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0"><p className="break-words font-semibold">{title}</p>{subtitle ? <p className="break-words text-muted">{subtitle}</p> : null}</div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
    {facts.length ? <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">{facts.map((fact, index) => <div key={index} className="min-w-0"><dt className="text-xs text-muted">{fact.label}</dt><dd className="break-words">{fact.value}</dd></div>)}</dl> : null}
    {children}
  </Card>;
}

export type LineItem = { key: string; description: ReactNode; detail?: ReactNode; amount: ReactNode; tone?: 'added' | 'correction' };

/** Lines in the order they were recorded; a line about to be added is marked rather than mixed in. */
export function LineItems({ label, items, empty }: { label: string; items: LineItem[]; empty?: ReactNode }) {
  if (!items.length) return empty ? <p className="text-sm text-muted">{empty}</p> : null;
  return <ul aria-label={label} className="flex flex-col divide-y divide-border text-sm">
    {items.map(item => <li key={item.key} className={cx('flex items-baseline justify-between gap-3 py-2', item.tone === 'added' && 'font-medium')}>
      <span className="min-w-0 break-words">{item.tone === 'added' ? <span className="mr-2 rounded bg-accent px-1.5 py-0.5 text-xs text-on-accent">New</span> : null}{item.description}{item.detail ? <span className="block text-xs font-normal text-muted">{item.detail}</span> : null}</span>
      <span className={cx('shrink-0 tabular-nums', item.tone === 'correction' && 'text-danger')}>{item.amount}</span>
    </li>)}
  </ul>;
}

export type TotalRow = { label: ReactNode; value: ReactNode; emphasis?: boolean; tone?: 'muted' | 'danger' };

/** Money totals, one row per figure, right-aligned so amounts line up; the emphasised row is what the decision is about. */
export function MoneyTotals({ label, rows }: { label: string; rows: TotalRow[] }) {
  return <dl aria-label={label} className="flex flex-col gap-1 border-t border-border pt-2 text-sm">
    {rows.map((row, index) => <div key={index} className={cx('flex items-baseline justify-between gap-3', row.emphasis && 'text-base font-semibold', row.tone === 'muted' && 'text-muted', row.tone === 'danger' && 'text-danger')}>
      <dt>{row.label}</dt><dd className="tabular-nums">{row.value}</dd>
    </div>)}
  </dl>;
}

/**
 * The last look before something that cannot be taken back. States what will happen in one
 * sentence and lists its consequences; the dialog's footer carries the confirming action.
 */
export function ConfirmationPanel({ title, statement, consequences = [], tone = 'default' }: { title: ReactNode; statement: ReactNode; consequences?: ReactNode[]; tone?: 'default' | 'caution' }) {
  return <div role="group" aria-label="Confirmation" className={cx('flex flex-col gap-2 rounded-[var(--visual-radius,0.625rem)] border p-4 text-sm', tone === 'caution' ? 'border-danger/40 bg-danger/5' : 'border-border bg-surface')}>
    <p className="font-semibold">{title}</p>
    <p>{statement}</p>
    {consequences.length ? <ul className="list-disc space-y-1 pl-5 text-muted">{consequences.map((item, index) => <li key={index}>{item}</li>)}</ul> : null}
  </div>;
}

/** What the command did, announced politely, with where to go next. */
export function TransactionResult({ title, detail, actions }: { title: ReactNode; detail?: ReactNode; actions?: ReactNode }) {
  return <div role="status" className="flex flex-col gap-3 rounded-[var(--visual-radius,0.625rem)] border border-success/30 bg-success/10 p-4 text-sm">
    <p className="flex items-center gap-2 font-semibold"><Check aria-hidden className="size-4 text-success" />{title}</p>
    {detail ? <p className="text-muted">{detail}</p> : null}
    {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
  </div>;
}

/** A labelled choice between a few options shown as one segmented row (receipt or correction, for instance). */
export function ChoiceRow<T extends string>({ legend, value, options, onChange }: { legend: string; value: T; options: { value: T; label: ReactNode; hint?: ReactNode }[]; onChange: (value: T) => void }) {
  const name = useId();
  return <fieldset className="flex flex-col gap-2">
    <legend className="mb-1 text-sm font-medium">{legend}</legend>
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map(option => <label key={option.value} className={cx('flex cursor-pointer flex-col gap-0.5 rounded-[var(--visual-radius,0.625rem)] border px-3 py-2 text-sm', FOCUS_RING_WITHIN, value === option.value ? 'border-accent bg-secondary' : 'border-border hover:bg-hover', FOCUS_RING)}>
        <span className="flex items-center gap-2 font-medium"><input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => onChange(option.value)} className="accent-[var(--accent)]" />{option.label}</span>
        {option.hint ? <span className="pl-6 text-xs text-muted">{option.hint}</span> : null}
      </label>)}
    </div>
  </fieldset>;
}

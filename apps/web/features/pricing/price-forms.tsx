'use client';

import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import { SectionHeading } from '@/components/surfaces/section';
import { Button } from '@/components/controls/button';
import { useActionState, useEffect, useRef, useState } from 'react';
import { useUnsavedChanges } from '@/components/controls/use-unsaved-changes';
import { CurrencyField } from '@/features/locale/locale-fields';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import {
  chooseCurrencyAction,
  createPriceItemAction,
  updatePriceItemAction,
  type PriceItemState,
} from '@/app/organizations/[organizationId]/finance/configuration/pricing/actions';

const INITIAL: PriceItemState = { error: null };
/**
 * How many decimal places to offer for a currency.
 *
 * The same question `formatMoney` answers on the way out, asked here on the way in, so a
 * business trading in JPY is not shown a stepper offering hundredths of a yen. Not a second
 * formatter — nothing here divides a stored amount; it only decides what a person may type.
 */
function step(currency: string): string {
  try {
    const digits =
      new Intl.NumberFormat('en-GB', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
    return digits === 0 ? '1' : `0.${'0'.repeat(digits - 1)}1`;
  } catch {
    return '0.01';
  }
}

/**
 * The one question a business must answer before it can price anything.
 *
 * **This used to be the fourth field on a signup form and it belongs here.** A currency means
 * nothing to somebody naming their business ninety seconds after registering, and it means
 * something obvious to somebody looking at an empty price book. Nothing is guessed in between:
 * until this is answered the business has no currency at all, which is a state the column holds
 * (`20260904000001`) rather than a default standing in for an answer.
 *
 * Nothing preselected, deliberately. The browser knows where somebody is and does not know what
 * they sell in — a Dutch company invoicing in dollars is ordinary — so a country-to-currency
 * guess would be the platform deciding what this business trades in, which `docs/product.md`
 * forbids outright.
 */
export function ChooseCurrencyForm({ organizationId, currentCurrency }: { organizationId: string; currentCurrency?: string | null }) {
  const [state, formAction, pending] = useActionState(chooseCurrencyAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 max-w-md">
      <input type="hidden" name="organizationId" value={organizationId} />

      <SectionHeading>{currentCurrency ? 'Trading currency' : 'First, what do you charge in?'}</SectionHeading>
      <Hint className="mt-1">
        Every amount is recorded in the currency it was written in, so this is a starting point
        rather than a setting that reaches backwards. You can change it later without
        reinterpreting anything already priced.
      </Hint>

      <div className="mt-4 flex flex-col gap-3">
        <CurrencyField id="finance-trading-currency" defaultValue={currentCurrency ?? undefined} />
        <Button type="submit" size="small" disabled={pending} className="w-fit">
          {pending ? 'Saving…' : currentCurrency ? 'Save currency' : 'Save and start pricing'}
        </Button>
      </div>

      <ErrorText role="alert" className="mt-2">{state.error}</ErrorText>
      {state.success ? <p role="status" className="text-sm text-success">{state.success}</p> : null}
    </form>
  );
}

/**
 * Add or edit one price item in its row of the price book. One row is one atomic write through the
 * existing create/update action — the same money parsing, domain validation and `price.manage`
 * check as before — so editing in place needs no list-wide save. A refusal keeps what was typed
 * (the inputs are controlled) and moves focus to the reason; Save success hands control back to the
 * list. Cancel and Escape discard this row's changes; leaving the page with changes asks first.
 *
 * The currency is shown and not editable, and that is a fact about the row rather than about this
 * role: the column grant refuses it to everybody, because changing it would reinterpret the amount
 * rather than convert it. An organization that has changed what it trades in re-prices its
 * catalogue, and seeing the old currency here is how it knows to.
 */
export function PriceItemRowForm({
  organizationId,
  item,
  currency,
  onDone,
  onCancel,
}: {
  organizationId: string;
  /** Absent when adding. */
  item?: PriceBookItem;
  currency: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [state, formAction, pending] = useActionState(item ? updatePriceItemAction : createPriceItemAction, INITIAL);
  const initial = { name: item?.name ?? '', unit: item?.unit ?? '', amount: item ? minorToTyped(item.unitAmountMinor, item.currency) : '' };
  const [fields, setFields] = useState(initial);
  const dirty = fields.name !== initial.name || fields.unit !== initial.unit || fields.amount !== initial.amount;
  const errorRef = useRef<HTMLParagraphElement>(null);
  useUnsavedChanges(dirty);
  // Reacts to each action result once, not to a caller's new callback on every render.
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => {
    if (state.success) done.current();
    else if (state.error) errorRef.current?.focus();
  }, [state]);
  const control = (name: keyof typeof fields) => ({ name, value: fields[name], onChange: (event: { target: { value: string } }) => setFields(previous => ({ ...previous, [name]: event.target.value })) });
  const subject = item ? item.name : 'new price item';
  const label = 'text-xs font-medium text-muted @min-[40rem]/prices:sr-only';

  return (
    <form
      action={formAction}
      aria-label={item ? `Edit ${item.name}` : 'Add price item'}
      onKeyDown={(event) => { if (event.key === 'Escape' && !pending) { event.preventDefault(); onCancel(); } }}
      className="grid gap-2 bg-secondary/40 px-3 py-3 @min-[40rem]/prices:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] @min-[40rem]/prices:items-start"
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      {item ? <input type="hidden" name="itemId" value={item.id} /> : null}
      <label className="grid gap-1"><span className={label}>Name</span>
        <TextInput {...control('name')} type="text" required maxLength={200} autoFocus aria-label={`Name of ${subject}`} placeholder="What it is, e.g. Callout" size="small" /></label>
      <label className="grid gap-1"><span className={label}>Unit</span>
        <TextInput {...control('unit')} type="text" required maxLength={40} aria-label={`Unit of ${subject}`} placeholder="Per what, e.g. visit" size="small" /></label>
      <label className="grid gap-1"><span className={label}>Amount ({currency})</span>
        <span className="flex items-center gap-2"><TextInput {...control('amount')} type="number" inputMode="decimal" required min={0} step={step(currency)} aria-label={`Amount in ${currency} for ${subject}`} size="small" className="min-w-0 flex-1 text-right tabular-nums" /><span className="text-xs text-subtle">{currency}</span></span></label>
      <div className="flex gap-2 @min-[40rem]/prices:justify-end">
        <Button type="button" tone="secondary" size="tiny" disabled={pending} onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="tiny" disabled={pending}>{pending ? 'Saving…' : item ? 'Save' : 'Add'}</Button>
      </div>
      <ErrorText ref={errorRef} tabIndex={-1} role="alert" className="@min-[40rem]/prices:col-span-4">{state.error}</ErrorText>
      {item ? <Hint className="@min-[40rem]/prices:col-span-4">Existing quoted and invoiced lines keep their original prices.</Hint> : null}
    </form>
  );
}

/**
 * The stored integer as a figure a person edits.
 *
 * This *is* a division of a minor unit, which `formatMoney` is supposed to be the only place
 * for — and the difference is that `formatMoney` produces something to read, with a currency
 * symbol and grouping, which a number input cannot accept. Both take the fraction digits from
 * the currency rather than assuming two, which is the part of the rule that actually matters.
 */
function minorToTyped(amountMinor: number, currency: string): string {
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat('en-GB', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    // Unknown to ICU; two is the honest guess, and the round trip is still exact.
  }
  return (amountMinor / 10 ** digits).toFixed(digits);
}

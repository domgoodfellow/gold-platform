'use client';

import { useActionState } from 'react';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import {
  createPriceItemAction,
  updatePriceItemAction,
  type PriceItemState,
} from './actions';

const INITIAL: PriceItemState = { error: null };
const CELL = 'rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20';
const FIELD = 'rounded border border-black/15 px-3 py-2 dark:border-white/20';

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

export function CreatePriceItemForm({
  organizationId,
  currency,
}: {
  organizationId: string;
  currency: string;
}) {
  const [state, formAction, pending] = useActionState(createPriceItemAction, INITIAL);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />
      {/* Decides the decimal places only. What is stored is read from the organization
          inside the RPC, so editing this cannot change what the business prices in. */}
      <input type="hidden" name="currency" value={currency} />

      <h2 className="text-sm font-medium">Something you charge for</h2>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="name"
          type="text"
          required
          maxLength={200}
          placeholder="What it is, e.g. Callout"
          aria-label="Name"
          className={`flex-1 ${FIELD}`}
        />
        <input
          name="unit"
          type="text"
          required
          maxLength={40}
          placeholder="Per what, e.g. visit"
          aria-label="Unit"
          className={`flex-1 ${FIELD}`}
        />
        <input
          name="amount"
          type="number"
          required
          min={0}
          step={step(currency)}
          placeholder={`Amount in ${currency}`}
          aria-label={`Amount in ${currency}`}
          className={`w-40 ${FIELD}`}
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded bg-foreground px-4 py-2 text-background disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add'}
      </button>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Re-price or rename one item.
 *
 * The currency is shown and not editable, and that is a fact about the row rather than about
 * this role: the column grant refuses it to everybody, because changing it would reinterpret
 * the amount rather than convert it. An organization that has changed what it trades in
 * re-prices its catalogue, and seeing the old currency here is how it knows to.
 */
export function EditPriceItemForm({
  organizationId,
  item,
}: {
  organizationId: string;
  item: PriceBookItem;
}) {
  const [state, formAction, pending] = useActionState(updatePriceItemAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 py-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="itemId" value={item.id} />
      <input type="hidden" name="currency" value={item.currency} />

      <input
        name="name"
        type="text"
        required
        maxLength={200}
        defaultValue={item.name}
        aria-label={`Name of ${item.name}`}
        className={`min-w-0 flex-1 ${CELL}`}
      />
      <span className="text-sm opacity-60">per</span>
      <input
        name="unit"
        type="text"
        required
        maxLength={40}
        defaultValue={item.unit}
        aria-label={`Unit of ${item.name}`}
        className={`w-28 ${CELL}`}
      />
      <input
        name="amount"
        type="number"
        required
        min={0}
        step={step(item.currency)}
        defaultValue={minorToTyped(item.unitAmountMinor, item.currency)}
        aria-label={`Amount for ${item.name}`}
        className={`w-28 ${CELL}`}
      />
      <span className="text-sm opacity-60">{item.currency}</span>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-black/15 px-2 py-1 text-xs disabled:opacity-50 dark:border-white/20"
      >
        Save
      </button>

      {state.error ? (
        <p role="alert" className="w-full text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
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

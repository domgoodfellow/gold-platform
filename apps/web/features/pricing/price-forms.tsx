'use client';

import { ErrorText, Hint, TextInput } from '@/components/controls/inputs';
import { SectionHeading } from '@/components/surfaces/section';
import { Button } from '@/components/controls/button';
import { useActionState, useState } from 'react';
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

export function CreatePriceItemForm({
  organizationId,
  currency,
}: {
  organizationId: string;
  currency: string;
}) {
  const [state, formAction, pending] = useActionState(createPriceItemAction, INITIAL);
  const [fields, setFields] = useState({ name: '', unit: '', amount: '' });
  const control = (name: keyof typeof fields) => ({ name, value: fields[name], onChange: (event: { target: { value: string } }) => setFields(previous => ({ ...previous, [name]: event.target.value })) });

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="organizationId" value={organizationId} />

      <SectionHeading>Something you charge for</SectionHeading>

      <div className="grid gap-3">
        <TextInput
          {...control('name')}
          type="text"
          required
          maxLength={200}
          placeholder="What it is, e.g. Callout"
          aria-label="Name"
          className="flex-1"
        />
        <TextInput
          {...control('unit')}
          type="text"
          required
          maxLength={40}
          placeholder="Per what, e.g. visit"
          aria-label="Unit"
          className="flex-1"
        />
        <TextInput
          {...control('amount')}
          type="number"
          required
          min={0}
          step={step(currency)}
          placeholder={`Amount in ${currency}`}
          aria-label={`Amount in ${currency}`}
          className="w-full"
        />
      </div>

      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? 'Adding…' : 'Add'}
      </Button>

      <ErrorText role="alert">{state.error}</ErrorText>
      {state.success ? <p role="status" className="text-sm text-success">{state.success}</p> : null}
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
  const [fields, setFields] = useState({ name: item.name, unit: item.unit, amount: minorToTyped(item.unitAmountMinor, item.currency) });
  const control = (name: keyof typeof fields) => ({ name, value: fields[name], onChange: (event: { target: { value: string } }) => setFields(previous => ({ ...previous, [name]: event.target.value })) });

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 py-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="itemId" value={item.id} />

      <TextInput
        {...control('name')}
        type="text"
        required
        maxLength={200}
        aria-label={`Name of ${item.name}`}
        size="small"
        className="min-w-0 flex-1"
      />
      <span className="text-sm text-subtle">per</span>
      <TextInput
        {...control('unit')}
        type="text"
        required
        maxLength={40}
        aria-label={`Unit of ${item.name}`}
        size="small"
        className="w-28"
      />
      <TextInput
        {...control('amount')}
        type="number"
        required
        min={0}
        step={step(item.currency)}
        aria-label={`Amount for ${item.name}`}
        size="small"
        className="w-28"
      />
      <span className="text-sm text-subtle">{item.currency}</span>
      <Button type="submit" disabled={pending} tone="secondary" size="tiny">
        Save
      </Button>

      <ErrorText role="alert" className="w-full">{state.error}</ErrorText>
      {state.success ? <p role="status" className="w-full text-sm text-success">{state.success}</p> : null}
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

'use client';

import { useActionState } from 'react';
import { OptionalSelect, type SelectOption } from '@/components/optional-select';
import type { PriceBookItem } from '@/lib/domain/pricing/price-book';
import {
  addChecklistItemAction,
  addPricedLineAction,
  recordCostAction,
  recordTimeAction,
  removePricedLineAction,
  setChecklistItemDoneAction,
  type WorkItemActionState,
} from './actions';

const INITIAL: WorkItemActionState = { error: null };

const INPUT_CLASS = 'flex-1 rounded border border-black/15 px-3 py-2 dark:border-white/20';
const SMALL_INPUT = 'rounded border border-black/15 px-2 py-1 text-xs dark:border-white/20';

export function ToggleChecklistItemForm({
  organizationId,
  workItemId,
  checklistItemId,
  label,
  done,
}: {
  organizationId: string;
  workItemId: string;
  checklistItemId: string;
  label: string;
  done: boolean;
}) {
  const [state, formAction, pending] = useActionState(setChecklistItemDoneAction, INITIAL);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <input type="hidden" name="checklistItemId" value={checklistItemId} />
      <input type="hidden" name="done" value={done ? '0' : '1'} />

      <button
        type="submit"
        disabled={pending}
        aria-pressed={done}
        className={`${SMALL_INPUT} disabled:opacity-50`}
      >
        {done ? '☑' : '☐'}
      </button>
      <span className={done ? 'text-sm line-through opacity-60' : 'text-sm'}>{label}</span>

      {state.error ? (
        <span role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

export function AddChecklistItemForm({
  organizationId,
  workItemId,
  position,
}: {
  organizationId: string;
  workItemId: string;
  position: number;
}) {
  const [state, formAction, pending] = useActionState(addChecklistItemAction, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <input type="hidden" name="position" value={position} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="label"
          type="text"
          required
          maxLength={200}
          placeholder="A step, e.g. Photograph the meter"
          aria-label="Step"
          className={INPUT_CLASS}
        />
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded border border-black/15 px-4 py-2 disabled:opacity-50 dark:border-white/20"
        >
          {pending ? 'Adding…' : 'Add step'}
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function RecordTimeForm({
  organizationId,
  workItemId,
  resources,
}: {
  organizationId: string;
  workItemId: string;
  resources: SelectOption[];
}) {
  const [state, formAction, pending] = useActionState(recordTimeAction, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />

      <div className="flex flex-wrap items-center gap-2">
        <input name="startedAt" type="datetime-local" aria-label="Started at" className={SMALL_INPUT} />
        <input name="endedAt" type="datetime-local" aria-label="Ended at" className={SMALL_INPUT} />
        <OptionalSelect name="resourceId" label="Worked by" options={resources} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="note"
          type="text"
          maxLength={1000}
          placeholder="What was done (optional)"
          aria-label="Note"
          className={INPUT_CLASS}
        />
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded border border-black/15 px-4 py-2 disabled:opacity-50 dark:border-white/20"
        >
          {pending ? 'Recording…' : 'Record time'}
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function RecordCostForm({
  organizationId,
  workItemId,
  currency,
}: {
  organizationId: string;
  workItemId: string;
  currency: string;
}) {
  const [state, formAction, pending] = useActionState(recordCostAction, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-col gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="description"
          type="text"
          required
          maxLength={200}
          placeholder="What was spent on, e.g. Replacement valve"
          aria-label="Description"
          className={INPUT_CLASS}
        />
        {/* Minor units, asked for as minor units. The alternative — accepting 12.50 and
            multiplying by 100 — is where a rounding bug enters and is not found until a
            reconciliation months later. The currency is the organization's and is not a
            field here: a caller does not assert what a business trades in. */}
        <input
          name="amountMinor"
          type="number"
          required
          step={1}
          placeholder={`Amount in minor units (${currency})`}
          aria-label={`Amount in minor units, ${currency}`}
          className={INPUT_CLASS}
        />
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded border border-black/15 px-4 py-2 disabled:opacity-50 dark:border-white/20"
        >
          {pending ? 'Recording…' : 'Record cost'}
        </button>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Put something from the catalogue on this job.
 *
 * There is no amount input, and its absence is the feature. A quantity and an item is all a
 * caller supplies; the price is copied from the catalogue by the database. Somebody who
 * should be able to type an amount onto a job is asking for a cost, which is a different form
 * a few sections up, and a different thing (`roadmap.md` M2 on why a cost is not a price).
 */
export function AddPricedLineForm({
  organizationId,
  workItemId,
  items,
}: {
  organizationId: string;
  workItemId: string;
  items: PriceBookItem[];
}) {
  const [state, formAction, pending] = useActionState(addPricedLineAction, INITIAL);

  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />

      <select
        name="priceBookItemId"
        required
        aria-label="Priced item"
        className="min-w-0 flex-1 rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20"
      >
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} · per {item.unit}
          </option>
        ))}
      </select>
      <input
        name="quantity"
        type="number"
        required
        min={1}
        step={1}
        defaultValue={1}
        aria-label="Quantity"
        className="w-20 rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-black/15 px-2 py-1 text-xs disabled:opacity-50 dark:border-white/20"
      >
        {pending ? 'Adding…' : 'Add to quote'}
      </button>

      {state.error ? (
        <p role="alert" className="w-full text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

/** Strike one line off. A quote changes by removal and re-adding, never by amendment. */
export function RemovePricedLineForm({
  organizationId,
  workItemId,
  lineId,
  description,
}: {
  organizationId: string;
  workItemId: string;
  lineId: string;
  description: string;
}) {
  const [state, formAction, pending] = useActionState(removePricedLineAction, INITIAL);

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="workItemId" value={workItemId} />
      <input type="hidden" name="lineId" value={lineId} />
      <button
        type="submit"
        disabled={pending}
        aria-label={`Remove ${description}`}
        className="text-xs underline underline-offset-4 opacity-60 disabled:opacity-30"
      >
        Remove
      </button>
      {state.error ? (
        <span role="alert" className="ml-2 text-xs text-red-600 dark:text-red-400">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

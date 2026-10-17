import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { parseWindow, type Window } from '@/lib/domain/scheduling/window';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a job actually consumed: time worked, and money spent.
 *
 * **A cost is not a price.** A price is derived from configuration a business publishes, and
 * the one-calculation rule says there is exactly one calculation for it; that is a separate, later change. A cost is an observation
 * about a job that already happened — what the part cost, what the subcontractor charged —
 * and needs no engine at all. Nothing here computes anything, and nothing here may start to:
 * the moment a rate appears on a resource and an hour becomes an amount, that is the one-calculation rule's
 * territory and belongs in one place with the rest of pricing.
 *
 * The minor-units money rule lives here: money is integer minor units, and the currency is the tenant's, snapshotted
 * onto each row at the moment it is written.
 */

export type TimeEntry = {
  id: string;
  /** What actually happened, as distinct from `work_items.scheduled_during`, which was the plan. */
  worked: Window;
  resourceId: string | null;
  note: string | null;
};

export type Cost = {
  id: string;
  description: string;
  /** Integer minor units. Never a float, and never divided before it reaches a formatter. */
  amountMinor: number;
  /** As it was when the cost was recorded, not as the organization reads today. */
  currency: string;
  incurredAt: string;
};

const DESCRIPTION_MAX = 200;
const NOTE_MAX = 1000;

/**
 * Render an amount in its own snapshotted currency.
 *
 * The division by 100 happens here and nowhere else, which is the practical form of "money is
 * integer minor units": every other layer holds the integer, so nothing can round it twice
 * or add two floats together.
 *
 * `minimumFractionDigits` comes from the currency rather than being assumed to be two — a
 * business trading in JPY has no minor unit, and hardcoding two would print ¥1,00.
 */
export function formatMoney(amountMinor: number, currency: string): string {
  try {
    const formatter = new Intl.NumberFormat('en-GB', { style: 'currency', currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amountMinor / 10 ** digits);
  } catch {
    // A code matching `^[A-Z]{3}$` that ICU does not know. The check constraint is the honest
    // limit of what the database can verify, so this path is reachable.
    return `${amountMinor} ${currency}`;
  }
}

export async function listTimeEntries(
  db: Db,
  input: { organizationId: string; workItemId: string },
): Promise<TimeEntry[]> {
  const { data, error } = await db
    .from('work_item_time_entries')
    .select('id, worked_during, resource_id, note')
    .eq('organization_id', input.organizationId)
    .eq('work_item_id', input.workItemId);

  if (error) {
    throw new DomainError(error.message, 'time_entries.list_failed');
  }

  return (data ?? []).flatMap((row) => {
    // the forward-only migration rule's boundary: `supabase gen types` has no TypeScript for a Postgres range.
    const worked = parseWindow(row.worked_during as string | null);
    if (!worked) return [];
    return [{ id: row.id, worked, resourceId: row.resource_id, note: row.note }];
  });
}

export async function recordTime(
  db: Db,
  input: {
    workItemId: string;
    resourceId?: string | null;
    startedAt: string;
    endedAt: string;
    note?: string | null;
  },
): Promise<string> {
  await requireActor(db);

  const started = new Date(input.startedAt);
  const ended = new Date(input.endedAt);

  if (Number.isNaN(started.getTime()) || Number.isNaN(ended.getTime())) {
    throw new DomainError('That is not a time.', 'time_entries.window_invalid');
  }
  if (ended <= started) {
    throw new DomainError(
      'Time worked must end after it starts.',
      'time_entries.window_backwards',
    );
  }

  const note = input.note?.trim() || null;
  if (note && note.length > NOTE_MAX) {
    throw new DomainError(
      `That note is longer than ${NOTE_MAX} characters.`,
      'time_entries.note_too_long',
    );
  }

  const { data, error } = await db.rpc('record_work_item_time', {
    p_work_item_id: input.workItemId,
    // the forward-only migration rule: Postgres records no nullability for a function argument.
    p_resource_id: (input.resourceId || null) as string,
    p_started_at: started.toISOString(),
    p_ended_at: ended.toISOString(),
    p_note: note as string,
  });

  if (error) {
    if (error.code === '23503') {
      throw new DomainError(
        'No such work item or resource here.',
        'time_entries.reference_not_found',
      );
    }
    if (error.code === '23514') {
      throw new DomainError(
        'Time worked must end after it starts.',
        'time_entries.window_backwards',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot record time here.', 'time_entries.forbidden');
    }
    throw new DomainError(error.message, 'time_entries.create_failed');
  }

  return data;
}

export async function listCosts(
  db: Db,
  input: { organizationId: string; workItemId: string },
): Promise<Cost[]> {
  const { data, error } = await db
    .from('work_item_costs')
    .select('id, description, amount_minor, currency, incurred_at')
    .eq('organization_id', input.organizationId)
    .eq('work_item_id', input.workItemId)
    .order('incurred_at', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'costs.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    description: row.description,
    amountMinor: row.amount_minor,
    currency: row.currency,
    incurredAt: row.incurred_at,
  }));
}

/**
 * Record what a job cost.
 *
 * The currency is not an argument. `record_work_item_cost` reads it from the organization and
 * writes it onto the row, so a caller cannot assert what a business trades in, and a later
 * change of currency does not silently reinterpret what this job cost.
 *
 * **`incurredAt` is when the cost happened, not when it was entered**, and it is optional
 * because most costs are entered as they happen. The row has always carried both dates and
 * only `created_at` was ever writable, which made a receipt from last Tuesday claim to be from
 * whenever somebody got round to it. `recordPayment` has taken this argument since invoices
 * arrived; this is the same one, on the sibling that was overlooked.
 */
export async function recordCost(
  db: Db,
  input: {
    workItemId: string;
    description: string;
    amountMinor: number;
    incurredAt?: string | null;
  },
): Promise<string> {
  await requireActor(db);

  const description = input.description.trim();
  if (description.length === 0) {
    throw new DomainError('A cost needs a description.', 'costs.description_required');
  }
  if (description.length > DESCRIPTION_MAX) {
    throw new DomainError(
      `That description is longer than ${DESCRIPTION_MAX} characters.`,
      'costs.description_too_long',
    );
  }

  if (!Number.isInteger(input.amountMinor)) {
    throw new DomainError(
      'An amount is a whole number of minor units — 1250, not 12.50.',
      'costs.amount_not_integer',
    );
  }
  if (input.amountMinor === 0) {
    throw new DomainError('A cost of nothing is not a cost.', 'costs.amount_zero');
  }

  // Null means "now", decided in the database rather than here, so a cost entered as it
  // happens carries the instant the row was written rather than one this process guessed.
  let incurredAt: string | null = null;
  if (input.incurredAt) {
    const incurred = new Date(input.incurredAt);
    if (Number.isNaN(incurred.getTime())) {
      throw new DomainError('That is not a date.', 'costs.incurred_invalid');
    }
    incurredAt = incurred.toISOString();
  }

  const { data, error } = await db.rpc('record_work_item_cost', {
    p_work_item_id: input.workItemId,
    p_description: description,
    p_amount_minor: input.amountMinor,
    // the forward-only migration rule: Postgres records no nullability for a function argument.
    p_incurred_at: incurredAt as string,
  });

  if (error) {
    if (error.code === '23503') {
      throw new DomainError('No such work item here.', 'costs.work_item_not_found');
    }
    if (error.code === '23514') {
      throw new DomainError('A cost of nothing is not a cost.', 'costs.amount_zero');
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot record costs here.', 'costs.forbidden');
    }
    throw new DomainError(error.message, 'costs.create_failed');
  }

  return data;
}

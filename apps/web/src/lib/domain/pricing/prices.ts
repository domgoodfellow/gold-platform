import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a job is quoted, and the one place a price is derived.
 *
 * **`priceWorkItem` is I4.** There is exactly one price calculation, it is that function, and
 * the property is kept the same way I5 keeps "exactly one availability calculation": by there
 * being nothing else that could answer. No component totals lines, no route handler sums an
 * array, no `subtotal` column is written anywhere, and the database holds no generated column
 * that would be a second opinion able to drift from the first.
 *
 * The reason a second one is tempting is worth naming, because it is how this invariant will
 * eventually be broken if it is: a total is trivial arithmetic, so writing `lines.reduce(…)`
 * inline feels like formatting rather than like pricing. It is pricing. The moment a discount,
 * a minimum charge or a tax lands, every inline sum becomes a place the rule was forgotten.
 *
 * A line is a **copy** of a catalogue row, never a join to one — see the migration. Everything
 * here therefore reads the snapshot and nothing reaches back to `price_book_items`, which is
 * what makes re-pricing the catalogue safe (I8).
 */

export type PricedLine = {
  id: string;
  /** The catalogue item's name, as it read when this line was added. Not a live join. */
  description: string;
  unit: string;
  /** Integer minor units, snapshotted. */
  unitAmountMinor: number;
  /** Snapshotted too, which is what makes the total well defined (I10). */
  currency: string;
  quantity: number;
};

/** What a job comes to. `null` when nothing has been priced — not zero, which is a claim. */
export type Price = {
  totalMinor: number;
  currency: string;
} | null;

/**
 * The price of a work item.
 *
 * Integer arithmetic end to end, and **no rounding rule, because nothing rounds**: quantity is
 * a whole number, so `unitAmountMinor * quantity` is exact. That is a real constraint on the
 * product rather than a simplification — a business billing half-hours prices per half-hour.
 * When a fractional quantity earns its way in, how a half-cent rounds is a pricing decision
 * and it belongs *in this function*, which is precisely why there must not be a second one.
 *
 * Nothing priced is `null` rather than zero. A job with no lines has not been quoted; a job
 * quoted at nothing is a business decision somebody made, and rendering them identically
 * would erase the difference at exactly the moment it matters.
 *
 * The mixed-currency throw is unreachable through the database, and is here for the same
 * reason `parseCustom` re-checks the registry: `work_item_priced_lines_one_currency` is the
 * guarantee, this produces a sentence if the constraint is ever dropped.
 */
export function priceWorkItem(lines: PricedLine[]): Price {
  if (lines.length === 0) return null;

  const [first] = lines;
  if (lines.some((line) => line.currency !== first.currency)) {
    throw new DomainError(
      'This job has lines in more than one currency, so it has no single total.',
      'prices.mixed_currency',
    );
  }

  return {
    totalMinor: lines.reduce((total, line) => total + line.unitAmountMinor * line.quantity, 0),
    currency: first.currency,
  };
}

export async function listPricedLines(
  db: Db,
  input: { organizationId: string; workItemId: string },
): Promise<PricedLine[]> {
  const { data, error } = await db
    .from('work_item_priced_lines')
    .select('id, description, unit, unit_amount_minor, currency, quantity, created_at')
    .eq('organization_id', input.organizationId)
    .eq('work_item_id', input.workItemId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'prices.lines_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    description: row.description,
    unit: row.unit,
    unitAmountMinor: row.unit_amount_minor,
    currency: row.currency,
    quantity: row.quantity,
  }));
}

/**
 * Put something from the catalogue on a job.
 *
 * The amount is not an argument and cannot be. `add_work_item_priced_line` reads the
 * catalogue row and copies it, so a caller can choose *what* and *how many* but never *how
 * much* — which is the difference between quoting from a price book and typing a number onto
 * an invoice.
 */
export async function addPricedLine(
  db: Db,
  input: { workItemId: string; priceBookItemId: string; quantity: number },
): Promise<string> {
  await requireActor(db);

  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new DomainError(
      'A quantity is a whole number, one or more.',
      'prices.quantity_invalid',
    );
  }

  const { data, error } = await db.rpc('add_work_item_priced_line', {
    p_work_item_id: input.workItemId,
    p_price_book_item_id: input.priceBookItemId,
    p_quantity: input.quantity,
  });

  if (error) {
    // The exclusion constraint. Reachable only after a business changed the currency it
    // trades in and then quoted from both halves of its catalogue, which is exactly the case
    // the constraint exists for.
    if (error.code === '23P01') {
      throw new DomainError(
        'This job is already priced in another currency. Re-price that item first.',
        'prices.mixed_currency',
      );
    }
    if (error.code === '23503') {
      throw new DomainError('That is not something this business prices.', 'prices.unknown_item');
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot price work here.', 'prices.forbidden');
    }
    throw new DomainError(error.message, 'prices.line_failed');
  }

  return data;
}

/**
 * Strike a line off a quote.
 *
 * Removal rather than editing, because an amount on a line is a snapshot and a snapshot that
 * can be amended in place is not one ("never rewrite history"). There is no update policy on
 * the table at all, so this is the only way a line changes.
 */
export async function removePricedLine(db: Db, input: { id: string }): Promise<void> {
  await requireActor(db);

  const { error } = await db.rpc('remove_work_item_priced_line', { p_id: input.id });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot price work here.', 'prices.forbidden');
    }
    throw new DomainError(error.message, 'prices.remove_failed');
  }
}

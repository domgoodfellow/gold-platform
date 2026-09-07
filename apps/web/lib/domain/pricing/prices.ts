import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a job is quoted, and the one place a price is derived — `priceWorkItem` is I4. No
 * component totals lines, no route sums an array, no `subtotal` column exists anywhere. A line
 * is a copy of a catalogue row, never a join to one, so re-pricing the catalogue never touches
 * an existing quote (I8).
 */

export type PricedLine = {
  id: string;
  /** The catalogue item's name as it read when this line was added — not a live join. */
  description: string;
  unit: string;
  /** Integer minor units, snapshotted. */
  unitAmountMinor: number;
  /** Snapshotted too, which is what makes the total well defined (I10). */
  currency: string;
  quantity: number;
};

/** `null` when nothing has been priced — not zero, which is a claim. */
export type Price = {
  totalMinor: number;
  currency: string;
} | null;

/**
 * The price of a work item. Integer arithmetic end to end with no rounding rule, because
 * nothing rounds — quantity is a whole number, so the multiplication is exact. A fractional
 * quantity, when it arrives, brings its rounding decision here and nowhere else. The
 * mixed-currency throw is unreachable through the database (`work_item_priced_lines_one_currency`
 * guarantees it) and exists only in case that constraint is ever dropped.
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

/** The amount is never an argument — `add_work_item_priced_line` reads the catalogue row and copies it, so a caller chooses what and how many but never how much. */
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
    // Reachable after a business changes what it trades in and quotes from both halves of its catalogue.
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

/** Removal, not editing — a priced line is a snapshot, and there's no update policy on the table at all. */
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

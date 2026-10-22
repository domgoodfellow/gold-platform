import type { Db } from '@/lib/db/types';
import { LIST_LIMIT, counted, type Counted } from '@/lib/domain/counted';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a job is quoted, and the one place a price is derived — `priceWorkItem` is the one-calculation rule. No
 * component totals lines, no route sums an array, no `subtotal` column exists anywhere. A line
 * is a copy of a catalogue row, never a join to one, so re-pricing the catalogue never touches
 * an existing quote.
 */

export type PricedLine = {
  id: string;
  /** The catalogue item's name as it read when this line was added — not a live join. */
  description: string;
  unit: string;
  /** Integer minor units, snapshotted. */
  unitAmountMinor: number;
  /** Snapshotted too, which is what makes the total well defined. */
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
/** A job that has something priced on it — the quote — with the lines exactly as they were priced. */
export type PricedWork = {
  workItemId: string;
  title: string;
  status: string;
  customer: { id: string; name: string } | null;
  createdAt: string;
  lines: PricedLine[];
};

/**
 * The jobs this business has priced, newest first, each with all of its lines. A quote is a job
 * with priced lines (there is no quote table), so this is that list; the amount is
 * `priceWorkItem` over `lines`, applied by the caller. The lines are the snapshots on the
 * job, never re-read from the price book. `!inner` keeps a job with nothing priced out, and
 * the limit counts whole jobs rather than lines, so no job is shown with part of its quote.
 */
export async function listPricedWork(
  db: Db,
  input: { organizationId: string; limit?: number },
): Promise<Counted<PricedWork>> {
  const { data, error, count } = await db
    .from('work_items')
    .select(
      'id, title, created_at, status:work_item_statuses!work_items_status_same_org_and_type (name), customer:contacts!work_items_customer_same_org (id, name), lines:work_item_priced_lines!work_item_priced_lines_work_item_same_org!inner (id, description, unit, unit_amount_minor, currency, quantity, created_at)',
      { count: 'exact' },
    )
    .eq('organization_id', input.organizationId)
    .order('created_at', { ascending: false })
    .limit(input.limit ?? LIST_LIMIT);

  if (error) {
    throw new DomainError(error.message, 'prices.work_failed');
  }

  const first = <T,>(value: T | T[] | null): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

  return counted(
    (data ?? []).map((row) => {
      const status = first(row.status);
      const customer = first(row.customer);
      return {
        workItemId: row.id,
        title: row.title,
        status: status?.name ?? '',
        customer: customer ? { id: customer.id, name: customer.name } : null,
        createdAt: row.created_at,
        lines: [...row.lines]
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((line) => ({
            id: line.id,
            description: line.description,
            unit: line.unit,
            unitAmountMinor: line.unit_amount_minor,
            currency: line.currency,
            quantity: line.quantity,
          })),
      };
    }),
    count,
  );
}

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

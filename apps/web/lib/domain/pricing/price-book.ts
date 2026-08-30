import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a business charges for.
 *
 * **This directory is not a module and does not claim to be one.** `domain-model.md` lists
 * `pricing` under "Not yet modules", which forbids naming a module before two independent
 * pieces of evidence want it — and `lib/domain/scheduling/` is the settled precedent that a
 * domain directory is a different thing entirely: `scheduling` sits in that same list while
 * that directory has existed since M2. What the rule forbids is claiming generality, not
 * writing the code concretely for the business in front of us.
 *
 * **Nothing here calculates a price.** That is deliberate and it is I4: there is exactly one
 * price calculation, it lives with the lines that consume this catalogue, and the surest way
 * to end up with two of them is to put a convenience total here as well.
 *
 * Money is integer minor units throughout, and every amount carries the currency it was
 * written in (I10). `formatMoney` in `work-items/consumption.ts` remains the only place a
 * minor unit is divided — pricing does not get a second formatter, because a second one is
 * how JPY starts printing with a decimal point in one half of the application.
 */

export type PriceBookItem = {
  id: string;
  /** The tenant's own word for what it sells. The platform ships no catalogue. */
  name: string;
  /** What one of it is: "hour", "visit", "each". A label, not an enum. */
  unit: string;
  /** Integer minor units. Never divided before it reaches a formatter. */
  unitAmountMinor: number;
  /** As it was when this item was priced, not as the organization reads today (I8). */
  currency: string;
  createdAt: string;
};

const NAME_MAX = 200;
const UNIT_MAX = 40;

/**
 * The largest amount this can hold, and why the check is here rather than only in Postgres.
 *
 * `unit_amount_minor` is `bigint`, which exceeds what a JavaScript number represents exactly.
 * A value beyond `Number.MAX_SAFE_INTEGER` would round on the way through this layer and the
 * rounding would be invisible — so the boundary is refused rather than silently crossed.
 * Twenty-one million euro was the figure `work_item_costs` chose bigint for; this is four
 * orders of magnitude above that and still exact.
 */
const AMOUNT_MAX = Number.MAX_SAFE_INTEGER;

function normaliseName(value: string): string {
  const name = value.trim();
  if (name.length === 0) {
    throw new DomainError('A priced item needs a name.', 'prices.name_required');
  }
  if (name.length > NAME_MAX) {
    throw new DomainError(
      `That name is longer than ${NAME_MAX} characters.`,
      'prices.name_too_long',
    );
  }
  return name;
}

function normaliseUnit(value: string): string {
  const unit = value.trim();
  if (unit.length === 0) {
    throw new DomainError(
      'A priced item needs a unit — what one of it is.',
      'prices.unit_required',
    );
  }
  if (unit.length > UNIT_MAX) {
    throw new DomainError(`That unit is longer than ${UNIT_MAX} characters.`, 'prices.unit_too_long');
  }
  return unit;
}

/**
 * The amount rule, in one place because two callers need it.
 *
 * Zero is allowed: an item a business includes at no charge is a real thing to publish.
 * Negative is not, and the reason is not arithmetic — `constraints.md` defers discounting
 * until travel cost modelling can bound it, and a negative line item would be that feature
 * arriving with none of the reasoning attached.
 */
function normaliseAmount(value: number): number {
  if (!Number.isInteger(value)) {
    throw new DomainError(
      'An amount is in whole minor units — 4250 for €42.50, never 42.5.',
      'prices.amount_not_integer',
    );
  }
  if (value < 0) {
    throw new DomainError('A price cannot be negative.', 'prices.amount_negative');
  }
  if (value > AMOUNT_MAX) {
    throw new DomainError('That amount is too large to record exactly.', 'prices.amount_too_large');
  }
  return value;
}

/**
 * Everything this tenant prices, in its own order.
 *
 * The `organization_id` filter is an optimisation, not the boundary — RLS decided which rows
 * exist before this ran.
 */
export async function listPriceBookItems(
  db: Db,
  input: { organizationId: string },
): Promise<PriceBookItem[]> {
  const { data, error } = await db
    .from('price_book_items')
    .select('id, name, unit, unit_amount_minor, currency, created_at')
    .eq('organization_id', input.organizationId)
    .order('name', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'prices.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    unit: row.unit,
    unitAmountMinor: row.unit_amount_minor,
    currency: row.currency,
    createdAt: row.created_at,
  }));
}

/**
 * Add something to the catalogue.
 *
 * The currency is deliberately not an argument. `create_price_book_item` reads it from the
 * organization and writes it onto the row, so a caller cannot assert what a business prices
 * in — the same shape `record_work_item_cost` has, and for the same reason (I10).
 */
export async function createPriceBookItem(
  db: Db,
  input: {
    organizationId: string;
    name: string;
    unit: string;
    unitAmountMinor: number;
  },
): Promise<string> {
  await requireActor(db);

  const { data, error } = await db.rpc('create_price_book_item', {
    p_organization_id: input.organizationId,
    p_name: normaliseName(input.name),
    p_unit: normaliseUnit(input.unit),
    p_unit_amount_minor: normaliseAmount(input.unitAmountMinor),
  });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        `You already price something called ${input.name.trim()}.`,
        'prices.name_taken',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot manage prices here.', 'prices.forbidden');
    }
    throw new DomainError(error.message, 'prices.create_failed');
  }

  return data;
}

/**
 * Re-price something, or rename it.
 *
 * Safe for a reason worth stating rather than assuming: nothing already quoted reads this row
 * again. A work item's priced lines copy what they need when they are added, so this changes
 * what the next job is quoted and nothing about a job that exists (I8) — the same property
 * that makes editing a checklist template safe.
 *
 * The currency is not editable, by anyone, through any path: the column grant refuses it.
 * Changing it would reinterpret the amount rather than convert it, which is the same
 * distinction that keeps a field definition's `kind` frozen.
 */
export async function updatePriceBookItem(
  db: Db,
  input: {
    id: string;
    name: string;
    unit: string;
    unitAmountMinor: number;
  },
): Promise<void> {
  await requireActor(db);

  const { error } = await db.rpc('update_price_book_item', {
    p_id: input.id,
    p_name: normaliseName(input.name),
    p_unit: normaliseUnit(input.unit),
    p_unit_amount_minor: normaliseAmount(input.unitAmountMinor),
  });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        `You already price something called ${input.name.trim()}.`,
        'prices.name_taken',
      );
    }
    if (error.code === '42501') {
      throw new DomainError('You cannot manage prices here.', 'prices.forbidden');
    }
    throw new DomainError(error.message, 'prices.update_failed');
  }
}

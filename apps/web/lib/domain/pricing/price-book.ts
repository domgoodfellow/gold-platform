import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a business charges for. Nothing here calculates a price — that's the one-calculation rule, and lives with the
 * lines that consume this catalogue. Money is integer minor units throughout, with the currency
 * it was written in; `formatMoney` in `work-items/consumption.ts` remains the only place
 * a minor unit is divided.
 */

export type PriceBookItem = {
  id: string;
  /** The tenant's own word for what it sells. The platform ships no catalogue. */
  name: string;
  /** What one of it is: "hour", "visit", "each". A label, not an enum. */
  unit: string;
  /** Integer minor units. Never divided before it reaches a formatter. */
  unitAmountMinor: number;
  /** As it was when this item was priced, not as the organization reads today. */
  currency: string;
  createdAt: string;
};

const NAME_MAX = 200;
const UNIT_MAX = 40;

/** `unit_amount_minor` is `bigint`, beyond what a JS number represents exactly — refused here rather than silently rounded on the way through. */
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

/** Zero allowed (a no-charge item is real); negative isn't — discounting is deliberately deferred, and a negative line would be that feature arriving with no reasoning attached. */
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

/** Currency is never an argument — `create_price_book_item` reads it from the organization, so a caller can't assert what a business prices in. */
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
 * Re-price something, or rename it. Safe because nothing already quoted reads this row again —
 * a priced line copies what it needs when added, so this changes only the next job quoted.
 * Currency isn't editable by anyone, through any path — the column grant refuses it, since
 * changing it would reinterpret the amount rather than convert it.
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

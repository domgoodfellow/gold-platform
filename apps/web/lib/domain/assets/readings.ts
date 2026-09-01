import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * What a machine's counter said, and when.
 *
 * **The third trigger shape's input**, and the one `constraints.md` warns is easy to miss: a
 * schedule fires at a time, a reading from outside fires on somebody else's number, and this
 * fires when a counter a person or a sensor advances crosses a line. The four hundredth hour is
 * the event, and nothing happened at any particular moment to announce it.
 *
 * **What it counts is the business's word.** Hours, kilometres, cycles, litres — the platform
 * keeps no list, because a counter is a counter whatever it measures. What the platform does
 * insist on is that the unit travels with the value and is never assumed, which is the same rule
 * money follows (I10) and the same one the weather thresholds follow.
 *
 * **Append-only.** A correction is a new row, exactly as it is for a recorded cost. A counter
 * that could be edited backwards is a counter that could be made to trip a rule twice, or never
 * — and the whole point of the mark this platform keeps is that it is arithmetic on a log
 * nobody rewrites.
 */

export type AssetReading = {
  id: string;
  value: number;
  unit: string;
  readAt: string;
  createdAt: string;
};

const UNIT_MAX = 16;

export async function listAssetReadings(
  db: Db,
  input: { organizationId: string; assetId: string; limit?: number },
): Promise<AssetReading[]> {
  const { data, error } = await db
    .from('asset_readings')
    .select('id, value, unit, read_at, created_at')
    .eq('organization_id', input.organizationId)
    .eq('asset_id', input.assetId)
    .order('read_at', { ascending: false })
    .limit(input.limit ?? 20);

  if (error) {
    throw new DomainError(error.message, 'assets.readings_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    value: row.value,
    unit: row.unit,
    readAt: row.read_at,
    createdAt: row.created_at,
  }));
}

/**
 * Write down what the counter says.
 *
 * **The rules run inside this write**, in the trigger on the table, each in its own
 * subtransaction — so a business whose maintenance rule is wrong still records its meter
 * reading, and reads the failure on the Automations screen afterwards. That is the same shape a
 * booking has: what a person did stands, and what a rule made of it is recorded separately.
 */
export async function recordAssetReading(
  db: Db,
  input: {
    organizationId: string;
    assetId: string;
    value: number;
    unit: string;
    /** When the counter read this, which is not when somebody typed it in. */
    readAt?: string;
  },
): Promise<void> {
  const actor = await requireActor(db);

  if (!Number.isFinite(input.value) || input.value < 0) {
    throw new DomainError('A counter reads a number that is not negative.', 'assets.reading_invalid');
  }

  const unit = input.unit.trim();
  if (unit.length === 0) {
    throw new DomainError(
      'A reading needs the unit it is counted in — hours, miles, cycles, whatever this business uses.',
      'assets.unit_required',
    );
  }
  if (unit.length > UNIT_MAX) {
    throw new DomainError(
      `That unit is longer than ${UNIT_MAX} characters.`,
      'assets.unit_too_long',
    );
  }

  const { error } = await db.from('asset_readings').insert({
    organization_id: input.organizationId,
    asset_id: input.assetId,
    value: input.value,
    unit,
    read_at: input.readAt || new Date().toISOString(),
    created_by: actor.id,
  });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError('You cannot record readings here.', 'assets.forbidden');
    }
    if (error.code === '23503') {
      throw new DomainError('No such asset here.', 'assets.not_found');
    }
    throw new DomainError(error.message, 'assets.reading_failed');
  }
}

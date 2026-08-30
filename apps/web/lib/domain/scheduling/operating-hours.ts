import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import {
  isoDayOfWeek,
  zonedTimeToInstant,
  type Window,
} from '@/lib/domain/scheduling/window';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * When a business is open, as that business's own configuration.
 *
 * **Nothing in this file knows what a working week is.** There is no Monday-to-Friday, no
 * weekend, no default set, and no opinion about what hour anything starts. A day is a number
 * between 1 and 7 because the calendar has seven days and repeats — a property every one of
 * these businesses already shares, and the only thing assumed here. Which of them a business
 * works, and for how long, is entirely rows.
 *
 * A business that has configured nothing is treated as **always open**, because that is what
 * "it has said nothing" means. Contrast I13, where an unconfigured type is frozen: an empty
 * transition set genuinely asserts that no move is legal, and reading it permissively would
 * void the invariant. An empty hours set asserts nothing, and reading it as *closed* would
 * invent a claim the business never made.
 */
export type OperatingHours = {
  id: string;
  /** ISO 8601: 1 is Monday through 7 is Sunday. A number, never a name (see above). */
  dayOfWeek: number;
  /** Wall-clock in the tenant's zone, `HH:MM:SS`. Not an instant — see the migration. */
  opensAt: string;
  closesAt: string;
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)(:([0-5]\d))?$/;

function normaliseTime(value: string, field: string): string {
  const match = TIME.exec(value.trim());
  if (!match) {
    throw new DomainError(
      `${field} must be a time of day, such as 09:00.`,
      'operating_hours.time_invalid',
    );
  }
  return `${match[1]}:${match[2]}:${match[4] ?? '00'}`;
}

export async function listOperatingHours(
  db: Db,
  input: { organizationId: string },
): Promise<OperatingHours[]> {
  const { data, error } = await db
    .from('operating_hours')
    .select('id, day_of_week, opens_at, closes_at')
    .eq('organization_id', input.organizationId)
    .order('day_of_week', { ascending: true })
    .order('opens_at', { ascending: true });

  if (error) {
    throw new DomainError(error.message, 'operating_hours.list_failed');
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    dayOfWeek: row.day_of_week,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
  }));
}

export async function addOperatingHours(
  db: Db,
  input: {
    organizationId: string;
    dayOfWeek: number;
    opensAt: string;
    closesAt: string;
  },
): Promise<string> {
  await requireActor(db);

  if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 1 || input.dayOfWeek > 7) {
    throw new DomainError(
      'A day is a number from 1 (Monday) to 7 (Sunday).',
      'operating_hours.day_invalid',
    );
  }

  const opensAt = normaliseTime(input.opensAt, 'Opening time');
  const closesAt = normaliseTime(input.closesAt, 'Closing time');

  if (closesAt <= opensAt) {
    // A shift that crosses midnight is two rows on two days, which is what it actually is.
    throw new DomainError(
      'Closing time must be after opening time. A shift that runs past midnight is two periods.',
      'operating_hours.closes_before_opens',
    );
  }

  const { data, error } = await db.rpc('add_operating_hours', {
    p_organization_id: input.organizationId,
    p_day_of_week: input.dayOfWeek,
    p_opens_at: opensAt,
    p_closes_at: closesAt,
  });

  if (error) {
    if (error.code === '23505') {
      throw new DomainError(
        'That opening time is already set for that day.',
        'operating_hours.duplicate',
      );
    }
    if (error.code === '42501') {
      throw new DomainError(
        'You cannot set opening hours here.',
        'operating_hours.forbidden',
      );
    }
    throw new DomainError(error.message, 'operating_hours.create_failed');
  }

  return data;
}

export async function removeOperatingHours(db: Db, input: { id: string }): Promise<void> {
  await requireActor(db);

  const { error } = await db.rpc('remove_operating_hours', { p_id: input.id });

  if (error) {
    if (error.code === '42501') {
      throw new DomainError(
        'You cannot change opening hours here.',
        'operating_hours.forbidden',
      );
    }
    throw new DomainError(error.message, 'operating_hours.delete_failed');
  }
}

/**
 * The absolute windows a business is open for, on one of its own calendar days.
 *
 * Pure, and the bridge between a recurring local reading and the instants everything else
 * works in. An empty `hours` set yields the whole day — "no claim" rather than "closed".
 *
 * @param date `YYYY-MM-DD`, as the tenant reads it.
 * @param within the day's absolute bounds, so a business that is open past its own midnight
 *   is still clipped to the day being asked about.
 */
export function openWindows(
  date: string,
  timeZone: string,
  hours: OperatingHours[],
  within: Window,
): Window[] {
  if (hours.length === 0) {
    return [within];
  }

  const day = isoDayOfWeek(date);

  return hours
    .filter((entry) => entry.dayOfWeek === day)
    .map((entry) => ({
      startsAt: zonedTimeToInstant(date, entry.opensAt, timeZone),
      endsAt: zonedTimeToInstant(date, entry.closesAt, timeZone),
    }))
    .flatMap((window) => {
      // Clip to the day. On the day a zone springs forward, an opening time inside the
      // skipped hour resolves to the instant the clock jumps to, which is the honest answer:
      // the business opens when its clock says so, and that minute did not exist.
      const startsAt = window.startsAt < within.startsAt ? within.startsAt : window.startsAt;
      const endsAt = window.endsAt > within.endsAt ? within.endsAt : window.endsAt;
      return startsAt < endsAt ? [{ startsAt, endsAt }] : [];
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

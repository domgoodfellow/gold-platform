import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import type { Filters, Grouping, Period } from '@/lib/domain/reporting/shape';

/**
 * How much resource time a business has committed.
 *
 * **The third measure, and the one that had to argue for itself.** What counts as a commitment is
 * `work_items_resource_not_double_booked`'s partial predicate, and that predicate already lives in
 * two places — the constraint, and `listSchedule`'s filters — held together by
 * `availability.test.ts` asserting they agree in both directions rather than by one having been
 * deleted. `public.time_committed` is the third, admitted on the terms D35 set for the second
 * price calculation, and `reporting.test.ts` pins it to `listSchedule` on the same jobs.
 *
 * **This is the numerator of utilisation and deliberately not utilisation.** A percentage needs
 * opening hours minus commitments, which is `freeWindows` — the one availability calculation
 * (I5). An aggregate re-deriving that would be a second answer to *what is free*, and no
 * correspondence test would make it safe, because the second answer is the one people would act
 * on when booking. A business dividing this by its own opening hours is doing arithmetic this
 * platform did not invent for it, which is the honest place for that division to live.
 *
 * **Time is clipped to the period.** A job running from the last day of one month into the first
 * of the next belongs to both, in the proportion it actually occupied. Counting the whole window
 * in each would report more committed time than exists.
 */

export type CommitmentGroup = {
  /** The entity this group is about, or null for work attributed to nobody. */
  groupId: string | null;
  label: string | null;
  /**
   * Minutes, and whole ones.
   *
   * The database sums in seconds and divides once, for the reason `formatMoney` divides once: a
   * rounding per row is a rounding repeated, and the total then disagrees with its own rows.
   */
  minutes: number;
};

export async function listTimeCommitted(
  db: Db,
  input: {
    organizationId: string;
    grouping: Grouping;
    period?: Period;
    filters?: Filters;
  },
): Promise<CommitmentGroup[]> {
  const { data, error } = await db.rpc('time_committed', {
    p_organization_id: input.organizationId,
    p_grouping: input.grouping,
    p_from: input.period?.from ?? undefined,
    p_to: input.period?.to ?? undefined,
    p_customer_id: input.filters?.customerId ?? undefined,
    p_resource_id: input.filters?.resourceId ?? undefined,
    p_location_id: input.filters?.locationId ?? undefined,
  });

  if (error) {
    throw new DomainError(error.message, 'reporting.commitment_failed');
  }

  return (data ?? []).map((row) => ({
    groupId: row.group_id,
    label: row.group_label,
    minutes: Number(row.minutes),
  }));
}

/** Every group's time added up. A duration has no currency, so there is one number. */
export function totalMinutes(groups: CommitmentGroup[]): number {
  return groups.reduce((total, group) => total + group.minutes, 0);
}

/**
 * Minutes as a business reads them.
 *
 * The one place a duration is turned into words, for the reason `formatMoney` is the one place a
 * minor unit is divided. Hours and minutes rather than decimal hours: *7h 30m* is what somebody
 * writing a timesheet recognises, and 7.5 invites being multiplied by a rate, which would make
 * this the accounting system `vision.md` refuses to be.
 */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import type { Filters, Grouping, Period } from '@/lib/domain/reporting/shape';

/**
 * How much resource time a business has committed. Pinned to `listSchedule` and the double-
 * booking constraint by `availability.test.ts`/`reporting.test.ts` so the three stay in
 * agreement (D35). The numerator of utilisation, deliberately not utilisation itself — a
 * percentage needs `freeWindows`, the one availability calculation (I5); dividing by opening
 * hours is arithmetic this platform doesn't do for a business. Time is clipped to the period,
 * so a job spanning a month boundary is split in proportion rather than double-counted.
 */

export type CommitmentGroup = {
  groupId: string | null;
  label: string | null;
  /** The database sums in seconds and divides once — dividing per row would make the total disagree with its own rows. */
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

export function totalMinutes(groups: CommitmentGroup[]): number {
  return groups.reduce((total, group) => total + group.minutes, 0);
}

/** Hours and minutes, not decimal hours — decimal invites multiplying by a rate, which would make this the accounting system `vision.md` refuses to be. */
export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

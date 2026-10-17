import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import type { Filters, Grouping, Period } from '@/lib/domain/reporting/shape';

/**
 * How much work a business marked as finished, and when. Says "marked" deliberately —
 * `occurred_at` is when a status changed, not necessarily when the work stopped. Which status
 * means finished is the tenant's own answer (`work_item_statuses.marks_complete`), distinct
 * from `releases_resource` since cancelling frees a resource without completing work. Nothing
 * here computes anything — every number comes from `public.work_marked_complete`.
 */

export type CompletionGroup = {
  groupId: string | null;
  /** Null either because nothing was attributed, or because the reader may not see that row — never distinguished. */
  label: string | null;
  /** Jobs, not events — a job moved out of and back into a finishing status within a period counts once. */
  jobs: number;
};

export async function listWorkMarkedComplete(
  db: Db,
  input: {
    organizationId: string;
    grouping: Grouping;
    period?: Period;
    filters?: Filters;
  },
): Promise<CompletionGroup[]> {
  const { data, error } = await db.rpc('work_marked_complete', {
    p_organization_id: input.organizationId,
    p_grouping: input.grouping,
    p_from: input.period?.from ?? undefined,
    p_to: input.period?.to ?? undefined,
    p_customer_id: input.filters?.customerId ?? undefined,
    p_resource_id: input.filters?.resourceId ?? undefined,
    p_location_id: input.filters?.locationId ?? undefined,
  });

  if (error) {
    throw new DomainError(error.message, 'reporting.completion_failed');
  }

  return (data ?? []).map((row) => ({
    groupId: row.group_id,
    label: row.group_label,
    jobs: Number(row.jobs),
  }));
}

/** A function rather than an inline `reduce` (the one-calculation rule's reasoning about totals). */
export function totalJobs(groups: CompletionGroup[]): number {
  return groups.reduce((total, group) => total + group.jobs, 0);
}

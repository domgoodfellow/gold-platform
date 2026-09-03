import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import type { Filters, Grouping, Period } from '@/lib/domain/reporting/shape';

/**
 * How much work a business marked as finished, and when.
 *
 * **The second measure, and the first that is not money** — which is what takes `requires:
 * 'billing'` off the reporting module: a business that invoices somewhere else can now read
 * something here.
 *
 * **It says *marked* complete, and the word is the honest part.** `events.occurred_at` records
 * when somebody moved a job into a status their business calls finished; nothing passes that
 * function a date, so it is not the instant the work stopped. Reporting it as *completed* would
 * claim a precision this platform does not have, which is the same discipline that makes the
 * financial set say invoiced rather than revenue. If a business needs the other instant, that is
 * a caller-supplied date on `change_work_item_status` and its own slice.
 *
 * **Which status means finished is the tenant's answer**, held in `work_item_statuses.marks_
 * complete`. It is deliberately not `releases_resource` and deliberately not a platform
 * `isTerminal`: Cancelled frees the resource and is not completed work, and one flag could not
 * have said both. M4 is where that reasoning is recorded.
 *
 * **Nothing here computes anything**, on the same terms as `financials.ts`: every number comes
 * from `public.work_marked_complete`, the one aggregate for this question (D35).
 */

export type CompletionGroup = {
  /** The entity this group is about, or null for work attributed to nobody. */
  groupId: string | null;
  /**
   * Today's name for that entity, or null.
   *
   * Two causes, told apart by the grouping the caller asked for: nothing was attributed, or the
   * reader may not see that row. Neither gets a word from the platform.
   */
  label: string | null;
  /**
   * Jobs, not events.
   *
   * A job moved out of a finishing status and back into it inside one period was finished once.
   * Counting the moves would make a business that corrects a mistake look busier than one that
   * does not, which is a number nobody could reproduce from a screen.
   */
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

/**
 * How many jobs in total, across every group.
 *
 * A function rather than a `reduce` on a page, for the reason I4 gives about prices — and one
 * number rather than a set, because a count has no currency and nothing here is being added
 * across a unit that could differ.
 */
export function totalJobs(groups: CompletionGroup[]): number {
  return groups.reduce((total, group) => total + group.jobs, 0);
}

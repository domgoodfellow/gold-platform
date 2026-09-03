import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import type { Filters, Grouping, Period } from '@/lib/domain/reporting/shape';

/**
 * What a business billed and what its work consumed, grouped.
 *
 * **This file computes nothing.** Every figure comes from `public.invoiced_and_incurred`, the
 * one aggregate (D35), for the same reason `TodayPage` reads `listSchedule` rather than
 * filtering work items itself: a second answer to the same question drifts from the first the
 * moment either learns something. What is here is the vocabulary, the call, and one total that
 * would otherwise be an inline sum on a page.
 *
 * **"Revenue" is not a word this module uses, and that is the design.** Four financial facts
 * live in this database and only two of them are dated by something a person chose:
 * *invoiced*, from `invoices.issued_at`, and *incurred*, from `work_item_costs.incurred_at`.
 * *Received* is a third and waits for somebody wanting a cash view.
 *
 * **The fourth is *quoted*, and this comment used to say it could not be reported at all.** That
 * was wrong and `roadmap.md` M7 carries the correction: `work_item.line_added` and
 * `work_item.line_removed` are both recorded with `occurred_at`, so *what we quoted in August* is
 * answerable with no schema change. What it needs is a decision between two different questions —
 * what was quoted **during** a period, and what stands quoted and unbilled **as at** a date —
 * and neither has a caller yet.
 *
 * The consequence is stated rather than hidden: **a business that prices here and invoices
 * somewhere else sees an empty report.** That is the correct answer under this design and it
 * may describe most of them, at which point an empty report in front of a real business is the
 * caller that decides which of those two questions it wanted.
 */

/**
 * One group, within one currency.
 *
 * **The currency is part of the key and never a column beside it.** Amounts carry the currency
 * they were recorded in (I8, I10), so a business that changed what it trades in has two rows for
 * one customer and no single figure — the same refusal `totalCost` makes one level down, and
 * the same one `jobEconomics` expresses as a `null` margin because a job screen wants one
 * number and a report is a table.
 */
export type FinancialGroup = {
  /**
   * The entity this group is about, for a screen to link to. Null when grouping by service,
   * which has no entity — a line snapshots a description and holds no key back to the
   * catalogue (I4, I8) — and null for work attributed to nobody.
   */
  groupId: string | null;
  /**
   * Today's name for an entity, the snapshotted word for a service, or null.
   *
   * Null has two causes and the caller knows which from the grouping it asked for: nothing was
   * attributed, or the reader may not see that row. Neither gets a word from the platform.
   */
  label: string | null;
  currency: string;
  invoicedMinor: number;
  /** Null when the question is not defined — grouping by service, where a cost has no line. */
  incurredMinor: number | null;
  marginMinor: number | null;
};

export async function listInvoicedAndIncurred(
  db: Db,
  input: {
    organizationId: string;
    grouping: Grouping;
    period?: Period;
    filters?: Filters;
  },
): Promise<FinancialGroup[]> {
  const { data, error } = await db.rpc('invoiced_and_incurred', {
    p_organization_id: input.organizationId,
    p_grouping: input.grouping,
    p_from: input.period?.from ?? undefined,
    p_to: input.period?.to ?? undefined,
    p_customer_id: input.filters?.customerId ?? undefined,
    p_resource_id: input.filters?.resourceId ?? undefined,
    p_location_id: input.filters?.locationId ?? undefined,
  });

  if (error) {
    throw new DomainError(error.message, 'reporting.financials_failed');
  }

  return (data ?? []).map((row) => ({
    groupId: row.group_id,
    label: row.group_label,
    currency: row.currency,
    invoicedMinor: Number(row.invoiced_minor),
    incurredMinor: row.incurred_minor === null ? null : Number(row.incurred_minor),
    marginMinor: row.margin_minor === null ? null : Number(row.margin_minor),
  }));
}

/** The same three figures for a whole period, one row per currency. */
export type PeriodTotal = {
  currency: string;
  invoicedMinor: number;
  incurredMinor: number | null;
  marginMinor: number | null;
};

/**
 * What the whole period came to, per currency.
 *
 * A function rather than a `reduce` on the page, for the reason I4 gives about prices and
 * `totalCost` gives about costs: a total looks like formatting right up until something
 * conditions it, and then every inline sum is a place the rule was forgotten.
 *
 * Per currency rather than one number, because there is no rate here and a rate has a date.
 * Grouped rather than summed is the same choice `totalCost` makes, and it is why a business
 * trading in two currencies sees two rows rather than a figure in neither.
 */
export function totalsByCurrency(groups: FinancialGroup[]): PeriodTotal[] {
  const byCurrency = new Map<string, PeriodTotal>();

  for (const group of groups) {
    const running = byCurrency.get(group.currency) ?? {
      currency: group.currency,
      invoicedMinor: 0,
      // Null propagates rather than becoming zero: if cost is not a defined question for this
      // grouping, it is not a defined question for the total either.
      incurredMinor: group.incurredMinor === null ? null : 0,
      marginMinor: group.incurredMinor === null ? null : 0,
    };

    running.invoicedMinor += group.invoicedMinor;

    if (running.incurredMinor !== null && group.incurredMinor !== null) {
      running.incurredMinor += group.incurredMinor;
      running.marginMinor = running.invoicedMinor - running.incurredMinor;
    }

    byCurrency.set(group.currency, running);
  }

  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

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
 * *Received* is a third and waits for somebody wanting a cash view. *Quoted* is the fourth and
 * cannot be reported over a period at all, because a priced line's only date is the instant
 * somebody typed it — which is the finding D35 records rather than a column added on
 * speculation.
 *
 * The consequence is stated rather than hidden: **a business that prices here and invoices
 * somewhere else sees an empty report.** That is the correct answer under this design and it
 * may describe most of them, at which point an empty report in front of a real business is the
 * caller that earns a quote its own date.
 */

/**
 * What a figure can be grouped by.
 *
 * Platform vocabulary rather than tenant configuration, exactly like `CAPABILITIES`: each entry
 * names a grouping the database actually implements, and adding one means writing the SQL.
 * The tenant's own words appear *inside* a grouping — their customers, their services — never
 * as one of these.
 */
export const GROUPINGS = ['customer', 'service', 'resource', 'location'] as const;

export type Grouping = (typeof GROUPINGS)[number];

export const GROUPING_LABELS: Record<Grouping, string> = {
  customer: 'Customer',
  service: 'Service',
  resource: 'Resource',
  location: 'Location',
};

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

/**
 * A period, half-open, as two dates in `YYYY-MM-DD`.
 *
 * Dates rather than instants: the aggregate applies the business's own zone to both ends, from
 * the row that holds it. Both optional — absent means everything on that side.
 */
export type Period = { from?: string; to?: string };

export const PERIODS = ['month', 'year', 'all'] as const;

export type PeriodPreset = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  month: 'This month',
  year: 'This year',
  all: 'Everything',
};

/**
 * A preset turned into two dates.
 *
 * **Dates, not instants, and the conversion deliberately does not happen here** (I9). Where a
 * month begins depends on where the business is, and the aggregate applies the tenant's own
 * zone to both ends — once, from the row that holds it. Converting on this side would put the
 * same arithmetic in every caller, and one of those callers is a language model.
 *
 * What this needs the zone for is only *which* month: a tenant in Auckland and one in Montréal
 * are on different dates for most of the server's day, so `today` comes from `todayInZone`.
 *
 * Half-open, matching the aggregate: the first day is included and the last is not, so a month
 * and the month after it share a boundary and count nothing twice.
 */
export function periodFor(preset: PeriodPreset, today: string): Period {
  if (preset === 'all') return {};

  const [year, month] = today.split('-').map(Number);
  const pad = (value: number) => String(value).padStart(2, '0');

  if (preset === 'year') {
    return { from: `${year}-01-01`, to: `${year + 1}-01-01` };
  }

  return {
    from: `${year}-${pad(month)}-01`,
    to: month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`,
  };
}

export async function listInvoicedAndIncurred(
  db: Db,
  input: { organizationId: string; grouping: Grouping; period?: Period },
): Promise<FinancialGroup[]> {
  const { data, error } = await db.rpc('invoiced_and_incurred', {
    p_organization_id: input.organizationId,
    p_grouping: input.grouping,
    p_from: input.period?.from ?? undefined,
    p_to: input.period?.to ?? undefined,
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

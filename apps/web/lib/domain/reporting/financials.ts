import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import type { Filters, Grouping, Period } from '@/lib/domain/reporting/shape';

/**
 * What a business billed and what its work consumed, grouped. Computes nothing — every figure
 * comes from `public.invoiced_and_incurred` (D35). Says "invoiced" and "incurred", never
 * "revenue": those are the two financial facts dated by something a person chose
 * (`invoices.issued_at`, `work_item_costs.incurred_at`). A business that prices here and
 * invoices elsewhere sees an empty report — the honest answer under this design, not a gap.
 */

export type FinancialGroup = {
  /** Null when grouping by service (a line snapshots a description, holding no key back to the catalogue — I4, I8) or when work is attributed to nobody. */
  groupId: string | null;
  /** Null either because nothing was attributed, or because the reader may not see that row — never distinguished. */
  label: string | null;
  /** Part of the key, never a column beside it — amounts carry the currency they were recorded in (I8, I10), so one customer can have two rows. */
  currency: string;
  invoicedMinor: number;
  /** Null when the question isn't defined — grouping by service, where a cost has no line. */
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

export type PeriodTotal = {
  currency: string;
  invoicedMinor: number;
  incurredMinor: number | null;
  marginMinor: number | null;
};

/** A function rather than an inline `reduce` (I4). Per currency, not one number — there's no conversion rate here (same choice as `totalCost`). */
export function totalsByCurrency(groups: FinancialGroup[]): PeriodTotal[] {
  const byCurrency = new Map<string, PeriodTotal>();

  for (const group of groups) {
    const running = byCurrency.get(group.currency) ?? {
      currency: group.currency,
      invoicedMinor: 0,
      // Null propagates rather than becoming zero — if cost isn't defined for this grouping, it isn't defined for the total either.
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

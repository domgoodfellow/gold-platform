import type { Db } from '@/lib/db/types';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import type { Filters, Grouping, Period } from '@/lib/domain/reporting/shape';

/**
 * What a business billed and what its work consumed, grouped. Computes nothing — every figure
 * comes from `public.invoiced_and_incurred`. Says "invoiced" and "incurred", never
 * "revenue": those are the two financial facts dated by something a person chose
 * (`invoices.issued_at`, `work_item_costs.incurred_at`). A business that prices here and
 * invoices elsewhere sees an empty report — the honest answer under this design, not a gap.
 */

export type FinancialGroup = {
  /** Null when grouping by service (a line snapshots a description, holding no key back to the catalogue — the one-calculation rule, the preserved-history rule) or when work is attributed to nobody. */
  groupId: string | null;
  /** Null either because nothing was attributed, or because the reader may not see that row — never distinguished. */
  label: string | null;
  /** Part of the key, never a column beside it — amounts carry the currency they were recorded in, so one customer can have two rows. */
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
  const pageSize = 500;
  const groups: FinancialGroup[] = [];
  for (let offset = 0; ; offset += pageSize) {
    // Read every group before computing totals; PostgREST caps a single response.
    const { data, error } = await db.rpc('invoiced_and_incurred', {
      p_organization_id: input.organizationId,
      p_grouping: input.grouping,
      p_from: input.period?.from ?? undefined,
      p_to: input.period?.to ?? undefined,
      p_customer_id: input.filters?.customerId ?? undefined,
      p_resource_id: input.filters?.resourceId ?? undefined,
      p_location_id: input.filters?.locationId ?? undefined,
    }).order('currency').order('group_id', { nullsFirst: true }).order('group_label', { nullsFirst: true }).range(offset, offset + pageSize - 1);

    if (error) {
      throw fromDatabaseError(error, 'reporting.financials_failed');
    }

    groups.push(...(data ?? []).map((row) => ({
      groupId: row.group_id,
      label: row.group_label,
      currency: row.currency,
      invoicedMinor: Number(row.invoiced_minor),
      incurredMinor: row.incurred_minor === null ? null : Number(row.incurred_minor),
      marginMinor: row.margin_minor === null ? null : Number(row.margin_minor),
    })));
    if ((data?.length ?? 0) < pageSize) return groups;
  }
}

export type PeriodTotal = {
  currency: string;
  invoicedMinor: number;
  incurredMinor: number | null;
  marginMinor: number | null;
};

/** Same canonical facts and access boundary, grouped in Postgres rather than in the web process. */
export async function readFinancialTotals(db: Db, organizationId: string, from: string, to: string): Promise<PeriodTotal[]> {
  const { data, error } = await db.rpc('home_financial_totals', { p_organization_id: organizationId, p_from: from, p_to: to });
  if (error) throw fromDatabaseError(error, 'reporting.financials_failed');
  const amount = (value: number) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) throw new DomainError('Financial amount exceeds the supported display range.', 'reporting.amount_out_of_range');
    return n;
  };
  return (data ?? []).map(row => ({ currency: row.currency, invoicedMinor: amount(row.invoiced_minor), incurredMinor: amount(row.incurred_minor), marginMinor: amount(row.margin_minor) }));
}

/** A function rather than an inline `reduce`. Per currency, not one number — there's no conversion rate here (same choice as `totalCost`). */
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

import type { Db } from '@/lib/db/types';
import { listOrganizationPayments, type PaymentRecord } from '@/lib/domain/billing/invoices';
import { listInvoicedAndIncurred, totalsByCurrency, type PeriodTotal } from '@/lib/domain/reporting/financials';
import { periodFor } from '@/lib/domain/reporting/shape';
import { listEnabledModules, outstandingModuleSetup } from '@/lib/domain/tenancy/modules';
import type { ModuleKey } from '@/lib/navigation';
import { loadFinanceInvoices, outstandingByCurrency, type FinanceInvoiceRow } from './invoices';
import { awaitingInvoiceByCurrency, loadFinanceQuotes } from './quotes';

/**
 * What Finance Home summarizes: this business's own money with its own customers — a projection
 * over reads that already own each fact (I4/I5's reasoning, as `studioOverview` does it for
 * Studio). Standing is `invoiceStanding`'s, a quote is `priceWorkItem` over a job's lines, and
 * invoiced/incurred/margin are `invoiced_and_incurred`'s. Nothing here totals across currencies,
 * turns an unknown cost into zero, or touches what the business pays GildOps — that is
 * Settings → Plan & usage, and Platform for GildOps' own control plane.
 */

export type FinanceAttention =
  | { kind: 'overdue_invoices'; count: number }
  | { kind: 'unpaid_invoices'; count: number }
  | { kind: 'quoted_not_invoiced'; jobs: number }
  | { kind: 'setup'; module: ModuleKey; message: string };

export type FinanceOverview = {
  /** True when the business has no invoice, no payment and no quoted work — an empty Finance, not a failed one. */
  empty: boolean;
  attention: FinanceAttention[];
  /** Owed per currency. Empty when nothing is outstanding; never a single cross-currency number. */
  outstanding: { currency: string; outstandingMinor: number; invoices: number }[];
  /** Quoted work with no invoice yet, per currency. */
  awaitingInvoice: { currency: string; quotedMinor: number; jobs: number }[];
  recentInvoices: FinanceInvoiceRow[];
  recentPayments: PaymentRecord[];
  /** `invoiced_and_incurred` for the month, per currency. Null where the caller may not read reports; `incurredMinor`/`marginMinor` are null where no cost is defined, never zero. */
  month: PeriodTotal[] | null;
  /** True when a list was cut at its limit, so a count or total above covers part of the records. */
  partial: boolean;
};

const RECENT = 5;

export async function financeOverview(
  db: Db,
  input: { organizationId: string; today: string; canReadReports: boolean; now?: Date },
): Promise<FinanceOverview> {
  const now = input.now ?? new Date();
  const [invoices, quotes, payments, enabled, invoiced] = await Promise.all([
    loadFinanceInvoices(db, { organizationId: input.organizationId, now }),
    loadFinanceQuotes(db, { organizationId: input.organizationId }),
    listOrganizationPayments(db, { organizationId: input.organizationId, limit: RECENT }),
    listEnabledModules(db, { organizationId: input.organizationId }),
    input.canReadReports
      ? listInvoicedAndIncurred(db, {
          organizationId: input.organizationId,
          grouping: 'customer',
          period: periodFor('month', input.today),
        })
      : Promise.resolve(null),
  ]);

  const setup = await outstandingModuleSetup(db, {
    organizationId: input.organizationId,
    enabled: new Set([...enabled].filter((key) => key === 'billing' || key === 'card_payments')),
  });

  const awaitingInvoice = awaitingInvoiceByCurrency(quotes.rows);
  const unsettled = invoices.rows.filter((row) => !row.settled);
  const overdue = unsettled.filter((row) => row.overdue).length;

  const attention: FinanceAttention[] = [];
  for (const [module, message] of setup) attention.push({ kind: 'setup', module, message });
  if (overdue > 0) attention.push({ kind: 'overdue_invoices', count: overdue });
  if (unsettled.length - overdue > 0) attention.push({ kind: 'unpaid_invoices', count: unsettled.length - overdue });
  const jobsAwaiting = awaitingInvoice.reduce((sum, entry) => sum + entry.jobs, 0);
  if (jobsAwaiting > 0) attention.push({ kind: 'quoted_not_invoiced', jobs: jobsAwaiting });

  return {
    empty: invoices.rows.length === 0 && payments.length === 0 && quotes.rows.length === 0,
    attention,
    outstanding: outstandingByCurrency(invoices.rows),
    awaitingInvoice,
    recentInvoices: invoices.rows.slice(0, RECENT),
    recentPayments: [...payments],
    month: invoiced ? totalsByCurrency(invoiced) : null,
    partial: invoices.total > invoices.rows.length || quotes.total > quotes.rows.length,
  };
}

import type { Db } from '@/lib/db/types';
import { invoiceStanding, listInvoices, type Invoice } from '@/lib/domain/billing/invoices';

/**
 * One invoice as Finance lists it: the invoice's own snapshot and the standing
 * `invoiceStanding` derives from it. Nothing here totals, prices or decides settled-ness a second
 * time — `invoiceStanding` calls `priceWorkItem` over the invoice's own lines, and a payment
 * is only ever a recorded one.
 */
export type { FinanceInvoiceRow } from '@/lib/domain/billing/finance-reads';
import type { FinanceInvoiceRow } from '@/lib/domain/billing/finance-reads';

export function financeInvoiceRow(invoice: Invoice, now: Date): FinanceInvoiceRow {
  const standing = invoiceStanding(invoice);
  return {
    id: invoice.id,
    source: invoice.source,
    workItemId: invoice.workItemId,
    proposalId: invoice.proposalId,
    number: invoice.number,
    billedTo: invoice.billedTo,
    customerId: invoice.customerId,
    currency: invoice.currency,
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    total: standing.total,
    paidMinor: standing.paidMinor,
    outstandingMinor: standing.outstandingMinor,
    settled: standing.settled,
    overdue: !standing.settled && invoice.dueAt !== null && new Date(invoice.dueAt) < now,
  };
}

export type FinanceInvoices = {
  rows: FinanceInvoiceRow[];
  /** Matching rows in the database, which exceeds `rows.length` when the list was cut at its limit. */
  total: number;
};

export async function loadFinanceInvoices(
  db: Db,
  input: { organizationId: string; now?: Date },
): Promise<FinanceInvoices> {
  const invoices = await listInvoices(db, { organizationId: input.organizationId });
  const now = input.now ?? new Date();
  return { rows: invoices.map((invoice) => financeInvoiceRow(invoice, now)), total: invoices.total };
}

/**
 * Money still owed, per currency — never one number across currencies (nothing converts). Only
 * invoices with something outstanding count; an overpaid invoice is not a negative debt here.
 */
export function outstandingByCurrency(rows: FinanceInvoiceRow[]): { currency: string; outstandingMinor: number; invoices: number }[] {
  const byCurrency = new Map<string, { currency: string; outstandingMinor: number; invoices: number }>();
  for (const row of rows) {
    if (row.settled || row.outstandingMinor === null || row.outstandingMinor <= 0) continue;
    const running = byCurrency.get(row.currency) ?? { currency: row.currency, outstandingMinor: 0, invoices: 0 };
    running.outstandingMinor += row.outstandingMinor;
    running.invoices += 1;
    byCurrency.set(row.currency, running);
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

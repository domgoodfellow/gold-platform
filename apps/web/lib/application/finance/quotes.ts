import type { Db } from '@/lib/db/types';
import { invoicedWorkItemIds } from '@/lib/domain/billing/invoices';
import { listPricedWork, priceWorkItem } from '@/lib/domain/pricing/prices';

/**
 * A quote is a job with priced lines — there is no quote table (I4). The amount is
 * `priceWorkItem` over the lines the job holds, which are snapshots of the price book as it read
 * when each was added (I8); nothing here reads the price book.
 */
export type { FinanceQuoteRow } from '@/lib/domain/billing/finance-reads';
import type { FinanceQuoteRow } from '@/lib/domain/billing/finance-reads';

export type FinanceQuotes = {
  rows: FinanceQuoteRow[];
  total: number;
};

export async function loadFinanceQuotes(db: Db, input: { organizationId: string }): Promise<FinanceQuotes> {
  const work = await listPricedWork(db, { organizationId: input.organizationId });
  const invoiced = await invoicedWorkItemIds(db, {
    organizationId: input.organizationId,
    workItemIds: work.map((item) => item.workItemId),
  });
  return {
    rows: work.map((item) => ({
      workItemId: item.workItemId,
      title: item.title,
      status: item.status,
      customer: item.customer,
      createdAt: item.createdAt,
      lineCount: item.lines.length,
      quoted: priceWorkItem(item.lines),
      invoiced: invoiced.has(item.workItemId),
    })),
    total: work.total,
  };
}

/** Quoted work not yet invoiced, per currency. */
export function awaitingInvoiceByCurrency(rows: FinanceQuoteRow[]): { currency: string; quotedMinor: number; jobs: number }[] {
  const byCurrency = new Map<string, { currency: string; quotedMinor: number; jobs: number }>();
  for (const row of rows) {
    if (row.invoiced || row.quoted === null) continue;
    const running = byCurrency.get(row.quoted.currency) ?? { currency: row.quoted.currency, quotedMinor: 0, jobs: 0 };
    running.quotedMinor += row.quoted.totalMinor;
    running.jobs += 1;
    byCurrency.set(row.quoted.currency, running);
  }
  return [...byCurrency.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

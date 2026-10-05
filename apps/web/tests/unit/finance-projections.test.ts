import { describe, expect, it } from 'vitest';
import { financeInvoiceRow, outstandingByCurrency } from '@/lib/application/finance/invoices';
import { awaitingInvoiceByCurrency, type FinanceQuoteRow } from '@/lib/application/finance/quotes';
import { receivedByCurrency } from '@/lib/application/finance/payments';
import type { Invoice, Payment } from '@/lib/domain/billing/invoices';

const NOW = new Date('2026-10-05T12:00:00Z');

function invoice(overrides: Partial<Invoice> & { totalMinor: number; paid?: number[] }): Invoice {
  const currency = overrides.currency ?? 'CAD';
  const payments: Payment[] = (overrides.paid ?? []).map((amountMinor, index) => ({
    id: `p${index}`, amountMinor, currency, receivedAt: '2026-10-01T00:00:00Z', provider: null, note: null,
  }));
  return {
    id: overrides.id ?? 'i1',
    workItemId: 'w1',
    number: 1,
    billedTo: 'Customer',
    customerId: null,
    currency,
    issuedAt: '2026-09-01T00:00:00Z',
    dueAt: overrides.dueAt ?? null,
    lines: [{ id: 'l1', description: 'Work', unit: 'job', unitAmountMinor: overrides.totalMinor, currency, quantity: 1, position: 0 }],
    payments,
  };
}

describe('Finance invoice rows', () => {
  it('take standing from the one standing function and never from the issue date', () => {
    const open = financeInvoiceRow(invoice({ totalMinor: 10_000, paid: [4_000] }), NOW);
    expect(open).toMatchObject({ settled: false, outstandingMinor: 6_000, paidMinor: 4_000, overdue: false });
    // No due date means no overdue — an issue date six weeks ago is not a due date.
    expect(open.overdue).toBe(false);

    expect(financeInvoiceRow(invoice({ totalMinor: 10_000, paid: [10_000] }), NOW).settled).toBe(true);
    expect(financeInvoiceRow(invoice({ totalMinor: 10_000, paid: [10_000, -2_500] }), NOW)).toMatchObject({ settled: false, outstandingMinor: 2_500 });
  });

  it('are overdue only when unpaid past a due date the business set', () => {
    expect(financeInvoiceRow(invoice({ totalMinor: 5_000, dueAt: '2026-10-01T00:00:00Z' }), NOW).overdue).toBe(true);
    expect(financeInvoiceRow(invoice({ totalMinor: 5_000, dueAt: '2026-10-09T00:00:00Z' }), NOW).overdue).toBe(false);
    expect(financeInvoiceRow(invoice({ totalMinor: 5_000, dueAt: '2026-10-01T00:00:00Z', paid: [5_000] }), NOW).overdue).toBe(false);
  });
});

describe('what is owed, grouped', () => {
  it('keeps currencies apart and never sums them', () => {
    const rows = [
      financeInvoiceRow(invoice({ id: 'a', totalMinor: 10_000, currency: 'CAD' }), NOW),
      financeInvoiceRow(invoice({ id: 'b', totalMinor: 7_000, currency: 'USD' }), NOW),
      financeInvoiceRow(invoice({ id: 'c', totalMinor: 2_000, currency: 'CAD', paid: [500] }), NOW),
    ];
    expect(outstandingByCurrency(rows)).toEqual([
      { currency: 'CAD', outstandingMinor: 11_500, invoices: 2 },
      { currency: 'USD', outstandingMinor: 7_000, invoices: 1 },
    ]);
  });

  it('leaves settled and overpaid invoices out, and says nothing for an empty business', () => {
    const rows = [
      financeInvoiceRow(invoice({ id: 'a', totalMinor: 1_000, paid: [1_000] }), NOW),
      financeInvoiceRow(invoice({ id: 'b', totalMinor: 1_000, paid: [1_500] }), NOW),
    ];
    expect(outstandingByCurrency(rows)).toEqual([]);
    expect(outstandingByCurrency([])).toEqual([]);
  });
});

describe('quoted work awaiting an invoice', () => {
  const quote = (workItemId: string, totalMinor: number, currency: string, invoiced: boolean): FinanceQuoteRow => ({
    workItemId, title: workItemId, status: 'Open', customer: null, createdAt: '2026-10-01T00:00:00Z', lineCount: 1,
    quoted: { totalMinor, currency }, invoiced,
  });

  it('counts only uninvoiced jobs, per currency', () => {
    expect(awaitingInvoiceByCurrency([
      quote('a', 10_000, 'CAD', false),
      quote('b', 4_000, 'CAD', true),
      quote('c', 3_000, 'USD', false),
    ])).toEqual([
      { currency: 'CAD', quotedMinor: 10_000, jobs: 1 },
      { currency: 'USD', quotedMinor: 3_000, jobs: 1 },
    ]);
  });
});

describe('payments received', () => {
  it('are net of corrections and grouped by the currency they were recorded in', () => {
    const row = (amountMinor: number, currency: string) => ({ amountMinor, currency }) as Parameters<typeof receivedByCurrency>[0][number];
    expect(receivedByCurrency([row(5_000, 'CAD'), row(-1_000, 'CAD'), row(2_000, 'USD')])).toEqual([
      { currency: 'CAD', receivedMinor: 4_000 },
      { currency: 'USD', receivedMinor: 2_000 },
    ]);
  });
});

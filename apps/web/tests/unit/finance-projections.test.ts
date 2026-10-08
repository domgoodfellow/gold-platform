import { describe, expect, it } from 'vitest';
import { financeInvoiceRow, outstandingByCurrency } from '@/lib/application/finance/invoices';
import { awaitingInvoiceByCurrency, type FinanceQuoteRow } from '@/lib/application/finance/quotes';
import { receivedByCurrency } from '@/lib/application/finance/payments';
import type { Invoice, Payment } from '@/lib/domain/billing/invoices';
import { parseMoneyInput } from '@/lib/domain/pricing/money-input';
import { financePeriod, financeFilters } from '@/lib/application/finance/operating';
import { listInvoicedAndIncurred, totalsByCurrency } from '@/lib/domain/reporting/financials';
import type { Db } from '@/lib/db/types';

const NOW = new Date('2026-10-05T12:00:00Z');

describe('Finance operator input', () => {
  it('includes financial groups beyond a capped report response before totaling currencies', async () => {
    const records = Array.from({ length: 501 }, (_, index) => ({ group_id: String(index), group_label: `Customer ${index}`, currency: index === 500 ? 'USD' : 'CAD', invoiced_minor: 100, incurred_minor: 25, margin_minor: 75 }));
    const response = { order() { return this; }, range(from: number, to: number) { return Promise.resolve({ data: records.slice(from, to + 1), error: null }); } };
    const db = { rpc: () => response } as unknown as Db;
    const groups = await listInvoicedAndIncurred(db, { organizationId: 'tenant', grouping: 'customer' });
    expect(groups).toHaveLength(501);
    expect(totalsByCurrency(groups)).toEqual([
      { currency: 'CAD', invoicedMinor: 50000, incurredMinor: 12500, marginMinor: 37500 },
      { currency: 'USD', invoicedMinor: 100, incurredMinor: 25, marginMinor: 75 },
    ]);
  });
  it('converts decimal input exactly to integer minor units across currency precisions', () => {
    expect(parseMoneyInput('42.55','CAD')).toBe(4255);
    expect(parseMoneyInput('-1.25','CAD')).toBe(-125);
    expect(parseMoneyInput('1250','JPY')).toBe(1250);
    expect(parseMoneyInput('1.005','KWD')).toBe(1005);
    for (const raw of ['1.001','NaN','1e3','9007199254740992']) expect(()=>parseMoneyInput(raw,'CAD')).toThrow();
    expect(()=>parseMoneyInput('1.1','JPY')).toThrow();
  });
  it('preserves historical months, rejects invalid periods and applies Organization timezone', () => {
    expect(financePeriod('2026-10-08','2025-12')).toEqual({from:'2025-12-01',to:'2026-01-01',month:'2025-12'});
    expect(financePeriod('2026-10-08','bad').month).toBe('2026-10');
    expect(financeFilters({from:'2026-10-01',page:'2'},'America/Toronto').from).toBe('2026-10-01T04:00:00.000Z');
    expect(financeFilters({from:'2026-02-31',page:'-1'},'UTC')).toMatchObject({from:undefined,page:1});
  });
});

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

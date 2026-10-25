import { describe, expect, it } from 'vitest';
import { DUE_SOON_DAYS, dueSoonWindow, financeFilters, overdueByCurrency } from '@/lib/application/finance/operating';
import { FINANCE_SORTS } from '@/lib/domain/billing/finance-reads';

const NOW = new Date('2026-10-25T16:30:00Z'); // 12:30 in Toronto

describe('Finance Dashboard figures', () => {
  it('reports overdue money per currency from the aging bands past their due date, never across currencies', () => {
    const aging = [
      { currency: 'CAD', band: 'Not yet due', amount: '120000' },
      { currency: 'CAD', band: '1–30 days', amount: '38650' },
      { currency: 'CAD', band: '31–60 days', amount: '44300' },
      { currency: 'CAD', band: 'No due date', amount: '900' },
      { currency: 'USD', band: '90+ days', amount: '36000' },
      { currency: 'USD', band: 'Not yet due', amount: '1' },
    ];
    expect(overdueByCurrency(aging)).toEqual([
      { currency: 'CAD', amount: '82950', count: 0 },
      { currency: 'USD', amount: '36000', count: 0 },
    ]);
    expect(overdueByCurrency([{ currency: 'CAD', band: 'Not yet due', amount: '5' }])).toEqual([]);
  });

  it('keeps amounts beyond the safe integer range exact while summing', () => {
    const aging = [{ currency: 'CAD', band: '1–30 days', amount: '9007199254740991' }, { currency: 'CAD', band: '90+ days', amount: '10' }];
    expect(overdueByCurrency(aging)[0].amount).toBe('9007199254741001');
  });

  it('starts due soon at this moment, so nothing already overdue is also due soon, and ends after the seventh local day', () => {
    const { dueFrom, dueTo } = dueSoonWindow('America/Toronto', NOW);
    expect(dueFrom).toBe(NOW.toISOString());
    // Seven days after Oct 25 is Nov 1; its local day ends at midnight Toronto time (UTC-4 that night).
    expect(new Date(dueTo).getTime()).toBeGreaterThan(Date.parse('2026-11-02T03:59:00Z'));
    expect(new Date(dueTo).getTime()).toBeLessThanOrEqual(Date.parse('2026-11-02T05:00:00Z'));
    expect(DUE_SOON_DAYS).toBe(7);
  });
});

describe('Finance collection view model', () => {
  it('turns the Due soon view into unpaid invoices inside the Dashboard window, so their counts agree', () => {
    const filter = financeFilters({ status: 'due-soon' }, 'America/Toronto', NOW);
    const window = dueSoonWindow('America/Toronto', NOW);
    expect(filter.status).toBe('outstanding');
    expect(filter.dueFrom).toBe(window.dueFrom);
    expect(filter.dueTo).toBe(window.dueTo);
  });

  it('lets an explicit Due on date narrow the Due soon view', () => {
    const filter = financeFilters({ status: 'due-soon', due: '2026-10-27' }, 'America/Toronto', NOW);
    expect(filter.status).toBe('outstanding');
    expect(filter.dueFrom).toBe('2026-10-27T04:00:00.000Z');
  });

  it('accepts only the payment entry and source values the read model understands', () => {
    expect(financeFilters({ entry: 'corrections', source: 'manual' }, 'UTC')).toMatchObject({ entry: 'corrections', source: 'manual' });
    expect(financeFilters({ entry: 'refunds', source: 'stripe' }, 'UTC')).toMatchObject({ entry: undefined, source: undefined });
  });

  it('passes a sort key through, and every collection offers newest first as its default order', () => {
    expect(financeFilters({ sort: 'due' }, 'UTC').sort).toBe('due');
    expect(financeFilters({}, 'UTC').sort).toBeUndefined();
    for (const orders of Object.values(FINANCE_SORTS)) expect(Object.keys(orders)[0]).toBe('newest');
  });
});

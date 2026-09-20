import { describe, expect, it } from 'vitest';
import type { Cost } from '@/lib/domain/work-items/consumption';
import { jobEconomics, totalCost } from '@/lib/domain/work-items/economics';
import type { PricedLine } from '@/lib/domain/pricing/prices';

/**
 * Revenue minus cost, and the cases where that subtraction is not defined.
 *
 * Pure, and therefore the one suite here that needs no database: `jobEconomics` takes what
 * the screen has already read. The claims worth holding are about refusal rather than
 * arithmetic — a margin this platform cannot honestly compute must come back `null` rather
 * than zero, because zero says the job broke even.
 */

function line(over: Partial<PricedLine> = {}): PricedLine {
  return {
    id: 'l1',
    description: 'Callout',
    unit: 'visit',
    unitAmountMinor: 12_000,
    currency: 'CAD',
    quantity: 1,
    ...over,
  };
}

function cost(over: Partial<Cost> = {}): Cost {
  return {
    id: 'c1',
    description: 'Tyres',
    amountMinor: 4_500,
    currency: 'CAD',
    incurredAt: '2026-11-02T13:00:00.000Z',
    ...over,
  };
}

describe('what a job earned', () => {
  it('subtracts what it consumed from what it is quoted', () => {
    const result = jobEconomics({ lines: [line()], costs: [cost()] });

    expect(result.revenue).toEqual({ totalMinor: 12_000, currency: 'CAD' });
    expect(result.costs).toEqual([{ amountMinor: 4_500, currency: 'CAD' }]);
    expect(result.marginMinor).toBe(7_500);
    expect(result.currency).toBe('CAD');
  });

  it('is integer minor units throughout, with nothing divided (I10)', () => {
    const result = jobEconomics({
      lines: [line({ unitAmountMinor: 1, quantity: 3 })],
      costs: [cost({ amountMinor: 1 })],
    });
    expect(result.marginMinor).toBe(2);
    expect(Number.isInteger(result.marginMinor)).toBe(true);
  });

  it('reports a loss as a negative rather than hiding it', () => {
    const result = jobEconomics({ lines: [line()], costs: [cost({ amountMinor: 20_000 })] });
    expect(result.marginMinor).toBe(-8_000);
  });

  it('treats a job with no costs as earning all of its price', () => {
    // True rather than optimistic: nothing has been spent that this business wrote down.
    const result = jobEconomics({ lines: [line()], costs: [] });
    expect(result.marginMinor).toBe(12_000);
  });

  it('refuses a margin when nothing is priced, and does not call it zero', () => {
    const result = jobEconomics({ lines: [], costs: [cost()] });

    expect(result.revenue).toBeNull();
    expect(result.marginMinor).toBeNull();
    // The cost is still reported. "We spent this and have not quoted it" is a real state.
    expect(result.costs).toEqual([{ amountMinor: 4_500, currency: 'CAD' }]);
  });

  it('refuses a margin across currencies, and reports both totals instead', () => {
    // The reachable case, not a theoretical one: a business that changes what it trades in
    // has costs in the old currency and quotes in the new one, and amounts are never
    // converted (I8, I10). Converting would need a rate, a rate has a date, and that is the
    // accounting system `vision.md` refuses to be.
    const result = jobEconomics({
      lines: [line()],
      costs: [cost(), cost({ id: 'c2', amountMinor: 3_000, currency: 'EUR' })],
    });

    expect(result.marginMinor).toBeNull();
    expect(result.currency).toBeNull();
    expect(result.costs).toEqual([
      { amountMinor: 4_500, currency: 'CAD' },
      { amountMinor: 3_000, currency: 'EUR' },
    ]);
  });

  it('groups costs per currency rather than adding across them', () => {
    const totals = totalCost([
      cost({ id: 'a', amountMinor: 100, currency: 'CAD' }),
      cost({ id: 'b', amountMinor: 250, currency: 'CAD' }),
      cost({ id: 'c', amountMinor: 700, currency: 'JPY' }),
    ]);

    expect(totals).toEqual([
      { amountMinor: 350, currency: 'CAD' },
      { amountMinor: 700, currency: 'JPY' },
    ]);
  });

  it('takes its revenue from the one price calculation, not from its own sum', () => {
    // I4 is a claim about there being exactly one place an amount is derived. This module
    // calls it; the assertion is that the two agree on a case with a quantity in it, which
    // is where a second implementation would first diverge.
    const lines = [line({ quantity: 3 }), line({ id: 'l2', unitAmountMinor: 500, quantity: 2 })];
    const result = jobEconomics({ lines, costs: [] });
    expect(result.revenue!.totalMinor).toBe(12_000 * 3 + 500 * 2);
  });
});

import { describe, expect, it } from 'vitest';
import { expectedUnit, marginPercent, stageCostMinor } from '@/lib/domain/pricing/expected-costs';

/**
 * The expected cost of one unit of a priced item: its own cost lines plus the time and cost of each
 * stage of the Work type that delivers it. Nothing is converted between currencies.
 */

const price = { amountMinor: 8900, currency: 'EUR' };
const stage = (statusId: string, expectedMinutes: number, hourlyCostMinor: number, currency = 'EUR') => ({ statusId, expectedMinutes, hourlyCostMinor, currency });

describe('a stage’s expected cost', () => {
  it('is minutes times the hourly cost, rounded half up once', () => {
    expect(stageCostMinor({ expectedMinutes: 45, hourlyCostMinor: 6000 })).toBe(4500);
    expect(stageCostMinor({ expectedMinutes: 10, hourlyCostMinor: 3000 })).toBe(500);
    expect(stageCostMinor({ expectedMinutes: 1, hourlyCostMinor: 30 })).toBe(1);
    expect(stageCostMinor({ expectedMinutes: 1, hourlyCostMinor: 29 })).toBe(0);
  });
});

describe('an item’s expected unit', () => {
  it('adds its cost lines to its delivering stages and sets them against the price', () => {
    const result = expectedUnit({ price, lines: [{ amountMinor: 2500, currency: 'EUR' }], stages: [stage('a', 10, 3000), stage('b', 45, 6000)] });
    expect(result).toEqual({ costMinor: 7500, marginMinor: 1400, itemCostMinor: 2500, stageCostMinor: 5000, minutes: 55, issue: null });
    expect(marginPercent(result.marginMinor, price.amountMinor)).toBe(15.7);
  });

  it('says nothing is expected yet rather than claiming a zero cost', () => {
    expect(expectedUnit({ price, lines: [], stages: [] })).toMatchObject({ costMinor: null, marginMinor: null, issue: 'No expected costs yet.' });
  });

  it('leaves the margin unknown when an assumption is in another currency', () => {
    const result = expectedUnit({ price, lines: [{ amountMinor: 100, currency: 'USD' }], stages: [] });
    expect(result).toMatchObject({ costMinor: null, marginMinor: null, issue: 'An expected cost is in USD, the price in EUR.' });
  });

  it('can be negative: an item expected to lose money says so', () => {
    expect(expectedUnit({ price, lines: [{ amountMinor: 9000, currency: 'EUR' }], stages: [] }).marginMinor).toBe(-100);
  });
});

describe('margin as a share of the price', () => {
  it('is undefined without a margin or a price', () => {
    expect(marginPercent(null, 8900)).toBeNull();
    expect(marginPercent(100, 0)).toBeNull();
  });
});

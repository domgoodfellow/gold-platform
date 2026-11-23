import { describe, expect, it } from 'vitest';
import { invoiceStanding } from '@/lib/domain/billing/invoices';
import { lineInForce, recurringAmount, subscriptionStatus, type LinePrice, type SubscriptionLine } from '@/lib/domain/subscriptions/subscriptions';

/**
 * The shared subscription rules that need no database (ADR-057): where a subscription stands on a
 * day, whether a line is in force, and what the lines in force cost per billing interval — never a
 * guessed total when a line is unpriced or two currencies meet. A voided provider invoice is owed by
 * no one.
 */

const line = (id: string, input: Partial<SubscriptionLine> = {}): SubscriptionLine => ({
  id, subscriptionId: 's1', itemId: `item-${id}`, role: 'primary', quantity: 1, startsOn: '2026-01-01', endsOn: null,
  recordedAt: '2026-01-01T00:00:00Z', note: '', ...input,
});
const price = (lineId: string, amountMinor: number, input: Partial<LinePrice> = {}): LinePrice => ({
  lineId, amountMinor, currency: 'CAD', billingInterval: 'month', source: 'list', sourceId: `p-${lineId}`, ...input,
});

describe('where a subscription stands', () => {
  it('reads its dates: later, active, ending and ended (the end is the first day without service)', () => {
    expect(subscriptionStatus({ startsOn: '2026-12-01', endsOn: null }, '2026-11-23')).toBe('scheduled');
    expect(subscriptionStatus({ startsOn: '2026-01-01', endsOn: null }, '2026-11-23')).toBe('active');
    expect(subscriptionStatus({ startsOn: '2026-01-01', endsOn: '2026-12-01' }, '2026-11-23')).toBe('ending');
    expect(subscriptionStatus({ startsOn: '2026-01-01', endsOn: '2026-11-23' }, '2026-11-23')).toBe('ended');
  });

  it('puts a line in force from its first day until the day it ends', () => {
    expect(lineInForce(line('a', { startsOn: '2026-11-23' }), '2026-11-23')).toBe(true);
    expect(lineInForce(line('a', { startsOn: '2026-11-24' }), '2026-11-23')).toBe(false);
    expect(lineInForce(line('a', { endsOn: '2026-11-23' }), '2026-11-23')).toBe(false);
  });
});

describe('what the lines in force cost', () => {
  it('adds each line’s price times its quantity, leaving out what is sold once', () => {
    const lines = [line('a'), line('b', { role: 'addon', quantity: 3 }), line('c', { role: 'addon' })];
    const prices = [price('a', 4_900), price('b', 1_000, { source: 'agreed' }), price('c', 25_000, { billingInterval: 'one_time' })];
    expect(recurringAmount(lines, prices, '2026-11-23')).toEqual({ amountMinor: 4_900 + 3 * 1_000, currency: 'CAD' });
  });

  it('ignores lines not in force on the day', () => {
    const lines = [line('a', { endsOn: '2026-06-01' }), line('b', { startsOn: '2026-06-01' })];
    expect(recurringAmount(lines, [price('a', 100), price('b', 200)], '2026-11-23')).toEqual({ amountMinor: 200, currency: 'CAD' });
  });

  it('is unknown, never zero, when a line in force has no price or two currencies meet', () => {
    expect(recurringAmount([line('a'), line('b', { role: 'addon' })], [price('a', 100)], '2026-11-23')).toBeNull();
    expect(recurringAmount([line('a'), line('b', { role: 'addon' })], [price('a', 100), price('b', 100, { currency: 'EUR' })], '2026-11-23')).toBeNull();
    expect(recurringAmount([], [], '2026-11-23')).toBeNull();
  });
});

describe('a voided provider invoice', () => {
  it('is settled with nothing outstanding, whatever its lines say', () => {
    const lines = [{ id: 'l1', description: 'Plan', unit: 'each', unitAmountMinor: 10_000, currency: 'CAD', quantity: 1, position: 1 }];
    expect(invoiceStanding({ lines, payments: [], voidedAt: '2026-11-20T00:00:00Z' })).toMatchObject({ outstandingMinor: 0, settled: true });
    expect(invoiceStanding({ lines, payments: [] })).toMatchObject({ outstandingMinor: 10_000, settled: false });
  });
});

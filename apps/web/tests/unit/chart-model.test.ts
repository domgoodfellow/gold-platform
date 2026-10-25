import { describe, expect, it } from 'vitest';
import { allowedPresentations, formatTick, hasValues, labelStride, linearScale, niceTicks, resolvePresentation, type ChartData } from '@/components/charts/chart-model';
import { CHART_FIXTURES } from '@/components/charts/chart-fixtures';

const series = (values: (number | null)[]): ChartData['series'] => [{ id: 's', label: 'S', points: values.map(value => ({ value, label: String(value) })) }];

describe('which presentations may show a dataset', () => {
  it('offers line, bar and table for a time series, and horizontal bars, bars and table for categories', () => {
    expect(allowedPresentations({ shape: 'time-series', series: series([1, -2]) })).toEqual(['line', 'bar', 'table']);
    expect(allowedPresentations({ shape: 'categorical', series: series([1, 2]) })).toEqual(['horizontal-bar', 'bar', 'table']);
  });

  it('offers a donut only for one series of known, non-negative parts of something', () => {
    expect(allowedPresentations({ shape: 'composition', series: series([2, 3, 1]) })).toEqual(['stacked-bar', 'donut', 'table']);
    expect(allowedPresentations({ shape: 'composition', series: series([2, -1]) })).toEqual(['table']);
    expect(allowedPresentations({ shape: 'composition', series: series([2, null]) })).toEqual(['stacked-bar', 'table']);
    expect(allowedPresentations({ shape: 'composition', series: series([0, 0]) })).toEqual(['stacked-bar', 'table']);
    expect(allowedPresentations({ shape: 'composition', series: [...series([1]), ...series([2])] })).toEqual(['stacked-bar', 'table']);
  });

  it('never converts a time series into a donut, and falls back from an invalid saved choice', () => {
    expect(resolvePresentation({ shape: 'time-series', series: series([1]) }, 'donut')).toBe('line');
    expect(resolvePresentation({ shape: 'time-series', series: series([1]) }, 'bar')).toBe('bar');
    expect(resolvePresentation({ shape: 'categorical', series: series([1]) }, 'nonsense')).toBe('horizontal-bar');
  });

  it('treats zero as a value and unknown as absent', () => {
    expect(hasValues({ series: series([0]) })).toBe(true);
    expect(hasValues({ series: series([null]) })).toBe(false);
    expect(hasValues(CHART_FIXTURES.empty.data)).toBe(false);
  });
});

describe('scales and ticks', () => {
  it('always includes zero and covers negative values', () => {
    const ticks = niceTicks(-2500, 120000, 5);
    expect(ticks).toContain(0);
    expect(ticks[0]).toBeLessThanOrEqual(-2500);
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(120000);
  });

  it('handles a single value and very large balances', () => {
    expect(niceTicks(0, 0, 4)).toEqual([0, 1]);
    const large = niceTicks(0, 15_360_000_000, 4);
    expect(large.at(-1)).toBeGreaterThanOrEqual(15_360_000_000);
    expect(large.length).toBeLessThanOrEqual(7);
  });

  it('maps a domain linearly and thins labels to the space available', () => {
    expect(linearScale([0, 100], [0, 200])(50)).toBe(100);
    expect(labelStride(31, 640)).toBe(4);
    expect(labelStride(5, 640)).toBe(1);
  });

  it('writes money ticks in the chart’s one currency, using its own decimal places', () => {
    expect(formatTick(1_250_000, { kind: 'money', currency: 'CAD' })).toBe('CA$12.5K');
    expect(formatTick(-2500, { kind: 'money', currency: 'CAD' })).toBe('-CA$25');
    expect(formatTick(1250, { kind: 'money', currency: 'JPY' })).toBe('JP¥1.3K');
  });
});

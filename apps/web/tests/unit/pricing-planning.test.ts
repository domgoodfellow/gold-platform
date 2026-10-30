import { describe, expect, it } from 'vitest';
import { calculatePricingScenario as calculate, emptyScenario, currencyPrecision, type PricingScenario } from '@/lib/domain/pricing/planning';
import { formatMoney } from '@/lib/domain/work-items/consumption';

const scenario = (currency = 'CAD'): PricingScenario => ({
  currency, laborQuantity: '2', laborRate: { amount: '40', currency },
  materials: { amount: '20', currency }, supplier: { amount: '10', currency }, other: { amount: '10', currency },
  targetMargin: '25', zeroCostNote: '',
});
describe('unsaved pricing assumptions', () => {
  it('uses margin rather than markup (120 / 0.75 = 160)', () => {
    expect(calculate(scenario())).toMatchObject({ errors: {}, estimatedCostMinor: 12000, suggestedPriceMinor: 16000, estimatedProfitMinor: 4000, estimatedMarginPercent: 25 });
  });
  it('rounds suggestions upward so the target survives monetary rounding', () => {
    const s = scenario(); s.targetMargin = '33.33';
    expect(calculate(s)).toMatchObject({ suggestedPriceMinor: 18000, estimatedMarginPercent: 33.3333 });
  });
  it('rounds fractional labor half up exactly once', () => {
    const s = scenario(); s.laborQuantity = '0.005'; s.laborRate.amount = '1'; s.targetMargin = '0';
    expect(calculate(s)).toMatchObject({ estimatedCostMinor: 4001, suggestedPriceMinor: 4001, estimatedMarginPercent: 0 });
  });
  it.each([['JPY', 0, 120, 160], ['CAD', 2, 12000, 16000], ['KWD', 3, 120000, 160000]] as const)('honors %s precision', (currency, digits, cost, price) => {
    expect(currencyPrecision(currency)).toBe(digits);
    expect(calculate(scenario(currency))).toMatchObject({ estimatedCostMinor: cost, suggestedPriceMinor: price });
    expect(formatMoney(price, currency)).toBe(new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(160));
  });
  it('does not silently round inputs beyond currency precision', () => {
    for (const [currency, amount] of [['JPY', '1.1'], ['CAD', '1.001'], ['KWD', '1.0001']]) {
      const s = scenario(currency); s.materials.amount = amount;
      expect(calculate(s).errors.materials).toBeTruthy();
      expect(calculate(s).suggestedPriceMinor).toBeNull();
    }
  });
  it('keeps unknown costs distinct from a documented zero and never invents a realized margin', () => {
    expect(calculate(emptyScenario('CAD'))).toMatchObject({ estimatedCostMinor: null, suggestedPriceMinor: null });
    const s = scenario(); s.materials.amount = '0';
    expect(calculate(s).errors.zeroCostNote).toBeTruthy();
    s.zeroCostNote = 'No materials needed for this service.';
    expect(calculate(s).estimatedCostMinor).toBe(10000);
    s.materials.amount = '';
    expect(calculate(s).estimatedCostMinor).toBeNull();
  });
  it('accepts documented entirely free delivery but cannot define a margin on zero price', () => {
    const s = scenario(); s.laborQuantity = '0';
    for (const key of ['laborRate', 'materials', 'supplier', 'other'] as const) s[key].amount = '0';
    s.zeroCostNote = 'Volunteer delivery; no purchased supplies or other costs.';
    expect(calculate(s)).toMatchObject({ estimatedCostMinor: 0, suggestedPriceMinor: 0, estimatedProfitMinor: 0, estimatedMarginPercent: null });
  });
  it.each(['-1', '100', '100.01', 'NaN', 'Infinity', '', '25.001'])('refuses invalid margin %s', margin => {
    const s = scenario(); s.targetMargin = margin;
    expect(calculate(s).errors.targetMargin).toBeTruthy();
    expect(calculate(s).suggestedPriceMinor).toBeNull();
  });
  it.each(['-1', 'NaN', 'Infinity', '1e2', '1,000', '9007199254740992', ' '])('refuses invalid costs %s', amount => {
    const s = scenario(); s.supplier.amount = amount;
    expect(calculate(s).errors.supplier).toBeTruthy();
    expect(calculate(s).estimatedCostMinor).toBeNull();
  });
  it.each(['-1', '1.0001', '', 'NaN'])('refuses invalid labor quantity %s', quantity => {
    const s = scenario(); s.laborQuantity = quantity;
    expect(calculate(s).errors.laborQuantity).toBeTruthy();
  });
  it('allows zero margin and near-100 margin within safe limits', () => {
    const s = scenario(); s.targetMargin = '0';
    expect(calculate(s).suggestedPriceMinor).toBe(12000);
    s.targetMargin = '99.99';
    expect(calculate(s).suggestedPriceMinor).toBe(120000000);
  });
  it('refuses sum and suggested-price overflow', () => {
    const s = scenario(); s.other.amount = '90071992547409.91';
    expect(calculate(s).errors.other).toBeTruthy();
    s.other.amount = '10000000000'; s.targetMargin = '99.99';
    expect(calculate(s).errors.targetMargin).toBeTruthy();
  });
  it('compares an unchanged same-currency catalog unit; zero catalog prices remain valid', () => {
    const s = scenario(); const original = structuredClone(s);
    const catalog = Object.freeze({ currency: 'CAD', unitAmountMinor: 14500 });
    expect(calculate(s, catalog).catalogDifferenceMinor).toBe(1500);
    expect(calculate(s, { ...catalog, unitAmountMinor: 18000 }).catalogDifferenceMinor).toBe(-2000);
    expect(calculate(s, { ...catalog, unitAmountMinor: 0 }).catalogDifferenceMinor).toBe(16000);
    expect(s).toEqual(original);
  });
  it('refuses mixed costs and mixed catalog currencies without inventing FX', () => {
    const s = scenario(); s.materials.currency = 'USD';
    expect(calculate(s).errors.materials).toContain('Different currencies');
    expect(calculate(s).estimatedCostMinor).toBeNull();
    const result = calculate(scenario(), { currency: 'USD', unitAmountMinor: 14500 });
    expect(result.catalogDifferenceMinor).toBeNull();
    expect(result.comparisonIssue).toContain('Different currencies');
    expect(result.suggestedPriceMinor).toBe(16000);
    expect(calculate(emptyScenario('CAD'), { currency: 'USD', unitAmountMinor: 1 }).comparisonIssue).toContain('Different currencies');
  });
  it.each([-1, Number.MAX_SAFE_INTEGER + 1, 1.5])('refuses an invalid catalog amount %s', unitAmountMinor => {
    const result = calculate(scenario(), { currency: 'CAD', unitAmountMinor });
    expect(result.catalogDifferenceMinor).toBeNull();
    expect(result.comparisonIssue).toContain('outside the supported range');
  });
  it.each(['', 'cad', 'ZZZ'])('refuses unsupported currency %s', currency => {
    expect(calculate(scenario(currency)).errors.currency).toBeTruthy();
  });
});

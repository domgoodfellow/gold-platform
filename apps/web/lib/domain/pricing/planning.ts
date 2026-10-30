/** Unsaved estimates only. Recorded Work economics and price snapshots keep their own rules. */
export type EstimateAmount = { amount: string; currency: string };
export type PricingScenario = {
  currency: string;
  laborQuantity: string;
  laborRate: EstimateAmount;
  materials: EstimateAmount;
  supplier: EstimateAmount;
  other: EstimateAmount;
  targetMargin: string;
  zeroCostNote: string;
};
export type ScenarioField = keyof PricingScenario;
export type CatalogComparison = { currency: string; unitAmountMinor: number };
export type PlanningResult = {
  errors: Partial<Record<ScenarioField, string>>;
  estimatedCostMinor: number | null;
  suggestedPriceMinor: number | null;
  estimatedProfitMinor: number | null;
  estimatedMarginPercent: number | null;
  catalogDifferenceMinor: number | null;
  comparisonIssue: string | null;
};

export function emptyScenario(currency: string): PricingScenario {
  const amount = () => ({ amount: '', currency });
  return { currency, laborQuantity: '', laborRate: amount(), materials: amount(), supplier: amount(), other: amount(), targetMargin: '', zeroCostNote: '' };
}

/** Same currency precision that formatMoney uses; unsupported ISO codes cannot be assumptions. */
export function currencyPrecision(currency: string): number | null {
  try {
    if (!Intl.supportedValuesOf('currency').includes(currency)) return null;
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return null;
  }
}

/** Decimal text to scaled integers, with no floating point money or silent precision loss. */
function scaled(value: string, digits: number): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || (match[2]?.length ?? 0) > digits || value.length > 40) return null;
  return BigInt(match[1]) * BigInt(10) ** BigInt(digits) + BigInt((match[2] ?? '').padEnd(digits, '0') || '0');
}
const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const ceilDivide = (a: bigint, b: bigint) => (a + b - BigInt(1)) / b;

/** Margin = profit / selling price, NOT markup. All money remains integer minor units.
 * Labor is rounded half up once; suggestion is rounded UP to meet the target after rounding.
 * Missing costs propagate as unknown. Each zero contribution requires a documented assumption.
 * No FX is inferred and no catalog object is ever changed.
 */
export function calculatePricingScenario(input: PricingScenario, catalog?: CatalogComparison): PlanningResult {
  const errors: PlanningResult['errors'] = {};
  const result: PlanningResult = { errors, estimatedCostMinor: null, suggestedPriceMinor: null, estimatedProfitMinor: null, estimatedMarginPercent: null, catalogDifferenceMinor: null, comparisonIssue: null };
  if (catalog) {
    if (catalog.currency !== input.currency) result.comparisonIssue = 'Different currencies: no comparison without conversion evidence.';
    else if (!Number.isSafeInteger(catalog.unitAmountMinor) || catalog.unitAmountMinor < 0) result.comparisonIssue = 'Catalog amount is outside the supported range.';
  }
  const digits = currencyPrecision(input.currency);
  if (digits === null) errors.currency = 'Choose a supported ISO currency.';
  const quantity = scaled(input.laborQuantity, 3);
  if (quantity === null || quantity > MAX) errors.laborQuantity = 'Enter non-negative hours with up to 3 decimal places.';
  const margin = scaled(input.targetMargin, 2);
  if (margin === null || margin >= BigInt(10000)) errors.targetMargin = 'Enter a margin from 0 to less than 100%, with up to 2 decimal places.';
  const amounts = {} as Record<'laborRate' | 'materials' | 'supplier' | 'other', bigint>;
  for (const key of ['laborRate', 'materials', 'supplier', 'other'] as const) {
    const entry = input[key];
    const amount = scaled(entry.amount, digits ?? 2);
    if (entry.currency !== input.currency) errors[key] = 'Different currencies cannot be combined without conversion evidence.';
    else if (amount === null || amount > MAX) errors[key] = entry.amount.trim() ? `Enter a non-negative amount with up to ${digits ?? 2} decimal places, within the supported range.` : 'Unknown cost: enter an estimate or a documented zero.';
    else amounts[key] = amount;
  }
  if (Object.keys(errors).some(key => key !== 'targetMargin')) return result;
  const labor = (quantity! * amounts.laborRate + BigInt(500)) / BigInt(1000);
  if ([labor, amounts.materials, amounts.supplier, amounts.other].some(amount => amount === BigInt(0)) && !input.zeroCostNote.trim()) {
    errors.zeroCostNote = 'Explain each zero-cost assumption before calculating.';
    return result;
  }
  const cost = labor + amounts.materials + amounts.supplier + amounts.other;
  if (cost > MAX) { errors.other = 'Total estimated cost exceeds the supported range.'; return result; }
  result.estimatedCostMinor = Number(cost);
  if (errors.targetMargin) return result;
  const price = ceilDivide(cost * BigInt(10000), BigInt(10000) - margin!);
  if (price > MAX) { errors.targetMargin = 'Suggested price exceeds the supported range; reduce the target or costs.'; return result; }
  result.suggestedPriceMinor = Number(price);
  result.estimatedProfitMinor = Number(price - cost);
  // A zero selling price has no defined margin, even when an explicit zero cost is valid.
  result.estimatedMarginPercent = price === BigInt(0) ? null : Number((price - cost) * BigInt(1000000) / price) / 10000;
  if (catalog && !result.comparisonIssue) result.catalogDifferenceMinor = Number(price) - catalog.unitAmountMinor;
  return result;
}

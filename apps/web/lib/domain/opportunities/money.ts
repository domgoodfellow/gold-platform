import { DomainError } from '@/lib/domain/errors';

function formatter(currency: string) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency });
}
/** Decimal text to integer minor units without floating-point multiplication. */
export function parseOpportunityValue(value: string, currency: string): number | null {
  if (!value.trim()) return null;
  if (!/^[A-Z]{3}$/.test(currency)) throw new DomainError('Choose a three-letter currency for the value.', 'opportunities.currency_invalid');
  const digits = formatter(currency).resolvedOptions().maximumFractionDigits ?? 2;
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || (match[2]?.length ?? 0) > digits) throw new DomainError(`Enter a non-negative value with at most ${digits} decimal places for ${currency}.`, 'opportunities.value_invalid');
  const minor = BigInt(match[1]) * BigInt(10) ** BigInt(digits) + BigInt((match[2] ?? '').padEnd(digits, '0') || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError('That value is too large.', 'opportunities.value_invalid');
  return Number(minor);
}
/** Exact rendering for aggregate totals that may exceed JavaScript's safe integer range. */
export function formatOpportunityValue(amountMinor: number | string, currency: string): string {
  const format = formatter(currency);
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  const amount = BigInt(amountMinor);
  const scale = BigInt(10) ** BigInt(digits);
  return format.formatToParts(amount / scale).map((part) => part.type === 'fraction' ? (amount % scale).toString().padStart(digits, '0') : part.value).join('');
}
export function opportunityValueInput(amountMinor: number | null, currency: string | null): string {
  if (amountMinor === null || !currency) return '';
  const digits = formatter(currency).resolvedOptions().maximumFractionDigits ?? 2;
  const raw = String(amountMinor).padStart(digits + 1, '0');
  return digits ? `${raw.slice(0, -digits)}.${raw.slice(-digits)}` : raw;
}

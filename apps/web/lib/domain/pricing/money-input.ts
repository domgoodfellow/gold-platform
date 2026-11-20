import { DomainError } from '@/lib/domain/errors';

export function parseMoneyInput(raw: string, currency: string): number {
  const digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const value = raw.trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) throw new DomainError('Enter a valid amount.', 'money.invalid');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  if (fraction.length > digits) throw new DomainError(`Use at most ${digits} decimal places for ${currency}.`, 'money.precision');
  const minor = Number(BigInt(whole) * BigInt(10) ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0')) * (value.startsWith('-') ? -1 : 1);
  if (!Number.isSafeInteger(minor)) throw new DomainError('Amount is too large.', 'money.out_of_range');
  return minor;
}

function currencyDigits(currency: string): number {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/**
 * A usage price typed in the currency's major unit (0.0125 for 1.25 cents), as micros: millionths
 * of the currency's minor unit, the precision `platform_retail_rates` stores. At most six decimal
 * places beyond the currency's own.
 */
export function parseMicrosInput(raw: string, currency: string): number {
  const digits = currencyDigits(currency) + 6;
  const value = raw.trim();
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new DomainError('Enter a valid amount.', 'money.invalid');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > digits) throw new DomainError(`Use at most ${digits} decimal places for ${currency}.`, 'money.precision');
  const micros = BigInt(whole) * BigInt(10) ** BigInt(digits) + BigInt(fraction.padEnd(digits, '0') || '0');
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) throw new DomainError('Amount is too large.', 'money.out_of_range');
  return Number(micros);
}

/** A micros amount in the currency's major unit, with as many decimals as it needs (at least the currency's own). */
export function formatMicros(micros: number, currency: string): string {
  const digits = currencyDigits(currency);
  const major = micros / 10 ** (digits + 6);
  const text = major.toFixed(digits + 6).replace(/0+$/, '');
  const [whole, fraction = ''] = text.split('.');
  return `${whole}.${fraction.padEnd(digits, '0')} ${currency}`;
}

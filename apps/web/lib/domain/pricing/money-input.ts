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

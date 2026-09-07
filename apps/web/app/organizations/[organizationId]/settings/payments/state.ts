import { headers } from 'next/headers';

export const STATE_COOKIE = 'gold_payment_connect';

/** Built here, never accepted from a request — an open redirector — and must match byte-for-byte between the authorize call and the exchange. */
export async function callbackUrl(organizationId: string): Promise<string> {
  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost:3000';
  const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  return `${protocol}://${host}/organizations/${organizationId}/settings/payments/callback`;
}

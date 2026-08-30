import { headers } from 'next/headers';

/**
 * The two halves of the connection flow that both routes need, in one place.
 *
 * Small enough to inline twice and exactly the kind of thing that then drifts: a cookie name
 * spelled differently in two files fails silently and looks like a provider problem.
 */

export const STATE_COOKIE = 'gold_payment_connect';

/**
 * Where the provider sends the operator back to.
 *
 * **Built here, never accepted from a request.** *Never build an open redirector*: this
 * resolves against a route this application owns, and a submitted destination is precisely the
 * field that rule exists to refuse. It must also match byte for byte between the authorize call
 * and the exchange, which is a second reason for it to have one source.
 */
export async function callbackUrl(organizationId: string): Promise<string> {
  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost:3000';
  const protocol = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  return `${protocol}://${host}/organizations/${organizationId}/settings/payments/callback`;
}

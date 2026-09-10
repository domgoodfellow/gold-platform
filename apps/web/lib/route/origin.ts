import { headers } from 'next/headers';

/** This deployment's own address, as the request arrived at it. */
export async function requestOrigin(): Promise<string> {
  const heading = await headers();
  const host = heading.get('host');
  if (!host) {
    throw new Error('Missing Host header.');
  }
  const protocol = heading.get('x-forwarded-proto') ?? 'http';
  return `${protocol}://${host}`;
}

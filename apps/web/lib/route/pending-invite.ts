import { cookies } from 'next/headers';

/**
 * Carries one organization invitation token across a sign-in or sign-up detour, without a
 * generic `?next=` redirector — `proxy.ts`'s own comment refuses one, and this is the narrow
 * case that actually needs the behaviour a `next=` param would otherwise give.
 *
 * The destination this ever produces is a closed template this file writes itself
 * (`/organizations/accept-invite/<token>`), never a URL taken from the cookie or from a caller —
 * the cookie holds only the token, checked against the exact shape `invite_member` generates
 * (64 lowercase hex, a sha256 digest) before it is trusted for anything. Server-set, `httpOnly`
 * so client script never sees it, and single-use: read once, deleted immediately after.
 */

const COOKIE_NAME = 'gold.pending-invite';
const TOKEN_SHAPE = /^[0-9a-f]{64}$/i;
const MAX_AGE_SECONDS = 24 * 60 * 60;

export async function storePendingInvite(token: string): Promise<void> {
  if (!TOKEN_SHAPE.test(token)) return;

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: MAX_AGE_SECONDS,
    path: '/',
  });
}

/**
 * Reads and clears the pending invite, if any. Called once, right after a sign-in or sign-up
 * actually succeeds — never before, since a failed attempt should leave the cookie in place for
 * the retry.
 */
export async function consumePendingInviteDestination(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  store.delete(COOKIE_NAME);

  if (!token || !TOKEN_SHAPE.test(token)) return null;
  return `/organizations/accept-invite/${token}`;
}

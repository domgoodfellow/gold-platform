import { isAuthApiError, isAuthError, isAuthRetryableFetchError, type AuthUser as User } from '@supabase/supabase-js';
import type { Db } from '@/lib/db/types';

/**
 * What a session actually is, which `userId: string | null` collapsed into one thing.
 *
 * The anonymous-session model gives a booking/portal visitor a real `auth.uid()` so RLS stays the boundary -- which
 * also means an anonymous Supabase session is genuinely authenticated, in the only sense the
 * database has an opinion about. It is not, and must never be treated as, a signed-in GOLD
 * account: it cannot be an organization member (RLS already refuses that on its own), and it
 * must not be shown an operator screen or an invitation-acceptance form just because
 * `auth.getUser()` returned somebody. `create_organization` (`20260830000001`) drew the same
 * line in the database, by reading `auth.users.is_anonymous` rather than trusting a session's
 * mere existence; this is that same distinction, read once, for every caller that needs it.
 */
export type SessionIdentity =
  | { kind: 'none' }
  | { kind: 'anonymous'; userId: string }
  | { kind: 'account'; userId: string };

/**
 * What the proxy learned from the sign-in service: an answer (`SessionIdentity`), or
 * `unverified` when the question went unanswered. An unanswered check is not "signed out": the
 * proxy lets the request through and the page's own `requireActor` raises the service error.
 */
export type SessionCheck = SessionIdentity | { kind: 'unverified' };

/** Pure, so the routing decisions built on it (proxy.ts) are testable with no session at all. */
export function classifySessionUser(user: User | null): SessionIdentity {
  if (!user) return { kind: 'none' };
  if (user.is_anonymous) return { kind: 'anonymous', userId: user.id };
  return { kind: 'account', userId: user.id };
}

/** `classifySessionUser`, for a caller holding a database client rather than a `User` already. */
export async function resolveSessionIdentity(db: Db): Promise<SessionIdentity> {
  const { data } = await db.auth.getUser();
  return classifySessionUser(data.user);
}

/** The reply to `auth.getUser()`, read as an answer about the session or as no answer at all. */
export function classifySessionCheck(reply: { data: { user: User | null }; error: unknown }): SessionCheck {
  if (reply.error && signInUnreachable(reply.error)) return { kind: 'unverified' };
  return classifySessionUser(reply.error ? null : reply.data.user);
}

/** `classifySessionCheck`, for a caller holding a database client. What the proxy runs. */
export async function checkSession(db: Pick<Db, 'auth'>): Promise<SessionCheck> {
  return classifySessionCheck(await db.auth.getUser());
}

/**
 * The check did not get an answer about the session. The sign-in library reports no connection,
 * a timeout or a 5xx reply as retryable; a reply it could not read at all as unknown. A 429 is a
 * refusal to answer now, not a statement about the session. Everything else (no session, an
 * expired, revoked or malformed token, a deleted user) is an answer, and means sign in.
 * The one rule both the proxy and `requireActor` apply.
 */
export function signInUnreachable(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  if (isAuthError(error) && error.name === 'AuthUnknownError') return true;
  return isAuthApiError(error) && (error.status >= 500 || error.status === 429);
}

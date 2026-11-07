import { isAuthApiError, isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { Db } from '@/lib/db/types';
import { DomainError, SignInUnreachableError } from '@/lib/domain/errors';

export type Actor = {
  id: string;
};

/**
 * Resolve the acting user, server-side, from the session the database itself will see.
 *
 * Hiding a UI element is not authorization. Every sensitive operation calls this on
 * the server regardless of what the client could or could not render, and the database
 * re-checks the same identity through RLS underneath. Two independent checks is the point,
 * not redundancy — this one produces a usable error, RLS produces the guarantee.
 *
 * Two different failures. The sign-in service answered that there is no valid session: a
 * `DomainError` (`auth.required`), which page guards turn into a redirect to sign in. The check
 * could not complete: a `SignInUnreachableError`, which reaches the error screen with "Try
 * again", because the person may well still be signed in.
 */
export async function requireActor(db: Db): Promise<Actor> {
  const { data, error } = await db.auth.getUser();

  if (error && signInUnreachable(error)) {
    throw new SignInUnreachableError(error);
  }

  if (error || !data.user) {
    throw new DomainError('Sign in to continue.', 'auth.required');
  }

  return { id: data.user.id };
}

/**
 * The check did not get an answer about the session. The sign-in library reports no connection,
 * a timeout or a 5xx reply as retryable; a reply it could not read at all as unknown. A 429 is a
 * refusal to answer now, not a statement about the session. Everything else (no session, an
 * expired, revoked or malformed token, a deleted user) is an answer, and means sign in.
 */
function signInUnreachable(error: unknown): boolean {
  if (isAuthRetryableFetchError(error)) return true;
  if (isAuthError(error) && error.name === 'AuthUnknownError') return true;
  return isAuthApiError(error) && (error.status >= 500 || error.status === 429);
}

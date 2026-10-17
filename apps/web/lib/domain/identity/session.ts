import type { AuthUser as User } from '@supabase/supabase-js';
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

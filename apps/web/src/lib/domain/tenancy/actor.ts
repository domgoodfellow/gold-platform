import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

export type Actor = {
  id: string;
};

/**
 * Resolve the acting user, server-side, from the session the database itself will see.
 *
 * I12: hiding a UI element is not authorization. Every sensitive operation calls this on
 * the server regardless of what the client could or could not render, and the database
 * re-checks the same identity through RLS underneath. Two independent checks is the point,
 * not redundancy — this one produces a usable error, RLS produces the guarantee.
 */
export async function requireActor(db: Db): Promise<Actor> {
  const { data, error } = await db.auth.getUser();

  if (error || !data.user) {
    throw new DomainError('Sign in to continue.', 'auth.required');
  }

  return { id: data.user.id };
}

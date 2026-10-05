import type { Db } from '@/lib/db/types';

/**
 * The temporary session a public write runs under, and the one rule about ending it: **a call may
 * end only a session it began itself.**
 *
 * A visitor's anonymous write needs a real `auth.uid()` for its policies and its event trail, so
 * the caller signs in anonymously first — unless somebody is already signed in, in which case that
 * is who writes, and that session is theirs. `signOut()` on a session this call did not create
 * ends a business owner's own Studio login the moment they try their own public form (it did, in
 * both the forms path and the marketing intake, before this existed).
 *
 * `ok: false` means no session could be had; nothing was started and `end` does nothing.
 */
export type PublicSession = { ok: boolean; end: () => Promise<void> };

export async function openPublicSession(db: Db): Promise<PublicSession> {
  const { data } = await db.auth.getUser();
  if (data.user) return { ok: true, end: async () => undefined };

  const { error } = await db.auth.signInAnonymously();
  if (error) return { ok: false, end: async () => undefined };
  return { ok: true, end: async () => { await db.auth.signOut(); } };
}

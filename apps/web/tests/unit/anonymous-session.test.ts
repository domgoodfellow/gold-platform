import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/db/types';
import { openPublicSession } from '@/lib/domain/identity/anonymous-session';
import { submitPublicInquiry } from '@/lib/domain/public-intake/public-intake';

/**
 * A public write may end only the session it began. Signing out a session it did not make ends a
 * business owner's own Studio login the moment they try their own public form — which the forms
 * path and the marketing intake both did before they shared this helper.
 */

function fakeDb(options: { signedIn: boolean; anonymousFails?: boolean }) {
  const auth = {
    getUser: vi.fn(async () => ({ data: { user: options.signedIn ? { id: 'owner' } : null } })),
    signInAnonymously: vi.fn(async () => (options.anonymousFails ? { error: new Error('disabled') } : { error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  const rpc = vi.fn(async () => ({ error: null }));
  return { db: { auth, rpc } as unknown as Db, auth, rpc };
}

describe('openPublicSession', () => {
  it('leaves an existing signed-in session alone, and ending it does nothing', async () => {
    const { db, auth } = fakeDb({ signedIn: true });
    const session = await openPublicSession(db);
    expect(session.ok).toBe(true);
    await session.end();
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('ends the anonymous session it began', async () => {
    const { db, auth } = fakeDb({ signedIn: false });
    const session = await openPublicSession(db);
    expect(session.ok).toBe(true);
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
    await session.end();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('reports a session that could not be had, and signs nothing out', async () => {
    const { db, auth } = fakeDb({ signedIn: false, anonymousFails: true });
    const session = await openPublicSession(db);
    expect(session.ok).toBe(false);
    await session.end();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

describe('the marketing intake', () => {
  const inquiry = { kind: 'contact' as const, name: 'Ada', email: 'ada@example.com', context: 'Hello' };

  it('does not sign out a signed-in caller', async () => {
    const { db, auth, rpc } = fakeDb({ signedIn: true });
    await submitPublicInquiry(db, inquiry);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('signs out the anonymous session it made, on success', async () => {
    const { db, auth } = fakeDb({ signedIn: false });
    await submitPublicInquiry(db, inquiry);
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('signs out the anonymous session it made, on failure too', async () => {
    const { db, auth, rpc } = fakeDb({ signedIn: false });
    rpc.mockResolvedValueOnce({ error: { code: 'XX000', message: 'boom' } } as never);
    await expect(submitPublicInquiry(db, inquiry)).rejects.toThrow();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
  });
});

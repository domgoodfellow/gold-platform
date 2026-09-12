import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { decideRedirect, isPublic } from '@/lib/route/access';
import { classifySessionUser, resolveSessionIdentity } from '@/lib/domain/identity/session';

/**
 * D22 gives a booking/portal visitor a real, RLS-visible `auth.uid()` — which used to collapse,
 * in `proxy.ts` and everywhere else, into the same `userId: string | null` a permanent account
 * produces. That let an anonymous session be redirected away from `/login`/`/sign-up` as though
 * it were already signed in, and let the accept-invite page offer it an acceptance form
 * `accept_invitation` was always going to refuse anyway. This suite proves the three-way
 * distinction (`none`/`anonymous`/`account`) holds, both as a pure classification and in the
 * proxy's own redirect rules.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function freshClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signUp(label: string): Promise<{ db: SupabaseClient; userId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  const db = freshClient();
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { db, userId: created.user.id };
}

describe('resolveSessionIdentity, against real sessions', () => {
  it('is "none" for a client with no session at all', async () => {
    if (!ANON_KEY) throw new Error('SUPABASE_ANON_KEY must be set.');
    const identity = await resolveSessionIdentity(freshClient());
    expect(identity).toEqual({ kind: 'none' });
  });

  it('is "anonymous" for a Supabase anonymous sign-in', async () => {
    const db = freshClient();
    const { data, error } = await db.auth.signInAnonymously();
    if (error) throw error;

    const identity = await resolveSessionIdentity(db);
    expect(identity).toEqual({ kind: 'anonymous', userId: data.user!.id });
  });

  it('is "account" for a permanent, registered user', async () => {
    if (!SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY must be set.');
    const { db, userId } = await signUp('identity-account');
    const identity = await resolveSessionIdentity(db);
    expect(identity).toEqual({ kind: 'account', userId });
  });
});

describe('classifySessionUser, pure', () => {
  it('reads null as no session', () => {
    expect(classifySessionUser(null)).toEqual({ kind: 'none' });
  });
});

describe("the proxy's redirect rules", () => {
  const NONE = { kind: 'none' } as const;
  const anon = { kind: 'anonymous', userId: 'u-anon' } as const;
  const account = { kind: 'account', userId: 'u-account' } as const;

  it('sends a signed-out visitor to /login from a protected path', () => {
    expect(decideRedirect(NONE, '/organizations')).toBe('/login');
  });

  it('never touches a public path regardless of identity', () => {
    expect(decideRedirect(NONE, '/book/some-business')).toBeNull();
    expect(decideRedirect(anon, '/book/some-business')).toBeNull();
    expect(decideRedirect(account, '/book/some-business')).toBeNull();
    expect(isPublic('/organizations/accept-invite/abc123')).toBe(true);
  });

  it('does not treat an anonymous session as an operator account on a protected path', () => {
    // The bug this guards: `userId` alone used to be truthy for an anonymous session, which let
    // it straight through to /organizations instead of being asked to sign in first.
    expect(decideRedirect(anon, '/organizations')).toBe('/login');
  });

  it('lets a permanent account through to a protected path', () => {
    expect(decideRedirect(account, '/organizations')).toBeNull();
  });

  it('keeps /login and /sign-up reachable to an anonymous session rather than bouncing it to /organizations', () => {
    expect(decideRedirect(anon, '/login')).toBeNull();
    expect(decideRedirect(anon, '/sign-up')).toBeNull();
  });

  it('still redirects a signed-in permanent account away from /login and /sign-up', () => {
    expect(decideRedirect(account, '/login')).toBe('/organizations');
    expect(decideRedirect(account, '/sign-up')).toBe('/organizations');
  });

  it('sends a signed-out visitor to /login unchanged', () => {
    expect(decideRedirect(NONE, '/login')).toBeNull();
    expect(decideRedirect(NONE, '/sign-up')).toBeNull();
  });
});

describe('the accept-invite page, by source', () => {
  // No harness here mounts a server component (see workflow-review-route.test.ts), so this
  // guards the specific bug the review named: checking `data.user` truthiness — true for an
  // anonymous session exactly as for a permanent one — instead of the session's actual kind.
  const page = readFileSync(
    fileURLToPath(
      new URL('../app/organizations/accept-invite/[token]/page.tsx', import.meta.url),
    ),
    'utf8',
  );

  it('classifies the session rather than checking bare user truthiness', () => {
    expect(page).toContain('resolveSessionIdentity');
    expect(page).toMatch(/identity\.kind\s*!==\s*'account'/);
    expect(page).not.toMatch(/if\s*\(!data\.user\)/);
  });
});

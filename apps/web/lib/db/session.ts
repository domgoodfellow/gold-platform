import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createPortalClient } from './portal';
import { createProposalClient } from './proposal';
import { classifySessionUser, type SessionIdentity } from '@/lib/domain/identity/session';
import type { Database } from './types';

/**
 * Refresh the caller's session and hand back both the response carrying the rotated
 * cookies and the identity it resolves to.
 *
 * This exists because Server Components cannot write cookies once the response has begun
 * streaming, so something upstream has to rotate the refresh token. That something is the
 * proxy (`proxy.ts`), and this is what it calls.
 *
 * The identity it returns is for deciding where to send someone, never for deciding what they
 * may do. A redirect from the proxy is not the authorization boundary (constraints.md,
 * Security) — the server-side guard and RLS are. It is a `SessionIdentity`, not a bare user id,
 * because an anonymous Supabase session (D22 — booking, the portal) resolves a real user here
 * exactly as a registered one does, and the proxy must not treat the two alike.
 */
export async function updateSession(
  request: NextRequest,
  { portal = false, proposal = false }: { portal?: boolean; proposal?: boolean } = {},
): Promise<{ response: NextResponse; identity: SessionIdentity }> {
  let response = NextResponse.next({ request });

  const jar = {
    getAll: () => request.cookies.getAll(),
    setAll: (cookiesToSet: { name: string; value: string; options: CookieOptions }[]) => {
      for (const { name, value } of cookiesToSet) {
        request.cookies.set(name, value);
      }
      response = NextResponse.next({ request });
      for (const { name, value, options } of cookiesToSet) {
        response.cookies.set(name, value, options);
      }
    },
  };

  // The portal keeps its own cookie (`lib/db/portal.ts`), so a request under `/portal` refreshes
  // that session and leaves the account session alone — and the reverse everywhere else.
  // The proposal recipient's session is a third cookie of its own (`lib/db/proposal.ts`), `/proposal` only.
  const db = portal
    ? createPortalClient(jar)
    : proposal
      ? createProposalClient(jar)
      : createServerClient<Database>(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), publicKey(), { cookies: jar });

  // getUser() rather than getSession(): it revalidates the token against the auth server
  // instead of trusting whatever the cookie claims. This call is what performs the refresh,
  // so it must not be removed as "unused".
  const { data } = await db.auth.getUser();

  return { response, identity: classifySessionUser(data.user) };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function publicKey(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!value) throw new Error('Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  return value;
}

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database, Db } from './types';

/**
 * The proposal recipient's own session, kept apart from the account's and the portal's.
 *
 * A proposal recipient is neither an organization member nor a portal customer. A browser that
 * holds several of these — an operator trying the link they just sent, in a second tab — must
 * not have one replace another, so this names a cookie of its own scoped to `/proposal`. Studio,
 * the portal, a booking visitor and a proposal recipient can all be live at once.
 *
 * `HttpOnly`: nothing in the browser reads it, and the link's own token never needs to travel
 * again after the exchange (`proposal/[token]/route.ts`).
 */
export const PROPOSAL_COOKIE_NAME = 'gold-proposal';
export const PROPOSAL_COOKIE_PATH = '/proposal';

export function proposalCookieOptions(options: CookieOptions = {}): CookieOptions {
  return {
    ...options,
    path: PROPOSAL_COOKIE_PATH,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  };
}

type CookieJar = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: { name: string; value: string; options: CookieOptions }[]) => void;
};

/** A proposal client over any cookie jar — a request's and a response's, in a route handler or the proxy. */
export function createProposalClient(jar: CookieJar): Db {
  return createServerClient<Database>(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), publicKey(), {
    cookieOptions: { name: PROPOSAL_COOKIE_NAME },
    cookies: {
      getAll: jar.getAll,
      setAll: (toSet) =>
        jar.setAll(toSet.map(({ name, value, options }) => ({ name, value, options: proposalCookieOptions(options) }))),
    },
  });
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function publicKey(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!value) throw new Error('Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  return value;
}

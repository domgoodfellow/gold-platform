import { createServerClient, type CookieOptions } from '@supabase/ssr';
import type { Database, Db } from './types';

/**
 * The portal's own session, kept apart from everybody else's.
 *
 * A portal customer is not an organization member, and a browser that holds both — a business
 * owner trying their own customer link in a second tab — must not have one replace the other. They
 * share a Supabase project, so they would share a cookie unless told not to: this names a cookie
 * of the portal's own, scoped to `/portal`, so the Studio session, the booking visitor's and the
 * portal customer's can all be live at once and none can sign out another.
 *
 * Nothing in the browser reads it. The runtime holds it `HttpOnly`, so the credential is not
 * available to a script on the page, and the link's own token never needs to travel again after
 * the exchange (`portal/[token]/route.ts`).
 */
export const PORTAL_COOKIE_NAME = 'gold-portal';
export const PORTAL_COOKIE_PATH = '/portal';

export function portalCookieOptions(options: CookieOptions = {}): CookieOptions {
  return {
    ...options,
    path: PORTAL_COOKIE_PATH,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  };
}

type CookieJar = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: { name: string; value: string; options: CookieOptions }[]) => void;
};

/** A portal client over any cookie jar — a request's and a response's, in a route handler or the proxy. */
export function createPortalClient(jar: CookieJar): Db {
  return createServerClient<Database>(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), publicKey(), {
    cookieOptions: { name: PORTAL_COOKIE_NAME },
    cookies: {
      getAll: jar.getAll,
      setAll: (toSet) =>
        jar.setAll(toSet.map(({ name, value, options }) => ({ name, value, options: portalCookieOptions(options) }))),
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

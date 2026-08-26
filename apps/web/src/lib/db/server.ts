import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Db } from './types';

/**
 * The request-scoped database client, running under the caller's own JWT.
 *
 * This is the only place a client is constructed for a web request, and it never uses the
 * service-role key: a service-role client discards RLS, which is the tenant boundary
 * (constraints.md, Tenancy). If a future operation genuinely needs to act outside a
 * caller's rights, it gets its own narrowly-scoped SECURITY DEFINER function in a
 * migration — not a privileged client here.
 */
export async function getDb(): Promise<Db> {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Thrown when called from a Server Component, where the response has already
            // begun. The proxy (src/proxy.ts) refreshes the session on every request
            // before the route renders, so dropping this write is safe.
          }
        },
      },
    },
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

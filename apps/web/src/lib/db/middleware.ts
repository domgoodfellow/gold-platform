import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

/**
 * Refresh the caller's session and hand back both the response carrying the rotated
 * cookies and the user they resolve to.
 *
 * This exists because Server Components cannot write cookies once the response has begun
 * streaming, so something upstream has to rotate the refresh token. That something is
 * middleware, and this is it.
 *
 * The user it returns is for deciding where to send someone, never for deciding what they
 * may do. A middleware redirect is not the authorization boundary (constraints.md,
 * Security) — the server-side guard and RLS are.
 */
export async function updateSession(
  request: NextRequest,
): Promise<{ response: NextResponse; userId: string | null }> {
  let response = NextResponse.next({ request });

  const db = createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() rather than getSession(): it revalidates the token against the auth server
  // instead of trusting whatever the cookie claims. This call is what performs the refresh,
  // so it must not be removed as "unused".
  const { data } = await db.auth.getUser();

  return { response, userId: data.user?.id ?? null };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/server';

/**
 * Where a Google sign-in lands after Supabase brokers the exchange.
 *
 * Same shape as `auth/recover/route.ts` and for the same two reasons: a route handler because
 * exchanging the code writes a cookie, which a Server Component cannot do once streaming has
 * begun, and a relative `Location` because the exchange sets the session on the host the flow
 * was actually opened at — a redirect that renamed the host would arrive with no cookies.
 *
 * A missing or rejected code sends somebody back to `/login` rather than an error page; there is
 * nothing else useful to show, and email/password sign-in is still right there.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');

  const to = (path: string) =>
    new NextResponse(null, { status: 303, headers: { Location: path } });

  if (!code) return to('/login');

  const db = await getDb();
  const { error } = await db.auth.exchangeCodeForSession(code);

  return to(error ? '/login' : '/organizations');
}

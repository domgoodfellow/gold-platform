import { NextResponse, type NextRequest } from 'next/server';
import { getDb } from '@/lib/db/server';

/**
 * Where a recovery link lands.
 *
 * **A route handler and not a page, because this has to write cookies.** Exchanging the code the
 * carrier of the link arrived with produces a session, and a Server Component cannot set a cookie
 * once the response has begun streaming — `lib/db/server.ts` says so where it swallows the write.
 * So the exchange happens here, and the screen that follows is an ordinary page with a session
 * already in place.
 *
 * **It redirects to one literal and takes no destination from the request.** `proxy.ts` refuses a
 * `?next=` parameter on the grounds that a stored destination has to be checked against a closed
 * set on the way in and on the way out; the same argument applies with more force here, where the
 * request arrives holding a credential. A link that could name where it lands is an open
 * redirector with a session attached.
 *
 * A missing or spent code is not an error page: it sends somebody to the screen that asks for a
 * new link, which is the only thing they can usefully do next.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');

  /*
    **A relative `Location`, so nothing here decides which host somebody lands on.**

    Both `request.url` and `request.nextUrl` were measured doing the wrong thing: a request to
    `http://127.0.0.1:3000/auth/recover` produced a redirect to `http://localhost:3000/…`. Those
    are two origins as far as a browser's cookie jar is concerned, and the exchange below sets
    the session on the host the link was actually opened at — so the redirect would arrive
    somewhere with no cookies, and `/reset-password` would find no session and send the person
    back to ask for another link. A recovery flow that loops forever.

    Deriving the host from the `Host` header would work and would be one more thing trusting a
    header. A relative location needs no host at all: the browser resolves it against the URL it
    is already on, which is by definition the one holding the session.
  */
  const to = (path: string) =>
    new NextResponse(null, { status: 303, headers: { Location: path } });

  if (!code) return to('/forgot-password');

  const db = await getDb();
  const { error } = await db.auth.exchangeCodeForSession(code);

  return to(error ? '/forgot-password' : '/reset-password');
}

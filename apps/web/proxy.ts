import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { updateSession } from '@/lib/db/session';

/**
 * Routes reachable without a session. Everything else redirects to the log-in screen.
 *
 * This is a closed set, checked by exact match or path prefix — not a pattern a request
 * can talk its way into. The redirect target below is likewise a fixed literal: there is
 * deliberately no `?next=` parameter, because a stored destination would have to resolve
 * against a closed set on read as well as on write, and nothing needs one yet
 * (constraints.md, "Never build an open redirector").
 */
const PUBLIC_PATHS = [
  '/',
  '/login',
  '/sign-up',
  '/forgot-password',
  // Where a recovery link lands, and the screen it lands on. Both have to be reachable without a
  // session: that is the state somebody who has forgotten their password is in. `/auth/recover`
  // is a route handler that exchanges the code for one, and `/reset-password` turns an arriving
  // caller with no session away itself.
  '/auth/recover',
  '/reset-password',
];

/**
 * The booking surface, which is public in a way the paths above are not.
 *
 * A prefix rather than an exact match, because the organization and the booking are in the
 * path — and it stays a closed set: one literal, checked with its trailing delimiter so that
 * `/booking` or `/book-a-thing` cannot talk their way in.
 *
 * Letting these through is not an authorization decision and nothing here decides anything. A
 * visitor arrives with no session at all; `beginBooking` gives them an anonymous one, and
 * every row they can then reach is decided by an RLS policy keyed to
 * `app.current_external_tenant()`. If this line were deleted the surface would be unreachable
 * and still correct, which is exactly what the redirect below is also true of.
 */
const BOOKING_PREFIX = '/book/';

/**
 * The portal, on the same terms as booking.
 *
 * The token in the path is a credential, and it is checked by `claim_portal_invite` against a
 * row rather than by anything here -- this only declines to redirect a caller who has no
 * session yet, because they are about to be given an anonymous one. A stranger reaching this
 * prefix with an invented token gets a 404 from the page, not access.
 */
const PORTAL_PREFIX = '/portal/';

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith(BOOKING_PREFIX) ||
    pathname.startsWith(PORTAL_PREFIX)
  );
}

export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Redirection here is convenience, not authorization. Every protected operation is
  // checked again server-side and again by RLS; if this block were deleted the system
  // would be uglier and still correct. Next 16 renamed this convention from `middleware`
  // to `proxy`; the security reasoning is unchanged by the rename.
  if (!userId && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (userId && (pathname === '/login' || pathname === '/sign-up')) {
    const url = request.nextUrl.clone();
    url.pathname = '/organizations';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next's own assets and files with an extension. The proxy runs on
    // every other request because that is what keeps the session alive.
    '/((?!_next/static|_next/image|.*\\.).*)',
  ],
};

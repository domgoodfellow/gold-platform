import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { updateSession } from '@/lib/db/session';

/**
 * Routes reachable without a session. Everything else redirects to sign-in.
 *
 * This is a closed set, checked by exact match or path prefix — not a pattern a request
 * can talk its way into. The redirect target below is likewise a fixed literal: there is
 * deliberately no `?next=` parameter, because a stored destination would have to resolve
 * against a closed set on read as well as on write, and nothing needs one yet
 * (constraints.md, "Never build an open redirector").
 */
const PUBLIC_PATHS = ['/', '/sign-in', '/sign-up'];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
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
    url.pathname = '/sign-in';
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (userId && (pathname === '/sign-in' || pathname === '/sign-up')) {
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

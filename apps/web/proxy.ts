import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { updateSession } from '@/lib/db/session';
import { decideRedirect } from '@/lib/route/access';

/**
 * The routing rules themselves — the closed public-path set and `decideRedirect` — live in
 * `lib/route/access.ts`, plain TypeScript with no Next.js runtime import, so they can be unit
 * tested directly (`session-identity.test.ts`). This file is only the Next-specific glue: refresh
 * the session, ask what to do, act on it.
 */
export async function proxy(request: NextRequest) {
  const { response, identity } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // Redirection here is convenience, not authorization. Every protected operation is
  // checked again server-side and again by RLS; if this block were deleted the system
  // would be uglier and still correct. Next 16 renamed this convention from `middleware`
  // to `proxy`; the security reasoning is unchanged by the rename.
  const target = decideRedirect(identity, pathname);
  if (target) {
    const url = request.nextUrl.clone();
    url.pathname = target;
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

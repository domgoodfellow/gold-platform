import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { updateSession } from '@/lib/db/session';
import { decideRedirect } from '@/lib/route/access';
import { bindingForRequestHost } from '@/lib/route/hostname';
import { LAST_ORGANIZATION_COOKIE, LAST_ORGANIZATION_COOKIE_OPTIONS } from '@/lib/route/last-organization';
import { organizationIdFromPath } from '@/lib/route/platform-context';

/**
 * The routing rules themselves — the closed public-path set and `decideRedirect` — live in
 * `lib/route/access.ts`, plain TypeScript with no Next.js runtime import, so they can be unit
 * tested directly (`session-identity.test.ts`). This file is only the Next-specific glue: refresh
 * the session, ask what to do, act on it.
 */
export async function proxy(request: NextRequest) {
  const { response, identity } = await updateSession(request);
  const { pathname } = request.nextUrl;

  // A business's own hostname opens its public surface at the root, and its published forms. The rewrite carries the hostname, never an organization id: the page resolves it again
  // itself (D17). A hostname that resolves to nothing falls through unchanged — to exactly what an
  // unknown host would have seen — so nothing says which names are almost valid.
  // `/` opens the home page; `/forms/{slug}` — one segment, which no application route has — opens
  // one of that business's published forms. Both carry the hostname, never an id.
  const hostedForm = /^\/forms\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(pathname);
  if (pathname === '/' || hostedForm) {
    const host = request.headers.get('host');
    const binding = await bindingForRequestHost(host);
    if (binding && host) {
      const url = request.nextUrl.clone();
      const hostname = encodeURIComponent(host.toLowerCase().replace(/:\d+$/, ''));
      url.pathname = hostedForm ? `/sites/${hostname}/forms/${hostedForm[1]}` : `/sites/${hostname}`;
      const rewrite = NextResponse.rewrite(url, { request });
      for (const cookie of response.cookies.getAll()) rewrite.cookies.set(cookie);
      return rewrite;
    }
  }

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

  // Remember the business being worked in, so a later sign-in lands there. Only a hint: the
  // landing checks it against the caller's memberships before honouring it.
  const organizationId = organizationIdFromPath(pathname);
  if (organizationId && request.cookies.get(LAST_ORGANIZATION_COOKIE)?.value !== organizationId) {
    response.cookies.set(LAST_ORGANIZATION_COOKIE, organizationId, LAST_ORGANIZATION_COOKIE_OPTIONS);
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

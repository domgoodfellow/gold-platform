import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { updateSession } from '@/lib/db/session';
import { decideRedirect } from '@/lib/route/access';
import { bindingForRequestHost } from '@/lib/route/hostname';
import { LAST_ORGANIZATION_COOKIE, LAST_ORGANIZATION_COOKIE_OPTIONS } from '@/lib/route/last-organization';
import { organizationIdFromPath } from '@/lib/route/platform-context';
import { isServablePageSlug } from '@/lib/domain/public-site/paths';
import { legacyConfigurationPath } from '@/lib/route/configuration-redirect';

/**
 * The routing rules themselves — the closed public-path set and `decideRedirect` — live in
 * `lib/route/access.ts`, plain TypeScript with no Next.js runtime import, so they can be unit
 * tested directly (`session-identity.test.ts`). This file is only the Next-specific glue: refresh
 * the session, ask what to do, act on it.
 */
export async function proxy(request: NextRequest) {
  const { response, identity } = await updateSession(request, {
    portal: request.nextUrl.pathname === '/portal' || request.nextUrl.pathname.startsWith('/portal/'),
    proposal: request.nextUrl.pathname === '/proposal' || request.nextUrl.pathname.startsWith('/proposal/'),
  });
  const { pathname } = request.nextUrl;
  if (pathname === '/portal' || pathname.startsWith('/portal/')) {
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }

  // A business's own hostname opens its public surface at the root, and its published forms. The rewrite carries the hostname, never an organization id: the page resolves it again
  // itself (D17). A hostname that resolves to nothing falls through unchanged — to exactly what an
  // unknown host would have seen — so nothing says which names are almost valid.
  // `/` opens the home page; `/forms/{slug}` opens one of that business's published forms; any other
  // single segment that could name a page (and is not a path the platform owns) opens that page of
  // the published website. All carry the hostname, never an id.
  const hostedForm = /^\/forms\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(pathname);
  const segment = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(pathname)?.[1];
  const hostedPage = segment && isServablePageSlug(segment) ? segment : null;
  if (pathname === '/' || hostedForm || hostedPage) {
    const host = request.headers.get('host');
    const binding = await bindingForRequestHost(host);
    if (binding && host) {
      if (binding.surface === 'portal') {
        const target = request.nextUrl.clone();
        target.host = host;
        target.pathname = '/portal';
        target.search = '';
        const redirected = NextResponse.redirect(target);
        for (const cookie of response.cookies.getAll()) redirected.cookies.set(cookie);
        return redirected;
      }
      const url = request.nextUrl.clone();
      const hostname = encodeURIComponent(host.toLowerCase().replace(/:\d+$/, ''));
      url.pathname = hostedForm
        ? `/sites/${hostname}/forms/${hostedForm[1]}`
        : hostedPage ? `/sites/${hostname}/${hostedPage}` : `/sites/${hostname}`;
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

  // Compatibility redirects read no business data and preserve search and browser fragments.
  const canonicalConfiguration = legacyConfigurationPath(pathname);
  if (canonicalConfiguration) {
    const url = request.nextUrl.clone();
    url.pathname = canonicalConfiguration;
    const redirected = NextResponse.redirect(url);
    for (const cookie of response.cookies.getAll()) redirected.cookies.set(cookie);
    return redirected;
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

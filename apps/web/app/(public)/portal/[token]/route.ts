import { NextResponse, type NextRequest } from 'next/server';
import { createPortalClient } from '@/lib/db/portal';
import { DomainError } from '@/lib/domain/errors';
import { exchangePortalLink } from '@/lib/domain/portal/portal';
import { normalizeRequestHost } from '@/lib/domain/domains/resolve';
import { isDeploymentHost } from '@/lib/route/hostname';

/**
 * The link a business sends, exchanged once for a session and then left behind.
 *
 * **Why this is a route handler.** A page cannot write a cookie while it renders, so the session
 * the old page made lasted for that render only and every action after it ran with none. A route
 * handler can: the session is kept in the portal's own `HttpOnly` cookie (`lib/db/portal.ts`) on
 * the redirect response, and the browser is sent to `/portal`, an address that carries no secret.
 * The link's token is therefore in browser history, in a Referer or in analytics for exactly one
 * request, and no action ever has to carry it again.
 *
 * An invalid, withdrawn or switched-off link all land on the same page (see `unavailable`).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const rawHost = request.headers.get('host');
  const hostname = normalizeRequestHost(rawHost);
  if (!hostname) return new NextResponse('Portal unavailable.', { status: 400 });
  const protocol = request.headers.get('x-forwarded-proto') === 'https' ? 'https' : request.nextUrl.protocol.replace(':','');
  const origin = `${protocol}://${rawHost}`;
  const response = NextResponse.redirect(new URL('/portal', origin));
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Cache-Control', 'no-store');

  const db = createPortalClient({
    getAll: () => request.cookies.getAll(),
    setAll: (toSet) => {
      for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
    },
  });

  try {
    await exchangePortalLink(db, { token, ...(isDeploymentHost(hostname) ? {} : { hostname }) });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    const refused = NextResponse.redirect(new URL('/portal/unavailable', origin));
    refused.headers.set('Referrer-Policy', 'no-referrer');
    refused.headers.set('Cache-Control', 'no-store');
    // The refusal signed the client out, which wrote cookie removals onto `response`; carry them.
    for (const cookie of response.cookies.getAll()) refused.cookies.set(cookie);
    return refused;
  }
  return response;
}

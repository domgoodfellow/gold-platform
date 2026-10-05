import { NextResponse, type NextRequest } from 'next/server';
import { createProposalClient } from '@/lib/db/proposal';
import { exchangeProposalLink } from '@/lib/domain/customers/proposal-access';
import { DomainError } from '@/lib/domain/errors';

/**
 * The link a business sends, exchanged once for a session and then left behind.
 *
 * A page cannot write a cookie while it renders, so the session the old page made lasted for that
 * render only and Accept/Decline ran with none. A route handler can: the session is kept in the
 * proposal's own `HttpOnly` cookie (`lib/db/proposal.ts`) on the redirect response, and the
 * browser is sent to `/proposal`, an address that carries no secret. No action carries the token.
 *
 * An invalid, withdrawn or otherwise unusable link all land on the same page (`unavailable`).
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = request.nextUrl.origin;
  const response = NextResponse.redirect(new URL('/proposal', origin));
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Cache-Control', 'no-store');

  const db = createProposalClient({
    getAll: () => request.cookies.getAll(),
    setAll: (toSet) => {
      for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
    },
  });

  try {
    await exchangeProposalLink(db, { token });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    const refused = NextResponse.redirect(new URL('/proposal/unavailable', origin));
    refused.headers.set('Referrer-Policy', 'no-referrer');
    refused.headers.set('Cache-Control', 'no-store');
    // The refusal signed the client out, which wrote cookie removals onto `response`; carry them.
    for (const cookie of response.cookies.getAll()) refused.cookies.set(cookie);
    return refused;
  }
  return response;
}

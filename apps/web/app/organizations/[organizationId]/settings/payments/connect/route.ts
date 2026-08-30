import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { paymentProvider } from '@/lib/adapters/payments';
import { requireOrganization } from '@/lib/route/organization';
import { callbackUrl, STATE_COOKIE } from '../state';

/**
 * Send an operator to their processor to authorize this business.
 *
 * A route handler rather than a server action, because what has to happen is a redirect to a
 * third party carrying a value this server generated — an action would have to hand the URL
 * back and let the client navigate, which puts the state cookie and the navigation in two
 * places that can disagree.
 *
 * **Not under an `api/` directory**, and there is not one in `apps/web` (D26). This is a screen's
 * own machinery, so it lives beside the screen.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  const { organizationId } = await params;

  // The same guard every screen runs. `requireOrganization` redirects an anonymous caller and
  // 404s a business this user is not in — RLS is the boundary either way (I12).
  const { organization } = await requireOrganization(organizationId);

  if (!organization.capabilities.includes('organization.manage')) {
    // Where this business is paid is not a dispatcher's decision, and the check is here as
    // well as in the policy because a redirect out to a third party is worth refusing before
    // it happens rather than after.
    return new Response('forbidden', { status: 403 });
  }

  const provider = await paymentProvider();
  if (!provider) {
    return new Response('not found', { status: 404 });
  }

  // **The state, and the attack it exists for.** Without it, somebody who can get an operator
  // to visit the callback with a code of their choosing connects *their* account to this
  // business — and every card payment thereafter lands in their bank. So a nonce is minted
  // here, kept in an httpOnly cookie, and compared on the way back; the provider only ever
  // echoes it.
  const nonce = randomUUID();
  const store = await cookies();
  store.set(STATE_COOKIE, `${organizationId}:${nonce}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Long enough to onboard with a processor, short enough that an abandoned attempt does
    // not stay valid.
    maxAge: 60 * 30,
  });

  redirect(
    provider.connectUrl({
      state: nonce,
      returnUrl: await callbackUrl(organizationId),
    }),
  );
}

import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { paymentProvider } from '@/lib/adapters/payments';
import { requireOrganization } from '@/lib/route/organization';
import { callbackUrl, STATE_COOKIE } from '../state';

/**
 * Send an operator to their processor to authorize this business. A route handler, not a server
 * action — the redirect carries a value this server generated, and an action would put the
 * cookie and the navigation in two places that could disagree. Not under `api/` — there is none
 * in `apps/web`; this is the screen's own machinery.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  const { organizationId } = await params;

  const { organization } = await requireOrganization(organizationId);

  if (!organization.capabilities.includes('organization.manage')) {
    return new Response('forbidden', { status: 403 });
  }

  const provider = await paymentProvider();
  if (!provider) {
    return new Response('not found', { status: 404 });
  }

  // The nonce defends against someone getting an operator to visit the callback with a code of
  // their choosing, which would connect the attacker's account to this business instead.
  const nonce = randomUUID();
  const store = await cookies();
  store.set(STATE_COOKIE, `${organizationId}:${nonce}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 30,
  });

  redirect(
    provider.connectUrl({
      state: nonce,
      returnUrl: await callbackUrl(organizationId),
    }),
  );
}

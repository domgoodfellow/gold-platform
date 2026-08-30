import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { paymentProvider } from '@/lib/adapters/payments';
import { connectPaymentAccount } from '@/lib/domain/billing/payment-accounts';
import { requireOrganization } from '@/lib/route/organization';
import { callbackUrl, STATE_COOKIE } from '../state';

/**
 * The operator coming back from their processor.
 *
 * **Three things are checked before anything is written**, and the order matters: that this
 * caller may configure this business, that the state matches what was minted, and only then
 * that the provider will complete the exchange. Reversing the last two would let somebody burn
 * a code against a business they have no claim on.
 *
 * The account id is never read from the query string. It comes back from the exchange, which is
 * authenticated with the platform's own key — so the only thing an attacker controls is a code
 * that will be refused by the state check first.
 */

export const dynamic = 'force-dynamic';

function back(organizationId: string, outcome: string): never {
  redirect(`/organizations/${organizationId}/settings?payments=${outcome}`);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
): Promise<Response> {
  const { organizationId } = await params;
  const { db, organization } = await requireOrganization(organizationId);

  if (!organization.capabilities.includes('organization.manage')) {
    return new Response('forbidden', { status: 403 });
  }

  const store = await cookies();
  const expected = store.get(STATE_COOKIE)?.value ?? null;
  // Single use, whatever happens below. A state that survived a failed attempt would be a
  // state worth replaying.
  store.delete(STATE_COOKIE);

  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');

  // The provider says the operator declined. Not an error, and it must not read like one.
  if (url.searchParams.get('error')) {
    back(organizationId, 'cancelled');
  }

  // **The check the whole flow exists for.** Without it, anybody who can get an operator to
  // open this URL with a code of their choosing points this business's card payments at their
  // own account. The cookie is httpOnly and names the organization as well as the nonce, so a
  // state minted for one business cannot complete against another.
  if (!expected || !state || !code || expected !== `${organizationId}:${state}`) {
    back(organizationId, 'mismatch');
  }

  const provider = await paymentProvider();
  if (!provider) {
    return new Response('not found', { status: 404 });
  }

  let account;
  try {
    account = await provider.completeConnection({
      code,
      returnUrl: await callbackUrl(organizationId),
    });
  } catch {
    // No partial connection. A business that believes it is connected and is not discovers it
    // when a customer tries to pay, which is the worst possible moment to find out.
    back(organizationId, 'failed');
  }

  await connectPaymentAccount(db, {
    organizationId,
    provider: provider.name,
    account,
  });

  back(organizationId, 'connected');
}

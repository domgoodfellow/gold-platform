import type { PlatformBillingProvider } from './index';

/**
 * Which implementation this deployment uses — the only file outside an implementation that
 * names one. Null when unconfigured: a deployment that has not decided how it bills itself yet
 * is complete, and every screen that would offer a subscription control simply shows none
 * (the same absence `lib/adapters/payments/registry.ts` already returns for a cash-only
 * business).
 *
 * **The same `STRIPE_SECRET_KEY` as `lib/adapters/payments`, deliberately.** Both capabilities
 * act as GOLD's own Stripe account — Connect's OAuth/direct-charge calls act *as* GOLD *on
 * behalf of* a connected account via the `Stripe-Account` header; this capability acts as GOLD
 * *for itself*, with no such header. One platform credential, two ways of using it, never a
 * tenant's own key either way (the provider-credential rule, restated for this plane).
 */
export async function platformBillingProvider(): Promise<PlatformBillingProvider | null> {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;

  const { stripePlatformBillingProvider } = await import('./stripe');
  return stripePlatformBillingProvider({ secret });
}

/**
 * Which Stripe environment this deployment bills in, read from the same secret
 * `platformBillingProvider` reads and by the same rule as `stripe.ts` — null when unconfigured.
 * Service access needs the answer without constructing a provider, since it only reads cached
 * rows and never calls out.
 */
export function platformBillingEnvironment(): 'sandbox' | 'live' | null {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  return secret.startsWith('sk_live_') ? 'live' : 'sandbox';
}

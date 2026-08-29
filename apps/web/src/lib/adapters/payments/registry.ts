import type { PaymentProvider } from './index';

/**
 * Which implementation this deployment uses.
 *
 * **The only file outside an implementation that names a provider**, and it is deliberately
 * this small. Everything above it — the contract in `./index`, every domain function, every
 * screen — names a capability. `adapters.test.ts` holds that line from both sides: no domain
 * file may name a vendor, and the contract file may not either.
 *
 * `null` when nothing is configured, rather than a throw. A business that takes only cash is a
 * complete business — Pneu3L is one for as long as it wants to be — so the card path simply
 * does not appear and the webhook route answers 404.
 *
 * **Selection is by environment rather than by tenant, and D27 records both why and for how
 * long.** The deferral was written here as "per-tenant credentials mean secrets at rest, a
 * rotation story and a vault" — true of the shape it assumed, which was a settings form taking
 * a pasted secret key. D27 rejects that shape: a tenant authorizes GOLD from their own
 * processor account and what gets stored is an account id, which is not a credential and needs
 * no vault. So the deferral stands and the reason has changed.
 *
 * **The trigger also changed, and it is sooner than this file used to say.** It was "when a
 * second business asks to take cards"; D27 makes it the *first real charge*, because until
 * then the environment variable below is a test key and after it is a live one belonging to
 * somebody else's business.
 *
 * When it lands, this function grows an organization argument and nothing above it changes —
 * which is the whole return on naming the capability instead of the provider.
 */
export async function paymentProvider(): Promise<PaymentProvider | null> {
  // The **platform's** own credentials, and they stay here permanently — D27 is explicit that
  // this is correct and that what must never live here is a *tenant's* key. The signing secret
  // is not read: verifying callbacks is `apps/api`'s, and one HMAC in the repository is the
  // point of that split.
  const secret = process.env.STRIPE_SECRET_KEY;
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!secret || !clientId) return null;

  const { stripePaymentProvider } = await import('./stripe');
  return stripePaymentProvider({ secret, clientId });
}

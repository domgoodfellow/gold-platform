import type { PaymentProvider } from './index';

/**
 * Which implementation this deployment uses — the only file outside an implementation that
 * names one. Null when unconfigured: a cash-only business is complete, and the webhook route
 * 404s. Selected by environment, not by tenant — what's stored per-tenant is an account id
 *, not a credential, so there's no per-tenant secret to manage here.
 */
export async function paymentProvider(): Promise<PaymentProvider | null> {
  // The platform's own credentials — a tenant's key must never live here. The signing
  // secret is read in apps/api, which owns webhook verification.
  const secret = process.env.STRIPE_SECRET_KEY;
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!secret || !clientId) return null;

  const { stripePaymentProvider } = await import('./stripe');
  return stripePaymentProvider({ secret, clientId });
}

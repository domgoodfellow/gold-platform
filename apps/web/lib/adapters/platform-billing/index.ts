/**
 * GOLD charging an organization for its own subscription — named as a capability rather than a
 * provider (I15), the same discipline `lib/adapters/payments` already holds for the opposite
 * money direction. Domain code imports `PlatformBillingProvider`/`platformBillingProvider` from
 * here and never reaches past it to `./stripe`.
 *
 * **Never confused with `lib/adapters/payments`.** That capability is a customer paying a
 * tenant's own connected Stripe account (`acct_...`, D27) — GOLD is never in that flow. This one
 * is the opposite direction: an organization paying GOLD, on GOLD's own Stripe account, using
 * GOLD's own Customer (`cus_...`) and Subscription (`sub_...`) objects. No type here may be
 * mistaken for one over there — there is no `ConnectedAccount` in this file, and nothing here
 * carries an `accountId`.
 */

export type PlatformBillingEnvironment = 'sandbox' | 'live';

export type PlatformBillingCustomer = {
  customerId: string;
};

export type CheckoutLineItemRequest = { priceId: string; quantity: number };

export type CheckoutSessionRequest = {
  customerId: string;
  /** One or more provider prices -- a base Plan plus any Add-ons, resolved entirely server-side (work order C §7). */
  lineItems: CheckoutLineItemRequest[];
  /** Our own correlation token (`platform_billing_checkout_sessions.id`): the provider's idempotency key, and carried onto the subscription it creates so the webhook can correlate that subscription back to this checkout. */
  requestId: string;
  organizationId: string;
  successUrl: string;
  cancelUrl: string;
};

export type CheckoutSessionStarted = {
  url: string;
  /** The provider's own correlation reference for this attempt — recorded for diagnostics, never trusted as payment proof (Phase 7). */
  providerReference: string;
};

export type PortalSessionStarted = {
  url: string;
};

export type ProvisionedPrice = {
  productId: string;
  priceId: string;
};

export type PlatformBillingProvider = {
  readonly name: string;
  /** Derived from which secret this deployment holds (D-restated for this plane, Phase 16) — never a separately-set flag that could drift from the key actually in use. */
  readonly environment: PlatformBillingEnvironment;

  /** Idempotent for retries of the same organization within the provider's own idempotency window; the caller's own database row is still what makes repeat calls a no-op after the first succeeds. */
  ensureCustomer(input: {
    organizationId: string;
    email: string | null;
    name: string;
  }): Promise<PlatformBillingCustomer>;

  /** Outbound only — being told what happened is webhook ingress, which belongs to Python (D2, D26). */
  createCheckoutSession(input: CheckoutSessionRequest): Promise<CheckoutSessionStarted>;

  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<PortalSessionStarted>;

  /**
   * Staff-only, and never called at checkout time (Phase 4/7: a stable Price id is resolved,
   * never invented while a caller waits). `productIdempotencyKey`/`priceIdempotencyKey` are the
   * caller's own — this repository's — correlation tokens, not a Stripe id it already knows.
   */
  createPrice(input: {
    productIdempotencyKey: string;
    priceIdempotencyKey: string;
    planKey: string;
    planLabel: string;
    currency: string;
    amountMinor: number;
    billingInterval: 'month' | 'year' | 'one_time';
  }): Promise<ProvisionedPrice>;
};

/** Re-exported so only ./registry names an implementation (adapters.test.ts). */
export { platformBillingEnvironment, platformBillingProvider } from './registry';

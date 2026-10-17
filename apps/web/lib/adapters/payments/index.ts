/**
 * Taking a card payment, named as a capability rather than a provider. Domain code imports
 * `PaymentProvider`/`paymentProvider` from here and never reaches past it to `./stripe`.
 * No type here may name Stripe or carry a Stripe id — `providerReference` is deliberately
 * generic so a second processor wouldn't need every caller rewritten.
 */

/** A business's own account with the processor — an authorization, not a key. Revocable from their own dashboard. */
export type ConnectedAccount = {
  accountId: string;
};

export type PaymentRequest = {
  /** Required — omitting it would let a charge land on the platform's own balance, the money-transmitter shape the provider-credential rule forbids. */
  account: ConnectedAccount;
  /** Our own correlation token; the processor returns it. */
  requestId: string;
  amountMinor: number;
  /** Integer minor units, snapshotted from the invoice. */
  currency: string;
  /** What the payer sees — the business's own words, never a platform noun. */
  description: string;
  returnUrl: string;
};

export type PaymentRequested = {
  /** Stored for idempotency, never trusted for routing. */
  providerReference: string;
  payUrl: string;
};

export type PaymentProvider = {
  readonly name: string;
  connectUrl(input: { state: string; returnUrl: string }): string;
  /** Throws on anything incomplete — never falls back to a partial connection. */
  completeConnection(input: { code: string; returnUrl: string }): Promise<ConnectedAccount>;
  /**
   * Outbound only — being called back by the processor is webhook ingress, which belongs to
   * Python, in `apps/api/app/providers/stripe/`.
   */
  request(input: PaymentRequest): Promise<PaymentRequested>;
};

/** Re-exported so only ./registry names an implementation (adapters.test.ts). */
export { paymentProvider } from './registry';

/**
 * Taking a card payment, named as a capability rather than as a provider.
 *
 * **This directory is the first adapter, and I15 is the invariant it exists to make true.**
 * *A vendor belongs behind an adapter. Domain code names capabilities — place a call, charge
 * a card — never providers.* Everything below is that sentence written as types: the domain
 * layer imports `PaymentProvider` and `paymentProvider()` from this file, and nothing under
 * `lib/domain/` may reach past it to `./stripe`. `adapters.test.ts` reads the tree and fails
 * if anything does, in the shape `schema-conformance.test.ts` uses for the schema — because an
 * adapter boundary that is merely a convention is a boundary until somebody is in a hurry.
 *
 * **What a capability may not leak.** No type here names Stripe, carries a Stripe id, or
 * describes a Stripe object. `providerReference` is a string this platform stores and hands
 * back; it is deliberately not `sessionId`, because the day a second processor lands, a domain
 * function holding a `sessionId` is a domain function that already knows who its provider is.
 */

/**
 * A business's own account with the processor.
 *
 * An id and nothing else. D27: what a tenant hands over is an authorization, not a key — this
 * grants nothing without the platform's own credentials, and the business can revoke it from
 * their own dashboard. That is why it lives in a row rather than in a vault.
 */
export type ConnectedAccount = {
  accountId: string;
};

/** What a business wants collected, in the terms this platform already holds money in. */
export type PaymentRequest = {
  /**
   * Whose account the money lands in.
   *
   * **Required, and there is no path that omits it.** A charge with no connected account is a
   * charge on the platform's own balance, which is the money-transmitter shape D27 refuses —
   * making this optional would make that shape reachable by forgetting an argument.
   */
  account: ConnectedAccount;
  /** Our own correlation token. The processor is handed this and returns it (see the migration). */
  requestId: string;
  amountMinor: number;
  /** Integer minor units and an explicit currency, both snapshotted from the invoice (I10). */
  currency: string;
  /** What the payer sees. The business's own words about its own work, never a platform noun. */
  description: string;
  /** Where the payer lands afterwards. Resolved against a closed set by the caller, never stored. */
  returnUrl: string;
};

/** Where to send the payer, and what to remember about having asked. */
export type PaymentRequested = {
  /** The processor's own identifier for this attempt. Stored for idempotency, never trusted for routing. */
  providerReference: string;
  /** Where the payer completes the payment. */
  payUrl: string;
};

export type PaymentProvider = {
  /** The name stored on `payments.provider` and `payment_requests.provider`. */
  readonly name: string;
  /**
   * Where to send an operator so they can authorize this platform against their own account.
   *
   * `state` is opaque to the provider and is checked on the way back — see the callback route.
   * Named for what it does rather than for the protocol: a provider that used something other
   * than a redirect would implement this the same way from the caller's side.
   */
  connectUrl(input: { state: string; returnUrl: string }): string;
  /**
   * Turn what the provider handed back into an account id.
   *
   * Throws on anything it cannot complete. The caller must not fall back to a partial
   * connection: a business that believes it is connected and is not will discover it at the
   * moment a customer tries to pay.
   */
  completeConnection(input: { code: string; returnUrl: string }): Promise<ConnectedAccount>;
  /**
   * Ask for money. Returns where to send the payer.
   *
   * **Outbound only, and the asymmetry is D2's.** Creating a payment request is an operator
   * pressing a button inside a transactional flow, which D2 gives to TypeScript. Being *called*
   * by the processor afterwards is webhook ingress, which D2 gives to Python — so there is no
   * `settlement` here, and no signature verification anywhere in this tree. It lives in
   * `apps/api/app/integrations/stripe/`, and having it in one runtime rather than two is the
   * point: two implementations of one HMAC would eventually disagree about a replay window.
   */
  request(input: PaymentRequest): Promise<PaymentRequested>;
};

/**
 * The configured provider, or `null` when this deployment has none.
 *
 * **Re-exported rather than defined here, and the test is what forced the split.** Choosing an
 * implementation is the one operation that must name implementations, so it cannot live in the
 * file that defines the contract — `adapters.test.ts` asserts that this file contains no
 * provider's name anywhere, and the first draft failed it on its own selection code. That was
 * the test working: a contract that names a vendor is a contract shaped by one.
 *
 * `./registry` is therefore the single place in the tree, outside an implementation, that is
 * allowed to say `stripe`.
 */
export { paymentProvider } from './registry';

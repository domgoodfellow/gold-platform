/**
 * GOLD sending its own transactional email — an invitation, never a tenant's own customer
 * communication (that is `apps/api/app/channels`, metered, and paid for through D40's purse).
 * Named as a capability rather than a provider (I15): nothing here may carry a message id, an
 * API response shape, or anything else that reveals which vendor answered.
 */

export type PlatformEmail = {
  to: string;
  subject: string;
  text: string;
};

export type PlatformEmailSender = {
  readonly name: string;
  /** Never throws for "unconfigured" — that is `platformEmailSender()` returning null instead. */
  send(email: PlatformEmail): Promise<void>;
};

/** Re-exported so only ./registry names an implementation (adapters.test.ts). */
export { platformEmailSender } from './registry';

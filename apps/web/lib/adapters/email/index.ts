/**
 * GOLD sending its own transactional email — an invitation, never a tenant's own customer
 * communication (that is `apps/api/app/channels`, metered, and paid for through D40's purse).
 * Named as a capability rather than a provider (I15): nothing here may carry a vendor's response
 * shape, only the opaque message id a later webhook can be correlated against.
 *
 * **No credential here, and none can be.** The Resend account lives in `platform_provider_accounts`
 * (D54/D62) and is read only by `apps/api`'s `provider_operator` (D14). Every method is a request
 * carrying the person's own token and an invitation this caller may already see; `apps/api` builds
 * the email itself from a fixed template and resolves which credential answers.
 */

export type PlatformEmailReceipt = {
  sent: boolean;
  /** Resend's own id for the message, or `null` when it never reached the provider. Opaque above this boundary. */
  externalId: string | null;
};

export type PlatformEmailSender = {
  readonly name: string;
  /**
   * Sends (or resends) the invitation email for a pending invitation this caller may see, with
   * the link they already hold — never throws for "unconfigured" or "the provider refused it",
   * both come back as `sent: false` so the caller can show the copyable link as the fallback it
   * already is (D31).
   */
  sendInvitationEmail(input: { organizationId: string; invitationId: string; link: string }): Promise<PlatformEmailReceipt>;
};

/** Re-exported so only ./registry names an implementation (adapters.test.ts). */
export { platformEmailSender } from './registry';

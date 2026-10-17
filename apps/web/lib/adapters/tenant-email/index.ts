/**
 * A business sending email to its own customers through Communications, as a capability.
 *
 * **Not `../email`, and not `../email-domains`.** Three email capabilities exist and answer three
 * different questions: `../email` is GildOps itself sending an invitation (`PlatformEmailSender`,
 * never a tenant's customer, never metered to a tenant); `../email-domains` is proving that a
 * business may send from a name at all; this is *an organization's message to a person*. Folding
 * either of the others in would let a tenant's mail ride on the platform's own sender, or let a
 * transactional template grow into a general send — so this contract stands alone.
 *
 * **The message is the command, and the provider runtime reads it.** What is sent, to whom and from
 * which address was decided by the database when the message was queued, under the sender's own
 * session. This contract therefore carries only *which message*: the runtime on the other side reads
 * everything else under the caller's token. There is no `from`, `to` or `subject` here for a caller
 * to supply, so no path through this capability can send as an address the business does not hold or
 * to a person the message does not name. Nothing here carries a vendor's vocabulary:
 * `adapters.test.ts` holds that from both sides.
 *
 * **The canonical status is the database's.** What came back is for the caller to show; the message
 * row, written by the same runtime through the one door that may say what a provider answered, is the
 * truth, and callers re-read it.
 */

export type EmailSubmission = {
  organizationId: string;
  /** The queued outbound message this send fulfils. */
  messageId: string;
};

export type EmailOutcome =
  /** The provider took the message. */
  | { status: 'accepted'; externalId: string | null }
  /** The provider refused it — a fact about the message, not retried. */
  | { status: 'rejected'; detail: string | null }
  /** Somebody else already has it, or it has already gone: not a second send. */
  | { status: 'in_progress' }
  /** Nothing could take it right now; the message is back in the queue and the same send can be tried again. */
  | { status: 'unavailable'; detail: string | null };

export type EmailProvider = {
  sendEmail(input: EmailSubmission): Promise<EmailOutcome>;
};

/** Re-exported so only ./registry names an implementation (adapters.test.ts). */
export { emailProvider } from './registry';

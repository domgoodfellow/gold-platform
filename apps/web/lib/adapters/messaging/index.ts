/**
 * Sending a text message, as a capability.
 *
 * **Not a word in here belongs to a vendor** (I15) — `adapters.test.ts` holds that from both
 * sides. What a caller says is *send this text from this number to that one*. Which company
 * carries it is `registry.ts`'s only subject, the same split `../telephony` already draws.
 *
 * **One method, on purpose.** MMS and RCS are not third and fourth methods here — they are what
 * `requested_transport` asks for and `sendMessage`'s own return says was actually used; the
 * capability a caller names is "deliver this content," not "use this specific wire protocol."
 */

export type MessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'undelivered';

export type SentMessage = {
  /** The provider's own id for this message — opaque, kept only so a later callback can find the row it belongs to. */
  externalId: string;
  status: MessageStatus;
};

export type MessagingProvider = {
  /**
   * Send `body` from `from` to `to`, and report delivery to `reportTo`.
   *
   * `reportTo` is supplied per message rather than configured once at the provider, the same
   * reason `TelephonyProvider.addToRoom` takes it: a deployment that moves does not leave its
   * messages reporting to an address that no longer answers.
   */
  sendMessage(input: { from: string; to: string; body: string; reportTo: string }): Promise<SentMessage>;
};

export { messagingCallbackBase, messagingProvider, messagingProviderKey } from './registry';

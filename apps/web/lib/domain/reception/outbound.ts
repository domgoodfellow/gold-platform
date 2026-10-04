import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { replyToEmailConversation, type SendEmailResult } from '@/lib/domain/email/messages';
import { getConversation, sendSms, type Message } from './messaging';

/**
 * The outbound commands Communications offers, one per piece of product intent, and the one that is
 * genuinely channel-neutral.
 *
 * **Channel-specific commands, shared discipline.** `sendSms` and `sendEmail` (`../email/messages`)
 * are separate commands with separate contracts, because a text and an email do not take the same
 * input. What they share is the pipeline each one runs, in this order: resolve who is acting, check
 * they may send, resolve the sender from a *resource id* the client named (a `phoneNumberId`, an
 * `emailIdentityId`) and never from an address it typed, resolve the recipient, find or create the
 * conversation, check the channel is ready, write a durable outbound message *before* the provider is
 * asked, call the provider through its capability, record what it answered, and report usage once.
 * Idempotency is a database constraint on the message (`idempotency_key`), so a double click, a retry
 * and a job's re-run are one send. Provider choice happens below this layer, in the registries.
 *
 * **`replyToConversation` is the only command that dispatches on channel**, because it is the only
 * one whose input does not already know it: the conversation does, and fixes the sender and the
 * recipient, so a reply can name neither.
 */
export { sendSms } from './messaging';
export { sendEmail, replyToEmailConversation, dispatchQueuedEmail } from '@/lib/domain/email/messages';

export type ReplyResult =
  | { channel: 'sms'; message: Message }
  | ({ channel: 'email' } & SendEmailResult);

export async function replyToConversation(
  db: Db,
  input: { organizationId: string; conversationId: string; body: string; idempotencyKey: string; subject?: string; files?: File[] },
): Promise<ReplyResult> {
  const conversation = await getConversation(db, { organizationId: input.organizationId, conversationId: input.conversationId });
  if (!conversation) throw new DomainError('No such conversation here.', 'messaging.conversation_not_found');

  if (conversation.channel === 'sms') {
    const message = await sendSms(db, {
      organizationId: input.organizationId,
      phoneNumberId: conversation.phoneNumberId,
      toNumber: conversation.externalNumber,
      body: input.body,
      idempotencyKey: input.idempotencyKey,
      customerId: conversation.customerId,
    });
    return { channel: 'sms', message };
  }

  const result = await replyToEmailConversation(db, {
    organizationId: input.organizationId,
    conversationId: conversation.id,
    text: input.body,
    subject: input.subject,
    idempotencyKey: input.idempotencyKey,
    files: input.files,
  });
  return { channel: 'email', ...result };
}

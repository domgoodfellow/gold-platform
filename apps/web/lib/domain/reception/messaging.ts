import { messagingCallbackBase, messagingProvider } from '@/lib/adapters/messaging';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { getPhoneNumber } from './numbers';

/**
 * One Message, one canonical object — never `SmsMessage`/`MmsMessage`/`RcsMessage`. Which wire
 * protocol carried it is `transport`, a resolved fact about the send, not the type doing the
 * sending. This slice's resolver only ever reaches `sms` (no RCS sender approval flow and no
 * attachment pipeline exist yet); the vocabulary for `mms`/`rcs` is real so a later slice extends
 * this resolver instead of replacing the schema underneath it.
 */

export type MessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'undelivered' | 'rejected' | 'bounced';
export type MessageTransport = 'sms' | 'mms' | 'rcs' | 'email';
export type MessageIntent = 'conversational' | 'transactional' | 'lifecycle' | 'marketing';

/**
 * One Conversation, whatever channel it runs on. What is shared — whose it is, who it is about,
 * when it last moved, whether it is unread — lives on the base; what addresses it is per channel,
 * and a union keeps the two honest: an SMS conversation always has its number pair, an email one
 * always has the address it is spoken through, and neither is ever handed a placeholder for the
 * other's fields.
 */
type ConversationBase = {
  id: string;
  customerId: string | null;
  lastMessageAt: string;
  lastMessagePreview: string;
  unread: boolean;
};
export type SmsConversation = ConversationBase & { channel: 'sms'; phoneNumberId: string; externalNumber: string };
export type EmailConversation = ConversationBase & {
  channel: 'email';
  emailIdentityId: string;
  /** The one person on the other end, for now. */
  externalEmail: string;
  /** The subject the thread was started under, without `Re:`/`Fwd:`. For display only; never how a thread is found. */
  subject: string | null;
};
export type Conversation = SmsConversation | EmailConversation;
export type ConversationChannel = Conversation['channel'];

export type Message = {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  status: MessageStatus;
  intent: MessageIntent;
  body: string;
  requestedTransport: MessageTransport;
  transport: MessageTransport | null;
  failureReason: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
};

const CONVERSATION_SELECT =
  'id, customer_id, channel, phone_number_id, external_number, email_identity_id, external_email, subject, last_message_at, last_message_preview, unread';

type ConversationRow = {
  id: string;
  customer_id: string | null;
  channel: string;
  phone_number_id: string | null;
  external_number: string | null;
  email_identity_id: string | null;
  external_email: string | null;
  subject: string | null;
  last_message_at: string;
  last_message_preview: string;
  unread: boolean;
};

function toConversation(row: ConversationRow): Conversation {
  const base = {
    id: row.id,
    customerId: row.customer_id,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    unread: row.unread,
  };
  // `conversations_channel_addressing` guarantees the half each channel needs; this refuses to
  // invent one if a row ever arrives without it rather than handing a screen an empty address.
  if (row.channel === 'sms' && row.phone_number_id && row.external_number) {
    return { ...base, channel: 'sms', phoneNumberId: row.phone_number_id, externalNumber: row.external_number };
  }
  if (row.channel === 'email' && row.email_identity_id && row.external_email) {
    return { ...base, channel: 'email', emailIdentityId: row.email_identity_id, externalEmail: row.external_email, subject: row.subject };
  }
  throw new DomainError('A conversation is missing the address its channel needs.', 'messaging.conversation_malformed');
}

export function listConversations(db: Db, input: { organizationId: string; channel: 'sms' }): Promise<SmsConversation[]>;
export function listConversations(db: Db, input: { organizationId: string; channel: 'email' }): Promise<EmailConversation[]>;
export function listConversations(db: Db, input: { organizationId: string; channel?: ConversationChannel }): Promise<Conversation[]>;
export async function listConversations(db: Db, input: { organizationId: string; channel?: ConversationChannel }): Promise<Conversation[]> {
  let query = db.from('conversations').select(CONVERSATION_SELECT).eq('organization_id', input.organizationId);
  if (input.channel) query = query.eq('channel', input.channel);
  const { data, error } = await query.order('last_message_at', { ascending: false });
  if (error) throw new DomainError(error.message, 'messaging.conversations_failed');
  return (data ?? []).map(toConversation);
}

export async function getConversation(db: Db, input: { organizationId: string; conversationId: string }): Promise<Conversation | null> {
  const { data, error } = await db
    .from('conversations')
    .select(CONVERSATION_SELECT)
    .eq('organization_id', input.organizationId)
    .eq('id', input.conversationId)
    .maybeSingle();
  if (error) throw new DomainError(error.message, 'messaging.conversation_failed');
  return data ? toConversation(data) : null;
}

const MESSAGE_SELECT = 'id, conversation_id, direction, status, intent, body, requested_transport, transport, failure_reason, created_at, sent_at, delivered_at';

type MessageRow = {
  id: string;
  conversation_id: string;
  direction: string;
  status: string;
  intent: string;
  body: string;
  requested_transport: string;
  transport: string | null;
  failure_reason: string | null;
  created_at: string;
  sent_at: string | null;
  delivered_at: string | null;
};

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    direction: row.direction as Message['direction'],
    status: row.status as MessageStatus,
    intent: row.intent as MessageIntent,
    body: row.body,
    requestedTransport: row.requested_transport as MessageTransport,
    transport: row.transport as MessageTransport | null,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    deliveredAt: row.delivered_at,
  };
}

export async function listMessages(db: Db, input: { organizationId: string; conversationId: string }): Promise<Message[]> {
  const { data, error } = await db
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('organization_id', input.organizationId)
    .eq('conversation_id', input.conversationId)
    .order('created_at', { ascending: true });
  if (error) throw new DomainError(error.message, 'messaging.messages_failed');
  return (data ?? []).map(toMessage);
}

export async function markConversationRead(db: Db, input: { organizationId: string; conversationId: string }): Promise<void> {
  const { error } = await db
    .from('conversations')
    .update({ unread: false })
    .eq('organization_id', input.organizationId)
    .eq('id', input.conversationId);
  if (error) throw new DomainError(error.message, 'messaging.mark_read_failed');
}

/** Whether this deployment has said `sendMessage` may reach this recipient (D40's own restated rule, for suppression). */
async function isSuppressed(db: Db, input: { organizationId: string; externalNumber: string }): Promise<boolean> {
  const { data, error } = await db
    .from('messaging_opt_outs')
    .select('opted_out')
    .eq('organization_id', input.organizationId)
    .eq('external_number', input.externalNumber)
    .maybeSingle();
  if (error) throw new DomainError(error.message, 'messaging.suppression_check_failed');
  return data?.opted_out ?? false;
}

async function findOrCreateConversation(
  db: Db,
  input: { organizationId: string; phoneNumberId: string; externalNumber: string; customerId?: string | null },
): Promise<string> {
  const existing = await db
    .from('conversations')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('channel', 'sms')
    .eq('phone_number_id', input.phoneNumberId)
    .eq('external_number', input.externalNumber)
    .maybeSingle();
  if (existing.error) throw new DomainError(existing.error.message, 'messaging.conversation_lookup_failed');
  if (existing.data) return existing.data.id;

  const created = await db
    .from('conversations')
    .insert({
      organization_id: input.organizationId,
      phone_number_id: input.phoneNumberId,
      external_number: input.externalNumber,
      customer_id: input.customerId ?? null,
    })
    .select('id')
    .single();
  if (created.error) throw new DomainError(created.error.message, 'messaging.conversation_create_failed');
  return created.data.id;
}

function writeError(error: { code?: string; message: string }): DomainError {
  return new DomainError(error.code === '42501' ? 'Your role cannot send messages here.' : error.message, 'messaging.write_failed');
}

/**
 * The address a text is sent from, decided here and never accepted from a caller.
 *
 * A browser names *which of this business's numbers* by id — the one thing it can honestly know —
 * and this resolves the E.164 the carrier is actually given. Two values naming one sender would be
 * two answers to the same question, so there is exactly one input and the address is derived. The
 * read goes through the caller's own session, so another business's number is simply absent
 * (RLS), and is refused with the same sentence as a number that never existed.
 *
 * Refused when the number is not active, is not enabled for outbound, is an identity that is not a
 * telephone number (a browser endpoint, a reserved SIP identity), or sits on a provider resource
 * the provider has not confirmed. An `external` number has no resource and is judged by the
 * lifecycle and direction flags alone, which is what makes it an outbound identity at all.
 */
export async function resolveSmsSender(
  db: Db,
  input: { organizationId: string; phoneNumberId: string },
): Promise<{ phoneNumberId: string; e164: string }> {
  const number = await getPhoneNumber(db, { organizationId: input.organizationId, phoneNumberId: input.phoneNumberId });
  if (!number) throw new DomainError('That number does not belong to this business.', 'messaging.sender_not_found');
  if (number.lifecycle !== 'active') throw new DomainError('That number is not active, so it cannot send texts.', 'messaging.sender_inactive');
  if (!number.outboundEnabled) throw new DomainError('That number is not enabled for sending.', 'messaging.sender_not_outbound');
  if (number.origin !== 'provisioned' && number.origin !== 'external') {
    throw new DomainError('That is not a number a text can be sent from.', 'messaging.sender_not_textable');
  }

  if (number.providerResourceId) {
    const { data, error } = await db
      .from('organization_provider_resources')
      .select('status')
      .eq('organization_id', input.organizationId)
      .eq('id', number.providerResourceId)
      .maybeSingle();
    if (error) throw new DomainError(error.message, 'messaging.sender_check_failed');
    if (data?.status !== 'active') throw new DomainError('That number is not ready to send texts yet.', 'messaging.sender_unavailable');
  }

  return { phoneNumberId: number.id, e164: number.e164 };
}

/**
 * `SendSms`: send a text — the one canonical path, whether the caller supplies a conversation already open
 * or a fresh destination.
 *
 * **Idempotent by construction.** `idempotencyKey` is a caller-chosen string (the composer's own
 * submit-token, regenerated only on a genuinely new send); a duplicate submit with the same key
 * finds the row this function already wrote and returns it rather than sending twice — a browser
 * double-click must not become two billable messages.
 *
 * **The sender is resolved here, from `phoneNumberId` alone** (`resolveSmsSender`). There is no
 * `fromNumber` to accept, so a caller cannot send as a number it was not entitled to by naming one.
 *
 * **Suppression is checked here, not trusted from the screen.** A business cannot reach an
 * opted-out number by picking a different sender: the check is against the recipient's own
 * number, independent of which of this business's numbers is sending.
 */
export async function sendSms(
  db: Db,
  input: {
    organizationId: string;
    phoneNumberId: string;
    toNumber: string;
    body: string;
    idempotencyKey: string;
    customerId?: string | null;
  },
): Promise<Message> {
  const actor = await requireActor(db);

  const to = input.toNumber.trim();
  if (!/^\+[1-9][0-9]{7,14}$/.test(to)) {
    throw new DomainError('That is not a number this platform can message. It needs a country code, like +14165550142.', 'messaging.number_invalid');
  }
  if (input.body.trim() === '') {
    throw new DomainError('A message needs something to say.', 'messaging.body_empty');
  }

  const existing = await db
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('organization_id', input.organizationId)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();
  if (existing.error) throw new DomainError(existing.error.message, 'messaging.idempotency_check_failed');
  if (existing.data) return toMessage(existing.data);

  const sender = await resolveSmsSender(db, { organizationId: input.organizationId, phoneNumberId: input.phoneNumberId });

  if (await isSuppressed(db, { organizationId: input.organizationId, externalNumber: to })) {
    throw new DomainError('This number has opted out of messages from this business.', 'messaging.recipient_opted_out');
  }

  const reportTo = messagingCallbackBase();
  const provider = await messagingProvider();
  if (!provider || !reportTo) {
    throw new DomainError('This deployment cannot send messages yet.', 'messaging.unconfigured');
  }

  const conversationId = await findOrCreateConversation(db, {
    organizationId: input.organizationId,
    phoneNumberId: sender.phoneNumberId,
    externalNumber: to,
    customerId: input.customerId,
  });

  const inserted = await db
    .from('messages')
    .insert({
      organization_id: input.organizationId,
      conversation_id: conversationId,
      direction: 'outbound',
      status: 'queued',
      body: input.body.trim(),
      requested_transport: 'sms',
      idempotency_key: input.idempotencyKey,
      created_by: actor.id,
    })
    .select(MESSAGE_SELECT)
    .single();
  if (inserted.error) throw writeError(inserted.error);
  const message = toMessage(inserted.data);

  // Two different failures, kept apart. The provider refusing (or being unreachable) is a failed
  // send, and the message says so. Everything after the provider has *accepted* the message is
  // bookkeeping: if that fails the text did go, so the message is never marked failed for it — a
  // history that says a delivered text failed is the less truthful of the two errors.
  let sent: Awaited<ReturnType<typeof provider.sendMessage>>;
  try {
    sent = await provider.sendMessage({ from: sender.e164, to, body: input.body.trim(), reportTo });
  } catch (cause) {
    // What the carrier said stays in the server's log; what the person reads is a sentence of ours,
    // never the carrier's raw answer.
    console.error('the carrier did not accept a text', cause);
    const reason = 'The carrier could not accept this message.';
    await db.rpc('record_sms_send_result', {
      p_organization_id: input.organizationId,
      p_message_id: message.id,
      p_status: 'failed',
      p_external_id: null as unknown as string,
      p_failure_reason: reason,
    });
    throw new DomainError(`The message could not be sent. ${reason}`, 'messaging.send_failed');
  }

  // What the carrier answered to the send itself, reported through the one door a sender may use: the
  // carrier took it (queued, sending or sent) and gave it an id. Delivered, read and undelivered are the
  // carrier's own callbacks to make — a send can never report them, so an adapter answer outside the three
  // is treated as "taken, not yet sent on".
  const taken = sent.status === 'sending' || sent.status === 'sent' ? sent.status : 'queued';
  const { error } = await db.rpc('record_sms_send_result', {
    p_organization_id: input.organizationId,
    p_message_id: message.id,
    p_status: taken,
    p_external_id: sent.externalId,
    p_failure_reason: null as unknown as string,
  });
  if (error) {
    throw new DomainError('The text was sent, but its status could not be saved.', 'messaging.status_not_recorded');
  }

  await db
    .from('conversations')
    .update({ last_message_at: new Date().toISOString(), last_message_preview: input.body.trim().slice(0, 280) })
    .eq('organization_id', input.organizationId)
    .eq('id', conversationId);

  return { ...message, status: taken, transport: 'sms', externalId: sent.externalId } as Message;
}

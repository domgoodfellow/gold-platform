import { messagingCallbackBase, messagingProvider } from '@/lib/adapters/messaging';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';

/**
 * One Message, one canonical object — never `SmsMessage`/`MmsMessage`/`RcsMessage`. Which wire
 * protocol carried it is `transport`, a resolved fact about the send, not the type doing the
 * sending. This slice's resolver only ever reaches `sms` (no RCS sender approval flow and no
 * attachment pipeline exist yet); the vocabulary for `mms`/`rcs` is real so a later slice extends
 * this resolver instead of replacing the schema underneath it.
 */

export type MessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'undelivered';
export type MessageTransport = 'sms' | 'mms' | 'rcs';
export type MessageIntent = 'conversational' | 'transactional' | 'lifecycle' | 'marketing';

export type Conversation = {
  id: string;
  customerId: string | null;
  phoneNumberId: string;
  externalNumber: string;
  lastMessageAt: string;
  lastMessagePreview: string;
  unread: boolean;
};

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

const CONVERSATION_SELECT = 'id, customer_id, phone_number_id, external_number, last_message_at, last_message_preview, unread';

type ConversationRow = {
  id: string;
  customer_id: string | null;
  phone_number_id: string;
  external_number: string;
  last_message_at: string;
  last_message_preview: string;
  unread: boolean;
};

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    customerId: row.customer_id,
    phoneNumberId: row.phone_number_id,
    externalNumber: row.external_number,
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    unread: row.unread,
  };
}

export async function listConversations(db: Db, input: { organizationId: string }): Promise<Conversation[]> {
  const { data, error } = await db
    .from('conversations')
    .select(CONVERSATION_SELECT)
    .eq('organization_id', input.organizationId)
    .order('last_message_at', { ascending: false });
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
 * Send a text — the one canonical path, whether the caller supplies a conversation already open
 * or a fresh destination.
 *
 * **Idempotent by construction.** `idempotencyKey` is a caller-chosen string (the composer's own
 * submit-token, regenerated only on a genuinely new send); a duplicate submit with the same key
 * finds the row this function already wrote and returns it rather than sending twice — a browser
 * double-click must not become two billable messages.
 *
 * **Suppression is checked here, not trusted from the screen.** A business cannot reach an
 * opted-out number by picking a different sender: the check is against the recipient's own
 * number, independent of which of this business's numbers is sending.
 */
export async function sendMessage(
  db: Db,
  input: {
    organizationId: string;
    phoneNumberId: string;
    fromNumber: string;
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
    phoneNumberId: input.phoneNumberId,
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

  try {
    const sent = await provider.sendMessage({ from: input.fromNumber, to, body: input.body.trim(), reportTo });
    const { error } = await db
      .from('messages')
      .update({ status: sent.status, transport: 'sms', external_id: sent.externalId, sent_at: new Date().toISOString() })
      .eq('organization_id', input.organizationId)
      .eq('id', message.id);
    if (error) throw writeError(error);

    await db
      .from('conversations')
      .update({ last_message_at: new Date().toISOString(), last_message_preview: input.body.trim().slice(0, 280) })
      .eq('organization_id', input.organizationId)
      .eq('id', conversationId);

    return { ...message, status: sent.status, transport: 'sms' };
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    await db
      .from('messages')
      .update({ status: 'failed', failure_reason: reason })
      .eq('organization_id', input.organizationId)
      .eq('id', message.id);
    throw new DomainError(`The message could not be sent: ${reason}`, 'messaging.send_failed');
  }
}

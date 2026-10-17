import { emailProvider } from '@/lib/adapters/tenant-email';
import { requireAccessToken } from '@/lib/api/client';
import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import type { MessageStatus } from '@/lib/domain/reception/messaging';
import { listEmailIdentities } from './identities';
import { sanitizeEmailHtml } from './html';
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES, validateOutboundAttachments } from './attachment-limits';

/**
 * Email as Communications operates it: queue a message, hand it to the provider runtime, read a
 * thread back.
 *
 * **One message, queued by the database, sent by something else.** `queue_outbound_email` decides
 * every authoritative fact under the sender's own session (which address, which recipient, whether
 * the address may send, which thread) and writes the message `queued`. Nothing in this file accepts a
 * `from`: a caller names an email identity by id, or a conversation to reply into, and the address a
 * message is sent as is whatever the database resolved. Sending is then a separate act through the
 * `EmailProvider` capability, so *the command was accepted*, *the provider took it* and *it was
 * delivered* are three recorded facts rather than one optimistic one: a message the provider could not
 * take stays `queued` with its reason, and sending it again is the same message, not a second.
 *
 * **Content from outside is never handed to a screen raw.** A received message's HTML leaves this
 * module only as `safeHtml`, after `sanitizeEmailHtml`; the unsanitized markup is not on any type here.
 */

export { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES, validateOutboundAttachments };

export type EmailAttachment = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number | null;
  /** `pending`: received, the bytes not stored yet. `rejected`: not kept (too large, or could not be fetched). */
  state: 'pending' | 'stored' | 'rejected';
  rejectionReason: string | null;
};

export type EmailThreadEvent = { type: string; at: string };

export type EmailThreadMessage = {
  id: string;
  direction: 'inbound' | 'outbound';
  status: MessageStatus;
  subject: string;
  from: string;
  to: string[];
  text: string;
  /** Sanitized. Null when the message had no HTML part. */
  safeHtml: string | null;
  failureReason: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  attachments: EmailAttachment[];
  events: EmailThreadEvent[];
};

function refusal(error: { code?: string; message: string }): DomainError {
  switch (error.code) {
    case '42501':
      return new DomainError('Your role cannot send email from here, or that address is not this business’s.', 'email.forbidden');
    case '55000':
      return new DomainError('That address cannot send email right now. Its domain has to be verified first.', 'email.sender_not_ready');
    case '22023':
    case '54000':
      return new DomainError(error.message, 'email.invalid');
    default:
      return new DomainError(error.message, 'email.write_failed');
  }
}

const THREAD_COLUMNS = 'id, direction, status, body, failure_reason, created_at, sent_at, delivered_at';

export async function listEmailThread(db: Db, input: { organizationId: string; conversationId: string }): Promise<EmailThreadMessage[]> {
  const { data: messages, error } = await db
    .from('messages')
    .select(THREAD_COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('conversation_id', input.conversationId)
    .eq('requested_transport', 'email')
    .order('created_at', { ascending: true });
  if (error) throw new DomainError(error.message, 'email.thread_failed');
  const ids = (messages ?? []).map((message) => message.id);
  if (ids.length === 0) return [];

  const [details, attachments, events] = await Promise.all([
    db.from('email_message_details').select('message_id, subject, from_address, to_addresses, html_body').eq('organization_id', input.organizationId).in('message_id', ids),
    db.from('message_attachments').select('id, message_id, filename, content_type, size_bytes, storage_state, rejection_reason').eq('organization_id', input.organizationId).in('message_id', ids).order('created_at'),
    db.from('message_events').select('message_id, event_type, occurred_at, provider_event_at').eq('organization_id', input.organizationId).in('message_id', ids).order('occurred_at'),
  ]);
  for (const result of [details, attachments, events]) {
    if (result.error) throw new DomainError(result.error.message, 'email.thread_failed');
  }

  const detailBy = new Map((details.data ?? []).map((row) => [row.message_id, row]));
  return (messages ?? []).map((message): EmailThreadMessage => {
    const detail = detailBy.get(message.id);
    return {
      id: message.id,
      direction: message.direction as EmailThreadMessage['direction'],
      status: message.status as MessageStatus,
      subject: detail?.subject ?? '',
      from: detail?.from_address ?? '',
      to: detail?.to_addresses ?? [],
      text: message.body,
      safeHtml: detail?.html_body ? sanitizeEmailHtml(detail.html_body) : null,
      failureReason: message.failure_reason,
      createdAt: message.created_at,
      sentAt: message.sent_at,
      deliveredAt: message.delivered_at,
      attachments: (attachments.data ?? [])
        .filter((row) => row.message_id === message.id)
        .map((row) => ({
          id: row.id,
          filename: row.filename,
          contentType: row.content_type,
          sizeBytes: row.size_bytes,
          state: row.storage_state as EmailAttachment['state'],
          rejectionReason: row.rejection_reason,
        })),
      events: (events.data ?? [])
        .filter((row) => row.message_id === message.id)
        .map((row) => ({ type: row.event_type, at: row.provider_event_at ?? row.occurred_at })),
    };
  });
}

/** The addresses this business may send from right now: able to send, and ready. Presentation only; the database decides again at send. */
export async function listSendableEmailIdentities(db: Db, input: { organizationId: string }) {
  const identities = await listEmailIdentities(db, input);
  return identities.filter((identity) => identity.canSend && identity.readiness.state === 'ready');
}

export async function emailDeliveryAvailable(db: Db): Promise<boolean> {
  return !!(await emailProvider({ token: await requireAccessToken(db) }));
}

const STORAGE_BUCKET = 'communications';

function storageKey(organizationId: string, fileName: string): string {
  const segment = fileName.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '') || 'file';
  return `${organizationId}/outbound/${globalThis.crypto.randomUUID()}/${segment}`;
}

/** Park each file under this business's own folder, under the sender's own session. Bytes first; the message row is what claims them. */
async function uploadAttachments(db: Db, organizationId: string, files: File[]) {
  const uploaded: { storage_path: string; filename: string; content_type: string; size_bytes: number }[] = [];
  try {
    for (const file of files) {
      const path = storageKey(organizationId, file.name);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { error } = await db.storage.from(STORAGE_BUCKET).upload(path, bytes, { contentType: file.type || 'application/octet-stream', upsert: false });
      if (error) throw new DomainError('An attachment could not be uploaded.', 'email.attachment_upload_failed');
      uploaded.push({ storage_path: path, filename: file.name, content_type: file.type || 'application/octet-stream', size_bytes: bytes.byteLength });
    }
  } catch (failure) {
    await removeUploads(db, uploaded);
    throw failure;
  }
  return uploaded;
}

async function removeUploads(db: Db, uploaded: { storage_path: string }[]) {
  if (uploaded.length > 0) await db.storage.from(STORAGE_BUCKET).remove(uploaded.map((file) => file.storage_path));
}

export type SendEmailResult = {
  messageId: string;
  conversationId: string;
  /** What the provider runtime answered. The message row's own status is the canonical one. */
  outcome: 'accepted' | 'rejected' | 'in_progress' | 'unavailable';
  detail: string | null;
};

/** Hand one queued message to the provider runtime. Safe to repeat: the same message is the same send. */
export async function dispatchQueuedEmail(db: Db, input: { organizationId: string; messageId: string }): Promise<{ outcome: SendEmailResult['outcome']; detail: string | null }> {
  const provider = await emailProvider({ token: await requireAccessToken(db) });
  if (!provider) return { outcome: 'unavailable', detail: 'This deployment cannot send email yet.' };

  const result = await provider.sendEmail({ organizationId: input.organizationId, messageId: input.messageId });
  switch (result.status) {
    case 'accepted':
      return { outcome: 'accepted', detail: null };
    case 'rejected':
      return { outcome: 'rejected', detail: result.detail };
    case 'in_progress':
      return { outcome: 'in_progress', detail: null };
    case 'unavailable':
      return { outcome: 'unavailable', detail: result.detail };
  }
}

/** `supabase gen types` types every function argument as non-null even where the parameter accepts null; the cast lives here once. */
const nullable = (value: string | null | undefined): string => (value ?? null) as string;

type QueueInput = {
  organizationId: string;
  emailIdentityId: string | null;
  to: string | null;
  subject: string;
  text: string;
  html?: string | null;
  conversationId: string | null;
  customerId?: string | null;
  idempotencyKey: string;
  files: File[];
};

async function queueAndSend(db: Db, input: QueueInput): Promise<SendEmailResult> {
  await requireActor(db);

  const problem = validateOutboundAttachments(input.files);
  if (problem) throw new DomainError(problem, 'email.attachment_invalid');

  // A retried command is the same message: its files are already attached, so uploading them again
  // would only strand copies. Ask first, upload only when this key is new.
  const existing = await db
    .from('messages')
    .select('id, conversation_id')
    .eq('organization_id', input.organizationId)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();
  if (existing.error) throw new DomainError(existing.error.message, 'email.write_failed');

  let messageId: string;
  if (existing.data) {
    messageId = existing.data.id;
  } else {
    const uploaded = await uploadAttachments(db, input.organizationId, input.files);
    const { data, error } = await db.rpc('queue_outbound_email', {
      p_organization_id: input.organizationId,
      p_email_identity_id: nullable(input.emailIdentityId),
      p_to: nullable(input.to),
      p_subject: input.subject,
      p_text: input.text,
      p_html: nullable(input.html),
      p_conversation_id: nullable(input.conversationId),
      p_idempotency_key: input.idempotencyKey,
      p_customer_id: nullable(input.customerId),
      p_attachments: uploaded,
    });
    if (error) {
      await removeUploads(db, uploaded);
      throw refusal(error);
    }
    messageId = data as string;
  }

  const { data: message, error: readError } = await db
    .from('messages')
    .select('conversation_id, status')
    .eq('organization_id', input.organizationId)
    .eq('id', messageId)
    .single();
  if (readError) throw new DomainError(readError.message, 'email.write_failed');

  // Only a message still waiting is sent. One already taken, sent or ended is reported as it stands.
  if (message.status !== 'queued') return { messageId, conversationId: message.conversation_id, outcome: 'in_progress', detail: null };

  const sent = await dispatchQueuedEmail(db, { organizationId: input.organizationId, messageId });
  return { messageId, conversationId: message.conversation_id, ...sent };
}

/**
 * `SendEmail`: a new conversation with a person. The client names the identity it speaks as by id;
 * the address is the database's to resolve. `idempotencyKey` is the composer's own submit token.
 */
export async function sendEmail(
  db: Db,
  input: { organizationId: string; emailIdentityId: string; to: string; subject: string; text: string; customerId?: string | null; idempotencyKey: string; files?: File[] },
): Promise<SendEmailResult> {
  return queueAndSend(db, {
    organizationId: input.organizationId,
    emailIdentityId: input.emailIdentityId,
    to: input.to,
    subject: input.subject,
    text: input.text,
    conversationId: null,
    customerId: input.customerId,
    idempotencyKey: input.idempotencyKey,
    files: input.files ?? [],
  });
}

/**
 * `ReplyToConversation`, for an email conversation: the conversation fixes the address it speaks
 * through and the person it speaks to, so a reply names neither.
 */
export async function replyToEmailConversation(
  db: Db,
  input: { organizationId: string; conversationId: string; text: string; subject?: string; idempotencyKey: string; files?: File[] },
): Promise<SendEmailResult> {
  return queueAndSend(db, {
    organizationId: input.organizationId,
    emailIdentityId: null,
    to: null,
    subject: input.subject ?? '',
    text: input.text,
    conversationId: input.conversationId,
    idempotencyKey: input.idempotencyKey,
    files: input.files ?? [],
  });
}

/**
 * One stored attachment's bytes, read under the caller's own session so the storage policy (the
 * first path segment is an organization the caller belongs to) and the row's own RLS both have to
 * agree. "No such attachment" and "somebody else's" are one answer. Never a durable public address.
 */
export async function readAttachment(
  db: Db,
  input: { organizationId: string; attachmentId: string },
): Promise<{ filename: string; bytes: Uint8Array }> {
  const { data: row, error } = await db
    .from('message_attachments')
    .select('filename, storage_path, storage_state')
    .eq('organization_id', input.organizationId)
    .eq('id', input.attachmentId)
    .maybeSingle();
  if (error) throw new DomainError(error.message, 'email.attachment_failed');
  if (!row || row.storage_state !== 'stored' || !row.storage_path) {
    throw new DomainError('No such attachment here.', 'email.attachment_not_found');
  }

  const { data: blob, error: downloadError } = await db.storage.from(STORAGE_BUCKET).download(row.storage_path);
  if (downloadError || !blob) throw new DomainError('No such attachment here.', 'email.attachment_not_found');
  return { filename: row.filename, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

import type { Db } from '@/lib/db/types';
import { dispatchQueuedEmail } from '@/lib/domain/email/messages';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import type { MessageStatus } from '@/lib/domain/reception/messaging';

/**
 * An issued invoice, emailed to its customer. The database decides every fact that matters
 * (`queue_invoice_email`): that this person may, the business's own sender, the customer's own
 * address, and the invoice's recorded PDF, attached where it is kept rather than copied. The request
 * names none of them; it may only confirm the recipient it was shown. The message then belongs to
 * Communications like any other email, and its delivery state is the message's own -- read here,
 * never copied or guessed.
 */

export type InvoiceEmailPreview = {
  sender: { address: string; name: string | null } | { problem: string };
  recipient: { address: string | null; problem: string | null; customerId: string | null; confirmedByCustomer: boolean };
  document: { fileName: string; sizeBytes: number } | null;
  sentBefore: boolean;
};

type PreviewRow = {
  sender: { address?: string; name?: string | null; problem?: string };
  recipient: { address: string | null; problem: string | null; customer_id: string | null; confirmed_by_customer: boolean };
  document: { file_name: string; size_bytes: number } | null;
  sent_before: boolean;
};

function refusal(error: { code?: string; message: string }): DomainError {
  switch (error.code) {
    case '42501': return new DomainError('Your role cannot email this business’s invoices.', 'invoice_emails.forbidden');
    case 'GD022': return fromDatabaseError(error, 'invoice_emails.already_sent');
    case '54000': return fromDatabaseError(error, 'invoice_emails.too_large');
    case '55000': case '58000': return fromDatabaseError(error, 'invoice_emails.not_ready');
    case '22023': return fromDatabaseError(error, 'invoice_emails.invalid');
    default: return new DomainError('The invoice could not be emailed. Try again.', 'invoice_emails.failed');
  }
}

/** What emailing this invoice now would use. Writes nothing. */
export async function previewInvoiceEmail(db: Db, input: { organizationId: string; invoiceId: string }): Promise<InvoiceEmailPreview> {
  const { data, error } = await db.rpc('invoice_email_preview', { p_organization_id: input.organizationId, p_invoice_id: input.invoiceId });
  if (error) throw refusal(error);
  const row = data as unknown as PreviewRow;
  return {
    sender: row.sender.problem ? { problem: row.sender.problem } : { address: row.sender.address ?? '', name: row.sender.name ?? null },
    recipient: { address: row.recipient.address, problem: row.recipient.problem, customerId: row.recipient.customer_id, confirmedByCustomer: row.recipient.confirmed_by_customer },
    document: row.document ? { fileName: row.document.file_name, sizeBytes: row.document.size_bytes } : null,
    sentBefore: row.sent_before,
  };
}

export type QueuedInvoiceEmail = { id: string; messageId: string; conversationId: string };

/** `queue_invoice_email`: one message per submission key; a later send of the same invoice needs `sendAgain`. */
export async function queueInvoiceEmail(db: Db, input: {
  organizationId: string; invoiceId: string; recipient: string; subject: string; text: string; idempotencyKey: string; sendAgain: boolean;
}): Promise<QueuedInvoiceEmail> {
  const { data, error } = await db.rpc('queue_invoice_email', {
    p_organization_id: input.organizationId, p_invoice_id: input.invoiceId, p_recipient: input.recipient,
    p_subject: input.subject, p_text: input.text, p_idempotency_key: input.idempotencyKey, p_send_again: input.sendAgain,
  });
  if (error || !data) throw refusal(error ?? { message: '' });
  return { id: data.id, messageId: data.message_id, conversationId: data.conversation_id };
}

/** What a person is told about one sent invoice. Accepted by the provider is never called delivered. */
export type InvoiceEmailState = 'queued' | 'not_sent' | 'sending' | 'accepted' | 'delivered' | 'failed';

export function invoiceEmailState(status: MessageStatus, failureReason: string | null): { state: InvoiceEmailState; label: string; detail: string | null } {
  switch (status) {
    case 'queued':
      return failureReason
        ? { state: 'not_sent', label: 'Not sent yet', detail: failureReason }
        : { state: 'queued', label: 'Queued', detail: 'Not sent yet.' };
    case 'sending':
      return { state: 'sending', label: 'Sending', detail: 'Sent to the email service; no answer yet, so it may not have arrived.' };
    case 'sent':
      return { state: 'accepted', label: 'Accepted for delivery', detail: 'Not yet confirmed as delivered.' };
    case 'delivered':
    case 'read':
      return { state: 'delivered', label: 'Delivered', detail: null };
    case 'failed':
    case 'rejected':
    case 'bounced':
    case 'undelivered':
      return { state: 'failed', label: status === 'bounced' ? 'Bounced' : 'Not delivered', detail: failureReason };
  }
}

export type InvoiceEmail = {
  id: string;
  messageId: string;
  conversationId: string;
  fromAddress: string;
  recipient: string;
  documentSha256: string;
  sentAgain: boolean;
  createdAt: string;
  status: MessageStatus;
  failureReason: string | null;
};

/** Every send of this invoice, newest first, with each message's own state as it stands. */
export async function listInvoiceEmails(db: Db, input: { organizationId: string; invoiceId: string }): Promise<InvoiceEmail[]> {
  const { data: sends, error } = await db.from('invoice_emails')
    .select('id, message_id, conversation_id, from_address, recipient, document_sha256, sent_again_after, created_at')
    .eq('organization_id', input.organizationId).eq('invoice_id', input.invoiceId)
    .order('created_at', { ascending: false });
  if (error) throw fromDatabaseError(error, 'invoice_emails.read_failed');
  if (!sends?.length) return [];
  const { data: messages, error: messageError } = await db.from('messages').select('id, status, failure_reason')
    .eq('organization_id', input.organizationId).in('id', sends.map((send) => send.message_id));
  if (messageError) throw fromDatabaseError(messageError, 'invoice_emails.read_failed');
  const byId = new Map((messages ?? []).map((message) => [message.id, message]));
  return sends.map((send) => ({
    id: send.id, messageId: send.message_id, conversationId: send.conversation_id, fromAddress: send.from_address,
    recipient: send.recipient, documentSha256: send.document_sha256, sentAgain: send.sent_again_after !== null, createdAt: send.created_at,
    status: (byId.get(send.message_id)?.status ?? 'queued') as MessageStatus,
    failureReason: byId.get(send.message_id)?.failure_reason ?? null,
  }));
}

/**
 * Hand a queued invoice email to the tenant-email runtime, which records whatever the provider
 * answers. Only a message still waiting is handed over. Returns why it could not be, when the
 * runtime was never reached and so nothing was recorded.
 */
export async function dispatchInvoiceEmail(db: Db, input: { organizationId: string; messageId: string }): Promise<string | null> {
  const { data } = await db.from('messages').select('status').eq('organization_id', input.organizationId).eq('id', input.messageId).maybeSingle();
  if (data?.status !== 'queued') return null;
  try {
    const sent = await dispatchQueuedEmail(db, input);
    return sent.outcome === 'unavailable' ? sent.detail ?? 'Email could not be sent just now.' : null;
  } catch (failure) {
    return failure instanceof DomainError ? failure.message : 'Email could not be sent just now.';
  }
}

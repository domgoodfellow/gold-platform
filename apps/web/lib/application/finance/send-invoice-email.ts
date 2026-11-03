import type { Db } from '@/lib/db/types';
import { readInvoiceDocument } from '@/lib/domain/billing/invoice-documents';
import { dispatchInvoiceEmail, invoiceEmailState, listInvoiceEmails, queueInvoiceEmail, type InvoiceEmailState } from '@/lib/domain/billing/invoice-emails';
import { DomainError } from '@/lib/domain/errors';

/**
 * `SendIssuedInvoiceEmail`: an issued invoice's recorded PDF, to its customer, from the business's
 * own sender. The request carries the invoice, the recipient the person was shown, the subject, the
 * message and a submission key -- no address to send from, no file and no path.
 *
 * In order: the recorded PDF is read under the person's own session and checked against its
 * checksum, so a document that fails that check is never queued; the database queues the message
 * with that PDF attached where it is kept (`queue_invoice_email`); the existing tenant-email runtime
 * sends it, checking the bytes against the checksum again. A retried submission is the same message
 * and is not sent twice, and a message that could not leave stays queued with its reason.
 */

export type InvoiceEmailOutcome = { invoiceEmailId: string; messageId: string; conversationId: string; state: InvoiceEmailState; label: string; detail: string | null };

async function outcome(db: Db, input: { organizationId: string; invoiceId: string; invoiceEmailId: string }): Promise<InvoiceEmailOutcome> {
  const send = (await listInvoiceEmails(db, input)).find((entry) => entry.id === input.invoiceEmailId);
  if (!send) throw new DomainError('That invoice email is unavailable.', 'invoice_emails.not_found');
  return { invoiceEmailId: send.id, messageId: send.messageId, conversationId: send.conversationId, ...invoiceEmailState(send.status, send.failureReason) };
}

export async function sendIssuedInvoiceEmail(db: Db, input: {
  organizationId: string; invoiceId: string; recipient: string; subject: string; text: string; idempotencyKey: string; sendAgain: boolean;
}): Promise<InvoiceEmailOutcome> {
  try {
    await readInvoiceDocument(db, input);
  } catch {
    throw new DomainError('This invoice’s PDF is missing or could not be verified, so it was not sent.', 'invoice_emails.document_unverified');
  }
  const queued = await queueInvoiceEmail(db, input);
  const handed = await dispatchInvoiceEmail(db, { organizationId: input.organizationId, messageId: queued.messageId });
  return withAttempt(await outcome(db, { organizationId: input.organizationId, invoiceId: input.invoiceId, invoiceEmailId: queued.id }), handed);
}

/** Try a send that has not left yet once more: the same message, never a second one. */
export async function retryInvoiceEmail(db: Db, input: { organizationId: string; invoiceId: string; invoiceEmailId: string }): Promise<InvoiceEmailOutcome> {
  const current = await outcome(db, input);
  if (current.state !== 'queued' && current.state !== 'not_sent') return current;
  const unreached = await dispatchInvoiceEmail(db, { organizationId: input.organizationId, messageId: current.messageId });
  return withAttempt(await outcome(db, input), unreached);
}

/** A message the runtime never reached is still queued with no reason recorded; say so rather than call it waiting. */
function withAttempt(result: InvoiceEmailOutcome, unreached: string | null): InvoiceEmailOutcome {
  return result.state === 'queued' && unreached ? { ...result, state: 'not_sent', label: 'Not sent yet', detail: `${unreached} Nothing was sent.` } : result;
}

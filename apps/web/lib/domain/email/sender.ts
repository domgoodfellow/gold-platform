import type { Db } from '@/lib/db/types';
import { DomainError } from '@/lib/domain/errors';

/**
 * The business's own email sender, as the database resolves it for every email the business sends
 * (`app.organization_email_sender`): Inbox, automation messages and service notifications. These
 * reads answer with the same resolution a send uses, so a settings page can never show "ready" for
 * an address a send would refuse. No provider detail or credential is ever part of the answer.
 */

export type EmailSenderState = 'ready' | 'not_ready' | 'unavailable';

export type EmailSender = {
  emailIdentityId: string;
  address: string;
  displayName: string | null;
  state: EmailSenderState;
  /** What to do next, when the address cannot send yet. */
  detail: string | null;
  isDefault: boolean;
};

export type EmailSendingStatus =
  | { state: 'missing'; address: null; detail: string }
  | { state: EmailSenderState; address: string; detail: string | null };

export async function emailSendingStatus(db: Db, organizationId: string): Promise<EmailSendingStatus> {
  const { data, error } = await db.rpc('organization_email_sender_status', { p_organization_id: organizationId });
  if (error) throw new DomainError(error.message, 'email_sender.status_failed');
  const row = (data ?? [])[0];
  if (!row || row.state === 'missing' || !row.address) return { state: 'missing', address: null, detail: row?.detail ?? 'This business has no default sender address.' };
  return { state: row.state as EmailSenderState, address: row.address, detail: row.detail };
}

export async function listEmailSenders(db: Db, organizationId: string): Promise<EmailSender[]> {
  const { data, error } = await db.rpc('organization_email_senders', { p_organization_id: organizationId });
  if (error) throw new DomainError(error.message, 'email_sender.list_failed');
  return (data ?? []).map((row) => ({
    emailIdentityId: row.email_identity_id,
    address: row.address,
    displayName: row.display_name,
    state: row.state as EmailSenderState,
    detail: row.detail,
    isDefault: row.is_default,
  }));
}

/** Organization configuration (`organization.manage`); only a ready address of this business's. */
export async function setDefaultEmailSender(db: Db, input: { organizationId: string; emailIdentityId: string }): Promise<void> {
  const { error } = await db.rpc('set_default_email_sender', { p_organization_id: input.organizationId, p_email_identity_id: input.emailIdentityId });
  if (error) {
    const message = error.code === '42501' ? 'You cannot choose the sender address for this business.' : error.message;
    throw new DomainError(message, 'email_sender.default_refused');
  }
}

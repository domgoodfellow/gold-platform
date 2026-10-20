import type { Db } from '@/lib/db/types';
import { callDomainCommand, requireAccessToken } from '@/lib/api/client';
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
  /** On a domain this business has proved, so replies may be sent to it. */
  canTakeReplies: boolean;
  isReplyTo: boolean;
  /** Mail sent to it arrives in the Communications Inbox (Inbox email). */
  receivesInInbox: boolean;
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
    canTakeReplies: row.can_take_replies,
    isReplyTo: row.is_reply_to,
    receivesInInbox: row.receives_in_inbox,
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

/** Where replies go: one of this business's addresses on a proved domain, or `null` for the From address. */
export async function setEmailReplyTo(db: Db, input: { organizationId: string; emailIdentityId: string | null }): Promise<void> {
  const { error } = await db.rpc('set_email_reply_to', { p_organization_id: input.organizationId, p_email_identity_id: input.emailIdentityId as string });
  if (error) {
    const message = error.code === '42501' ? 'You cannot choose where replies go for this business.' : error.message;
    throw new DomainError(message, 'email_sender.reply_to_refused');
  }
}

export type EmailTestSend = {
  id: string;
  recipient: string;
  fromAddress: string;
  state: 'sending' | 'sent' | 'failed' | 'uncertain';
  /** What the provider later reported, when it did. */
  providerState: string | null;
  detail: string | null;
  createdAt: string;
};

export async function listEmailTestSends(db: Db, organizationId: string): Promise<EmailTestSend[]> {
  const { data, error } = await db.from('email_test_sends').select('id, recipient, from_address, state, provider_state, detail, created_at')
    .eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(3);
  if (error) throw new DomainError(error.message, 'email_sender.tests_failed');
  return (data ?? []).map((row) => ({ id: row.id, recipient: row.recipient, fromAddress: row.from_address, state: row.state as EmailTestSend['state'], providerState: row.provider_state, detail: row.detail, createdAt: row.created_at }));
}

export type EmailTestOutcome = { state: 'sent' | 'failed' | 'uncertain'; recipient: string; detail: string | null };

/**
 * One test email from the default sender to the caller's own confirmed address, sent by apps/api
 * (`/email/test-send`). Who may, to whom, from which address and how often are the database's
 * decisions; a refusal comes back as its own sentence.
 */
export async function sendTestEmail(db: Db, organizationId: string): Promise<EmailTestOutcome> {
  return callDomainCommand<EmailTestOutcome>('/email/test-send', { token: await requireAccessToken(db), body: { organization_id: organizationId }, timeoutMs: 30_000 });
}

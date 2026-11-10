'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import { dispatchQueuedEmail, type SendEmailResult } from '@/lib/domain/email/messages';
import {
  assignConversation,
  claimConversation,
  createCustomerFromConversation,
  currentMembershipId,
  linkConversationCustomer,
  releaseConversation,
  searchCustomersToLink,
  setConversationStatus,
  type ConversationStatus,
  type CustomerCandidate,
  type InboxCounts,
  type InboxFilter,
  type InboxPage,
} from '@/lib/domain/reception/inbox';
import { conversationFeedCounts, listConversationFeed } from '@/lib/domain/reception/conversation-feed';
import { markConversationRead, type Message } from '@/lib/domain/reception/messaging';
import { replyToConversation, sendEmail, sendSms } from '@/lib/domain/reception/outbound';
import { requireOrganization } from '@/lib/route/organization';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Every action proves the business and its service access first, then calls the domain layer, which
 * decides everything else. The organization is the one the route named and `requireOrganization`
 * checked; no relationship the browser supplies (an assignee, a customer, a conversation) is trusted —
 * each is re-checked by the database function that acts on it.
 */
async function attempt<T>(organizationId: string, run: () => Promise<T>, revalidate = true): Promise<ActionResult<T>> {
  try {
    const data = await run();
    if (revalidate) revalidatePath(`/organizations/${organizationId}/comms/inbox`, 'layout');
    return { ok: true, data };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}

const filesOf = (formData: FormData) => formData.getAll('files').filter((entry): entry is File => entry instanceof File && entry.size > 0);

export async function listInboxAction(organizationId: string, filter: InboxFilter, cursor: string | null): Promise<ActionResult<InboxPage>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    return listConversationFeed(db, { organizationId, filter, cursor, membershipId: await currentMembershipId(db, { organizationId }) });
  }, false);
}

export async function inboxCountsAction(organizationId: string): Promise<ActionResult<InboxCounts>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    return conversationFeedCounts(db, { organizationId, membershipId: await currentMembershipId(db, { organizationId }) });
  }, false);
}

export async function markReadAction(organizationId: string, conversationId: string): Promise<ActionResult<null>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    await markConversationRead(await getDb(), { organizationId, conversationId });
    return null;
  }, false);
}

export async function setStatusAction(organizationId: string, conversationId: string, status: ConversationStatus): Promise<ActionResult<null>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    await setConversationStatus(await getDb(), { organizationId, conversationId, status });
    return null;
  });
}

export async function claimAction(organizationId: string, conversationId: string): Promise<ActionResult<boolean>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => claimConversation(await getDb(), { organizationId, conversationId }));
}

export async function assignAction(organizationId: string, conversationId: string, membershipId: string): Promise<ActionResult<null>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    await assignConversation(await getDb(), { organizationId, conversationId, membershipId });
    return null;
  });
}

export async function releaseAction(organizationId: string, conversationId: string): Promise<ActionResult<null>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    await releaseConversation(await getDb(), { organizationId, conversationId });
    return null;
  });
}

export async function linkCustomerAction(organizationId: string, conversationId: string, customerId: string | null): Promise<ActionResult<null>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    await linkConversationCustomer(await getDb(), { organizationId, conversationId, customerId });
    return null;
  });
}

export async function createCustomerAction(organizationId: string, conversationId: string, name: string): Promise<ActionResult<string>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => createCustomerFromConversation(await getDb(), { organizationId, conversationId, name }));
}

export async function searchCustomersAction(organizationId: string, search: string): Promise<ActionResult<CustomerCandidate[]>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => (search.trim().length < 2 ? [] : searchCustomersToLink(await getDb(), { organizationId, search })), false);
}

export type ReplyOutcome = { channel: 'sms'; message: Message } | ({ channel: 'email' } & SendEmailResult);

/**
 * A reply: the conversation fixes the channel, the address or number it speaks through and the person
 * it speaks to. The form carries the text, the files and a submit token — there is no sender field.
 */
export async function replyAction(organizationId: string, formData: FormData): Promise<ActionResult<ReplyOutcome>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () =>
    replyToConversation(await getDb(), {
      organizationId,
      conversationId: String(formData.get('conversationId') ?? ''),
      body: String(formData.get('text') ?? ''),
      idempotencyKey: String(formData.get('idempotencyKey') ?? ''),
      files: filesOf(formData),
    }),
  );
}

/** "Try sending again" for an email that never left: the same message, handed to the provider again. */
export async function retryEmailAction(organizationId: string, messageId: string): Promise<ActionResult<{ outcome: SendEmailResult['outcome']; detail: string | null }>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => dispatchQueuedEmail(await getDb(), { organizationId, messageId }));
}

/** Start a new text conversation. The number to send from is named by id; the address is resolved on the server. */
export async function startSmsAction(
  organizationId: string,
  input: { phoneNumberId: string; toNumber: string; body: string; idempotencyKey: string },
): Promise<ActionResult<{ conversationId: string }>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const message = await sendSms(await getDb(), { organizationId, ...input });
    return { conversationId: message.conversationId };
  });
}

/** Start a new email conversation. The address to send from is named by identity id and resolved by the database. */
export async function startEmailAction(organizationId: string, formData: FormData): Promise<ActionResult<SendEmailResult>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () =>
    sendEmail(await getDb(), {
      organizationId,
      emailIdentityId: String(formData.get('emailIdentityId') ?? ''),
      to: String(formData.get('to') ?? ''),
      subject: String(formData.get('subject') ?? ''),
      text: String(formData.get('text') ?? ''),
      idempotencyKey: String(formData.get('idempotencyKey') ?? ''),
      files: filesOf(formData),
    }),
  );
}

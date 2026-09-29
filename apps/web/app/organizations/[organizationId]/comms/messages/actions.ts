'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import { DomainError } from '@/lib/domain/errors';
import {
  listConversations,
  listMessages,
  markConversationRead,
  sendMessage,
  type Conversation,
  type Message,
} from '@/lib/domain/reception/messaging';
import { requireOrganization } from '@/lib/route/organization';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function attempt<T>(organizationId: string, run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await run();
    revalidatePath(`/organizations/${organizationId}/comms/messages`);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof DomainError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function listConversationsAction(organizationId: string): Promise<ActionResult<Conversation[]>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    return listConversations(db, { organizationId });
  });
}

export async function listMessagesAction(organizationId: string, conversationId: string): Promise<ActionResult<Message[]>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    return listMessages(db, { organizationId, conversationId });
  });
}

export async function markConversationReadAction(organizationId: string, conversationId: string): Promise<ActionResult<null>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    await markConversationRead(db, { organizationId, conversationId });
    return null;
  });
}

export async function sendMessageAction(
  organizationId: string,
  input: { phoneNumberId: string; fromNumber: string; toNumber: string; body: string; idempotencyKey: string; customerId?: string | null },
): Promise<ActionResult<Message>> {
  await requireOrganization(organizationId);
  return attempt(organizationId, async () => {
    const db = await getDb();
    return sendMessage(db, { organizationId, ...input });
  });
}

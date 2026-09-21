'use server';

import { revalidatePath } from 'next/cache';
import { getDb } from '@/lib/db/server';
import {
  askQuestion,
  decideOnAction,
  listAgentConversationRuns,
  type AgentRun,
} from '@/lib/domain/assistant/questions';
import { DomainError } from '@/lib/domain/errors';
import {
  removeAgentAttachment,
  uploadAgentAttachment,
  type AgentAttachment,
} from '@/lib/domain/assistant/attachments';
import { resolveAgentViewing } from './agent-context';
import { requireOrganization } from '@/lib/route/organization';

/**
 * What an Agent action hands back. `runs` is the transcript of the conversation it touched,
 * re-read after the write, so the rail shows the new turn without waiting on a layout refresh and
 * without any route having to be the one that revalidates (a question can be asked from any
 * organization page).
 */
export type AskActionState = {
  error: string | null;
  conversationId?: string;
  runs?: AgentRun[];
};

/**
 * One write, and it is a question.
 *
 * Nothing here decides anything, which is the ordinary rule and worth restating on this screen
 * in particular: the tempting thing to add is a check on what the answer said before showing it,
 * and that would be this route forming an opinion about a business's own data.
 *
 * An empty `conversationId` is a New chat: the domain layer creates the conversation from this
 * first question and the caller learns its id from the result.
 */
export async function askAction(
  _previous: AskActionState,
  formData: FormData,
): Promise<AskActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);
  const conversationId = String(formData.get('conversationId') ?? '') || null;
  // Where the person is comes from the path, re-derived here against navigation's own areas — a
  // label the browser sent would be a sentence somebody else wrote into the prompt. The Configure
  // popover's switch can withhold the open record; it can never add anything.
  const documentIds = formData.getAll('documentId').map(String).filter(Boolean);
  const viewing = resolveAgentViewing(String(formData.get('pathname') ?? ''));
  if (formData.get('includeRecord') !== 'on') viewing.recordId = null;

  let state: AskActionState;
  try {
    const run = await askQuestion(db, {
      organizationId,
      conversationId,
      viewing,
      documentIds,
      question: String(formData.get('question') ?? ''),
    });
    state = {
      error: null,
      conversationId: run.conversationId,
      runs: await listAgentConversationRuns(db, {
        organizationId,
        conversationId: run.conversationId,
      }),
    };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  // The Agent rail is mounted by the organization layout, so its History list (order and titles)
  // is refreshed there, on whichever page the question was asked from.
  revalidatePath(`/organizations/${organizationId}`, 'layout');
  return state;
}

/**
 * Open another conversation on demand. Only the transcript of the one asked for is read —
 * History lists titles and the shell loads a single transcript, never all of them. A conversation
 * the caller cannot read comes back empty, by policy, and is reported as unavailable.
 */
export async function openConversationAction(
  organizationId: string,
  conversationId: string,
): Promise<AskActionState> {
  await requireOrganization(organizationId);
  const db = await getDb();

  try {
    const runs = await listAgentConversationRuns(db, { organizationId, conversationId });
    if (runs.length === 0) return { error: 'That conversation is not available.' };
    return { error: null, conversationId, runs };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}

export type AttachmentActionState = { error: string | null; attachment?: AgentAttachment };

/**
 * Store one file for the composer, privately and as the asker's own. Nothing is asked of the model
 * and nothing is sent anywhere: the file waits, unsent, until a question carries it.
 */
export async function uploadAttachmentAction(formData: FormData): Promise<AttachmentActionState> {
  await requireOrganization(String(formData.get('organizationId') ?? ''));
  const db = await getDb();
  const file = formData.get('file');
  if (!(file instanceof File)) return { error: 'Choose a file first.' };

  try {
    const attachment = await uploadAgentAttachment(db, {
      organizationId: String(formData.get('organizationId') ?? ''),
      file,
    });
    return { error: null, attachment };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}

/** Take back a file that has not been sent. One that has been sent stays: it is part of a question. */
export async function removeAttachmentAction(
  organizationId: string,
  documentId: string,
): Promise<{ error: string | null }> {
  await requireOrganization(organizationId);
  const db = await getDb();
  try {
    await removeAgentAttachment(db, { organizationId, documentId });
    return { error: null };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }
}

/**
 * Carry out what a question suggested, or say no to it.
 *
 * Two buttons and one action, because the decision is one thing with two answers and a declined
 * suggestion is as much a decision as a carried-out one. Nothing here decides which: the form
 * says, the domain layer does it, and what the database refuses comes back as words.
 */
export async function decideAction(
  _previous: AskActionState,
  formData: FormData,
): Promise<AskActionState> {
  const db = await getDb();
  const organizationId = String(formData.get('organizationId') ?? '');
  await requireOrganization(organizationId);

  let state: AskActionState;
  try {
    const run = await decideOnAction(db, {
      runId: String(formData.get('runId') ?? ''),
      carryOut: formData.get('decision') === 'carry-out',
    });
    state = {
      error: null,
      conversationId: run.conversationId,
      runs: await listAgentConversationRuns(db, {
        organizationId,
        conversationId: run.conversationId,
      }),
    };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  // The Agent rail is mounted by the organization layout, so its history is refreshed there.
  revalidatePath(`/organizations/${organizationId}`, 'layout');
  return state;
}

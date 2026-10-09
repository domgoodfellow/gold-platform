'use server';

import { getDb } from '@/lib/db/server';
import { unstable_rethrow } from 'next/navigation';
import {
  askQuestion,
  decideOnAction,
  listAgentConversationRuns,
  listAgentConversationSummaries,
  type AgentConversationSummary,
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
import { canAnswerQuestions } from '@/lib/domain/assistant/questions';

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
  conversations?: AgentConversationSummary[];
};

export type AgentBootstrapState = {
  error: string | null;
  errorCode?: 'authentication' | 'permission' | 'database' | 'transient';
  identityError?: string;
  canAnswer: boolean;
  conversations: AgentConversationSummary[];
  initialConversation: { id: string; runs: AgentRun[] } | null;
  identity?: string;
};

export async function loadAgentBootstrapAction(organizationId: string): Promise<AgentBootstrapState> {
  let stage: 'access' | 'history' | 'readiness' = 'access';
  try {
    const { db, organization } = await requireOrganization(organizationId);
    stage = 'history';
    const conversations = await listAgentConversationSummaries(db, { organizationId });
    const latest = conversations[0];
    const initialConversation = latest
      ? { id: latest.id, runs: await listAgentConversationRuns(db, { organizationId, conversationId: latest.id }) }
      : null;
    stage = 'readiness';
    const canAnswer = await canAnswerQuestions();
    let identity = 'Built-in Operator Copilot';
    let identityError: string | undefined;
    if (organization.capabilities.includes('assistant.ask')) {
      try {
        const result = await db.rpc('resolve_operator_agent', { p_organization_id: organizationId });
        if (result.error) throw result.error;
        const configured = result.data as { name?: string } | null;
        identity = configured?.name || identity;
      } catch (error) {
        unstable_rethrow(error);
        console.error('Agent identity lookup failed.');
        identityError = 'Agent identity could not be loaded. Using Built-in Operator Copilot.';
      }
    }
    return {
      identity,
      identityError,
      error: null,
      canAnswer,
      conversations,
      initialConversation,
    };
  } catch (error) {
    // Preserve framework redirects/not-found signals; never turn revoked access into chat data.
    unstable_rethrow(error);
    const code = error instanceof DomainError ? error.code :
      typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    const errorCode = code === 'auth.required' || code === 'PGRST301' ? 'authentication'
      : code === '42501' || code.endsWith('.forbidden') || code.endsWith('.denied') || code.endsWith('.not_permitted') ? 'permission'
      : code.endsWith('_failed') || /^[0-9A-Z]{5}$/.test(code) ? 'database' : 'transient';
    const message = errorCode === 'authentication' ? 'Sign in again to load your Agent conversations.'
      : errorCode === 'permission' ? 'You do not have permission to load Agent conversations here.'
      : errorCode === 'database' ? 'Could not load your Agent conversation history. Try again.'
      : 'Could not load Agent right now. Try again.';
    console.error('Agent bootstrap failed.', { stage, errorCode, code });
    return { error: message, errorCode, canAnswer: false, conversations: [], initialConversation: null };
  }
}

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
  const organizationId = String(formData.get('organizationId') ?? '');
  const { db } = await requireOrganization(organizationId);
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
      conversations: await listAgentConversationSummaries(db, { organizationId }),
    };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

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
  const { db } = await requireOrganization(organizationId);

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
  const organizationId = String(formData.get('organizationId') ?? '');
  const { db } = await requireOrganization(organizationId);

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
      conversations: await listAgentConversationSummaries(db, { organizationId }),
    };
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    throw error;
  }

  // The rail holds its own History state once it has loaded, from its first-open bootstrap; this
  // result carries the refreshed conversation list back to it directly, so nothing here revalidates
  // a layout the rail no longer depends on to see its own write.
  return state;
}

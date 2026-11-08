import type { Database, Db } from '@/lib/db/types';

type Json = Database['public']['Tables']['agent_runs']['Insert']['tools'];
import {
  AnsweringNotEntitledError,
  answeringProvider,
  type AnswerOutcome,
  type PriorTurn,
  type ProposedAction,
  type ToolCallRecord,
} from '@/lib/adapters/answering';
import { DomainError, fromDatabaseError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { executorFor, reasonActionCannotRun } from './actions';
import { getOrganization } from '@/lib/domain/tenancy/organizations';
import {
  linkAttachmentsToRun,
  listAttachmentsByRun,
  readAttachmentsForQuestion,
  type AgentAttachment,
} from './attachments';

/**
 * Asking the system a question, and the record of having asked — grouped into conversations, each
 * readable only by the person who started it. The domain layer owns the flow;
 * the capability owns the answering — nothing here knows there's a loop, a model, or a second
 * deployment. Nothing here reads or writes business data: a question is answered by tools
 * running under the asking person's own token, so this function could not widen what
 * somebody sees if it tried. Carrying out a suggested action is a separate, later step with its
 * own screen.
 */

export type { ProposedAction, ToolCallRecord };
export { ACTION_LABELS } from './actions';

/** `pending` is a real state somebody is looking at, hence four words rather than three. */
export type ActionOutcome = 'pending' | 'done' | 'declined' | 'failed';

export type { AgentAttachment };

export type AgentRun = {
  id: string;
  /** The conversation this question was asked in. */
  conversationId: string;
  question: string;
  /** The finished words. Empty unless it was answered. */
  answer: string;
  outcome: AnswerOutcome;
  /** Whoever refused, in their own words. */
  detail: string | null;
  /** What ran, with what, and how many rows came back. Never the rows. */
  tools: ToolCallRecord[];
  /** Which model answered. For a person reading this later; decides nothing. */
  answeredBy: string;
  occurredAt: string;
  /** What it suggested doing, if anything. Nothing has been done until somebody says so. */
  proposedAction: ProposedAction | null;
  actionOutcome: ActionOutcome | null;
  /** The refusal, in the words of whoever refused. */
  actionDetail: string | null;
  /** The files this question was sent with, so a reopened conversation shows them again. */
  attachments: AgentAttachment[];
};

/** A thread as History lists it. The transcript is a separate read, loaded when somebody opens it. */
export type AgentConversationSummary = {
  id: string;
  title: string;
  createdAt: string;
  lastActivityAt: string;
};

const QUESTION_MAX = 2000;

/** What History lists and the shell loads up front — older conversations are not fetched until asked for. */
export const CONVERSATION_LIST_LIMIT = 30;
/** One transcript never loads more than this many runs. */
export const CONVERSATION_RUN_LIMIT = 50;

export const TITLE_MAX = 60;

/**
 * A title is the first question, whitespace collapsed and shortened — never a second model call to
 * name what somebody just typed. Counts code points, so a cut cannot split an emoji. The backfill
 * in `20260929000008` applies the same rule in SQL to the runs that already existed.
 */
export function deriveConversationTitle(question: string): string {
  const text = question.replace(/\s+/g, ' ').trim();
  const characters = Array.from(text);
  return characters.length > TITLE_MAX ? `${characters.slice(0, TITLE_MAX - 1).join('')}…` : text;
}

/**
 * What the person has open when they ask: the workspace, and a record in it. Application state,
 * never a tenant's own words — the workspace is navigation's label and the record an id, checked
 * here to be one, so nothing a browser typed becomes a sentence in the prompt.
 */
export type Viewing = { workspace: string | null; recordId: string | null };

const RECORD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function describeViewing(viewing: Viewing | null | undefined): string {
  if (!viewing?.workspace) return '';
  const workspace = viewing.workspace.replace(/[^\p{L}\p{N} &'-]/gu, '').slice(0, 60);
  if (!workspace) return '';
  const record =
    viewing.recordId && RECORD_ID.test(viewing.recordId)
      ? `, on one record there (id ${viewing.recordId})`
      : '';
  return ` The person asking has the ${workspace} workspace open${record}.`;
}

/**
 * How much of a conversation's past an answering request may carry. Bounded twice on purpose —
 * here, and again in `apps/api/app/ai/loop.py`, which cannot assume its caller was careful. The
 * numbers are restated there because the two runtimes share no code.
 */
export const CONTEXT_MAX_TURNS = 10;
export const CONTEXT_MAX_ANSWER_CHARS = 3_000;
export const CONTEXT_MAX_CHARS = 12_000;

/**
 * The most recent turns that fit, oldest first. Walks from the newest and stops at the first that
 * does not fit, so what is kept is one unbroken run ending at the latest exchange — a gap in the
 * middle would have the model answering a question that refers to something it was never shown.
 */
export function boundPriorTurns(turns: PriorTurn[]): PriorTurn[] {
  const kept: PriorTurn[] = [];
  let used = 0;
  for (const turn of turns.slice(-CONTEXT_MAX_TURNS).reverse()) {
    const answer =
      turn.answer.length > CONTEXT_MAX_ANSWER_CHARS
        ? `${turn.answer.slice(0, CONTEXT_MAX_ANSWER_CHARS - 1)}…`
        : turn.answer;
    const cost = turn.question.length + answer.length;
    if (used + cost > CONTEXT_MAX_CHARS) break;
    used += cost;
    kept.unshift({ question: turn.question, answer });
  }
  return kept;
}

const OUTCOMES: AnswerOutcome[] = ['answered', 'unanswered', 'failed'];

function isOutcome(value: string): value is AnswerOutcome {
  return (OUTCOMES as string[]).includes(value);
}

function toRun(row: {
  id: string;
  conversation_id: string;
  question: string;
  answer: string;
  outcome: string;
  detail: string | null;
  tools: unknown;
  answered_by: string;
  occurred_at: string;
  proposed_action: unknown;
  action_outcome: string | null;
  action_detail: string | null;
}): AgentRun {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    question: row.question,
    answer: row.answer,
    outcome: isOutcome(row.outcome) ? row.outcome : 'failed',
    detail: row.detail,
    tools: (row.tools ?? []) as ToolCallRecord[],
    answeredBy: row.answered_by,
    occurredAt: row.occurred_at,
    proposedAction: (row.proposed_action ?? null) as ProposedAction | null,
    actionOutcome: isActionOutcome(row.action_outcome) ? row.action_outcome : null,
    actionDetail: row.action_detail,
    // Filled in by the reads that list a transcript; a single row read never knows.
    attachments: [],
  };
}

const ACTION_OUTCOMES: ActionOutcome[] = ['pending', 'done', 'declined', 'failed'];

function isActionOutcome(value: string | null): value is ActionOutcome {
  return value !== null && (ACTION_OUTCOMES as string[]).includes(value);
}

const COLUMNS =
  'id, conversation_id, question, answer, outcome, detail, tools, answered_by, occurred_at, proposed_action, action_outcome, action_detail';

/** Lets a screen say "this deployment can't answer" rather than rendering a box that fails. */
export async function canAnswerQuestions(): Promise<boolean> {
  return (await answeringProvider()) !== null;
}

const CONVERSATION_COLUMNS = 'id, title, created_at, last_activity_at';

function toSummary(row: {
  id: string;
  title: string;
  created_at: string;
  last_activity_at: string;
}): AgentConversationSummary {
  return { id: row.id, title: row.title, createdAt: row.created_at, lastActivityAt: row.last_activity_at };
}

/**
 * My conversations in this business, most recently active first, bounded. Only ever mine, by
 * policy (`agent_conversations_select` narrows to `created_by = auth.uid()`) — an answer holds
 * whatever its asker could see, so no `.eq('created_by', ...)` is added here, to avoid suggesting
 * the boundary lives in this function.
 */
export async function listAgentConversationSummaries(
  db: Db,
  input: { organizationId: string; limit?: number },
): Promise<AgentConversationSummary[]> {
  const { data, error } = await db
    .from('agent_conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('organization_id', input.organizationId)
    .order('last_activity_at', { ascending: false })
    .limit(input.limit ?? CONVERSATION_LIST_LIMIT);

  if (error) {
    throw fromDatabaseError(error, 'assistant.list_failed');
  }

  return (data ?? []).map(toSummary);
}

/** One of my conversations, or null — somebody else's, another business's and a missing one all look alike, by policy. */
export async function getAgentConversation(
  db: Db,
  input: { organizationId: string; conversationId: string },
): Promise<AgentConversationSummary | null> {
  const { data, error } = await db
    .from('agent_conversations')
    .select(CONVERSATION_COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('id', input.conversationId)
    .maybeSingle();

  if (error) {
    throw fromDatabaseError(error, 'assistant.list_failed');
  }

  return data ? toSummary(data) : null;
}

/** One conversation's runs, newest first and bounded — the caller reverses for a transcript. Empty for a conversation the caller cannot read. */
export async function listAgentConversationRuns(
  db: Db,
  input: { organizationId: string; conversationId: string },
): Promise<AgentRun[]> {
  const { data, error } = await db
    .from('agent_runs')
    .select(COLUMNS)
    .eq('organization_id', input.organizationId)
    .eq('conversation_id', input.conversationId)
    .order('occurred_at', { ascending: false })
    .limit(CONVERSATION_RUN_LIMIT);

  if (error) {
    throw fromDatabaseError(error, 'assistant.list_failed');
  }

  const runs = (data ?? []).map(toRun);
  const attachments = await listAttachmentsByRun(db, {
    organizationId: input.organizationId,
    runIds: runs.map((run) => run.id),
  });
  return runs.map((run) => ({ ...run, attachments: attachments.get(run.id) ?? [] }));
}

/**
 * What the answering side is told about the conversation so far: the finished questions and
 * answers of this conversation and no other, bounded. A failed or unanswered run has no finished
 * answer to carry, and tool calls are never included — see `PriorTurn`.
 */
async function priorTurnsOf(
  db: Db,
  input: { organizationId: string; conversationId: string },
): Promise<PriorTurn[]> {
  const { data, error } = await db
    .from('agent_runs')
    .select('question, answer')
    .eq('organization_id', input.organizationId)
    .eq('conversation_id', input.conversationId)
    .eq('outcome', 'answered')
    .order('occurred_at', { ascending: false })
    .limit(CONTEXT_MAX_TURNS);

  if (error) {
    throw fromDatabaseError(error, 'assistant.list_failed');
  }

  return boundPriorTurns((data ?? []).reverse());
}

/**
 * Ask, and write down what came back. A failure is recorded rather than discarded — a
 * refusal, an unconfigured deployment, a declined tool all leave a row saying so in whoever's
 * words said it. The token is fetched here and passed straight through, so every tool on the
 * far side runs inside the caller's own RLS boundary.
 */
export async function askQuestion(
  db: Db,
  input: {
    organizationId: string;
    question: string;
    conversationId?: string | null;
    /** Where the person is, if the caller knows. Left out, nothing about it is sent. */
    viewing?: Viewing | null;
    /** Agent files, already uploaded, to send with this question. */
    documentIds?: string[];
  },
): Promise<AgentRun> {
  const actor = await requireActor(db);

  const question = input.question.trim();
  if (!question) {
    throw new DomainError('Write a question first.', 'assistant.question_required');
  }
  if (question.length > QUESTION_MAX) {
    throw new DomainError(
      `A question can be at most ${QUESTION_MAX} characters.`,
      'assistant.question_too_long',
    );
  }

  // Checked here as well as by the policy: `agent_runs_insert` fires *after* the answering has
  // happened, by which point somebody without the capability would already have spent this
  // deployment's money and sent this business's rows to whoever answers.
  const organization = await getOrganization(db, input.organizationId);
  if (!organization) {
    throw new DomainError('No such business.', 'assistant.not_found');
  }
  if (!organization.capabilities.includes('assistant.ask')) {
    throw new DomainError(
      'Your role cannot ask the platform questions.',
      'assistant.not_permitted',
    );
  }

  const provider = await answeringProvider();
  if (!provider) {
    throw new DomainError(
      'This deployment cannot answer questions yet.',
      'assistant.unconfigured',
    );
  }

  const { data: session } = await db.auth.getSession();
  const token = session.session?.access_token;
  if (!token) {
    throw new DomainError('Sign in to continue.', 'auth.required');
  }

  // Checked before anything is spent: a conversation that is not mine, or not in this business,
  // reads as absent, and asking into it would send the model a thread nobody may read.
  let priorTurns: PriorTurn[] = [];
  if (input.conversationId) {
    const existing = await getAgentConversation(db, {
      organizationId: input.organizationId,
      conversationId: input.conversationId,
    });
    if (!existing) {
      throw new DomainError('That conversation is not available.', 'assistant.conversation_not_found');
    }
    priorTurns = await priorTurnsOf(db, {
      organizationId: input.organizationId,
      conversationId: existing.id,
    });
  }

  // The files are read before anything is spent, for the same reason: one that is gone, sent
  // already, or not text refuses the whole question rather than being quietly left out.
  const sending = await readAttachmentsForQuestion(db, {
    organizationId: input.organizationId,
    documentIds: input.documentIds ?? [],
  });

  let outcome: AnswerOutcome = 'failed';
  let text = '';
  let detail: string | null = null;
  let answeredBy = provider.name;
  let tools: ToolCallRecord[] = [];
  let action: ProposedAction | null = null;
  let actionRefusal: string | null = null;
  let agentVersionId: string | null = null;
  let agentDeploymentId: string | null = null;

  try {
    const answer = await provider.answer({
      conversationId: input.conversationId,
      question,
      priorTurns,
      attachments: sending.texts,
      token,
      organizationId: input.organizationId,
      // the absolute-time rule, not a convenience — the model has no clock, so `Intl` (not Date arithmetic) resolves the business's own today in its own zone.
      context: `Today is ${new Intl.DateTimeFormat('en-CA', {
        timeZone: organization.timezone,
        dateStyle: 'full',
      }).format(new Date())} in ${organization.timezone}, which is the time zone this business works in. Any date you give must be in that zone.${describeViewing(input.viewing)}`,
    });
    outcome = answer.outcome;
    agentVersionId = answer.agentVersionId ?? null;
    agentDeploymentId = answer.agentDeploymentId ?? null;
    text = answer.text;
    detail = answer.detail;
    answeredBy = answer.answeredBy;
    tools = answer.tools;
    // Recorded as pending, never performed — but only if it could be carried out at all, decided
    // by the whitelist rather than by whoever suggested it.
    action = answer.action;
    actionRefusal = action ? reasonActionCannotRun(action.name, action.arguments) : null;
  } catch (failure) {
    // Not holding the Agent is a fact about the business, not a run that went wrong: nothing was
    // spent, so no run is recorded and no conversation is started for it.
    if (failure instanceof AnsweringNotEntitledError) {
      throw new DomainError(
        'This business does not have the Agent, so it cannot answer questions.',
        'assistant.not_entitled',
      );
    }
    // Their words, not a paraphrase.
    detail = failure instanceof Error ? failure.message : 'the assistant could not answer';
  }

  // A New chat is nothing until its first question has been answered or refused — created here,
  // after the answering, so a request that never got as far as asking leaves nothing behind.
  let conversationId = input.conversationId ?? null;
  if (!conversationId) {
    const created = await db
      .from('agent_conversations')
      .insert({
        organization_id: input.organizationId,
        created_by: actor.id,
        title: deriveConversationTitle(question),
      })
      .select('id')
      .single();
    if (created.error) {
      throw fromDatabaseError(created.error, 'assistant.record_failed');
    }
    conversationId = created.data.id;
  }

  const { data, error } = await db
    .from('agent_runs')
    .insert({
      organization_id: input.organizationId,
      conversation_id: conversationId,
      question,
      assistant_version_id: agentVersionId,
      assistant_deployment_id: agentDeploymentId,
      answer: text,
      outcome,
      detail,
      // `tools` is jsonb, generated as `Json` — cast because the shape it actually holds is this layer's own `ToolCallRecord`, already narrowed by the capability contract.
      tools: tools as unknown as Json,
      answered_by: answeredBy,
      created_by: actor.id,
      proposed_action: action as unknown as Json,
      // A suggestion that can't work is recorded as failed, never offered as a button — a weak
      // model can propose moving a job it never looked up, naming it in words where the id goes.
      action_outcome: action ? (actionRefusal ? 'failed' : 'pending') : null,
      action_detail: actionRefusal,
      action_taken_at: action && actionRefusal ? new Date().toISOString() : null,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    throw fromDatabaseError(error, 'assistant.record_failed');
  }

  await linkAttachmentsToRun(db, {
    organizationId: input.organizationId,
    userId: actor.id,
    runId: data.id,
    documentIds: sending.attachments.map((attachment) => attachment.id),
  });

  return { ...toRun(data), attachments: sending.attachments };
}

/**
 * Carry out what a run suggested, or decline it. Reads the run back from the database rather
 * than trusting what the caller handed over (a stale snapshot walked past the guard once, on
 * `applyConfigurationProposal`). Adds no capability and checks none — moving a job is still
 * `work_item.schedule`, refused by the same policy it would be if dragged by hand. A refusal is
 * recorded rather than thrown: the exclusion constraint refusing an overlap is the ordinary
 * case here, not a rare one.
 */
export async function decideOnAction(
  db: Db,
  input: { runId: string; carryOut: boolean },
): Promise<AgentRun> {
  await requireActor(db);

  const { data: current, error: readError } = await db
    .from('agent_runs')
    .select(`organization_id, ${COLUMNS}`)
    .eq('id', input.runId)
    .single();

  if (readError || !current) {
    throw new DomainError('No such question.', 'assistant.run_not_found');
  }

  const run = toRun(current);
  if (run.actionOutcome !== 'pending') {
    // Frozen the moment it was decided, in the policy as well as here — asking again is a new question.
    throw new DomainError('That has already been decided.', 'assistant.action_decided');
  }
  if (!run.proposedAction) {
    throw new DomainError('There is nothing to do here.', 'assistant.no_action');
  }

  let outcome: ActionOutcome = 'declined';
  let detail: string | null = null;

  if (input.carryOut) {
    const executor = executorFor(run.proposedAction.name);
    if (!executor) {
      // The two runtimes disagreeing — allowed to happen, and must fail closed.
      outcome = 'failed';
      detail = 'This platform cannot carry out that kind of suggestion.';
    } else {
      try {
        await executor(db, {
          organizationId: current.organization_id,
          arguments: run.proposedAction.arguments,
        });
        outcome = 'done';
      } catch (failure) {
        outcome = 'failed';
        detail = failure instanceof Error ? failure.message : 'that could not be carried out';
      }
    }
  }

  const { data, error } = await db
    .from('agent_runs')
    .update({
      action_outcome: outcome,
      action_detail: detail,
      action_taken_at: new Date().toISOString(),
    })
    .eq('id', input.runId)
    .select(COLUMNS)
    .single();

  if (error) {
    throw fromDatabaseError(error, 'assistant.decision_failed');
  }

  return toRun(data);
}

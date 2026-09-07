import type { Database, Db } from '@/lib/db/types';

type Json = Database['public']['Tables']['agent_runs']['Insert']['tools'];
import {
  answeringProvider,
  type AnswerOutcome,
  type ProposedAction,
  type ToolCallRecord,
} from '@/lib/adapters/answering';
import { DomainError } from '@/lib/domain/errors';
import { requireActor } from '@/lib/domain/tenancy/actor';
import { executorFor, reasonActionCannotRun } from './actions';
import { getOrganization } from '@/lib/domain/tenancy/organizations';

/**
 * Asking the system a question, and the record of having asked. The domain layer owns the flow;
 * the capability owns the answering — nothing here knows there's a loop, a model, or a second
 * deployment. Nothing here reads or writes business data: a question is answered by tools
 * running under the asking person's own token (D34), so this function could not widen what
 * somebody sees if it tried. Carrying out a suggested action is a separate, later step with its
 * own screen.
 */

export type { ProposedAction, ToolCallRecord };
export { ACTION_LABELS } from './actions';

/** `pending` is a real state somebody is looking at, hence four words rather than three. */
export type ActionOutcome = 'pending' | 'done' | 'declined' | 'failed';

export type AgentRun = {
  id: string;
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
  /** The refusal, in the words of whoever refused (I25). */
  actionDetail: string | null;
};

const QUESTION_MAX = 2000;

const OUTCOMES: AnswerOutcome[] = ['answered', 'unanswered', 'failed'];

function isOutcome(value: string): value is AnswerOutcome {
  return (OUTCOMES as string[]).includes(value);
}

function toRun(row: {
  id: string;
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
  };
}

const ACTION_OUTCOMES: ActionOutcome[] = ['pending', 'done', 'declined', 'failed'];

function isActionOutcome(value: string | null): value is ActionOutcome {
  return value !== null && (ACTION_OUTCOMES as string[]).includes(value);
}

const COLUMNS =
  'id, question, answer, outcome, detail, tools, answered_by, occurred_at, proposed_action, action_outcome, action_detail';

/** Lets a screen say "this deployment can't answer" rather than rendering a box that fails (D31). */
export async function canAnswerQuestions(): Promise<boolean> {
  return (await answeringProvider()) !== null;
}

/** Only ever mine, by policy (`agent_runs_select` narrows to `created_by = auth.uid()`) — an answer holds whatever its asker could see, so no `.eq('created_by', ...)` is added here, to avoid suggesting the boundary lives in this function. */
export async function listAgentRuns(
  db: Db,
  input: { organizationId: string },
): Promise<AgentRun[]> {
  const { data, error } = await db
    .from('agent_runs')
    .select(COLUMNS)
    .eq('organization_id', input.organizationId)
    .order('occurred_at', { ascending: false })
    .limit(50);

  if (error) {
    throw new DomainError(error.message, 'assistant.list_failed');
  }

  return (data ?? []).map(toRun);
}

/**
 * Ask, and write down what came back. A failure is recorded rather than discarded (I25) — a
 * refusal, an unconfigured deployment, a declined tool all leave a row saying so in whoever's
 * words said it. The token is fetched here and passed straight through, so every tool on the
 * far side runs inside the caller's own RLS boundary.
 */
export async function askQuestion(
  db: Db,
  input: { organizationId: string; question: string },
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

  let outcome: AnswerOutcome = 'failed';
  let text = '';
  let detail: string | null = null;
  let answeredBy = provider.name;
  let tools: ToolCallRecord[] = [];
  let action: ProposedAction | null = null;
  let actionRefusal: string | null = null;

  try {
    const answer = await provider.answer({
      question,
      token,
      organizationId: input.organizationId,
      // I9, not a convenience — the model has no clock, so `Intl` (not Date arithmetic) resolves the business's own today in its own zone.
      context: `Today is ${new Intl.DateTimeFormat('en-CA', {
        timeZone: organization.timezone,
        dateStyle: 'full',
      }).format(new Date())} in ${organization.timezone}, which is the time zone this business works in. Any date you give must be in that zone.`,
    });
    outcome = answer.outcome;
    text = answer.text;
    detail = answer.detail;
    answeredBy = answer.answeredBy;
    tools = answer.tools;
    // Recorded as pending, never performed — but only if it could be carried out at all, decided
    // by the whitelist rather than by whoever suggested it.
    action = answer.action;
    actionRefusal = action ? reasonActionCannotRun(action.name, action.arguments) : null;
  } catch (failure) {
    // Their words, not a paraphrase (I25).
    detail = failure instanceof Error ? failure.message : 'the assistant could not answer';
  }

  const { data, error } = await db
    .from('agent_runs')
    .insert({
      organization_id: input.organizationId,
      question,
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
    throw new DomainError(error.message, 'assistant.record_failed');
  }

  return toRun(data);
}

/**
 * Carry out what a run suggested, or decline it. Reads the run back from the database rather
 * than trusting what the caller handed over (a stale snapshot walked past the guard once, on
 * `applyConfigurationProposal`). Adds no capability and checks none — moving a job is still
 * `work_item.schedule`, refused by the same policy it would be if dragged by hand. A refusal is
 * recorded rather than thrown: the exclusion constraint refusing an overlap is the ordinary
 * case here, not a rare one (I6).
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
    throw new DomainError(error.message, 'assistant.decision_failed');
  }

  return toRun(data);
}

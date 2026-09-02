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
import { executorFor } from './actions';
import { getOrganization } from '@/lib/domain/tenancy/organizations';

/**
 * Asking the system a question, and the record of having asked.
 *
 * **The domain layer owns the flow; the capability owns the answering.** Nothing in this file
 * knows there is a loop, a model, a tool or a second deployment — it asks for an answer and
 * writes down what came back, beside who asked and what they asked.
 *
 * **Nothing here reads business data, and that absence is the point.** A question about work is
 * answered by tools running in Postgres under the asking person's own token, so this function
 * never fetches a job, never filters one, and could not widen what somebody sees if it tried
 * (`constraints.md` D34). It is the same shape D32 gave drafting: the model reaches business
 * state through nothing this layer hands it.
 *
 * **And nothing here writes business data.** A question is a read. The intended-action half of
 * the AI layer — where an answer comes back with something to do about it — is a later slice
 * with its own screen, and until it exists the honest description of this feature is that it
 * can tell you things and change nothing.
 */

export type { ProposedAction, ToolCallRecord };
export { ACTION_LABELS } from './actions';

/**
 * What became of a suggestion. `pending` is a real state somebody is looking at, which is why
 * there are four words rather than three.
 */
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

/**
 * Whether this deployment can answer anything at all.
 *
 * Exists so a screen can say so rather than rendering a box that cannot work — D31's rule, and
 * the shipped failure it was written from.
 */
export async function canAnswerQuestions(): Promise<boolean> {
  return (await answeringProvider()) !== null;
}

/**
 * My own questions in this business, newest first.
 *
 * **Only ever mine, and that is the policy rather than this filter.** `agent_runs_select`
 * narrows to `created_by = auth.uid()` because an answer holds whatever its asker could see, and
 * two people in one business do not see the same rows — a portal customer's narrowing and an
 * operator's reach are different, and a tenant-wide history would be a way to read yesterday's
 * answer to a question today's policies refuse. There is no `.eq('created_by', ...)` below
 * because there is no need for one, and adding it would suggest the boundary lives here.
 */
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
 * Ask, and write down what came back.
 *
 * **A failure is recorded rather than thrown away**, which is I25 applied to a third thing. A
 * model that refused, a deployment whose far side is unconfigured, a tool that Postgres declined
 * — all of them leave a row saying so in whoever's words said it. The alternative is the failure
 * mode M5's console could not answer: something went wrong, nobody can say what, and there is
 * nothing to read.
 *
 * **The token is fetched here and passed straight through.** It is the caller's own session,
 * which is what makes every tool on the far side run inside their own RLS boundary rather than
 * beside it. A caller with no session never reaches the provider.
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

  // **Checked before anything is asked, and this one is not merely for the message.** Everywhere
  // else in this platform a domain-side capability check exists to produce a readable refusal
  // while the policy does the guarding — but `agent_runs_insert` fires *after* the answering has
  // happened, and by then somebody without the capability has already spent this deployment's
  // money and sent this business's rows to whoever answers. So the guard has to be here as well.
  // The policy remains the guarantee: it refuses the record even if this check is ever lost.
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

  try {
    const answer = await provider.answer({ question, token });
    outcome = answer.outcome;
    text = answer.text;
    detail = answer.detail;
    answeredBy = answer.answeredBy;
    tools = answer.tools;
    // **Recorded as pending, never performed.** Whether this platform can carry it out at all is
    // decided below by the whitelist rather than by whoever suggested it, and whether it *should*
    // be is decided by the person reading it.
    action = answer.action && executorFor(answer.action.name) ? answer.action : null;
  } catch (failure) {
    // Their words, not a paraphrase of them (I25). A sentence an operator can act on is the
    // whole value of recording this at all.
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
      // Cast because `tools` is `jsonb` and the generated type is `Json`. The shape it holds
      // is this layer's own `ToolCallRecord`, narrowed by the capability contract before it got
      // here, and re-describing it as `Json` on the way out would lose the only thing worth
      // knowing about it.
      tools: tools as unknown as Json,
      answered_by: answeredBy,
      created_by: actor.id,
      proposed_action: action as unknown as Json,
      action_outcome: action ? 'pending' : null,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    throw new DomainError(error.message, 'assistant.record_failed');
  }

  return toRun(data);
}

/**
 * Carry out what a run suggested, or decline it.
 *
 * **The whole of the proposal contract, and it is four short steps.** Read the run back from the
 * database rather than trusting what a caller handed over — a lesson `applyConfigurationProposal`
 * learned the hard way, where a stale snapshot walked past the guard and re-ran a whole sequence.
 * Look the name up in this layer's own whitelist. Call the domain function. Write down what
 * happened.
 *
 * **This adds no capability and checks none.** Moving a job is `work_item.schedule`, refused by
 * the policy on `work_items` exactly as it would be if the person had dragged it on the schedule.
 * A check here would be a second copy of that rule in the place least able to keep it current.
 *
 * **A refusal is recorded rather than thrown.** The person suggested pressing a button and the
 * database said no; what they are owed is the sentence it said, on the row, where they are
 * already looking. The exclusion constraint refusing an overlap is the ordinary case, not a rare
 * one — which is the point of proposing an instant rather than searching for a free one (I6).
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
    // Frozen the moment it was decided, in the policy as well as here. Asking again is a new
    // question, because a suggestion acted on twice is a job moved twice.
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
      // The two runtimes disagreeing, which is allowed to happen and must fail closed. Recorded
      // in the platform's own words, because this is a fact about the platform.
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

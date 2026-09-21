/**
 * Answering a question about this business, named as a capability rather than a runtime (I15) —
 * `apps/api` is as much a "who" as Stripe is. Carries a question out and an answer back; decides
 * nothing itself. No type here may carry a model name, token count, finish reason, or prompt.
 */

export type ToolCallRecord = {
  tool: string;
  arguments: Record<string, unknown>;
  /** Row count only — the rows themselves stay where they live (D34). */
  rows: number;
  error: string;
};

/** `unanswered` isn't a failure — the tools ran and there was simply nothing to say. */
export type AnswerOutcome = 'answered' | 'unanswered' | 'failed';

/**
 * What the model would do, reported rather than performed. Name and arguments are untrusted —
 * the domain layer checks the name against its own whitelist before anything happens.
 */
export type ProposedAction = {
  name: string;
  arguments: Record<string, unknown>;
  because: string;
};

export type Answer = {
  outcome: AnswerOutcome;
  text: string;
  detail: string | null;
  answeredBy: string;
  tools: ToolCallRecord[];
  action: ProposedAction | null;
};

/**
 * An earlier question in the same conversation and the words that answered it. Text only —
 * never a tool result or a row, which were readable to their asker at that moment and must not
 * travel into a later request (D34).
 */
export type PriorTurn = {
  question: string;
  answer: string;
};

/**
 * A file sent with the question, already read as text by the domain layer — never bytes. Bounded
 * before it gets here and again on the far side.
 */
export type AttachedText = {
  name: string;
  mimeType: string;
  text: string;
  /** True when the file was longer than what is sent. */
  truncated: boolean;
};

export type AnsweringRequest = {
  question: string;
  /** Files sent with *this* question, as text. Earlier questions' files are not carried forward. */
  attachments: AttachedText[];
  /** Earlier finished turns of this same conversation, oldest first, already bounded. Empty for the first question. */
  priorTurns: PriorTurn[];
  /** Never given to the model — the loop fills it in; RLS is the real boundary (D34). */
  organizationId: string;
  /** The caller's own access token — identity reaches the database as their JWT (D17). */
  token: string;
  /** What a model has no clock for: today's date in the business's own zone. Application state only, never a tenant's own words. */
  context: string;
};

export type AnsweringProvider = {
  readonly name: string;
  /** No null case (unlike drafting/geocoding) — an unanswerable question comes back as `unanswered`, not a refusal to try. */
  answer(input: AnsweringRequest): Promise<Answer>;
};

/** Re-exported so only ./registry names an implementation (adapters.test.ts). */
export { answeringProvider } from './registry';

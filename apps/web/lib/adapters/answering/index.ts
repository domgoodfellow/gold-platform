/**
 * Answering a question about this business, named as a capability rather than as a runtime.
 *
 * The fourth adapter, and the first whose implementation is not somebody else's company — it is
 * this repository's own second deployment. That makes it look like an odd fit for I15 and it is
 * exactly the right fit: the reason a vendor goes behind a contract is that *who answers* must
 * not leak into the domain layer, and `apps/api` is as much a who as Stripe is. A domain
 * function holding a base URL and a bearer header would be a domain function that knows the loop
 * runs in another process, which is a fact it has no use for and would have to be corrected in
 * every caller the day it stops being true.
 *
 * **What this capability does not do is decide anything.** It carries a question out and brings
 * an answer back. Which tools exist, which one to call, what the rows mean — all of that is
 * behind the contract, and none of it is a rule a business wrote. The rules this platform holds
 * are in Postgres and in `lib/domain`, and the tools reach them the same way a screen does.
 *
 * **The token is the argument that matters.** Every read performed on the far side happens under
 * the caller's own access token, so a tool sees what that person's session sees and nothing more
 * (`constraints.md` D34). Passing it is therefore not a convenience — it is the authorization
 * model. An implementation that authenticated as itself would be a different feature.
 *
 * **What a capability may not leak.** No type here carries a model name, a token count, a
 * finish reason, a prompt or a vendor's identifier. `answeredBy` is the one word that comes back
 * about who answered, it is for a person reading a record later, and nothing branches on it.
 */

/** One tool that ran, for the record. Never what it returned. */
export type ToolCallRecord = {
  tool: string;
  arguments: Record<string, unknown>;
  /** How many rows came back. The rows themselves stay where they live — see D34. */
  rows: number;
  /** The database's own words, when it refused. */
  error: string;
};

/**
 * What happened, in three words the platform owns.
 *
 * `unanswered` is deliberately not a failure. Nothing broke: the question was asked, the tools
 * answered, and there was nothing to say — which is a fact about the question and the only
 * evidence that decides whether retrieval is worth building.
 */
export type AnswerOutcome = 'answered' | 'unanswered' | 'failed';

/**
 * What the model would do about its answer, reported rather than performed.
 *
 * **A name and some arguments, and neither is trusted.** The domain layer looks the name up in
 * its own whitelist and validates the arguments before anything happens, so a name this contract
 * carries and that whitelist does not know is a recorded refusal rather than a dispatch — which
 * is what lets the two runtimes disagree safely and is why the list of actions needs no version
 * shared between them.
 */
export type ProposedAction = {
  name: string;
  arguments: Record<string, unknown>;
  /** One sentence for the person deciding, in their own terms. The model's, not ours. */
  because: string;
};

export type Answer = {
  outcome: AnswerOutcome;
  /** The finished words. Empty for anything but an answered one. */
  text: string;
  /** Whoever refused, in their own words. Null unless it failed. */
  detail: string | null;
  /** Which model answered. For a person reading the record; decides nothing. */
  answeredBy: string;
  tools: ToolCallRecord[];
  /** What it suggests doing about the answer, if anything. Nothing has been done. */
  action: ProposedAction | null;
};

export type AnsweringRequest = {
  question: string;
  /**
   * The asking person's own access token.
   *
   * Not an organization id and not a user id: identity reaches the database as the caller's own
   * JWT (D17), and this carries it one hop further rather than re-deriving it somewhere it could
   * be got wrong.
   */
  token: string;
};

export type AnsweringProvider = {
  /** For a message an operator reads, and for nothing that decides anything. */
  readonly name: string;
  /**
   * An answer, or a throw.
   *
   * No null case here, unlike drafting and geocoding, and the asymmetry is real rather than an
   * oversight: those two have an answer that means *I will not work with this input*, and a
   * question does not. A question nothing could answer comes back as `unanswered`, which is an
   * answer. Everything else — unreachable, unconfigured, refused — is a throw.
   */
  answer(input: AnsweringRequest): Promise<Answer>;
};

/**
 * The configured provider, or `null` when this deployment has none.
 *
 * Re-exported rather than defined here, for the reason the other three contracts record: choosing
 * an implementation is the one operation that must name implementations, and `adapters.test.ts`
 * asserts that this file names none.
 */
export { answeringProvider } from './registry';

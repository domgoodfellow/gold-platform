import type { BusinessShape } from '@/lib/domain/onboarding/configure';

/**
 * Turning a description of a business into a proposed configuration, named as a capability
 * rather than as a provider.
 *
 * The third adapter, and it exists for the same reason the first two do (I15): domain code names
 * *draft a configuration from this description* and never names who answers.
 * `adapters.test.ts` reads the tree and fails on a domain file that reaches past this file to an
 * implementation, and on this file carrying a provider's vocabulary.
 *
 * **This capability drafts and does nothing else.** It holds no database handle, calls no domain
 * function, and has no permitted write path — which is how I14 is satisfied here: not by
 * checking what a model may reach, but by there being nothing for it to reach. Everything this
 * returns is a proposal a person reads, edits and applies under their own session, and every
 * write that eventually happens goes through the same policies a hand-typed one does.
 * `constraints.md` D32 is the record.
 *
 * **What a capability may not leak.** No type here carries a model name, a token count, a
 * finish reason, a message role or a request id. A shape and a list of questions come back, or
 * nothing does. A richer answer is a richer answer *from somebody*, and the moment a domain
 * function holds one it has a provider in it.
 *
 * **It returns a domain type, and that direction is deliberate.** `BusinessShape` belongs to
 * `configureBusiness`, which is where its meaning and its prose live; this file imports it
 * rather than restating it, because a second description of the same structure is a second
 * thing to keep in step. The dependency points from the adapter into the domain and never the
 * other way, which is the direction I15 cares about.
 */

/**
 * One thing the drafting could not settle, as a question somebody can answer.
 *
 * **This is the half that makes the flow guide rather than guess.** A description of a business
 * will not mention what it charges for a callout, and a proposal that silently invents a number
 * is worse than one that asks. So the provider says what it was thin about and why it is
 * asking, the screen renders each as a box, and the answers become the next turn's description.
 *
 * `field` names a part of the shape in the shape's own vocabulary — `prices`, `hours`,
 * `statuses`. It is for grouping questions beside what they concern, and nothing branches on
 * it: an unrecognised value renders as an ungrouped question rather than being dropped, because
 * a question nobody sees is the failure this whole mechanism exists to avoid.
 */
export type ConfigurationGap = {
  field: string;
  /** Asked in plain words, of somebody who does not know what a status is. */
  question: string;
};

/** A proposal, before anybody has looked at it. */
export type DraftedConfiguration = {
  shape: BusinessShape;
  gaps: ConfigurationGap[];
};

/**
 * What the drafting is told about the business it is drafting for.
 *
 * Deliberately three facts and a description, rather than the organization row: a name, what it
 * trades in and where it is. Prices are minor units in the business's own currency (I10) and
 * hours are wall-clock in its own zone, so a draft made without those two is a draft in some
 * other business's units — which is exactly the mistake `jobEconomics` refuses to make by
 * converting.
 */
export type DraftingRequest = {
  /** What the business said about itself, in its own words. */
  description: string;
  business: {
    name: string;
    /** ISO 4217, as the organization holds it. */
    currency: string;
    /** IANA, as the organization holds it. */
    timeZone: string;
  };
  /**
   * The shape from the previous turn, or null on the first.
   *
   * Passing it is what makes answering a question a refinement rather than a restart: the
   * business answers what it was asked, and everything it already agreed to survives.
   */
  current: BusinessShape | null;
};

export type DraftingProvider = {
  /** For a message an operator reads, and for nothing that decides anything. */
  readonly name: string;
  /**
   * A proposed configuration, or null when the provider will not produce one.
   *
   * **Null rather than a throw for a refusal, and a throw for everything else.** Those are
   * genuinely different answers, the same way they are for geocoding: a description the
   * provider declines to work with is something the business can fix by writing a different
   * one, and a provider that is unreachable, unconfigured or failing is not. A caller that
   * could not tell them apart would show the wrong sentence for both.
   *
   * **It returns one proposal and never a list.** Choosing between several is a decision, and a
   * decision made inside an adapter is business logic in the wrong place. One draft is offered
   * to a person, who edits it or throws it away.
   */
  draft(input: DraftingRequest): Promise<DraftedConfiguration | null>;
};

/**
 * The configured provider, or `null` when this deployment has none.
 *
 * Re-exported rather than defined here for the reason the payments and geocoding contracts
 * record: choosing an implementation is the one operation that must name implementations, and
 * `adapters.test.ts` asserts that this file names none.
 */
export { draftingProvider } from './registry';

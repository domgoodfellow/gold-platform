import type { BusinessShape } from '@/lib/domain/onboarding/configure';

/**
 * Drafting a configuration from a description, named as a capability rather than a provider
 * (I15). No DB handle, no domain writer — everything returned is a proposal a person applies
 * under their own session (D32).
 */

export type ConfigurationGap = {
  field: string;
  /** Asked in plain words — the person answering may not know what a "status" is. */
  question: string;
};

export type DraftedConfiguration = {
  shape: BusinessShape;
  gaps: ConfigurationGap[];
};

export type DraftingRequest = {
  description: string;
  business: {
    name: string;
    /** Null when the business hasn't said (signup doesn't require it) — never substituted. */
    currency: string | null;
    /** IANA. */
    timeZone: string;
  };
  /** The previous turn's shape, so answering a question refines rather than restarts. */
  current: BusinessShape | null;
};

export type DraftingProvider = {
  readonly name: string;
  /**
   * Null for "won't draft this" (fixable by writing a different description); throws for
   * anything else. One proposal, never a list — choosing between several belongs to a person.
   */
  draft(input: DraftingRequest): Promise<DraftedConfiguration | null>;
};

/** Re-exported so only ./registry names an implementation (adapters.test.ts). */
export { draftingProvider } from './registry';

import type { BusinessShape } from '@/lib/domain/configuration/configure';

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

/** The business does not hold guided setup. A fact about the business, not a failure of the service. */
export class DraftingNotEntitledError extends Error {
  constructor() {
    super('This business does not have guided setup.');
    this.name = 'DraftingNotEntitledError';
  }
}

export type DraftingRequest = {
  description: string;
  /** Never given to the model — `apps/api` reads the entitlement as the caller, so a business that is not theirs answers *no*. */
  organizationId: string;
  /** The caller's own access token (D17). */
  token: string;
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

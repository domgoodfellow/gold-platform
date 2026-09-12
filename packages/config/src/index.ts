/**
 * Non-secret, static identifiers shared across more than one `@gold/*` package. Nothing here is
 * mutable business configuration — that lives in the database, per business, on its own rows.
 * Never add a secret, a credential, or anything environment-specific to this file.
 */

/** The two places a caller can be acting from — paired with `ContextType` in `@gold/types`. */
export const CONTEXT_TYPES = ['platform', 'organization'] as const;

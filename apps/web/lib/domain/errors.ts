/**
 * A rule the domain refused. Distinct from an infrastructure failure: a DomainError is a
 * sentence a caller may show a person, and its `code` is what a caller may branch on.
 * Callers never re-derive the rule to produce a nicer message — that is how a second
 * implementation of a rule gets written.
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

/** The fixed `digest` of a `SignInUnreachableError`, which the error screens recognise it by. */
export const SIGN_IN_UNREACHABLE = 'auth.unreachable';

/**
 * The sign-in service could not be asked who is signed in: no connection, no answer in time, or
 * a server error. An infrastructure failure, not a `DomainError`: nobody was refused, so sending
 * them to sign in would be wrong. Next replaces a server error's message in production but keeps
 * a `digest` the error already carries, so the error screens tell it apart by that.
 */
export class SignInUnreachableError extends Error {
  readonly code = SIGN_IN_UNREACHABLE;
  readonly digest = SIGN_IN_UNREACHABLE;
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("We couldn't confirm you're signed in. Try again in a moment.");
    this.name = 'SignInUnreachableError';
    this.cause = cause;
  }
}

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

/** What a database, PostgREST or storage client hands back when it refuses. */
export type DatabaseErrorLike = { message?: string | null; code?: string | null; details?: string | null; hint?: string | null } | null | undefined;

/**
 * SQLSTATEs the database's own functions raise on purpose (`RAISE ... USING ERRCODE`), with a
 * sentence written for a person, as the migrations use them (plus `GD`/`PT` codes of our own). A
 * message under one of these codes passes through unless it is one of Postgres's own wordings below.
 */
const RAISED_ON_PURPOSE = new Set(['P0001', 'P0002', '22023', '23502', '23503', '23505', '23514', '23P01', '42501', '55000', '54000', '40001', '21000', '53400', '58000']);
const RAISED_CODE = /^(GD|PT)\d{3}$/;

/** Postgres's own wording, which is never a sentence for a person. */
const SYSTEM_WORDING = [
  /violates (unique|foreign key|check|exclusion|not-null) constraint/i,
  /row-level security/i,
  /^permission denied\b/i,
  /^null value in column/i,
  /^invalid input (syntax|value)/i,
  /^value too long/i,
  /^could not serialize access/i,
  /^deadlock detected/i,
  /^canceling statement/i,
  /^query returned (no|more than one) rows?/i,
  /^more than one row returned/i,
  /^(function|relation|column|table|schema|type) .* does not exist/i,
  /^duplicate key value/i,
];

/**
 * The one way a database refusal becomes something a person reads. A raw database message never
 * reaches a screen: Postgres's own refusals become a plain sentence by error code, a sentence a
 * database function raised on purpose passes through, and anything else becomes "Something went
 * wrong. Try again." with the original kept in the server log and on `cause`. `code` is the call
 * site's own tag, kept so callers can still branch on it.
 */
export function fromDatabaseError(error: DatabaseErrorLike, code: string): DomainError {
  const message = (error?.message ?? '').trim();
  const sqlstate = (error?.code ?? '').toUpperCase();
  const system = SYSTEM_WORDING.some((pattern) => pattern.test(message));
  const plain = (sentence: string) => Object.assign(new DomainError(sentence, code), { cause: error });

  if (system || !message) {
    if (sqlstate === '23505') return plain('That already exists.');
    if (sqlstate === '23503') {
      // "update or delete on table ... violates foreign key constraint": something still points at it.
      return /^update or delete on/i.test(message)
        ? plain("That's still in use, so it can't be removed.")
        : plain('That no longer exists.');
    }
    if (sqlstate === '42501') return plain("You don't have access to that.");
    if (sqlstate === '23514') return plain("That value isn't allowed.");
    if (sqlstate === '23P01') return plain('That overlaps something already there.');
  } else if (RAISED_ON_PURPOSE.has(sqlstate) || RAISED_CODE.test(sqlstate)) {
    return Object.assign(new DomainError(message, code), { cause: error });
  }

  console.error(`[${code}] database error ${sqlstate || '(no code)'}: ${message || '(no message)'}`);
  return plain('Something went wrong. Try again.');
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

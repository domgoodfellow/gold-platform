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

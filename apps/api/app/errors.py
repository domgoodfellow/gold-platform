"""The error vocabulary every runtime command translates a database refusal into.

**One place this translation happens, so a second command does not reinvent it differently.** A
browser must never see a raw SQLSTATE or a PostgREST body -- that is exactly the "raw SQL/
PostgREST internals" `CLAUDE.md`'s error-model rule refuses -- and a caller (a web route, an AI
tool, a worker) needs to tell a validation problem from a refusal from an ordinary failure
without parsing a message.
"""

from __future__ import annotations


class DomainError(Exception):
    """A command could not be completed. The base case: an unclassified failure.

    Deliberately vague in its default message -- an unclassified error is exactly the case where
    the underlying detail must not reach whoever asked (the no-detail-leak rule's reasoning). Anything printed for an
    operator to see goes to stderr by the caller, never into this exception's own text.
    """

    status: int = 500
    code: str = "internal"


class ValidationError(DomainError):
    """The command's input was rejected -- a check constraint, a foreign key, a bad shape."""

    status = 400
    code = "validation"


class NotFoundError(DomainError):
    """Nothing answered. Deliberately the same outcome as "not yours" (the same-organization reference rule's reasoning, RLS's
    own): a caller able to tell a refusal from an absence has been told the row exists."""

    status = 404
    code = "not_found"


class ConflictError(DomainError):
    """The command's precondition no longer holds -- something else changed the row first."""

    status = 409
    code = "conflict"


# The two SQLSTATEs this schema's narrow command functions actually raise (see the migration
# that adds `change_customer_stage` and `record_call_outcome`), plus the two Postgres raises for
# a malformed argument PostgREST would otherwise pass straight through as a 500. Nothing here
# guesses about a SQLSTATE this codebase has not chosen to mean something.
_VALIDATION_SQLSTATES = frozenset({"23514", "23503", "22P02"})  # check violation, FK violation, invalid input syntax
_NOT_FOUND_SQLSTATES = frozenset({"42501"})  # this schema's own ambiguous "not found, or not yours" refusal


def from_command_failure(message: str, *, sqlstate: str | None) -> DomainError:
    """Turn what Postgres said into the one of the four things a caller may act on."""
    if sqlstate in _VALIDATION_SQLSTATES:
        return ValidationError(message)
    if sqlstate in _NOT_FOUND_SQLSTATES:
        return NotFoundError(message)
    return DomainError("That could not be completed.")

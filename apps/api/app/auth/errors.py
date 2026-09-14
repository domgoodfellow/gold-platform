"""The one shape a rejection takes, on the way out to a browser.

**A single class rather than one per cause.** Missing header, malformed token, expired token,
wrong project, wrong signature: a caller learns nothing by being told which. Item 12 of the
security pass this package belongs to is explicit about it — a validation-internals message is a
map for whoever is trying the next token. `message` is deliberately generic; whatever Supabase or
PyJWT actually said stays out of it and belongs in a server log instead, keyed by request id, not
here.
"""

from __future__ import annotations


class AuthError(Exception):
    """Refuse a request. `status` is always 401 or 403; `message` is always safe to return."""

    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def missing_credential() -> AuthError:
    return AuthError(401, "authentication required")


def invalid_credential() -> AuthError:
    return AuthError(401, "invalid authentication")


def provider_unavailable() -> AuthError:
    """Verification infrastructure (JWKS endpoint or Supabase Auth) could not be reached, or
    answered with its own error.

    **Never a reason to authenticate anyway.** A caller with a fine token and unlucky timing
    gets a 503 and retries; a caller this runtime cannot verify never becomes one it decided to
    trust. "I could not check" and "checked and fine" must never produce the same outcome.
    """
    return AuthError(503, "authentication provider unavailable")

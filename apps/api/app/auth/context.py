"""What a verified request tells the rest of this runtime about who asked.

**Immutable, and deliberately thin.** Nothing downstream may attach anything to this after
`require_caller` builds it — a mutable context is a place authorization creep starts, one field
at a time. What is here answers "who" and "how sure"; what a caller may do is answered elsewhere
(module docstring, `app/auth/__init__.py`).
"""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping


@dataclass(frozen=True)
class CallerContext:
    """One authenticated caller, for the length of one request.

    `token` is kept only to be forwarded to PostgREST under this same person's own rights (D17) —
    never logged, never echoed in a response (constraints.md, item 12 of this security pass).

    `role` is Supabase's own JWT `role` claim (ordinarily `authenticated`), exposed for
    inspection only. **It must never be read as platform authority.** `platform_staff` is a
    database fact checked live (D45); a JWT claim a session merely presents is exactly the
    design this repository tore out once already, and `require_caller` does not special-case it.

    `verification_mechanism` says *how* this identity was established — `"jwks"` (this process
    checked a signature itself) or `"auth_server"` (Supabase Auth checked it and told us,
    `GET /auth/v1/user`) — for diagnostics only. Both are a finished, authoritative verification;
    reaching this dataclass at all already means one of them succeeded. There is no third value
    and no partially-verified `CallerContext`.
    """

    user_id: str
    token: str
    claims: Mapping[str, Any]
    verification_mechanism: str
    assurance_level: str | None

    @property
    def role(self) -> str | None:
        return self.claims.get("role")

    @staticmethod
    def build(
        *, user_id: str, token: str, claims: Mapping[str, Any], verification_mechanism: str
    ) -> "CallerContext":
        return CallerContext(
            user_id=user_id,
            token=token,
            claims=MappingProxyType(dict(claims)),
            verification_mechanism=verification_mechanism,
            assurance_level=claims.get("aal"),
        )

    def __repr__(self) -> str:  # pragma: no cover - defensive, exercised by logging-hygiene tests
        # No token, no claims — only what is safe in a stray log line.
        return (
            f"CallerContext(user_id={self.user_id!r}, "
            f"verification_mechanism={self.verification_mechanism!r})"
        )

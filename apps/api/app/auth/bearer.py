"""Reading one header, the one way, once.

**The duplication this whole package exists to remove.** Before this, `ai_ask.py` and
`crm_change_customer_stage.py` each wrote their own `presented.startswith("Bearer ")` — a rule a
second caller extracts rather than copies (CLAUDE.md, "Rules that hold in every change"). A third
handler was about to write it a third time.
"""

from __future__ import annotations

from app.auth.errors import missing_credential

_PREFIX = "Bearer "


def extract_bearer_token(headers) -> str:
    """The raw token from `Authorization: Bearer <token>`, or a refusal.

    `headers` is anything answering `.get(name)` case-insensitively — `http.server`'s
    `self.headers` already behaves this way, so a handler passes it straight through.

    Refuses on a missing header, an empty one, a scheme that is not `Bearer`, and a `Bearer` with
    nothing after it. All four are `missing_credential()`, not `invalid_credential()`: nothing
    was presented to judge, so there is nothing to call invalid.
    """
    presented = headers.get("authorization") or headers.get("Authorization") or ""
    if not presented.startswith(_PREFIX):
        raise missing_credential()

    token = presented[len(_PREFIX):].strip()
    if not token:
        raise missing_credential()

    return token

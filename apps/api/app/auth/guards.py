"""The one call a handler makes to stop being anonymous.

Everything upstream of this module is decomposed for testing; this is the composed entry point a
handler actually imports — `ai_ask.py`, `crm_change_customer_stage.py` and
`voice_wrap_up_call.py` all replace their own `presented.startswith("Bearer ")` with one call
here, and it finishes — one way or the other — before any of them calls a domain function,
a model, or a provider.
"""

from __future__ import annotations

from app.auth.bearer import extract_bearer_token
from app.auth.context import CallerContext
from app.auth.errors import invalid_credential
from app.auth.supabase import verify_access_token


def require_caller(
    headers, *, supabase_url: str, supabase_publishable_key: str
) -> CallerContext:
    """Extract and authoritatively verify the caller's bearer token, or raise `AuthError`.

    Both arguments are passed in rather than read from the environment here, because every
    caller already loaded a `*Settings` dataclass for its own feature — this stays a pure
    function of what it is given rather than a second reader of `os.environ`. Note what is
    absent: no signing secret of any kind, for either verification mechanism `verify_access_token`
    may use.
    """
    token = extract_bearer_token(headers)
    verified = verify_access_token(
        token, supabase_url=supabase_url, supabase_publishable_key=supabase_publishable_key
    )

    user_id = verified.claims.get("sub")
    if not user_id:
        # Both branches of verify_access_token already guarantee this; belt and braces so this
        # function alone is the contract callers can rely on.
        raise invalid_credential()

    return CallerContext.build(
        user_id=user_id,
        token=token,
        claims=verified.claims,
        verification_mechanism=verified.mechanism,
    )

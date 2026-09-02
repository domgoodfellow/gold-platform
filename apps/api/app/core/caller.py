"""Reaching Postgres as the person who asked.

**The third way this runtime reaches the database, and the first that is not a machine.**
`app.core.db` mints a token for `payment_webhook`; `app.core.runner` mints one for
`automation_runner`. Both exist because no person is present. Here a person always is, so this
module **mints nothing** -- it forwards the access token `apps/web` was already holding for the
operator who asked the question, and every read lands on the policies that operator's own
browser session lands on (D17).

**That absence is the security property, not a simplification.** The alternative is an
`assistant` Postgres role reading across tenants and filtering by an organization id -- and the
organization id would be an argument a language model produced. Protection that a model can
choose the value of is not protection. So there is no role on this axis, no grant to assert, and
nothing here that could read a row its caller could not: `work_at_risk`'s parameter says *which
of your businesses*, and RLS says *whose*.

**Nothing is stored and nothing is logged.** The token lives for the length of one request. It
never reaches a run row, an exception message or a response body -- a bearer token in a hosting
provider's log is outside every boundary this platform draws.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.core.config import AssistantSettings


class ToolFailed(RuntimeError):
    """Postgres refused, in its own words.

    Kept verbatim and handed back to the model as a tool result rather than raised out of the
    loop: a question that asks for something the caller may not see is an ordinary event, and
    the useful answer is *the database declined*, not a failed run. The same words reach the run
    row (I25).
    """


def call_tool(
    settings: AssistantSettings,
    *,
    token: str,
    function: str,
    arguments: dict[str, Any],
) -> list[dict[str, Any]]:
    """Call one tool function under the caller's own token, and return what it answered.

    The arguments come from a model and are passed through unexamined on purpose. There is
    nothing useful this runtime could check about them that Postgres does not check better: a
    wrong type is a 400 from PostgREST, an unknown argument is a 404, and an organization id
    belonging to somebody else is an empty list. Validating here would be a second, weaker copy
    of the function's own signature.
    """
    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/{function}",
        headers={
            "apikey": settings.supabase_anon_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=arguments,
        timeout=15.0,
    )

    if response.status_code >= 400:
        body: dict[str, Any] = {}
        if response.headers.get("content-type", "").startswith("application/json"):
            body = response.json()
        raise ToolFailed(body.get("message") or f"the database refused ({response.status_code})")

    answered = response.json()
    # A set-returning function answers with a list. A scalar one would not, and rather than
    # guess what a future tool means by that, the one shape this understands is the one every
    # tool in `app.ai.tools` has.
    if not isinstance(answered, list):
        raise ToolFailed("this tool did not answer with rows")

    return answered

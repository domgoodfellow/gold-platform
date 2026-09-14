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

from typing import Any, Protocol

import httpx


class SupabaseCallerSettings(Protocol):
    """What forwarding a caller's own token needs: where to send it and which project.

    A `Protocol` rather than a concrete dataclass, because two features now share this shape --
    `AssistantSettings` (asking a question) and `DomainSettings` (a CRM/Voice command) -- for two
    separate reasons to exist. Structural typing is the point: neither has to inherit from the
    other, or from anything, to be usable here.
    """

    supabase_url: str
    supabase_publishable_key: str


class ToolFailed(RuntimeError):
    """Postgres refused, in its own words.

    Kept verbatim and handed back to the model as a tool result rather than raised out of the
    loop: a question that asks for something the caller may not see is an ordinary event, and
    the useful answer is *the database declined*, not a failed run. The same words reach the run
    row (I25).
    """


class CommandFailed(RuntimeError):
    """Postgres refused a domain command, in its own words and its own error code.

    Distinct from `ToolFailed`: a tool's failure is handed to a model as an ordinary event, but a
    domain command's caller (`apps/api/app/domains/**`) needs the SQLSTATE too, to translate a
    check violation into a validation error and an RLS refusal into a not-found one rather than
    showing a browser Postgres's own words (`app/domains/errors.py`).
    """

    def __init__(self, message: str, *, sqlstate: str | None) -> None:
        super().__init__(message)
        self.sqlstate = sqlstate


def call_tool(
    settings: SupabaseCallerSettings,
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
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        # PostgREST names an argument exactly as the function declares it. Everything a model
        # supplies is named in the schema's own words, so it is prefixed here rather than in
        # every schema -- which keeps a tool's description readable to whoever is reading it.
        json={
            key if key.startswith("p_") else f"p_{key}": value
            for key, value in arguments.items()
        },
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


def call_command(
    settings: SupabaseCallerSettings,
    *,
    token: str,
    function: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    """Call one narrow write RPC under the caller's own token, and return the row it wrote.

    The write half of what `call_tool` is for reads: `apps/api/app/domains/**`'s commands each
    name a function declared `returns public.<table>` (a single row), not `returns setof` (many)
    -- PostgREST answers a scalar-returning function with one JSON object, so this does not share
    `call_tool`'s "must be a list" shape. The one thing both keep in common is the whole reason
    either can exist without a role of its own: the token forwarded is the caller's, and RLS on
    the underlying table is what actually decides whether the write happens (D17, D34).
    """
    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/{function}",
        headers={
            "apikey": settings.supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={
            key if key.startswith("p_") else f"p_{key}": value
            for key, value in arguments.items()
        },
        timeout=15.0,
    )

    if response.status_code >= 400:
        body: dict[str, Any] = {}
        if response.headers.get("content-type", "").startswith("application/json"):
            body = response.json()
        raise CommandFailed(
            body.get("message") or f"the database refused ({response.status_code})",
            sqlstate=body.get("code"),
        )

    return response.json()

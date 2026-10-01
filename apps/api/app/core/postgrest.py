"""One call to PostgREST under a caller's own token -- RLS decides, never this runtime.

Extracted once two services (`app.services.integrations`, `app.services.web_delivery`) had each
written the same six lines and a third (`app.services.dns`) was about to copy them a third time.
A machine-role call (`app.core.db`) mints its own token first; this is for the ordinary case where
a human's own bearer token is already in hand and RLS is what must answer.
"""

from __future__ import annotations

import httpx

from app.errors import DomainError


def caller_rest(
    supabase_url: str,
    supabase_publishable_key: str,
    token: str,
    method: str,
    path: str,
    **kwargs,
) -> httpx.Response:
    response = httpx.request(
        method,
        f"{supabase_url}/rest/v1/{path}",
        headers={
            "apikey": supabase_publishable_key,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        timeout=10.0,
        **kwargs,
    )
    if response.status_code >= 400:
        raise DomainError("That could not be completed.")
    return response

"""Acting on GOLD's own OpenAI account.

**One operation, because there is nothing else to provision.** Unlike Twilio, an OpenAI account
has no subaccounts and no per-tenant resource this platform creates — GOLD holds one API key and
answers every capability assigned to it. No SDK, for the same reason `app.providers.twilio.accounts`
gives: this is one HTTPS call, and the answering adapter beside this file is where an SDK earns
its place.
"""

from __future__ import annotations

import httpx

API = "https://api.openai.com/v1"


def verify(credential: dict) -> dict:
    """Does this API key work. Returns `{"ok", "error", "metadata"}` rather than raising."""
    secret = credential.get("secret")
    if not secret:
        return {"ok": False, "error": "This account has no credential stored.", "metadata": {}}

    try:
        response = httpx.get(
            f"{API}/models", headers={"Authorization": f"Bearer {secret}"}, timeout=15.0
        )
    except httpx.HTTPError as failure:
        return {"ok": False, "error": f"OpenAI could not be reached: {type(failure).__name__}", "metadata": {}}

    if response.status_code >= 400:
        return {
            "ok": False,
            "error": f"OpenAI refused the request ({response.status_code}): {response.text[:300]}",
            "metadata": {},
        }

    count = len(response.json().get("data") or [])
    return {"ok": True, "error": None, "metadata": {"models_visible": count}}


OPERATIONS = {"verify": lambda credential, args: verify(credential)}

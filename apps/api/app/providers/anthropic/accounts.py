"""Acting on GOLD's own Anthropic account.

One operation, for the reason `app.providers.openai.accounts` gives: GOLD holds a single API key
and there is nothing per-tenant to provision beneath it. No SDK -- a listing call is one HTTPS
request, and the SDK earns its place in the answering adapter beside this file, not here.
"""

from __future__ import annotations

import httpx

API = "https://api.anthropic.com/v1"
ANTHROPIC_VERSION = "2023-06-01"


def verify(credential: dict) -> dict:
    """Does this API key work. Returns `{"ok", "error", "metadata"}` rather than raising."""
    secret = credential.get("secret")
    if not secret:
        return {"ok": False, "error": "This account has no credential stored.", "metadata": {}}

    try:
        response = httpx.get(
            f"{API}/models",
            headers={"x-api-key": secret, "anthropic-version": ANTHROPIC_VERSION},
            timeout=15.0,
        )
    except httpx.HTTPError as failure:
        return {"ok": False, "error": f"Anthropic could not be reached: {type(failure).__name__}", "metadata": {}}

    if response.status_code >= 400:
        return {
            "ok": False,
            "error": f"Anthropic refused the request ({response.status_code}): {response.text[:300]}",
            "metadata": {},
        }

    count = len(response.json().get("data") or [])
    return {"ok": True, "error": None, "metadata": {"models_visible": count}}


OPERATIONS = {"verify": lambda credential, args: verify(credential)}

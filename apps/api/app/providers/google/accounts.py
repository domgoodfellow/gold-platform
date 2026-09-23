"""Acting on GOLD's own Google (Gemini) account.

One operation, for the reason `app.providers.openai.accounts` gives: GOLD holds a single API key
and there is nothing per-tenant to provision beneath it. No SDK -- a listing call is one HTTPS
request, and the SDK earns its place in the answering adapter beside this file, not here.
"""

from __future__ import annotations

import httpx

API = "https://generativelanguage.googleapis.com/v1beta"


def verify(credential: dict) -> dict:
    """Does this API key work. Returns `{"ok", "error", "metadata"}` rather than raising."""
    secret = credential.get("secret")
    if not secret:
        return {"ok": False, "error": "This account has no credential stored.", "metadata": {}}

    try:
        response = httpx.get(f"{API}/models", params={"key": secret}, timeout=15.0)
    except httpx.HTTPError as failure:
        return {"ok": False, "error": f"Google could not be reached: {type(failure).__name__}", "metadata": {}}

    if response.status_code >= 400:
        return {
            "ok": False,
            "error": f"Google refused the request ({response.status_code}): {response.text[:300]}",
            "metadata": {},
        }

    count = len(response.json().get("models") or [])
    return {"ok": True, "error": None, "metadata": {"models_visible": count}}


OPERATIONS = {"verify": lambda credential, args: verify(credential)}

"""Acting on GOLD's own Resend account.

**One operation, the same reason `app.providers.openai.accounts` gives.** A Resend account has no
subaccounts and no per-tenant resource this platform creates -- GOLD holds one API key and every
invitation this deployment sends goes through it (or through the environment-variable bootstrap
path, `app.services.platform_email`'s own fallback). Listing domains is a harmless, side-effect-free
call that also happens to say something useful: how many sending domains this account can answer
for.
"""

from __future__ import annotations

import httpx

API = "https://api.resend.com"


def verify(credential: dict) -> dict:
    """Does this API key work. Returns `{"ok", "error", "metadata"}` rather than raising."""
    secret = credential.get("secret")
    if not secret:
        return {"ok": False, "error": "This account has no credential stored.", "metadata": {}}

    try:
        response = httpx.get(
            f"{API}/domains", headers={"Authorization": f"Bearer {secret}"}, timeout=15.0
        )
    except httpx.HTTPError as failure:
        return {"ok": False, "error": f"Resend could not be reached: {type(failure).__name__}", "metadata": {}}

    if response.status_code >= 400:
        return {
            "ok": False,
            "error": f"Resend refused the request ({response.status_code}): {response.text[:300]}",
            "metadata": {},
        }

    data = response.json().get("data") or []
    return {"ok": True, "error": None, "metadata": {"domains_visible": len(data)}}


OPERATIONS = {"verify": lambda credential, args: verify(credential)}

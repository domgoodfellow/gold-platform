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

from app.providers.resend.base import api_base

API = api_base()


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


def sending_domains(secret: str) -> dict:
    """The domains this account holds and Resend's word for each, read only.

    `{"ok": True, "domains": [{"name", "status"}]}`, or `{"ok": False, "kind", "error"}` where
    `kind` is `rejected` (the key does not work) or `unavailable` (Resend could not answer).
    """
    try:
        response = httpx.get(f"{API}/domains", headers={"Authorization": f"Bearer {secret}"}, timeout=15.0)
    except httpx.HTTPError as failure:
        return {"ok": False, "kind": "unavailable", "error": f"Resend could not be reached: {type(failure).__name__}"}
    if response.status_code in (401, 403):
        return {"ok": False, "kind": "rejected", "error": f"Resend refused this account's key ({response.status_code})."}
    if response.status_code >= 400:
        return {"ok": False, "kind": "unavailable", "error": f"Resend answered {response.status_code}."}
    try:
        rows = response.json().get("data") or []
    except ValueError:
        return {"ok": False, "kind": "unavailable", "error": "Resend's answer could not be read."}
    return {"ok": True, "domains": [{"name": str(row.get("name") or "").lower(), "status": str(row.get("status") or "")} for row in rows if isinstance(row, dict)]}


OPERATIONS = {"verify": lambda credential, args: verify(credential)}

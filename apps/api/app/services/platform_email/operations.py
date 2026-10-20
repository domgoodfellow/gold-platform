"""Sending or resending one invitation's email, and recording what happened.

**The caller never supplies a recipient, a subject or a body.** Every value that decides *who*
this reaches and *what it says* is derived here: the recipient from the invitation row the
caller's own token can see (the same `role.manage` capability `invite_member` and
`revoke_invitation` already require), the subject and body from one fixed template this platform
writes once. `link` is the one thing only `apps/web` can supply, because only it just minted the
plaintext token that makes the link work (the hashed-token rule: the token is hashed at rest and returned exactly
once, to the caller who created it) -- never a `to`, never free text, so this is not an open relay
a signed-in caller could point at an arbitrary address with arbitrary words.

**The account is tried before the environment, explicitly.** A GOLD-owned `platform_provider_accounts`
row for `resend` -- rotatable without a deploy, verifiable, defaultable -- answers first when one
exists and holds a credential; `RESEND_API_KEY`/`PLATFORM_EMAIL_FROM_ADDRESS` is the bootstrap
fallback this deployment already had, kept rather than removed (work order 1, section 6).
"""

from __future__ import annotations

import os

from app.core import db
from app.core.config import ProviderOperationsSettings
from app.core.postgrest import caller_rest
from app.errors import NotFoundError, ValidationError
from app.providers.resend.email import send_platform_email

_SUBJECT = "You've been invited to join a business on GildOps"


def _text(link: str) -> str:
    return (
        "You've been invited to join a business on GildOps. Open this link to accept:\n\n"
        f"{link}\n\n"
        "If you weren't expecting this, you can ignore it."
    )


def _invitation(settings: ProviderOperationsSettings, token: str, organization_id: str, invitation_id: str) -> dict:
    if not organization_id or not invitation_id:
        raise ValidationError("A business and an invitation are both required.")

    response = caller_rest(
        settings.supabase_url,
        settings.supabase_publishable_key,
        token,
        "GET",
        "organization_invitations",
        params={
            "id": f"eq.{invitation_id}",
            "organization_id": f"eq.{organization_id}",
            "accepted_at": "is.null",
            "revoked_at": "is.null",
            "select": "id,email,organization_id",
        },
    )
    rows = response.json()
    if not rows:
        raise NotFoundError("No such pending invitation.")
    return rows[0]


def send_invitation_email(
    settings: ProviderOperationsSettings,
    *,
    token: str,
    organization_id: str,
    invitation_id: str,
    link: str,
) -> dict:
    if not link or not link.strip():
        raise ValidationError("A link is required.")

    invitation = _invitation(settings, token, organization_id, invitation_id)
    to = invitation["email"]
    subject = _SUBJECT
    text = _text(link.strip())

    account_id = db.default_platform_provider_account(settings, provider_key="resend")
    credential = db.read_provider_account_credential(settings, account_id=account_id) if account_id else None
    sender = os.environ.get("PLATFORM_EMAIL_FROM_ADDRESS")

    if credential and credential.get("secret") and sender:
        result = send_platform_email(api_key=credential["secret"], sender=sender, to=to, subject=subject, text=text)
    else:
        api_key = os.environ.get("RESEND_API_KEY")
        if api_key and sender:
            result = send_platform_email(api_key=api_key, sender=sender, to=to, subject=subject, text=text)
        else:
            result = {"ok": False, "external_id": None, "detail": "GildOps' invitation email is not set up on this deployment yet."}

    db.record_invitation_delivery(
        settings,
        organization_id=organization_id,
        invitation_id=invitation_id,
        recipient=to,
        # `queued`, not `sent`: Resend's synchronous 2xx means it was accepted into Resend's own
        # send pipeline, never that it actually left -- `email.sent` is the provider's own later
        # word for that, and is what advances this (work order 1 closeout, section 6).
        state="queued" if result["ok"] else "failed",
        provider_message_id=result.get("external_id"),
        detail=result.get("detail"),
    )

    return {"sent": result["ok"], "external_id": result.get("external_id"), "detail": result.get("detail")}

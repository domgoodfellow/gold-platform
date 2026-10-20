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
from datetime import datetime, timezone

from app.core import db
from app.core.config import ProviderOperationsSettings
from app.core.postgrest import caller_rest
from app.errors import NotFoundError, ValidationError
from app.providers.resend.email import send_platform_email

def _subject(business: str) -> str:
    # One line, whatever the business is called: a header never carries a line break.
    return f"{business} invited you to join them on GildOps".replace("\r", " ").replace("\n", " ")[:200]


def _text(link: str, *, business: str, role: str, email: str, expires: str) -> str:
    return (
        f"{business} has invited you to join their team on GildOps as {role}.\n\n"
        f"Accept the invitation:\n{link}\n\n"
        f"This invitation is for {email} and expires on {expires}.\n\n"
        "Already use GildOps with this address? Log in and accept. New to GildOps? Create an account with "
        "this address; GildOps will then email you a separate verification code to confirm it, and "
        "bring you back to this invitation.\n\n"
        "If you weren't expecting this, you can ignore this email."
    )


def _name(settings: ProviderOperationsSettings, token: str, table: str, row_id: str, organization_id: str) -> str | None:
    """A name the caller may already read: their own business, or one of its roles."""
    params = {"id": f"eq.{row_id}", "select": "name"}
    if table == "roles":
        params["organization_id"] = f"eq.{organization_id}"
    try:
        rows = caller_rest(settings.supabase_url, settings.supabase_publishable_key, token, "GET", table, params=params).json()
    except Exception:  # noqa: BLE001 - a missing name never stops the invitation
        return None
    return str(rows[0]["name"]) if rows and rows[0].get("name") else None


def _expires(value: str | None) -> str:
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00")).astimezone(timezone.utc)
    except (TypeError, ValueError):
        return "in 7 days"
    return f"{moment.day} {moment.strftime('%B %Y at %H:%M')} UTC"


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
            "select": "id,email,organization_id,role_id,expires_at",
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
    business = _name(settings, token, "organizations", organization_id, organization_id) or "A business"
    role = _name(settings, token, "roles", str(invitation.get("role_id") or ""), organization_id) or "a member"
    subject = _subject(business)
    text = _text(link.strip(), business=business, role=role, email=to, expires=_expires(invitation.get("expires_at")))

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

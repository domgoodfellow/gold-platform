"""Sending one business's email, and recording what the provider answered.

**The message row is the command; the caller supplies nothing else.** `queue_outbound_email` (the
database, under the sender's own session) has already decided who the mail is from, who it goes to,
whether that address may send and which thread it belongs to. This runtime is handed only the id of
that message, reads every value it sends back *under the caller's own token* (so RLS says whether
this person may see, and therefore send, this message at all), and never accepts a recipient, an
address, a subject or a body from the request. There is no way to point it at somebody else's
message or at an address the business does not hold.

**The provider is chosen by what is under the address, not named here.** The database resolves the
address the conversation is on (`email_sender_account`, the same `app.organization_email_sender`
every business email uses): it must still be this business's and ready at send time, and the answer
names the provider and the account that holds its sending domain. Only that account's credential is
used, never the deployment's own key. This file sequences the work and speaks GildOps' vocabulary
only; `app.providers` turns the key into a module.

**Every outcome is recorded before it is returned**, through the one door that may say what a
provider answered (`provider_operator`): accepted, refused (a fact about the message), failed (nothing
could send it) or retry (a transient fault, so the same message goes back in the queue and the same
attempt can be made again). A claim, taken first and exactly once, is what stops two attempts at one
message both reaching the provider; the provider's own idempotency key, the message id, covers the
case where the answer was lost.
"""

from __future__ import annotations

import base64
from email.utils import formataddr

import httpx

from app.core import db
from app.core.config import ProviderOperationsSettings
from app.core.postgrest import caller_rest
from app.errors import DomainError, NotFoundError, ValidationError
from app.providers.providers import tenant_email_for

# The one place these limits are written for this runtime; the database enforces the same numbers
# when the message is queued, so a mismatch fails there first.
MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
MAX_TOTAL_BYTES = 25 * 1024 * 1024


class ProviderUnavailableError(DomainError):
    """No email account can answer -- a platform fact, never a problem with the message."""

    status = 503
    code = "provider_unavailable"


def _rows(settings: ProviderOperationsSettings, token: str, path: str, params: dict) -> list[dict]:
    response = caller_rest(settings.supabase_url, settings.supabase_publishable_key, token, "GET", path, params=params)
    rows = response.json()
    return rows if isinstance(rows, list) else []


def _one(settings: ProviderOperationsSettings, token: str, path: str, params: dict) -> dict | None:
    rows = _rows(settings, token, path, params)
    return rows[0] if rows else None


def _sender_identity(settings: ProviderOperationsSettings, token: str, organization_id: str, message: dict) -> str | None:
    """The address this message's conversation is on, read under the caller's own token."""
    conversation = _one(settings, token, "conversations", {"id": f"eq.{message['conversation_id']}", "organization_id": f"eq.{organization_id}", "select": "email_identity_id"})
    return conversation.get("email_identity_id") if conversation else None


def _credential(settings: ProviderOperationsSettings, account_id: str | None) -> str | None:
    """The secret of the one account that holds this sender's domain, or `None`. No other account's
    key, and no deployment-wide key, may stand in for it: a domain verified in one account cannot be
    sent from through another."""
    if not account_id:
        return None
    credential = db.read_provider_account_credential(settings, account_id=account_id)
    return str(credential["secret"]) if credential and credential.get("secret") else None


def _attachments(settings: ProviderOperationsSettings, token: str, organization_id: str, message_id: str) -> list[dict]:
    """The files of this message, read back from private storage under the caller's own token --
    so a path that is not this business's would not open -- and re-checked for size here."""
    rows = _rows(
        settings, token, "message_attachments",
        {"message_id": f"eq.{message_id}", "organization_id": f"eq.{organization_id}", "storage_state": "eq.stored", "select": "filename,content_type,size_bytes,storage_path"},
    )
    files: list[dict] = []
    total = 0
    for row in rows:
        response = httpx.get(
            f"{settings.supabase_url}/storage/v1/object/communications/{row['storage_path']}",
            headers={"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token}"},
            timeout=60.0,
        )
        if response.status_code >= 400:
            raise ValidationError("An attachment could not be read, so the email was not sent.")
        content = response.content
        total += len(content)
        if len(content) > MAX_ATTACHMENT_BYTES or total > MAX_TOTAL_BYTES:
            raise ValidationError("The attachments are larger than an email may carry.")
        files.append({"filename": row["filename"], "content_type": row["content_type"], "content": base64.b64encode(content).decode()})
    return files


def send_queued_email(
    settings: ProviderOperationsSettings,
    *,
    token: str,
    organization_id: str,
    message_id: str,
) -> dict:
    if not organization_id or not message_id:
        raise ValidationError("A business and a message are both required.")

    message = _one(
        settings, token, "messages",
        {"id": f"eq.{message_id}", "organization_id": f"eq.{organization_id}", "requested_transport": "eq.email", "direction": "eq.outbound",
         "select": "id,status,body,conversation_id,external_id"},
    )
    # One refusal for "not yours", "no such message" and "not an email": the same-organization reference rule's ambiguous answer.
    if message is None:
        raise NotFoundError("No such email.")

    if message["status"] != "queued":
        # Already taken, sent, or ended: a repeat of the same request is not a second send.
        return {"status": message["status"], "external_id": message.get("external_id")}

    details = _one(
        settings, token, "email_message_details",
        {"message_id": f"eq.{message_id}", "organization_id": f"eq.{organization_id}",
         "select": "subject,from_address,from_name,to_addresses,html_body,in_reply_to,reference_ids"},
    )
    if details is None:
        raise NotFoundError("No such email.")

    sender = db.email_sender_account(settings, organization_id=organization_id, email_identity_id=_sender_identity(settings, token, organization_id, message))
    provider = tenant_email_for(sender["provider_key"]) if sender["state"] == "ready" and sender.get("provider_key") else None
    api_key = _credential(settings, sender.get("provider_account_id")) if provider is not None else None

    # Taken exactly once. From here on, every path ends in a recorded outcome.
    if not db.claim_email_for_send(settings, organization_id=organization_id, message_id=message_id):
        return {"status": "sending", "external_id": None}

    def record(outcome: str, **kwargs) -> None:
        db.record_email_send_result(settings, organization_id=organization_id, message_id=message_id, outcome=outcome, **kwargs)

    if sender["state"] == "refused":
        # The address is no longer this business's to send from (unverified, disabled, or not
        # its own): a fact the business must fix, so it is not retried and the reason is shown.
        record("failed", detail=sender["detail"])
        return {"status": "rejected", "external_id": None, "detail": sender["detail"]}

    if provider is None or not api_key:
        record("retry", detail="Email sending is not set up on this deployment yet.")
        raise ProviderUnavailableError("Email sending is not available right now.")

    try:
        return _deliver(settings, token, organization_id, message_id, message, details, provider, api_key, record)
    except DomainError:
        raise
    except Exception:
        # Whatever went wrong, the message is not left claimed forever: it returns to the queue so
        # the person can see it was not sent and try again, and the provider's own idempotency key
        # makes a repeat of a send that did land the same send.
        record("retry", detail="The email could not be sent because of an unexpected error.")
        raise ProviderUnavailableError("The email could not be sent right now.")


def _deliver(settings, token, organization_id, message_id, message, details, provider, api_key, record) -> dict:
    try:
        files = _attachments(settings, token, organization_id, message_id)
    except DomainError as failure:
        record("failed", detail=str(failure))
        raise

    result = provider.send_tenant_email(
        api_key=api_key,
        idempotency_key=message_id,
        sender=formataddr((details.get("from_name") or "", details["from_address"])),
        to=list(details["to_addresses"]),
        subject=details["subject"],
        text=message["body"],
        html=details.get("html_body"),
        in_reply_to=details.get("in_reply_to"),
        references=list(details.get("reference_ids") or []),
        attachments=files,
    )

    if result["ok"]:
        # Read back, never assumed: what a reply will carry in `In-Reply-To` is what the provider
        # actually put on the wire.
        confirmed = provider.confirmed_message_id(api_key=api_key, email_id=result["external_id"])
        record("accepted", external_id=result["external_id"], rfc_message_id=confirmed)
        return {"status": "sent", "external_id": result["external_id"]}

    if result["retryable"]:
        record("retry", detail=result["detail"])
        raise ProviderUnavailableError("The email provider could not take the message right now.")

    record("rejected", detail=result["detail"])
    return {"status": "rejected", "external_id": None, "detail": result["detail"]}

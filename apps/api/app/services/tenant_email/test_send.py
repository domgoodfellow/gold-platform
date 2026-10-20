"""One test email from a business's own sender to the manager who asked for it.

**Everything that decides it is the database's, under the manager's own session.**
`begin_email_test_send` checks that the caller may configure the business, that their own sign-in
address is confirmed, and that the business has not sent too many tests; it resolves the default
sender through the one sender path; and it records the attempt. The recipient is always the
caller's own confirmed address, so there is nothing here a caller could point at somebody else.

**The account is the one recorded as holding the sender's domain**, read through the provider
runtime's narrow door (`email_test_send_account`); no other account's key and no deployment key is
used. The test id is the provider's idempotency key and travels as a tag, so a report can find it.
"""

from __future__ import annotations

from email.utils import formataddr

import httpx

from app.core import db
from app.core.config import ProviderOperationsSettings
from app.errors import DomainError, ValidationError
from app.providers.providers import tenant_email_for


class TestSendRefused(DomainError):
    """The business must change something first (its sender, or the manager's own address)."""

    status = 409
    code = "test_send_refused"


class TestSendLimited(DomainError):
    status = 429
    code = "test_send_limited"


class TestSendForbidden(DomainError):
    status = 403
    code = "forbidden"


def _subject(business: str) -> str:
    return f"Test email from {business}"[:200]


def _text(business: str, sender: str) -> str:
    return (
        f"This is a test email from {business}, sent with GildOps to check that email from {sender} works.\n\n"
        "No action is needed. You received it because you asked for a test in Email sending settings."
    )


def _begin(settings: ProviderOperationsSettings, token: str, organization_id: str) -> dict:
    response = httpx.post(
        f"{settings.supabase_url}/rest/v1/rpc/begin_email_test_send",
        headers={"apikey": settings.supabase_publishable_key, "Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"p_organization_id": organization_id},
        timeout=10.0,
    )
    if response.status_code >= 400:
        try:
            body = response.json()
        except ValueError:
            body = {}
        code, message = body.get("code"), str(body.get("message") or "")
        if code == "42501":
            raise TestSendForbidden("You cannot send a test email for this business.")
        if code == "53400":
            raise TestSendLimited(message or "Too many test emails for now. Try again later.")
        if code == "55000":
            # The database's own sentence: what to set up before a test can be sent.
            raise TestSendRefused(message[:300])
        raise DomainError("The test email could not be started.")
    rows = response.json()
    if not rows:
        raise DomainError("The test email could not be started.")
    return rows[0]


def send_test_email(settings: ProviderOperationsSettings, *, token: str, organization_id: str) -> dict:
    if not organization_id:
        raise ValidationError("A business is required.")

    test = _begin(settings, token, organization_id)
    account = db.email_test_send_account(settings, organization_id=organization_id, test_id=test["id"])
    provider = tenant_email_for(account["provider_key"]) if account["state"] == "ready" and account.get("provider_key") else None
    credential = db.read_provider_account_credential(settings, account_id=account["provider_account_id"]) if provider else None

    def finish(outcome: str, **kwargs) -> None:
        db.finish_email_test_send(settings, organization_id=organization_id, test_id=test["id"], outcome=outcome, **kwargs)

    if not provider or not credential or not credential.get("secret"):
        detail = account.get("detail") or "Email sending for this business's sender is unavailable on this platform right now."
        finish("failed", detail=detail)
        return {"state": "failed", "recipient": test["recipient"], "detail": detail}

    business = test.get("business_name") or "your business"
    result = provider.send_tenant_email(
        api_key=credential["secret"],
        idempotency_key=test["id"],
        sender=formataddr((test.get("from_name") or "", test["from_address"])),
        to=[test["recipient"]],
        subject=_subject(business),
        text=_text(business, test["from_address"]),
        html=None,
        in_reply_to=None,
        references=[],
        attachments=[],
        reply_to=test.get("reply_to"),
        tags=[{"name": "gildops_test_send", "value": test["id"]}],
    )
    if result["ok"]:
        finish("accepted", external_id=result["external_id"])
        return {"state": "sent", "recipient": test["recipient"], "detail": None}
    if result.get("uncertain") or result.get("retryable"):
        # Not retried here: a test is not worth risking a second copy. The record says so.
        finish("uncertain", detail=result["detail"])
        return {"state": "uncertain", "recipient": test["recipient"], "detail": result["detail"]}
    finish("rejected", detail=result["detail"])
    return {"state": "failed", "recipient": test["recipient"], "detail": result["detail"]}

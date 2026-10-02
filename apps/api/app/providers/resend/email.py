"""Email, behind the capability its Protocol names.

**One of two modules in this repository that knows this provider exists**, the other being the
registry that chooses it. No SDK, for the reason the Stripe adapter gives: what this needs is one
HTTPS call and a JSON body, both stable and specified.

**The body is sent exactly as it arrives.** No greeting, no signature, no footer, no HTML
wrapper — `constraints.md` forbids the platform putting words in a business's mouth, and an
email is the strongest case of that rule because it lands in somebody's inbox with the business's
name on it. Plain text is what the business wrote, so plain text is what goes.
"""

from __future__ import annotations

import httpx

from app.channels import Message, Sender, Sent

API = "https://api.resend.com/emails"


def resend_sender(*, api_key: str, sender: str) -> Sender:
    class _Sender:
        def send(self, message: Message) -> Sent:
            response = httpx.post(
                API,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    # The address is this deployment's, not this tenant's. A per-tenant sending
                    # identity means proving a domain per tenant, which is a real feature and a
                    # different one; until then the business's own name is in the words it wrote.
                    "from": sender,
                    "to": [message.recipient],
                    "subject": message.subject_line,
                    "text": message.body,
                },
                timeout=15.0,
            )

            if response.status_code >= 500:
                # Their problem and probably temporary. Raised, so the caller leaves the message
                # queued and tries again rather than recording a failure that was not one.
                raise RuntimeError(f"the mail provider answered {response.status_code}")

            if response.status_code >= 400:
                # A bad address, a rejected domain: something a business can see and fix, so it
                # is recorded rather than retried forever.
                return Sent(ok=False, detail=_reason(response))

            return Sent(ok=True)

    return _Sender()


def send_platform_email(*, api_key: str, sender: str, to: str, subject: str, text: str) -> dict:
    """GOLD's own transactional email -- an invitation, never a tenant's own message (the same
    split `resend_sender` above draws, one axis over). Returns Resend's own message id so a later
    webhook can be correlated back to this one send; `resend_sender`'s `Sent` carries none because
    no channel delivery needs that correlation today.

    **A 2xx with no message id is not a successful send.** Nothing could ever correlate a later
    `email.sent`/`email.bounced`/... callback back to it, which makes it operationally identical to
    a send that never reached Resend at all -- so it is refused here rather than recorded as `ok`
    with a null id (work order 1 closeout, section 6).

    Never raises for a provider refusal: `{"ok", "external_id", "detail"}` is the whole answer, so
    the caller can record what happened rather than lose it to an exception.
    """
    try:
        response = httpx.post(
            API,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"from": sender, "to": [to], "subject": subject, "text": text},
            timeout=15.0,
        )
    except httpx.HTTPError as failure:
        return {"ok": False, "external_id": None, "detail": f"Resend could not be reached: {type(failure).__name__}"}

    if response.status_code >= 400:
        return {"ok": False, "external_id": None, "detail": _reason(response)}

    try:
        body = response.json()
    except ValueError:
        body = {}
    message_id = body.get("id") if isinstance(body, dict) else None
    if not message_id:
        return {
            "ok": False,
            "external_id": None,
            "detail": "Resend answered with no message id, so this send cannot be correlated with its own delivery.",
        }
    return {"ok": True, "external_id": str(message_id), "detail": None}


def _reason(response: httpx.Response) -> str:
    """The provider's own words, kept short. Never our interpretation of them."""
    try:
        body = response.json()
    except ValueError:
        return f"refused with status {response.status_code}"

    message = body.get("message") or body.get("error")
    return str(message)[:500] if message else f"refused with status {response.status_code}"

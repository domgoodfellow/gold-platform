"""Email through Resend: GildOps' own transactional mail, and a business's own mail.

**One of the few modules in this repository that knows this provider exists**, alongside
`app.providers.providers`, which chooses it. No SDK, for the reason the Stripe adapter gives: what this needs is one
HTTPS call and a JSON body, both stable and specified.

**The body is sent exactly as it arrives.** No greeting, no signature, no footer, no HTML
wrapper — `docs/product.md` forbids the platform putting words in a business's mouth, and an
email is the strongest case of that rule because it lands in somebody's inbox with the business's
name on it. Plain text is what the business wrote, so plain text is what goes.
"""

from __future__ import annotations

import httpx

from app.providers.resend.base import api_base

API = f"{api_base()}/emails"


def send_platform_email(*, api_key: str, sender: str, to: str, subject: str, text: str) -> dict:
    """GOLD's own transactional email -- an invitation, never a tenant's own message (that is
    `send_tenant_email` below, from the business's own verified sender). Returns Resend's own
    message id so a later webhook can be correlated back to this one send.

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


def _name(response: httpx.Response) -> str | None:
    """The provider's own error name, when it gave one."""
    try:
        body = response.json()
    except ValueError:
        return None
    return str(body.get("name")) if isinstance(body, dict) and body.get("name") else None


def _reason(response: httpx.Response) -> str:
    """The provider's own words, kept short. Never our interpretation of them."""
    try:
        body = response.json()
    except ValueError:
        return f"refused with status {response.status_code}"

    message = body.get("message") or body.get("error")
    return str(message)[:500] if message else f"refused with status {response.status_code}"


# --- a business's own mail: send, confirm, and read what came back -----------------------------
#
# Everything below is a tenant's message to (or from) its own customers, never GildOps' own
# invitation. The caller above this file has already decided what may be sent and from where; these
# functions only speak the provider's protocol and return plain data.


def send_tenant_email(
    *,
    api_key: str,
    idempotency_key: str,
    sender: str,
    to: list[str],
    subject: str,
    text: str,
    html: str | None,
    in_reply_to: str | None,
    references: list[str],
    attachments: list[dict],
    timeout: float = 30.0,
    reply_to: str | None = None,
    tags: list[dict] | None = None,
) -> dict:
    """One tenant email. `{"ok", "external_id", "detail", "retryable"}` is the whole answer.

    `retryable` is true for anything that is the provider's or the network's problem rather than a
    statement about this message (unreachable, a 5xx, a rate limit) -- the caller puts the message
    back in the queue instead of recording a failure that was not one. The idempotency key is the
    message's own id, so a retry the provider already saw is the same send, not a second one.
    """
    headers: dict[str, str] = {}
    if in_reply_to:
        headers["In-Reply-To"] = in_reply_to
    if references:
        headers["References"] = " ".join(references)

    body: dict = {"from": sender, "to": to, "subject": subject, "text": text}
    if html:
        body["html"] = html
    if headers:
        body["headers"] = headers
    if attachments:
        body["attachments"] = attachments
    if reply_to:
        body["reply_to"] = reply_to
    if tags:
        # Echoed back on every delivery report, so a report can name the send it is about even
        # when the answer to the send itself was lost.
        body["tags"] = tags

    try:
        response = httpx.post(
            API,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Idempotency-Key": idempotency_key[:256],
            },
            json=body,
            timeout=timeout,
        )
    except httpx.HTTPError as failure:
        return {"ok": False, "external_id": None, "retryable": True, "detail": f"The mail provider could not be reached: {type(failure).__name__}"}

    if response.status_code >= 500 or response.status_code == 429:
        return {"ok": False, "external_id": None, "retryable": True, "detail": _reason(response)}
    if response.status_code == 409:
        # The idempotency key answered, not the message. Another attempt with this key is still in
        # flight (try again shortly), or this key was already used for a different request, which
        # means an earlier attempt may have been sent: uncertain, never a refusal to resend.
        concurrent = _name(response) == "concurrent_idempotent_requests"
        return {"ok": False, "external_id": None, "retryable": concurrent, "uncertain": not concurrent, "detail": _reason(response)}
    if response.status_code >= 400:
        return {"ok": False, "external_id": None, "retryable": False, "detail": _reason(response)}

    try:
        answer = response.json()
    except ValueError:
        answer = {}
    message_id = answer.get("id") if isinstance(answer, dict) else None
    if not message_id:
        # Accepted but uncorrelatable: nothing could ever tie a later delivery event to it, which
        # is operationally the same as it never having been sent.
        return {"ok": False, "external_id": None, "retryable": False, "detail": "The provider answered with no message id, so this send cannot be followed."}
    return {"ok": True, "external_id": str(message_id), "retryable": False, "detail": None}


def confirmed_message_id(*, api_key: str, email_id: str) -> str | None:
    """The RFC Message-ID the provider *actually* gave a sent email, or `None` when it will not say.

    A reply threads against this, so it is read back rather than assumed: whatever this platform
    might have asked for, only the provider knows what went on the wire.
    """
    try:
        response = httpx.get(f"{API}/{email_id}", headers={"Authorization": f"Bearer {api_key}"}, timeout=10.0)
    except httpx.HTTPError:
        return None
    if response.status_code >= 400:
        return None
    try:
        answer = response.json()
    except ValueError:
        return None
    value = answer.get("message_id") if isinstance(answer, dict) else None
    return str(value) if value else None


def _header(headers: object, name: str) -> str | None:
    """One header from whichever shape the provider returned (an object, or a list of name/value)."""
    wanted = name.lower()
    if isinstance(headers, dict):
        for key, value in headers.items():
            if str(key).lower() == wanted:
                return str(value) if value is not None else None
    if isinstance(headers, list):
        for entry in headers:
            if isinstance(entry, dict) and str(entry.get("name", "")).lower() == wanted:
                value = entry.get("value")
                return str(value) if value is not None else None
    return None


def fetch_received_email(*, api_key: str, email_id: str) -> dict | None:
    """The body and threading headers of a received email -- the webhook carries metadata only.

    Plain data out, never the provider's raw answer: text, html, the Message-ID, the headers that
    thread a reply, and what the provider says about the sender's authentication.
    """
    try:
        response = httpx.get(f"{API}/receiving/{email_id}", headers={"Authorization": f"Bearer {api_key}"}, timeout=20.0)
    except httpx.HTTPError:
        return None
    if response.status_code >= 400:
        return None
    try:
        answer = response.json()
    except ValueError:
        return None
    if not isinstance(answer, dict):
        return None

    headers = answer.get("headers")
    references = (_header(headers, "References") or "").split()
    return {
        "text": answer.get("text") if isinstance(answer.get("text"), str) else "",
        "html": answer.get("html") if isinstance(answer.get("html"), str) else None,
        "message_id": answer.get("message_id") or _header(headers, "Message-ID"),
        "in_reply_to": _header(headers, "In-Reply-To"),
        "references": references,
        "authentication": answer.get("authentication") if isinstance(answer.get("authentication"), dict) else None,
    }


def list_received_attachments(*, api_key: str, email_id: str) -> list[dict]:
    """The attachments of a received email, each with a short-lived link to fetch it from.

    The link is returned so the caller can fetch the bytes once and keep them; it is never stored.
    """
    try:
        response = httpx.get(f"{API}/receiving/{email_id}/attachments", headers={"Authorization": f"Bearer {api_key}"}, timeout=20.0)
    except httpx.HTTPError:
        return []
    if response.status_code >= 400:
        return []
    try:
        answer = response.json()
    except ValueError:
        return []
    rows = answer.get("data") if isinstance(answer, dict) else None
    return [row for row in (rows or []) if isinstance(row, dict) and row.get("id")]


def download_attachment(url: str, *, max_bytes: int) -> bytes | None:
    """The bytes behind a provider link, or `None` when they exceed `max_bytes` or cannot be had.

    Streamed and cut off at the limit, so a hostile attachment cannot make this runtime hold an
    unbounded body in memory.
    """
    try:
        with httpx.stream("GET", url, timeout=30.0, follow_redirects=False) as response:
            if response.status_code >= 400:
                return None
            data = bytearray()
            for chunk in response.iter_bytes():
                data.extend(chunk)
                if len(data) > max_bytes:
                    return None
            return bytes(data)
    except httpx.HTTPError:
        return None

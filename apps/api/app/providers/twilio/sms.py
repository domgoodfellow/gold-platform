"""Text messages, behind the capability its Protocol names.

The same shape as the email sender and the same rules: no SDK, one HTTPS call, and the body
goes exactly as the business wrote it. A text message has no subject line, so there is nowhere
for one to go and nothing is invented to fill the gap.
"""

from __future__ import annotations

import httpx

from app.channels import Message, Sender, Sent

API = "https://api.twilio.com/2010-04-01/Accounts/{account}/Messages.json"


def twilio_sender(*, account: str, token: str, number: str) -> Sender:
    class _Sender:
        def send(self, message: Message) -> Sent:
            response = httpx.post(
                API.format(account=account),
                auth=(account, token),
                data={
                    "From": number,
                    "To": message.recipient,
                    # The subject line is deliberately dropped rather than prefixed onto the
                    # body. A business writing one for email and reusing the template for text
                    # gets its message, not its message with a heading glued on.
                    "Body": message.body,
                },
                timeout=15.0,
            )

            if response.status_code >= 500:
                raise RuntimeError(f"the message provider answered {response.status_code}")

            if response.status_code >= 400:
                return Sent(ok=False, detail=_reason(response))

            return Sent(ok=True)

    return _Sender()


def _reason(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return f"refused with status {response.status_code}"

    message = body.get("message")
    return str(message)[:500] if message else f"refused with status {response.status_code}"


# --- the carrier's delivery vocabulary, translated at this boundary ---------------------------------------
#
# Everything above this file speaks GildOps' own statuses (`queued`, `sending`, `sent`, `delivered`,
# `read`, `failed`, `undelivered`); the carrier's words stop here. A word this platform has no meaning for
# (`receiving`, `received`) is `None` and the callback is acknowledged without being acted on.
_STATUS = {
    "accepted": "queued",
    "scheduled": "queued",
    "queued": "queued",
    "sending": "sending",
    "sent": "sent",
    "delivered": "delivered",
    "read": "read",
    "undelivered": "undelivered",
    "failed": "failed",
    "canceled": "failed",
}

# What a person is told, in words, for the carrier's most common delivery errors. The code itself is
# diagnostics and stays out of what a business reads.
_FAILURE_WORDS = {
    "30003": "The phone could not be reached.",
    "30004": "The recipient has blocked messages from this number.",
    "30005": "That number does not exist or cannot receive texts.",
    "30006": "That number is a landline or cannot receive texts.",
    "30007": "The carrier filtered this message.",
    "30008": "The carrier could not deliver this message.",
}


def normalize_status(raw: str | None) -> str | None:
    return _STATUS.get((raw or "").strip().lower())


def failure_reason(error_code: str | None) -> str:
    return _FAILURE_WORDS.get((error_code or "").strip(), "The carrier could not deliver this message.")

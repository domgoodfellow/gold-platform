"""Which implementation this deployment uses for each channel.

**The only module outside an implementation that names a provider**, which is the same split
`apps/web/lib/adapters/payments/registry.ts` makes and for the reason recorded there: a contract
that names a vendor is a contract shaped by one.

`None` for a channel this deployment cannot send on, rather than a throw. A business that
writes a text-message rule on a deployment without text messaging gets a failed delivery saying
so, rather than silence (the no-dead-end rule, `docs/ui-system.md`).

**There is no email channel here, deliberately.** A business's email is sent from its own verified
sender, through the provider account that holds that sender's domain
(`app.organization_email_sender`, used by `api/automation_tick.py`), never from one address this
deployment holds for everybody.
"""

from __future__ import annotations

import os

from app.channels import Sender


def sender_for(channel: str) -> Sender | None:
    if channel == "sms":
        account = os.environ.get("TWILIO_ACCOUNT_SID")
        token = os.environ.get("TWILIO_AUTH_TOKEN")
        number = os.environ.get("MESSAGE_FROM_NUMBER")
        if not account or not token or not number:
            return None
        from app.providers.twilio.sms import twilio_sender

        return twilio_sender(account=account, token=token, number=number)

    return None


def unconfigured_reason(channel: str) -> str:
    """What to record when there is nobody to send with.

    A sentence for an operator on the Automations screen, not for a customer. It says whose
    problem it is: not this business's, and not fixable from inside the application.
    """
    return f"this deployment cannot send {channel} messages yet"

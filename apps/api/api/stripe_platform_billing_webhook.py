"""GOLD's own billing account calling in.

**Not the tenant-payment webhook.** `stripe_webhook.py` verifies a customer paying a tenant
through the tenant's own connected account. This is the opposite money direction: an
organization paying GOLD, on GOLD's own Stripe account (`domain-model.md`'s two-plane table).
Its own destination, its own `STRIPE_PLATFORM_BILLING_WEBHOOK_SECRET`, its own Postgres role
(`platform_billing_webhook`) — see `20260922000004_gold_bills_the_organization_its_own_subscription.sql`
and `app.providers.stripe.platform_billing_webhook` for why the two are never folded together.

**The same three refusals that must not be distinguishable to a caller**, restated from
`stripe_webhook.py`: a bad signature, a body that is not JSON, and an event about nothing all
produce the same terse answer.

Vercel's Python runtime routes a file under `api/` to a path. One file, one route, one
thing it may do.
"""

from __future__ import annotations

import time
from http.server import BaseHTTPRequestHandler

from app.core.config import load_platform_billing_settings
from app.core.db import apply_platform_subscription_event, record_platform_billing_notice
from app.providers.stripe.platform_billing_webhook import NoticeEvent, SubscriptionEvent, parse


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_platform_billing_settings()
        if settings is None:
            # Nothing configured. A deployment with no GOLD subscription webhook wired up yet
            # has no processor to hear from, and 404 is the honest answer: this endpoint does
            # not exist here.
            self._reply(404, "not found")
            return

        # The **raw** body, read once and never parsed first — a signature is over bytes.
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length).decode("utf-8", errors="replace")

        try:
            parsed = parse(
                body=body,
                signature=self.headers.get("stripe-signature"),
                signing_secret=settings.signing_secret,
                now=int(time.time()),
            )
        except (ValueError, UnicodeError):
            self._reply(400, "rejected")
            return

        if parsed is None:
            # A genuine event this platform does not act on, or one whose shape it could not
            # read. 200, so the processor stops retrying something that was never going to be
            # recorded.
            self._reply(200, "ignored")
            return

        if isinstance(parsed, SubscriptionEvent):
            result = apply_platform_subscription_event(settings, event=parsed)
        elif isinstance(parsed, NoticeEvent):
            result = record_platform_billing_notice(settings, event=parsed)
        else:
            result = None

        # None covers an event about a customer this platform never provisioned, and one already
        # applied. Both are a 200: retrying changes neither answer.
        self._reply(200, "recorded" if result else "unknown")

    def _reply(self, status: int, message: str) -> None:
        payload = message.encode()
        self.send_response(status)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

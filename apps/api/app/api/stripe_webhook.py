"""The processor calling in.

**The first request this platform serves with no human behind it.** Everything interesting
about it is elsewhere by design: the signature check is the integration's, because "did this
really come from the provider" is the one entirely provider-specific question; the write is one
SECURITY DEFINER function that derives every consequential value itself; and the authority it
writes with is a Postgres role holding no table grant at all. What is left here is routing and
status codes.

**Three refusals that must not be distinguishable to a caller.** A bad signature, a body that
is not JSON, and an event about nothing all produce the same terse answer. A handler that said
which one would be a handler that helps somebody find the third.

Vercel's Python runtime routes a file under `api/` to a path (D24). No framework and no router:
one file, one route, one thing it may do.
"""

from __future__ import annotations

import time
from http.server import BaseHTTPRequestHandler

from app.core.config import load_settings
from app.core.db import record_provider_payment
from app.integrations.stripe.webhook import settlement


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_settings()
        if settings is None:
            # Nothing configured. A deployment that takes only cash has no processor to hear
            # from, and 404 is the honest answer: this endpoint does not exist here.
            self._reply(404, "not found")
            return

        # The **raw** body, read once and never parsed first. A signature is over bytes, so
        # anything that re-serialises before verifying is checking a signature against a body
        # the sender did not send.
        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length).decode("utf-8", errors="replace")

        try:
            payment = settlement(
                body=body,
                signature=self.headers.get("stripe-signature"),
                signing_secret=settings.stripe_signing_secret,
                now=int(time.time()),
            )
        except (ValueError, UnicodeError):
            # Unverified, or unparseable. 400 and nothing else: no detail, no echo.
            self._reply(400, "rejected")
            return

        if payment is None:
            # A genuine event this platform does not act on. 200, so the processor stops
            # retrying something that was never going to be recorded.
            self._reply(200, "ignored")
            return

        recorded = record_provider_payment(
            settings,
            request_id=payment.request_id,
            provider=payment.provider,
            provider_reference=payment.provider_reference,
            amount_minor=payment.amount_minor,
        )

        # None is a verified payment against a request this platform has no record of asking
        # for. Also 200, and for the same reason.
        self._reply(200, "recorded" if recorded else "unknown")

    def _reply(self, status: int, message: str) -> None:
        payload = message.encode()
        self.send_response(status)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

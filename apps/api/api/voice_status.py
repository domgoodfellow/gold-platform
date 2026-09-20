"""The carrier reporting what happened to a call.

**The endpoint that finishes a row nobody could finish before.** Until this existed a call
recorded whatever status the carrier returned at the instant of asking -- always *ringing* --
and stayed that way, with its duration typed in by a person if at all.

**Three refusals that must not be distinguishable**, exactly as the payment webhook has it: an
unsigned request, an unparseable one, and one about a call this platform never placed all get
the same terse answer. A handler that said which would help somebody find the third.

Vercel's Python runtime routes a file under `api/` to a path (D24). No framework, no router:
one file, one route, one thing it may do.
"""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs

from app.core.config import load_voice_settings
from app.core.db import record_call_event
from app.providers.twilio.voice import payload_hash, status_report, verify_signature


def form_params(body: str) -> dict[str, str]:
    """The carrier posts form-encoded, and signs the parameters rather than the body.

    Last value wins for a repeated key, which is what their signature scheme assumes.
    """
    return {key: values[-1] for key, values in parse_qs(body, keep_blank_values=True).items()}


def public_url(headers, path: str) -> str:
    """The URL the carrier says it called, rebuilt.

    **Taken from the proxy's own headers rather than from configuration**, because the signature
    is over the address they used and a deployment behind a load balancer does not see it any
    other way. A mismatch here fails the signature check, which is the correct outcome: if this
    cannot reconstruct what was signed, it cannot verify anything.
    """
    host = headers.get("x-forwarded-host") or headers.get("host") or ""
    scheme = headers.get("x-forwarded-proto") or "https"
    return f"{scheme}://{host}{path}"


class handler(BaseHTTPRequestHandler):  # noqa: N801 - Vercel requires this name
    def do_POST(self) -> None:  # noqa: N802 - the base class defines the interface
        settings = load_voice_settings()
        if settings is None:
            # Nothing configured. A deployment with no telephone has no carrier to hear from,
            # and 404 is the honest answer: this endpoint does not exist here.
            self._reply(404, "not found")
            return

        length = int(self.headers.get("content-length") or 0)
        body = self.rfile.read(length).decode("utf-8", errors="replace")
        params = form_params(body)

        if not verify_signature(
            url=public_url(self.headers, self.path),
            params=params,
            signature=self.headers.get("x-twilio-signature"),
            auth_token=settings.twilio_auth_token,
        ):
            self._reply(403, "rejected")
            return

        report = status_report(params)
        if report is None:
            # Verified, and about nothing this platform stores. 200 so the carrier stops
            # retrying something that was never going to be recorded.
            self._reply(200, "ignored")
            return

        recorded = record_call_event(
            settings,
            external_id=report.external_id,
            source=report.source,
            raw_status=report.raw_status,
            status=report.status,
            duration_seconds=report.duration_seconds,
            recording_url=None,
            payload=params,
            payload_hash=payload_hash(params),
        )

        # None is either a call this deployment has no record of or an event already applied.
        # Both are 200 and neither is distinguishable, which is what makes a retry harmless.
        self._reply(200, "recorded" if recorded else "ignored")

    def _reply(self, status: int, message: str) -> None:
        payload = message.encode()
        self.send_response(status)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

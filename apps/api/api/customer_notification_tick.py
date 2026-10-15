"""Scheduled delivery of explicitly requested customer service notifications."""
import hmac
import json
import os
from http.server import BaseHTTPRequestHandler

from app.core.config import load_provider_operations_settings
from app.services.tenant_email.notifications import drain_notifications


class handler(BaseHTTPRequestHandler):  # noqa: N801
    def do_GET(self):  # noqa: N802
        settings = load_provider_operations_settings()
        secret = os.environ.get("CRON_SECRET")
        if not settings or not secret:
            self._reply(404, {"error": "not found"})
            return
        if not hmac.compare_digest(self.headers.get("authorization", ""), f"Bearer {secret}"):
            self._reply(401, {"error": "rejected"})
            return
        try:
            self._reply(200, drain_notifications(settings, limit=5))
        except Exception:
            self._reply(503, {"error": "Notification worker unavailable"})

    def _reply(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(body).encode())

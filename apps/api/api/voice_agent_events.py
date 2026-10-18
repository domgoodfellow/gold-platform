"""Signed callbacks from the external voice-agent project; no tenant credentials."""
import json
from http.server import BaseHTTPRequestHandler
from app.core.config import load_voice_settings
from app.services.communications.voice_agent import receive_voice_event


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        settings = load_voice_settings()
        size = int(self.headers.get('content-length') or 0)
        if not settings or not 0 < size <= 65536:
            self.send_error(400)
            return
        body = self.rfile.read(size)
        try:
            payload = json.loads(body)
            accepted = receive_voice_event(settings, payload=payload, body=body, timestamp=self.headers.get('x-voice-timestamp'), signature=self.headers.get('x-voice-signature'))
        except (KeyError, ValueError, TypeError):
            self.send_error(400)
            return
        except Exception:
            self.send_error(503)
            return
        self.send_response(204 if accepted else 403)
        self.end_headers()

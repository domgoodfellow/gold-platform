"""Signed inbound calling through the canonical organization routing resolver."""
from __future__ import annotations
import logging
import os
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlsplit
from api.voice_status import form_params, public_url
from app.core.config import load_voice_settings
from app.core.db import record_call_event
from app.services.communications.inbound import inbound_response, REJECT
from app.providers.twilio.voice import payload_hash, verify_signature

logger = logging.getLogger(__name__)

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        settings = load_voice_settings()
        account = os.environ.get('TWILIO_ACCOUNT_SID')
        if settings is None or not account:
            self._reply(404, 'not found')
            return
        length = int(self.headers.get('content-length') or 0)
        if length > 65536:
            self._reply(413, 'rejected')
            return
        params = form_params(self.rfile.read(length).decode('utf-8', errors='replace'))
        if params.get('AccountSid') != account or not verify_signature(url=public_url(self.headers, self.path), params=params, signature=self.headers.get('x-twilio-signature'), auth_token=settings.twilio_auth_token):
            self._reply(403, 'rejected')
            return
        stage = parse_qs(urlsplit(self.path).query).get('stage', [''])[0]
        status = params.get('DialCallStatus')
        completed = status == 'completed'
        try:
            if stage == 'agent-ended':
                from app.core.caller import call_command
                from app.core.db import machine_token, VOICE_ROLE, VOICE_ACTOR
                state = call_command(settings, token=machine_token(settings.supabase_jwt_secret, role=VOICE_ROLE, sub=VOICE_ACTOR), function='inbound_voice_agent_state', arguments={'external_id':params.get('CallSid',''),'account_sid':params.get('AccountSid','')})
                completed = state == 'ended'
                stage = 'fallback'
            if completed:
                response = '<Response><Hangup/></Response>'
            else:
                response = inbound_response(settings, params, public_url(self.headers, '/voice/inbound'), fallback=stage == 'fallback', final=stage == 'final')
            if completed or response == REJECT:
                duration = params.get('DialCallDuration', '')
                record_call_event(settings, external_id=params.get('CallSid', ''), source='status', raw_status=status or 'no-answer', status='completed' if completed else 'no_answer', duration_seconds=int(duration) if duration.isdigit() else None, recording_url=None, payload=params, payload_hash=payload_hash(params))
            self._reply(200, response)
        except Exception:
            logger.exception('Inbound routing failed')
            # Retry the signed request; returning success here would permanently discard it.
            self._reply(503, REJECT)

    def _reply(self, status, message):
        payload = message.encode()
        self.send_response(status)
        self.send_header('content-type', 'application/xml; charset=utf-8')
        self.send_header('content-length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

"""A public assistant deployment uses the same AI loop as the operator rail."""
from __future__ import annotations
import json, os
from http.server import BaseHTTPRequestHandler
from app.ai.actions import PUBLIC_ACTIONS
from app.ai.loop import answer
from app.ai.registry import answering_provider
from app.core.config import load_assistant_settings

class handler(BaseHTTPRequestHandler):  # noqa: N801
    def do_POST(self) -> None:  # noqa: N802
        settings = load_assistant_settings()
        secret = os.environ.get('PUBLIC_CHAT_API_SECRET')
        if self.headers.get('x-gold-public-chat-key') != secret or not secret or settings is None:
            self._reply(404, {'error': 'not found'}); return
        provider = answering_provider()
        if provider is None: self._reply(503, {'error': 'public AI is unavailable'}); return
        try:
            body=json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
            message=str(body.get('message') or '').strip(); instructions=str(body.get('instructions') or '').strip()
            deployment_id=str(body.get('deploymentId') or '').strip(); organization_id=str(body.get('organizationId') or '').strip()
            if not message or len(message)>2000 or len(instructions)>8000 or not deployment_id or not organization_id: raise ValueError
            given=answer(settings,provider,question=message,token='',organization_id=organization_id,context="PUBLIC WEBSITE DEPLOYMENT\n" + instructions,tools=(),actions=PUBLIC_ACTIONS)
            self._reply(200,{'answer':given.text[:4000] or 'Please contact the team for help.','handoff':bool(given.action and given.action.name=='escalate_to_human')})
        except Exception: self._reply(400,{'error':'request rejected'})
    def _reply(self,status:int,body:dict)->None:
        payload=json.dumps(body).encode(); self.send_response(status); self.send_header('content-type','application/json; charset=utf-8'); self.send_header('content-length',str(len(payload))); self.end_headers(); self.wfile.write(payload)

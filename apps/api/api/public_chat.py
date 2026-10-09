"""A public assistant deployment uses the same AI loop as the operator rail.

**The request names a deployment and a message, and nothing else.** The business, the instructions
its owner wrote and whether it holds the Agent are all read from the database by the deployment's
id (`resolve_public_assistant`). A request that could name its own organization or carry its own
instructions would be telling this runtime who to spend on and what to believe, on the strength of
a shared secret that proves who is calling and nothing about what they sent (D17, D22).
"""
from __future__ import annotations
import json, os
from http.server import BaseHTTPRequestHandler
from app.ai.actions import PUBLIC_ACTIONS
from app.ai import PriorTurn
from app.ai.loop import answer
from app.ai.metering import meter
from app.ai.runtime import PUBLIC_ASSISTANT, resolve_provider
from app.ai.public_reply import record_public_reply
from app.core.config import load_assistant_settings, load_provider_operations_settings
from app.core.db import resolve_public_assistant

class handler(BaseHTTPRequestHandler):  # noqa: N801
    def do_POST(self) -> None:  # noqa: N802
        settings = load_assistant_settings()
        secret = os.environ.get('PUBLIC_CHAT_API_SECRET')
        if self.headers.get('x-gold-public-chat-key') != secret or not secret or settings is None:
            self._reply(404, {'error': 'not found'}); return
        # Without the machine role there is no way to learn which business a deployment is, or
        # whether it holds the Agent, so there is nothing safe to answer with.
        operations = load_provider_operations_settings()
        if operations is None:
            self._reply(503, {'error': 'public AI is unavailable'}); return
        try:
            body=json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
            message=str(body.get('message') or '').strip()
            deployment_id=str(body.get('deploymentId') or '').strip()
            if not message or len(message)>2000 or not deployment_id: raise ValueError
        except Exception:
            self._reply(400, {'error': 'request rejected'}); return
        try:
            deployment = resolve_public_assistant(operations, deployment_id=deployment_id, **({'visitor_key': str(body['visitorKey'])} if body.get('visitorKey') else {}))
        except Exception:
            # Includes a deployment id that is not a uuid, which PostgREST refuses.
            self._reply(400, {'error': 'request rejected'}); return
        if deployment is None:
            self._reply(404, {'error': 'not found'}); return
        if not deployment['entitled']:
            self._reply(403, {'error': 'this business does not have the Agent', 'code': 'not_entitled'}); return
        if deployment.get('handoff'):
            self._reply(200, {'answer': deployment.get('handoff_message') or 'Your request is with the team.', 'handoff': True}); return
        try:
            provider = resolve_provider(operations, capability=PUBLIC_ASSISTANT)
        except RuntimeError:
            self._reply(503, {'error': 'public AI is unavailable'}); return
        if provider is None: self._reply(503, {'error': 'public AI is unavailable'}); return
        try:
            history = tuple(PriorTurn(question=t['question'], answer=t.get('answer') or '') for t in deployment.get('history', []) if t.get('question'))
            given=answer(settings,provider,question=message,token='',organization_id=deployment['organization_id'],instructions=deployment['instructions'] or '',audience='public',tools=(),actions=PUBLIC_ACTIONS,prior_turns=history)
            meter(operations, organization_id=deployment['organization_id'], capability=PUBLIC_ASSISTANT, provider_key=provider.provider_key, given=given)
            if body.get('visitorKey'):
                record_public_reply(operations, site_id=deployment['site_id'], visitor_key=str(body['visitorKey']), text=given.text[:4000] or 'Please contact the team for help.', handoff=bool(given.action and given.action.name=='escalate_to_human'))
            self._reply(200,{'answer':given.text[:4000] or 'Please contact the team for help.','handoff':bool(given.action and given.action.name=='escalate_to_human')})
        except Exception: self._reply(400,{'error':'request rejected'})
    def _reply(self,status:int,body:dict)->None:
        payload=json.dumps(body).encode(); self.send_response(status); self.send_header('content-type','application/json; charset=utf-8'); self.send_header('content-length',str(len(payload))); self.end_headers(); self.wfile.write(payload)

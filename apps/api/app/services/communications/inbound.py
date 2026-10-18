"""Execute the canonical resolver against a machine-authorized, call-bound snapshot."""
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import urlencode

from app.core.caller import call_command
from app.core.db import VOICE_ACTOR, VOICE_ROLE, machine_token
from app.domains.communications.routing import resolve_inbound_route, resolve_inbound_fallback
from app.providers.twilio.voice import dial_route_twiml, say_and_hang_up

REJECT = '<Response><Reject reason="busy"/></Response>'


@dataclass
class InboundSnapshot:
    supabase_url: str
    supabase_publishable_key: str
    context: dict

    def routing_read(self, table, params):
        rows = self.context.get(table, [])
        for key, value in params.items():
            if value.startswith('eq.'):
                rows = [row for row in rows if str(row.get(key)) == value[3:]]
            elif value == 'is.null':
                rows = [row for row in rows if row.get(key) is None]
            elif value.startswith('in.('):
                values = value[4:-1].split(',')
                rows = [row for row in rows if str(row.get(key)) in values]
        return rows[:int(params.get('limit', len(rows)))]

    def routing_command(self, token, function, arguments):
        if function == 'organization_open_now':
            return self.context['open_now']
        if function == 'advance_route_round_robin':
            return call_command(self, token=token, function='claim_inbound_route_cursor', arguments={'call_id': self.context['call_id'], 'route_id': arguments['route_id']})
        raise ValueError('Unsupported inbound routing command')


def inbound_response(settings, params, callback_url, *, fallback=False, final=False):
    token = machine_token(settings.supabase_jwt_secret, role=VOICE_ROLE, sub=VOICE_ACTOR)
    context = call_command(settings, token=token, function='refresh_inbound_routing', arguments={
        'external_id': params.get('CallSid', ''), 'to_number': params.get('To', ''),
        'from_number': params.get('From', ''), 'account_sid': params.get('AccountSid', ''),
    })
    if not context or final:
        return REJECT
    snapshot = InboundSnapshot(settings.supabase_url, settings.supabase_publishable_key, context)
    arguments = dict(token=token, organization_id=context['organization_id'], number_id=context['number_id'], from_number=params.get('From'), at=datetime.now(timezone.utc))
    primary = resolve_inbound_route(snapshot, **arguments)
    decision = resolve_inbound_fallback(snapshot, **arguments, route_id=primary.route_id) if fallback else primary
    if decision.target_type == 'ai_receptionist':
        from app.services.communications.voice_agent import connect_voice_agent
        try:
            response = connect_voice_agent(settings, call_id=context['call_id'], route_id=decision.route_id, callback_url=callback_url.replace('/voice/inbound', '/voice/agent/events'))
        except Exception:
            response = None
        if response:
            return response
        decision = resolve_inbound_fallback(snapshot, **arguments, route_id=decision.route_id)
        if decision.target_type == 'ai_receptionist':
            return REJECT
    if decision.target_type in ('members', 'external_number'):
        action = callback_url + '?' + urlencode({'stage': 'final' if fallback or decision.fallback_used else 'fallback'})
        return dial_route_twiml(decision, action=action)
    route = next((r for r in context['communication_routes'] if r['id'] == decision.route_id), {})
    message = route.get('fallback_message')
    return say_and_hang_up(message) if message and decision.target_type == 'voicemail' else REJECT

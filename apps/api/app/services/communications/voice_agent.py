from app.core.caller import call_command
from app.core.db import machine_token, PROVIDER_ROLE, PROVIDER_ACTOR, read_provider_account_credential
from app.providers.voice_agent.sessions import start_session, verify_event
from app.providers.twilio.voice import voice_stream_twiml


def command(settings, function, arguments):
    token = machine_token(settings.supabase_jwt_secret, role=PROVIDER_ROLE, sub=PROVIDER_ACTOR)
    return call_command(settings, token=token, function=function, arguments=arguments)


def connect_voice_agent(settings, *, call_id, route_id, callback_url):
    session = command(settings, 'admit_voice_agent_session', {'call_id': call_id, 'route_id': route_id})
    if not session or session['state'] in ('ended', 'failed', 'uncertain'):
        return None
    if session.get('connection_url'):
        return voice_stream_twiml(session['connection_url'], session['id'], callback_url.replace('/voice/agent/events','/voice/inbound?stage=agent-ended'))
    try:
        credential = read_provider_account_credential(settings, account_id=session['provider_account_id'])
        if not credential:
            command(settings, 'mark_voice_agent_uncertain', {'call_id': call_id})
            return None
        remote, connection = start_session(secret=credential['secret'], session=session, callback_url=callback_url)
        command(settings, 'bind_voice_agent_session', {'session_id': session['id'], 'external_id': remote, 'connection_url': connection})
        return voice_stream_twiml(connection, session['id'], callback_url.replace('/voice/agent/events','/voice/inbound?stage=agent-ended'))
    except Exception:
        command(settings, 'mark_voice_agent_uncertain', {'call_id': call_id})
        return None



def receive_voice_event(settings, *, payload, body, timestamp, signature):
    session = command(settings, 'voice_agent_session_context', {'session_id': payload['session_id']})
    if not session:
        return False
    credential = read_provider_account_credential(settings, account_id=session['provider_account_id'])
    if not credential or not verify_event(secret=credential['secret'], body=body, timestamp=timestamp, signature=signature):
        return False
    if payload.get('organization_id') != session['organization_id'] or payload.get('call_id') != session['call_id']:
        return False
    for key in ('duration_seconds', 'input_tokens', 'output_tokens'):
        if payload.get(key) is not None and (type(payload[key]) is not int or payload[key] < 0):
            raise ValueError('Invalid reported usage')
    command(settings, 'record_voice_agent_event', {'session_id': session['id'], 'event_id': payload['event_id'], 'external_id': payload['external_session_id'], 'type': payload['type'], 'seconds': payload.get('duration_seconds'), 'input_tokens': payload.get('input_tokens'), 'output_tokens': payload.get('output_tokens')})
    if payload['type'] == 'transfer_requested':
        import os
        from types import SimpleNamespace
        from app.providers.twilio.voice import dial_route_twiml, redirect_inbound_call
        target = command(settings, 'claim_voice_agent_transfer', {'session_id': session['id']})
        if target:
            if target['account_sid'] != os.environ.get('TWILIO_ACCOUNT_SID'):
                raise ValueError('Carrier account mismatch')
            callback = os.environ.get('TELEPHONY_CALLBACK_URL', '').rstrip('/')
            if not callback.startswith('https://'):
                raise ValueError('Carrier callback unavailable')
            decision = SimpleNamespace(target_type='members', member_ids=target['member_ids'], external_number=None, ring_strategy='everyone', ring_timeout_seconds=20)
            redirect_inbound_call(account_sid=target['account_sid'], auth_token=settings.twilio_auth_token, external_id=target['external_id'], twiml=dial_route_twiml(decision, action=callback + '/voice/inbound?stage=final'))
    return True

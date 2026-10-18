import hashlib
import hmac
from types import SimpleNamespace
from xml.etree.ElementTree import fromstring
import pytest
from app.services.communications import inbound, voice_agent
from app.providers.voice_agent.sessions import verify_event, start_session
from app.providers.twilio.voice import dial_route_twiml


def test_snapshot_applies_tenant_and_null_filters():
    snapshot = inbound.InboundSnapshot('db', 'key', {'communication_routes': [{'id':'a','organization_id':'one','number_id':None},{'id':'b','organization_id':'two','number_id':None}]})
    assert [r['id'] for r in snapshot.routing_read('communication_routes', {'organization_id':'eq.one','number_id':'is.null','select':'*'})] == ['a']


def test_dial_preserves_membership_identity_and_escapes_xml():
    decision=SimpleNamespace(target_type='members',member_ids=['member&one','member-two'],external_number=None,ring_strategy='sequential',ring_timeout_seconds=25)
    root=fromstring(dial_route_twiml(decision,action='https://example.test/voice/inbound?stage=fallback&x=1'))
    assert root.find('Dial').attrib['sequential']=='true'
    assert [x.text for x in root.findall('Dial/Client/Identity')]==decision.member_ids
    assert root.find('Dial').attrib['record']=='do-not-record'


def test_provider_signature_covers_raw_body_and_expires():
    body=b'{"event_id":"one"}'
    signature=hmac.new(b'test-secret',b'1000.'+body,hashlib.sha256).hexdigest()
    assert verify_event(secret='test-secret',body=body,timestamp='1000',signature=signature,now=1001)
    assert not verify_event(secret='test-secret',body=body+b' ',timestamp='1000',signature=signature,now=1001)
    assert not verify_event(secret='test-secret',body=body,timestamp='1000',signature=signature,now=1301)


def test_provider_session_refuses_untrusted_stream_origin(monkeypatch):
    monkeypatch.setenv('VOICE_AGENT_BASE_URL','https://voice.example.test')
    monkeypatch.setattr('app.providers.voice_agent.sessions.httpx.post',lambda *a,**k:SimpleNamespace(status_code=201,content=b'{}',json=lambda:{'session_id':'remote','connection_url':'wss://attacker.test/stream'}))
    with pytest.raises(RuntimeError,match='unauthorized'):
        start_session(secret='secret',session={'id':'id','organization_id':'org','call_id':'call','deployment_ref':'published','config_revision':1,'model':'voice','max_seconds':300},callback_url='https://app.test/events')


def test_foreign_business_event_cannot_write_usage(monkeypatch):
    calls=[]
    monkeypatch.setattr(voice_agent,'command',lambda s,f,a: calls.append(f) or {'id':'session','organization_id':'one','call_id':'call','provider_account_id':'account'})
    monkeypatch.setattr(voice_agent,'read_provider_account_credential',lambda *a,**k:{'secret':'secret'})
    monkeypatch.setattr(voice_agent,'verify_event',lambda **k:True)
    assert not voice_agent.receive_voice_event(None,payload={'session_id':'session','organization_id':'two','call_id':'call'},body=b'body',timestamp='1',signature='sig')
    assert calls==['voice_agent_session_context']


def test_usage_is_one_atomic_database_command(monkeypatch):
    calls=[]
    session={'id':'session','organization_id':'one','call_id':'call','provider_account_id':'account'}
    def command(s,f,a):
        calls.append((f,a))
        return session
    monkeypatch.setattr(voice_agent,'command',command)
    monkeypatch.setattr(voice_agent,'read_provider_account_credential',lambda *a,**k:{'secret':'secret'})
    monkeypatch.setattr(voice_agent,'verify_event',lambda **k:True)
    payload={'session_id':'session','organization_id':'one','call_id':'call','external_session_id':'remote','event_id':'event','type':'ended','duration_seconds':12,'input_tokens':20,'output_tokens':10}
    assert voice_agent.receive_voice_event(None,payload=payload,body=b'body',timestamp='1',signature='sig')
    assert [f for f,a in calls]==['voice_agent_session_context','record_voice_agent_event']
    assert calls[-1][1]['input_tokens']==20


def test_voice_failure_executes_business_human_fallback(monkeypatch):
    route={'id':'route','organization_id':'org','number_id':None,'enabled':True,'when_mode':'always','ring_strategy':'everyone','ring_timeout_seconds':20,'destination_type':'ai_receptionist','fallback_type':'members','callback_affinity_enabled':False}
    context={'call_id':'call','organization_id':'org','number_id':'number','open_now':True,'communication_routes':[route],'communication_route_targets':[{'route_id':'route','organization_id':'org','slot':'fallback','member_id':'member','position':0}],'memberships':[{'id':'member','organization_id':'org','role':{'capabilities':['call.place']}}]}
    monkeypatch.setattr(inbound,'call_command',lambda *a,**k:context)
    monkeypatch.setattr(inbound,'machine_token',lambda *a,**k:'machine')
    monkeypatch.setattr(voice_agent,'connect_voice_agent',lambda *a,**k:None)
    settings=SimpleNamespace(supabase_url='db',supabase_publishable_key='key',supabase_jwt_secret='signing')
    response=inbound.inbound_response(settings,{'CallSid':'carrier','To':'+14165550000','From':'+14165550111','AccountSid':'account'},'https://app.test/voice/inbound')
    assert fromstring(response).find('Dial/Client/Identity').text=='member'
    assert 'stage=final' in response


def test_voice_account_health_does_not_start_a_session(monkeypatch):
    from app.providers.voice_agent.accounts import verify
    requests=[]
    monkeypatch.setenv('VOICE_AGENT_BASE_URL','https://voice.test')
    def get(url,**kwargs):
        requests.append(url)
        return SimpleNamespace(status_code=200,content=b'{}',json=lambda:{'ready':True})
    monkeypatch.setattr('app.providers.voice_agent.accounts.httpx.get',get)
    assert verify({'secret':'test-key'})['ok']
    assert requests==['https://voice.test/health']


def test_uncertain_session_setup_is_visible_and_uses_fallback(monkeypatch):
    session={'id':'session','state':'preparing','provider_account_id':'account','organization_id':'org','call_id':'call'}
    writes=[]
    def command(settings,function,args):
        writes.append(function)
        return session if function=='admit_voice_agent_session' else None
    def unavailable(**kwargs):
        raise RuntimeError('timeout')
    monkeypatch.setattr(voice_agent,'command',command)
    monkeypatch.setattr(voice_agent,'read_provider_account_credential',lambda *a,**k:{'secret':'test-key'})
    monkeypatch.setattr(voice_agent,'start_session',unavailable)
    assert voice_agent.connect_voice_agent(None,call_id='call',route_id='route',callback_url='https://app.test/voice/agent/events') is None
    assert writes==['admit_voice_agent_session','mark_voice_agent_uncertain']

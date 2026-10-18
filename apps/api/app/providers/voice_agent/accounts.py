"""Side-effect-free credential verification for the external voice-session adapter."""
import httpx
from app.providers.voice_agent.sessions import voice_endpoint


def verify(credential):
    secret=credential.get('secret')
    if not secret:
        return {'ok':False,'error':'No credential stored.','metadata':{}}
    try:
        response=httpx.get(voice_endpoint()+'/health',headers={'Authorization':'Bearer '+secret},timeout=5.0,follow_redirects=False)
        ready=response.status_code==200 and len(response.content)<=65536 and response.json().get('ready') is True
    except (RuntimeError,ValueError,httpx.HTTPError):
        ready=False
    return {'ok':ready,'error':None if ready else 'Voice provider did not confirm readiness.','metadata':{}}


OPERATIONS={'verify':lambda credential,args:verify(credential)}

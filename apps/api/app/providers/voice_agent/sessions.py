import hashlib
import hmac
import os
import time
from urllib.parse import urlsplit
import httpx


def voice_endpoint():
    base = os.environ.get('VOICE_AGENT_BASE_URL', '').rstrip('/')
    origin = urlsplit(base)
    if origin.scheme != 'https' or not origin.hostname or origin.username or origin.password or origin.query or origin.fragment:
        raise RuntimeError('Voice agent endpoint is unavailable')
    return base


def start_session(*, secret, session, callback_url):
    base = voice_endpoint()
    origin = urlsplit(base)
    response = httpx.post(base + '/sessions', headers={'Authorization': 'Bearer ' + secret, 'Idempotency-Key': session['id']}, json={
        'session_id': session['id'], 'organization_id': session['organization_id'], 'call_id': session['call_id'],
        'deployment_ref': session['deployment_ref'], 'revision': session['config_revision'], 'runtime': session['model'],
        'max_duration_seconds': session['max_seconds'], 'context_references': [], 'callback_url': callback_url,
        'deadline': int(time.time()) + 8,
    }, timeout=5.0, follow_redirects=False)
    if response.status_code not in (200, 201) or len(response.content) > 65536:
        raise RuntimeError('Voice agent session could not be established')
    body = response.json()
    stream = urlsplit(body.get('connection_url', ''))
    allowed = urlsplit(os.environ.get('VOICE_AGENT_STREAM_ORIGIN', 'wss://' + origin.netloc))
    if stream.scheme != 'wss' or stream.netloc != allowed.netloc or stream.username or stream.password or stream.query or stream.fragment:
        raise RuntimeError('Voice agent returned an unauthorized connection')
    remote = body.get('session_id')
    if not isinstance(remote, str) or not 1 <= len(remote) <= 200:
        raise RuntimeError('Voice agent returned an invalid session')
    return remote, stream.geturl()


def verify_event(*, secret, body, timestamp, signature, now=None):
    try:
        issued = int(timestamp)
    except (ValueError, TypeError):
        return False
    if abs((time.time() if now is None else now) - issued) > 300 or not signature:
        return False
    expected = hmac.new(secret.encode(), str(issued).encode() + b'.' + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)

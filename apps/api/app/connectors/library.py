"""Imported connector metadata and the authenticated handoff to its Node runtime."""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from pathlib import Path

import httpx

from app.connectors.base import Account, Capability, OAuthApp, OAuthProvider
from app.providers.providers import UpstreamRefused

CATALOGUE = json.loads((Path(__file__).resolve().parents[2] / 'library' / 'catalogue.json').read_text(encoding='utf8'))
APPLICATIONS = CATALOGUE['applications']


def configured() -> bool:
    from app.connectors import library_runtime_configuration
    url,secret=library_runtime_configuration()
    return bool(url and secret)


def capabilities_for(key: str) -> tuple[Capability, ...]:
    if not configured():
        return ()
    return tuple(Capability(a['capability'], a['name'], 'library', p['workspace'],
        properties=a['inputs']['properties'], required=tuple(a['inputs']['required']))
        for p in APPLICATIONS if p['connector_key'] == key for a in p['actions'] if a['executable'])


def application_for(key: str) -> dict | None:
    return next((a for a in APPLICATIONS if a['connector_key'] == key), None)


def oauth_app(key: str) -> OAuthApp | None:
    from app.connectors import library_oauth_app
    return library_oauth_app(key)


def provider_for(key: str) -> OAuthProvider | None:
    app = application_for(key)
    if not app or app['auth']['type'] != 'oauth2':
        return None
    return LibraryOAuth(app)


class LibraryOAuth(OAuthProvider):
    def __init__(self, app: dict):
        self.key, self.app = app['connector_key'], app
        self.authorize_endpoint, self.token_endpoint = app['auth']['authorize_url'], app['auth']['token_url']
        self.scopes = tuple(app['auth'].get('scopes') or [])

    def account(self, access_token: str) -> Account:
        # The successful token exchange establishes authorization, not an account email or data health.
        return Account(f"{self.app['name']} authorization")

    def resources(self, access_token: str) -> list[dict]:
        return []


def call_worker(body: dict) -> dict:
    from app.connectors import library_runtime_configuration
    url,secret=library_runtime_configuration()
    if not url or not secret:
        raise UpstreamRefused('The open-source connector runtime is not configured.')
    if not url.startswith('https://') and not url.startswith('http://127.0.0.1:'):
        raise UpstreamRefused('The connector runtime must use HTTPS.')
    raw = json.dumps(body, separators=(',', ':'), ensure_ascii=False).encode()
    timestamp = str(int(time.time()))
    signature = hmac.new(secret.encode(), timestamp.encode() + b'.' + raw, hashlib.sha256).hexdigest()
    try:
        response = httpx.post(url, content=raw, headers={'content-type':'application/json',
            'x-gildops-time':timestamp,'x-gildops-signature':signature}, timeout=45.0, follow_redirects=False)
        if response.status_code >= 400:
            raise UpstreamRefused('The connector could not complete this request. Check authorization and query limits.')
        return response.json()
    except (httpx.HTTPError, ValueError) as failure:
        raise UpstreamRefused('The connector runtime could not be reached.') from failure


def catalogue(query: dict) -> dict:
    needle, category, workspace = str(query.get('q') or '').lower().strip(), str(query.get('category') or ''), str(query.get('workspace') or '')
    rows = []
    for app in APPLICATIONS:
        if needle and needle not in ' '.join([app['name'],app['description'],app['connector_key'],app['category']]).lower(): continue
        if category and app['category'] != category: continue
        if workspace and app['workspace'] != workspace: continue
        rows.append({**app, 'actions':[a for a in app['actions'] if a['executable']],
            'action_count':sum(a['executable'] for a in app['actions']), 'trigger_count':len(app['triggers'])})
    offset = max(0, min(int(query.get('offset') or 0), 10000))
    return {'applications':rows[offset:offset+50], 'total':len(rows), 'installed_total':len(APPLICATIONS),
        'runtime_configured':configured(), 'next_offset':offset+50 if offset+50<len(rows) else None}

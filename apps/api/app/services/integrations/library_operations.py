from __future__ import annotations
import json

from app.connectors import oauth_app_for, oauth_provider_for
from app.connectors import library
from app.core import db
from app.core.postgrest import caller_rest
from app.errors import ValidationError
from app.services.integrations import credentials
from app.services.integrations import arguments as schema


def _rest(settings, caller, method, path, **kwargs):
    return caller_rest(settings.supabase_url,settings.supabase_publishable_key,caller.token,method,path,**kwargs)


def invoke(settings, caller, arguments):
    from app.services.integrations.operations import _connection
    connection = _connection(settings,caller,str(arguments.get('connection_id') or ''))
    key, params = str(arguments.get('capability') or ''), arguments.get('params') or {}
    declared = next((c for c in library.capabilities_for(connection['connector_key']) if c.key==key),None)
    if declared is None or not isinstance(params,dict): raise ValidationError('This operation is not enabled.')
    errors=schema.problems(declared.input_schema(),params)
    if errors:raise ValidationError('; '.join(errors))
    prepare(settings,connection['id'],connection['connector_key'])
    job = _rest(settings,caller,'POST','rpc/queue_integration_library_read',json={
        'p_connection_id':connection['id'],'p_capability_key':key,'p_arguments':params}).json()
    return {'capability':key, **library.call_worker({'job_id':job})}


def prepare(settings, connection_id, connector_key):
    held = credentials.held(settings,connection_id)
    if not held: raise ValidationError('Reconnect this application; it has no stored credential.')
    if held.get('library_auth_type') in ('api_key','shopify'): return
    provider, app = oauth_provider_for(connector_key), oauth_app_for(connector_key)
    if provider is None or app is None: raise ValidationError('The OAuth application is not configured.')
    credentials.usable_token(settings,provider,app,connection_id,held)


def connect_key(settings, caller, arguments):
    from app.services.integrations.operations import _require_manage, _connection
    org, slug = str(arguments.get('organization_id') or ''), str(arguments.get('application') or '')
    _require_manage(settings,caller,org)
    app = next((a for a in library.APPLICATIONS if a['key']==slug),None)
    if not app or not library.configured(): raise ValidationError('This application cannot be connected on this deployment.')
    value = arguments.get('secret')
    if app['auth']['type'] != 'api_key' or not isinstance(value,str) or not value.strip() or len(value)>4000:
        raise ValidationError('Supply a valid API key for an application that supports it.')
    candidate = {'library_auth_type':'api_key','secret_text':value.strip()}
    if not library.call_worker({'operation':'validate','application':slug,'credential':candidate}).get('valid'):
        raise ValidationError('The application refused that API key. Check its permissions.')
    connection_id = arguments.get('connection_id')
    if connection_id:
        existing = _connection(settings,caller,str(connection_id))
        if existing['organization_id']!=org or existing['connector_key']!=app['connector_key']: raise ValidationError('No such connection.')
    else:
        connection_id = _rest(settings,caller,'POST','rpc/record_integration_connection',json={'p_organization_id':org,
            'p_connector_key':app['connector_key'],'p_account_label':str(arguments.get('label') or app['name'])[:200]}).json()
    db.store_integration_credential(settings,connection_id=connection_id,secret=json.dumps(candidate))
    db.record_integration_health(settings,connection_id=connection_id,ok=True)
    return {'connection_id':connection_id}

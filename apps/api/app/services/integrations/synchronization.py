from __future__ import annotations
from app.connectors import oauth_provider_for, oauth_app_for
from app.connectors.synchronization import read_page
from app.connectors.base import SourceCursorExpired
from app.core import db
from app.errors import ValidationError
from app.providers.providers import UpstreamRefused
from app.services.integrations import credentials


def synchronize(settings,resource_id):
    job=db._integration_rpc(settings,'claim_integration_resource_sync',{'p_resource_id':resource_id})
    if not job:return {'started':False,'message':'Synchronization is disabled or already running.'}
    try:
        provider,app=oauth_provider_for(job['connector_key']),oauth_app_for(job['connector_key'])
        if provider is None or app is None:raise ValidationError('The OAuth application is not configured.')
        held=credentials.held(settings,job['connection_id'])
        if not held:raise ValidationError('Reconnect this account.')
        token,_=credentials.usable_token(settings,provider,app,job['connection_id'],held)
        restarted=False
        try:page=read_page(provider,token,job['resource_type'],job['external_id'],job['cursor'],job['parameters'])
        except SourceCursorExpired:
            page=read_page(provider,token,job['resource_type'],job['external_id'],{},job['parameters'])
            restarted=True
        db._integration_rpc(settings,'commit_integration_resource_sync',{'p_resource_id':resource_id,'p_lease_id':job['lease_id'],
            'p_records':page.records,'p_cursor':page.cursor,'p_complete':page.complete,'p_snapshot':page.snapshot,'p_error':None,'p_restart':restarted})
        return {'started':True,'complete':page.complete,'records':len(page.records)}
    except (UpstreamRefused,ValidationError) as error:
        message=str(error)[:300]
        for secret in [locals().get('token'),(locals().get('held') or {}).get('refresh_token')]:
            if secret:message=message.replace(secret,'[redacted]')
        db._integration_rpc(settings,'commit_integration_resource_sync',{'p_resource_id':resource_id,'p_lease_id':job['lease_id'],
            'p_records':[],'p_cursor':job['cursor'],'p_complete':False,'p_snapshot':False,'p_error':message})
        return {'started':True,'complete':False,'error':message}


def operate(settings,caller,arguments):
    from app.services.integrations.operations import _rest,_require_manage
    resource_id=str(arguments.get('resource_id') or '')
    rows=_rest(settings,caller,'GET','integration_resources',params={'id':f'eq.{resource_id}','select':'id,organization_id'}).json()
    if not rows:raise ValidationError('No such resource.')
    _require_manage(settings,caller,rows[0]['organization_id'])
    if arguments.get('configure'):
        _rest(settings,caller,'POST','rpc/configure_integration_resource_sync',json={'p_resource_id':resource_id,
            'p_enabled':arguments.get('enabled') is True,'p_parameters':arguments.get('parameters') or {}})
    return synchronize(settings,resource_id)

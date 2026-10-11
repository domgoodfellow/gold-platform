import json
import os
import secrets
from http.server import BaseHTTPRequestHandler
from app.core.config import load_integration_settings
from app.core import db
from app.services.integrations.synchronization import synchronize


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        secret=os.environ.get('CRON_SECRET')
        if not secret or not secrets.compare_digest(self.headers.get('authorization',''),f'Bearer {secret}'):
            self.send_response(401);self.end_headers();return
        settings=load_integration_settings()
        if settings is None:self.send_response(503);self.end_headers();return
        rows=db._integration_rpc(settings,'due_integration_resource_syncs',{})
        results=[]
        for row in rows:
            try:results.append(synchronize(settings,row['resource_id']))
            except Exception:results.append({'error':'Synchronization could not complete.'})
        raw=json.dumps({'processed':len(results)}).encode()
        self.send_response(200);self.send_header('content-type','application/json');self.send_header('content-length',str(len(raw)))
        self.end_headers();self.wfile.write(raw)

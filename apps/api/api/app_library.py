import json
import os
from http.server import BaseHTTPRequestHandler
from app.auth import AuthError, require_caller
from app.connectors.library import catalogue


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            require_caller(self.headers,supabase_url=os.environ.get('SUPABASE_URL',''),
                supabase_publishable_key=os.environ.get('SUPABASE_PUBLISHABLE_KEY') or os.environ.get('SUPABASE_ANON_KEY',''))
            length=int(self.headers.get('content-length') or 0)
            if length>8000: self._reply(413,{'error':'Request too large.'}); return
            body=json.loads(self.rfile.read(length) or b'{}')
            if not isinstance(body,dict): raise ValueError()
            self._reply(200,catalogue(body))
        except AuthError as e: self._reply(e.status,{'error':e.message})
        except (ValueError,TypeError): self._reply(400,{'error':'Invalid request.'})

    def _reply(self,status,body):
        raw=json.dumps(body).encode(); self.send_response(status)
        self.send_header('content-type','application/json');self.send_header('content-length',str(len(raw)))
        self.end_headers();self.wfile.write(raw)

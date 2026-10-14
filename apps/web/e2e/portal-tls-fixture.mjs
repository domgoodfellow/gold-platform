// Disposable loopback HTTPS reverse proxy for the Batch B hostname browser tests.
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../../..');
const directory=path.join(root,'.artifacts','portal-tls');
fs.mkdirSync(directory,{recursive:true});
const key=path.join(directory,'local.key');const cert=path.join(directory,'local.crt');
const executable=process.env.E2E_OPENSSL ?? 'openssl';
const configuration=process.env.E2E_OPENSSL_CONFIG;
execFileSync(executable,['req',...(configuration ? ['-config',configuration] : []),'-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','2','-subj','/CN=*.example.test','-addext','subjectAltName=DNS:*.example.test'],{stdio:'ignore',windowsHide:true});
const upstream=new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3140');
const address=new URL(process.env.E2E_PORTAL_TLS_URL ?? 'https://localhost:3141');
if (!['localhost','127.0.0.1'].includes(upstream.hostname) || !['localhost','127.0.0.1'].includes(address.hostname) || upstream.protocol!=='http:' || address.protocol!=='https:') throw Error('Loopback fixture URLs required.');
https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(request,response)=>{
  const target=http.request({hostname:'127.0.0.1',port:upstream.port,path:request.url,method:request.method,headers:{...request.headers,'x-forwarded-proto':'https'}},reply=>{
    response.writeHead(reply.statusCode,reply.headers);reply.pipe(response);
  });
  target.on('error',()=>{response.writeHead(502);response.end('Local upstream unavailable');});
  request.pipe(target);
}).listen(Number(address.port),'127.0.0.1',()=>process.stdout.write(`Local Portal TLS fixture ready on ${address.port}\n`));

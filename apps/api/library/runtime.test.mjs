import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { catalogue, verifyRequest, runAction } from './runtime.mjs';
import handler from '../api/library_runtime.mjs';
import {Readable} from 'node:stream';

test('the deployed worker rejects unsigned callers before database or vendor access',async()=>{
  const request=Readable.from([Buffer.from('{}')]);request.method='POST';request.headers={};
  let status,payload;
  const response={status(code){status=code;return this;},json(value){payload=value;}};
  await handler(request,response);
  assert.equal(status,401);assert.deepEqual(payload,{error:'Unauthorized.'});
});

test('signed requests reject changed bodies, stale timestamps and missing keys', () => {
  const raw = Buffer.from('{"job_id":"example"}');
  const timestamp = '1780000000';
  const signature = createHmac('sha256', 'test-secret').update(`${timestamp}.`).update(raw).digest('hex');
  assert.equal(verifyRequest(raw, timestamp, signature, 'test-secret', Number(timestamp)*1000), true);
  assert.equal(verifyRequest(Buffer.from('{}'), timestamp, signature, 'test-secret', Number(timestamp)*1000), false);
  assert.equal(verifyRequest(raw, timestamp, signature, 'test-secret', Number(timestamp)*1000+61000), false);
  assert.equal(verifyRequest(raw, timestamp, signature, '', Number(timestamp)*1000), false);
});

const app = catalogue.applications.find(a => a.key === 'stripe');
const action = app.actions.find(a => a.executable && a.inputs.required.length === 0);
const job = { id:'job', organization_id:'org', connector_key:app.connector_key, capability_key:action.capability, arguments:{} };
const credential = { library_auth_type:'api_key', secret_text:'private-test-key' };

test('unreviewed operations and mismatched connections never load a connector', async () => {
  let loaded = false;
  const loaders = { stripe:async () => { loaded=true; } };
  await assert.rejects(runAction({...job, capability_key:'piece.stripe.delete_customer'}, credential, loaders), /not enabled/);
  await assert.rejects(runAction({...job, connector_key:'github'}, credential, loaders), /does not belong/);
  assert.equal(loaded, false);
});

test('only reviewed classifications execute and supplied secrets are redacted', async () => {
  const load = classification => ({stripe:async () => ({getAction:() => ({classification,run:async context => ({seen:context.auth.secret_text})})})});
  await assert.rejects(runAction(job,credential,load('WRITE')), /reviewed read/);
  assert.deepEqual(await runAction(job,credential,load('READ')), {seen:'[redacted]'});
  await assert.rejects(runAction({...job,arguments:{unexpected:'value'}},credential,load('READ')), /Unknown argument/);
});

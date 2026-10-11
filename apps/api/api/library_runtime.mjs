import { createHmac } from 'node:crypto';
import { runAction, validateCredential, verifyRequest } from '../library/runtime.mjs';

export const config = { api: { bodyParser: false } };

function machineToken() {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) throw new Error('Integration database identity is not configured.');
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role: 'integration_operator', sub: '00000000-0000-4000-8000-0000000000a5', iat: now, exp: now + 60 })).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')}`;
}
async function rpc(name, body) {
  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${machineToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('Integration request refused.');
  return response.json();
}
export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 24000) return response.status(413).json({ error: 'Request too large.' });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  if (!verifyRequest(raw, request.headers['x-gildops-time'], request.headers['x-gildops-signature'], process.env.GILDOPS_LIBRARY_SECRET)) {
    return response.status(401).json({ error: 'Unauthorized.' });
  }
  let executionId;
  try {
    const body = JSON.parse(raw.toString('utf8'));
    if (body.operation === 'validate') {
      const valid = await validateCredential(body.application, body.credential);
      return response.status(200).json({ valid });
    }
    const job = await rpc('claim_integration_library_job', { p_job_id: body.job_id });
    if (!job) return response.status(409).json({ error: 'Request expired or already claimed.' });
    executionId = job.principal_kind === 'member' ? job.execution_id : null;
    const result = await runAction(job, JSON.parse(job.secret));
    if (executionId) await rpc('complete_integration_execution', { p_execution_id: executionId, p_succeeded: true,
      p_result_bytes: Buffer.byteLength(JSON.stringify(result)), p_result: null });
    return response.status(200).json({ data: result });
  } catch {
    if (executionId) await rpc('complete_integration_execution', { p_execution_id: executionId, p_succeeded: false,
      p_error_class: 'provider_refused' }).catch(() => {});
    return response.status(502).json({ error: 'The connector could not complete this request. Check authorization and query limits.' });
  }
}

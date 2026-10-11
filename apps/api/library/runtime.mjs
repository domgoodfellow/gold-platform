import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loaders } from './loaders.mjs';

export const catalogue = JSON.parse(await readFile(new URL('./catalogue.json', import.meta.url), 'utf8'));
export function verifyRequest(raw, timestamp, signature, secret, now = Date.now()) {
  if (!secret || !/^\d{10}$/.test(timestamp ?? '') || Math.abs(now / 1000 - Number(timestamp)) > 60) return false;
  if (!/^[a-f0-9]{64}$/.test(signature ?? '')) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
export function findAction(capability) {
  for (const app of catalogue.applications) {
    const action = app.actions.find(a => a.capability === capability && a.executable);
    if (action) return { app, action };
  }
  throw new Error('Operation is not enabled.');
}
function validateInputs(schema, given) {
  if (!given || typeof given !== 'object' || Array.isArray(given)) throw new Error('Invalid arguments.');
  const props = {};
  for (const [key, value] of Object.entries(given)) {
    const rule = schema.properties[key];
    if (!rule) throw new Error('Unknown argument.');
    const valid = rule.type === 'array' ? Array.isArray(value) : rule.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : typeof value === rule.type;
    if (!valid || (typeof value === 'string' && value.length > (rule.maxLength ?? 2000))) throw new Error('Invalid argument type.');
    props[key] = value;
  }
  for (const [key, rule] of Object.entries(schema.properties)) if (!(key in props) && rule.default !== undefined) props[key] = rule.default;
  if (schema.required.some(key => props[key] === undefined || props[key] === '')) throw new Error('A required argument is missing.');
  if (JSON.stringify(props).length > 20000) throw new Error('Arguments are too large.');
  return props;
}
export function authValue(credential) {
  if (credential.library_auth_type === 'api_key') return { type: 'SECRET_TEXT', secret_text: credential.secret_text };
  if (credential.library_auth_type === 'shopify') return { type: 'CUSTOM_AUTH', props: credential.props };
  return { type: 'OAUTH2', access_token: credential.access_token, refresh_token: credential.refresh_token,
    props: { cloud: 'login.microsoftonline.com', ...(credential.auth_props ?? {}) } };
}
const unavailable = async () => { throw new Error('This operation needs a runtime capability that GildOps has not enabled.'); };
export async function runAction(job, credential, load = loaders) {
  const { app, action } = findAction(job.capability_key);
  if (app.connector_key !== job.connector_key) throw new Error('Connection does not belong to this application.');
  const piece = await load[app.key]();
  const operation = piece.getAction(action.key);
  if (!operation || !['READ', 'SEARCH'].includes(operation.classification)) throw new Error('Operation is not a reviewed read.');
  const propsValue = validateInputs(action.inputs, job.arguments);
  const result = await operation.run({ auth: authValue(credential), propsValue,
    project: { id: job.organization_id, externalId: async () => job.organization_id },
    store: { get: unavailable, put: unavailable, delete: unavailable },
    connections: { get: unavailable }, flows: { list: unavailable, current: { id: job.id, version: { id: job.id } } },
    files: { write: unavailable, upload: unavailable }, tags: { add: unavailable }, output: { update: unavailable },
    server: { apiUrl: '', publicUrl: '', token: '' }, step: { name: action.key }, executionType: 'BEGIN',
    run: { id: job.id, canPause: false, stop: unavailable, respond: unavailable, createWaitpoint: unavailable, waitForWaitpoint: unavailable },
  });
  const secrets = [credential.access_token, credential.refresh_token, credential.secret_text, credential.props?.adminToken].filter(Boolean);
  const encoded = JSON.stringify(result ?? null, (_key,value) => {
    if (typeof value !== 'string') return value;
    for (const secret of secrets) value = value.split(secret).join('[redacted]');
    return value;
  });
  if (Buffer.byteLength(encoded) > 30000) throw new Error('Result exceeds the allowed size. Narrow the query.');
  return JSON.parse(encoded);
}
export async function validateCredential(slug, credential) {
  const app = catalogue.applications.find(a => a.key === slug);
  if (!app) throw new Error('Unknown application.');
  const piece = await loaders[slug]();
  const auths = Array.isArray(piece.auth) ? piece.auth : [piece.auth];
  const auth = auths.find(a => a.type === (credential.library_auth_type === 'shopify' ? 'CUSTOM_AUTH' : 'SECRET_TEXT'));
  if (!auth?.validate) {
    const read = app.actions.find(a => a.executable && a.inputs.required.length === 0);
    if (!read) throw new Error('This application has no supported credential verification.');
    await runAction({ id: 'verification', organization_id: 'verification', connector_key: app.connector_key,
      capability_key: read.capability, arguments: {} }, credential);
    return true;
  }
  const value = credential.library_auth_type === 'shopify' ? credential.props : credential.secret_text;
  const result = await auth.validate({ auth: value, server: { apiUrl: '', publicUrl: '' } });
  return result.valid === true;
}

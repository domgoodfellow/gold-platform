import { createHash, createHmac, randomUUID } from 'node:crypto';
import {
  composeInvoiceDocument,
  drawWithLogoFallback,
  isPdf,
  logoFormat,
  presentationFrom,
  reactPdfRenderer,
} from './document.generated.mjs';
import './standard-fonts.cjs';

/**
 * The one writer of an issued invoice's PDF and of a retained logo (Work Order 2G.1).
 *
 * A member who may issue invoices asks; they never supply anything that ends up in the document.
 * Their own token is used for one thing: `invoice_document_requester`, which the database answers
 * only for a person who may issue this business's invoices, with who that person is. Everything
 * after that runs as `invoice_document_writer`, a machine role this function signs a 60-second
 * token for and which can do nothing but read an invoice's document source, store under names it
 * chooses in `finance-documents`, remove what it stored and nothing recorded, and record. Each of
 * those database functions checks the person again.
 *
 * The bytes are drawn here from the database's own facts by the same composition and layout the
 * web app draws drafts with (`document.generated.mjs`, bundled from apps/web). The checksum is
 * computed here. The name is chosen here. The database records only an object this role stored at
 * exactly that size, so nothing a member stored -- before or after this change -- is ever adopted.
 */

export const WRITER_ID = '00000000-0000-4000-8000-0000000000c1';
const BUCKET = 'finance-documents';
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class Refusal extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function configuration() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!url || !key || !secret) throw new Refusal(503, 'invoice_documents.unconfigured', 'This deployment cannot create invoice documents yet.');
  return { url: url.replace(/\/$/, ''), key, secret };
}

function writerToken(secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role: 'invoice_document_writer', sub: WRITER_ID, iat: now, exp: now + 60 })).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url')}`;
}

const objectUrl = (config, bucket, path) => `${config.url}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`;

function session(config, personToken) {
  const writer = writerToken(config.secret);
  const headers = (bearer) => ({ apikey: config.key, authorization: `Bearer ${bearer}` });

  async function rpc(name, args, bearer) {
    const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { ...headers(bearer), 'content-type': 'application/json' },
      body: JSON.stringify(args), signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => null);
    return response.ok ? { data: body, error: null } : { data: null, error: { status: response.status, code: body?.code ?? null } };
  }

  return {
    person: (name, args) => rpc(name, args, personToken),
    writer: (name, args) => rpc(name, args, writer),
    async download(bucket, path, limit) {
      const response = await fetch(objectUrl(config, bucket, path), { headers: headers(writer), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      return bytes.length > 0 && bytes.length <= limit ? bytes : null;
    },
    async store(path, bytes, contentType) {
      const response = await fetch(objectUrl(config, BUCKET, path), {
        method: 'POST', headers: { ...headers(writer), 'content-type': contentType, 'x-upsert': 'false', 'cache-control': 'max-age=31536000' },
        body: bytes, signal: AbortSignal.timeout(20_000),
      });
      return response.ok;
    },
    async list(folder) {
      const response = await fetch(`${config.url}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST', headers: { ...headers(writer), 'content-type': 'application/json' },
        body: JSON.stringify({ prefix: folder, limit: 100 }), signal: AbortSignal.timeout(10_000),
      });
      return response.ok ? (await response.json()).map((entry) => `${folder}/${entry.name}`) : [];
    },
    // The writer's delete policy refuses anything an invoice relies on and anything it did not store.
    async remove(paths) {
      if (paths.length === 0) return;
      await fetch(`${config.url}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE', headers: { ...headers(writer), 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }), signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
    },
  };
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** Who is asking, if they may issue this business's invoices -- decided by the database under their own session. */
async function requester(db, organizationId) {
  const { data, error } = await db.person('invoice_document_requester', { p_organization_id: organizationId });
  if (error?.status === 401) throw new Refusal(401, 'invoice_documents.unauthenticated', 'Sign in to continue.');
  if (error?.code === '42501') throw new Refusal(403, 'invoice_documents.forbidden', 'Your role cannot create this business’s invoice documents.');
  if (error || typeof data !== 'string' || !UUID.test(data)) throw new Refusal(503, 'invoice_documents.unavailable', 'Invoice documents are unavailable. Try again.');
  return data;
}

async function documentSource(db, actor, organizationId, invoiceId) {
  const { data, error } = await db.writer('invoice_document_source', { p_actor: actor, p_organization_id: organizationId, p_invoice_id: invoiceId });
  if (error?.code === '42501') throw new Refusal(404, 'invoice_documents.not_found', 'That invoice is unavailable.');
  if (error || !data) throw new Refusal(503, 'invoice_documents.unavailable', 'Invoice documents are unavailable. Try again.');
  return data;
}

/** The recorded retained copy, only when its bytes are still the bytes that were recorded. */
async function retainedLogo(db, logo) {
  if (!logo) return null;
  const bytes = await db.download(BUCKET, logo.storage_path, MAX_LOGO_BYTES);
  if (!bytes || sha256(bytes) !== logo.sha256 || logoFormat(bytes) !== logo.format) return null;
  return { bytes, format: logo.format };
}

async function create(db, { organizationId, invoiceId }) {
  const actor = await requester(db, organizationId);
  const source = await documentSource(db, actor, organizationId, invoiceId);
  if (source.document) return source.document;

  const { invoice, organization } = source;
  const document = composeInvoiceDocument({
    status: 'issued', number: invoice.number, issuedAt: invoice.issued_at, dueAt: invoice.due_at, currency: invoice.currency,
    lines: source.lines.map((line) => ({ description: line.description, unit: line.unit, unitAmountMinor: line.unit_amount_minor, currency: line.currency, quantity: line.quantity })),
    presentation: source.presentation ? presentationFrom(source.presentation) : null,
    fallback: { sellerName: organization?.name ?? 'Business', billToName: invoice.billed_to, timezone: organization?.timezone ?? 'UTC' },
    logo: await retainedLogo(db, source.logo),
  });
  let bytes;
  try {
    bytes = await drawWithLogoFallback(reactPdfRenderer, document);
  } catch {
    bytes = null;
  }
  if (!bytes || !isPdf(bytes) || bytes.length > MAX_PDF_BYTES) throw new Refusal(503, 'invoice_documents.render_failed', 'The invoice PDF could not be drawn. Try again.');

  const folder = `${organizationId}/invoices/${invoiceId}`;
  const path = `${folder}/${reactPdfRenderer.version}-${randomUUID()}.pdf`;
  const recorded = async () => (await documentSource(db, actor, organizationId, invoiceId)).document;

  if (!(await db.store(path, bytes, 'application/pdf'))) {
    // Refused, most often because another request recorded the document meanwhile.
    const existing = await recorded();
    if (existing) return existing;
    throw new Refusal(503, 'invoice_documents.store_failed', 'The invoice document could not be stored. Try again.');
  }

  const { data, error } = await db.writer('record_invoice_document', {
    p_actor: actor, p_invoice_id: invoiceId, p_storage_path: path, p_sha256: sha256(bytes), p_size_bytes: bytes.length, p_renderer: reactPdfRenderer.version,
  });
  const record = data ?? (await recorded());
  // Once one is recorded, nothing else this writer stored for the invoice is needed: this attempt's
  // copy if it lost, and any an interrupted attempt left. The delete policy spares the recorded one.
  // With nothing recorded, only this attempt's own copy goes; another attempt may be about to record.
  await db.remove(record ? (await db.list(folder)).filter((name) => name !== record.storage_path) : [path]);
  if (!record) {
    if (error?.code === '42501') throw new Refusal(403, 'invoice_documents.forbidden', 'Your role cannot create this invoice’s document.');
    throw new Refusal(503, 'invoice_documents.record_failed', 'The invoice document could not be recorded. Try again.');
  }
  return record;
}

async function retainLogo(db, { organizationId }) {
  const actor = await requester(db, organizationId);
  const { data: source, error } = await db.writer('invoice_logo_source', { p_actor: actor, p_organization_id: organizationId });
  if (error || !source) throw new Refusal(503, 'invoice_documents.unavailable', 'The logo could not be kept. Try again.');
  if (!source.brand_logo_path || source.retained) return { retained: source.retained ?? null };

  // Only what the layout can draw is kept; anything else leaves the business's name in its place.
  const bytes = await db.download('brand', source.brand_logo_path, MAX_LOGO_BYTES);
  const format = bytes ? logoFormat(bytes) : null;
  if (!bytes || !format) return { retained: null };

  const path = `${organizationId}/logos/retained-${randomUUID()}.${format}`;
  if (!(await db.store(path, bytes, format === 'png' ? 'image/png' : 'image/jpeg'))) return { retained: null };
  const { data } = await db.writer('record_retained_logo', {
    p_actor: actor, p_organization_id: organizationId, p_brand_logo_path: source.brand_logo_path,
    p_storage_path: path, p_sha256: sha256(bytes), p_size_bytes: bytes.length, p_format: format,
  });
  // The logo changed meanwhile, or a concurrent request recorded its own copy first.
  if (data?.storage_path !== path) await db.remove([path]);
  return { retained: data?.storage_path ?? null };
}

/** One command from apps/web, with the person's own token. */
export async function runCommand(personToken, body) {
  if (!personToken) throw new Refusal(401, 'invoice_documents.unauthenticated', 'Sign in to continue.');
  const organizationId = String(body?.organization_id ?? '');
  if (!UUID.test(organizationId)) throw new Refusal(400, 'invoice_documents.invalid', 'That request is not valid.');
  const db = session(configuration(), personToken);
  if (body.command === 'retain_logo') return retainLogo(db, { organizationId });
  if (body.command === 'create') {
    const invoiceId = String(body.invoice_id ?? '');
    if (!UUID.test(invoiceId)) throw new Refusal(400, 'invoice_documents.invalid', 'That request is not valid.');
    return create(db, { organizationId, invoiceId });
  }
  throw new Refusal(400, 'invoice_documents.invalid', 'That request is not valid.');
}

import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * `apps/api`'s invoice-document writer, served in-process the way `apps/api/node_dev.mjs` serves
 * it, so apps/web reaches it through `GOLD_API_URL` exactly as it does deployed. The signing secret
 * is set here, in the test process, for the handler; nothing under apps/web's own source reads it.
 */

// Supabase's documented local default, as the rest of the local stack uses unless told otherwise.
export const LOCAL_JWT_SECRET = process.env.SUPABASE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long';
export const WRITER_ID = '00000000-0000-4000-8000-0000000000c1';

type Handler = (request: IncomingMessage, response: ServerResponse & { status: (code: number) => ServerResponse; json: (value: unknown) => void }) => Promise<void>;

export async function startInvoiceDocumentWriter(): Promise<{ url: string; close: () => Promise<void> }> {
  process.env.SUPABASE_URL ??= 'http://127.0.0.1:54321';
  process.env.SUPABASE_JWT_SECRET = LOCAL_JWT_SECRET;
  process.env.SUPABASE_PUBLISHABLE_KEY ??= process.env.SUPABASE_ANON_KEY;
  const { default: handler } = (await import('../../../api/api/invoice_documents.mjs')) as { default: Handler };
  const server: Server = createServer((request, response) => {
    const res = Object.assign(response, {
      status: (code: number) => { response.statusCode = code; return res; },
      json: (value: unknown) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); },
    });
    void handler(request, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.GOLD_API_URL = url;
  return { url, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

/** A token for the writer's own role, for proving what that role can and cannot do directly. */
export function writerToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role: 'invoice_document_writer', sub: WRITER_ID, iat: now, exp: now + 60 })).toString('base64url');
  return `${header}.${payload}.${createHmac('sha256', LOCAL_JWT_SECRET).update(`${header}.${payload}`).digest('base64url')}`;
}

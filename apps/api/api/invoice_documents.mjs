import { Refusal, runCommand } from '../invoice_documents/writer.mjs';

export const config = { api: { bodyParser: false } };

/** `/invoice-documents`: apps/web's request for an issued invoice's PDF or a retained logo, with the person's own token. */
export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).json({ error: 'Method not allowed.' });
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 4000) return response.status(413).json({ error: 'Request too large.' });
    chunks.push(chunk);
  }
  const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    return response.status(200).json(await runCommand(token, body));
  } catch (error) {
    if (error instanceof Refusal) return response.status(error.status).json({ error: error.message, code: error.code });
    if (error instanceof SyntaxError) return response.status(400).json({ error: 'That request is not valid.', code: 'invoice_documents.invalid' });
    return response.status(503).json({ error: 'Invoice documents are unavailable. Try again.', code: 'invoice_documents.unavailable' });
  }
}

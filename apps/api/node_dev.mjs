import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

/**
 * Serve the Node handlers locally, as `dev.py` serves the Python ones. Development only.
 *
 *   node --env-file-if-exists=apps/api/.env apps/api/node_dev.mjs
 *
 * The routes are the `vercel.json` rewrites whose destination is an `.mjs` file -- one list, the
 * one production reads. `dev.py` forwards those routes here when `GILDOPS_NODE_DEV_URL` is set, so
 * apps/web's single `GOLD_API_URL` reaches both.
 */

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const config = JSON.parse(readFileSync(`${ROOT}vercel.json`, 'utf8'));
const routes = new Map();
for (const rewrite of config.rewrites ?? []) {
  const file = `${ROOT}${rewrite.destination.replace(/^\//, '')}.mjs`;
  try { readFileSync(file); } catch { continue; }
  routes.set(rewrite.source, (await import(new URL(`file:///${file.replace(/\\/g, '/')}`).href)).default);
}

const port = Number(process.env.GILDOPS_NODE_DEV_PORT ?? 5323);
createServer(async (request, response) => {
  response.status = (code) => { response.statusCode = code; return response; };
  response.json = (value) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
  const handler = routes.get((request.url ?? '').split('?')[0]);
  if (!handler) return response.status(404).json({ error: 'Not found.' });
  await handler(request, response);
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`apps/api Node handlers on http://127.0.0.1:${port}\n`);
  for (const route of routes.keys()) process.stdout.write(`  ${route}\n`);
});

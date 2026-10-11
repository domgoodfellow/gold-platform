import { createServer } from 'node:http';
import handler from '../api/library_runtime.mjs';

const port = Number(process.env.GILDOPS_LIBRARY_PORT ?? 5322);
createServer(async (request, response) => {
  response.status = code => { response.statusCode = code; return response; };
  response.json = value => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
  await handler(request, response);
}).listen(port, '127.0.0.1', () => process.stdout.write(`Integration library listening at http://127.0.0.1:${port}\n`));

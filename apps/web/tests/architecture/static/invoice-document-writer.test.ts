import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The trusted invoice-document boundary (Work Order 2G.1). apps/api's writer is the only thing
 * that stores or records an issued invoice's PDF or a retained logo; apps/web asks it with the
 * person's token. Read from source, like `auth-boundary.test.ts`, because what is protected is an
 * absence: apps/web names no writer credential, no writer role and no storage write into the
 * private bucket, and the writer draws with apps/web's own composition rather than a stale copy.
 */

const WEB = fileURLToPath(new URL('../../../', import.meta.url));
const API = fileURLToPath(new URL('../../../../api/', import.meta.url));

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', 'tests', 'e2e'].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('database.types.ts')) out.push(path);
  }
  return out;
}

describe('the invoice-document writer boundary', () => {
  it('draws with apps/web’s composition and layout, bundled from source and not stale', () => {
    const run = spawnSync(process.execPath, ['invoice_documents/generate.mjs', '--check'], { cwd: API, encoding: 'utf8' });
    expect(run.stderr, 'run: pnpm --filter @gold/integration-library invoice-documents:generate').toBe('');
    expect(run.status).toBe(0);
  });

  it('gives apps/web no writer credential, role or way to store into the private bucket', () => {
    for (const file of [...sources(join(WEB, 'app')), ...sources(join(WEB, 'lib')), ...sources(join(WEB, 'features'))]) {
      const text = readFileSync(file, 'utf8');
      for (const forbidden of ['invoice_document_writer', '0000000000c1', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'record_invoice_document', 'record_retained_logo']) {
        expect(text.includes(forbidden), `${file} names ${forbidden}`).toBe(false);
      }
      expect(/storage\s*\.from\(\s*(DOCUMENT_BUCKET|'finance-documents')\s*\)\s*\.(upload|update|remove|move|copy)/.test(text), `${file} writes to finance-documents`).toBe(false);
    }
  });

  it('names the very pdfkit fonts the layout opens, so a deployed function contains them', () => {
    const api = JSON.parse(readFileSync(join(API, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    // pnpm installs a package's dependencies beside it.
    const renderer = realpathSync(join(API, 'node_modules/@react-pdf/renderer'));
    const font = JSON.parse(readFileSync(join(renderer, '..', 'font', 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(api.dependencies.pdfkit).toBe(font.dependencies.pdfkit);
    expect(readFileSync(join(API, 'invoice_documents/writer.mjs'), 'utf8')).toContain("import './standard-fonts.cjs';");
  });

  it('keeps the signing secret inside apps/api’s writer, reached only through its handler', () => {
    const writer = readFileSync(join(API, 'invoice_documents/writer.mjs'), 'utf8');
    expect(writer).toContain("role: 'invoice_document_writer'");
    expect(writer).toContain('exp: now + 60');
    const handler = readFileSync(join(API, 'api/invoice_documents.mjs'), 'utf8');
    expect(handler).not.toMatch(/SUPABASE_JWT_SECRET|writerToken/);
  });
});

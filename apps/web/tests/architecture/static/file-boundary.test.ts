import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A file is an artifact, not a connection. Two guards hold that: the file layer knows no consumer
 * (so it cannot grow a CRM schema or a vendor), and nothing in code names a file format as a
 * connector (the catalogue side is `connector-catalogue.test.ts`).
 */

const ROOT = join(__dirname, '..', '..', '..');

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(join(ROOT, path)).isDirectory() ? sources(path) : /\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe('the file layer knows no consumer', () => {
  it('imports nothing but itself and the shared error type — no CRM, Agent, connection or vendor', () => {
    for (const file of sources('lib/domain/files')) {
      const imports = readFileSync(join(ROOT, file), 'utf8').match(/from '@\/[^']+'/g) ?? [];
      for (const specifier of imports) {
        expect(specifier, file).toMatch(/^from '@\/lib\/domain\/(files\/|errors')/);
      }
    }
  });
});

describe('a file format is never a connector', () => {
  it('names no `csv` connector anywhere a connection is made or drawn', () => {
    for (const file of [...sources('features/integrations'), ...sources('lib/domain/integrations'), ...sources('lib/adapters/integrations')]) {
      expect(readFileSync(join(ROOT, file), 'utf8'), file).not.toMatch(/connectorKey\s*[:=!]==?\s*'csv'|connectorKey:\s*'csv'|['"]csv['"]\s*\)/);
    }
  });
});

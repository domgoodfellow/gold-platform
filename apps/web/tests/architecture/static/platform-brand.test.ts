import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLATFORM_NAME } from '@/lib/brand';

const WEB = fileURLToPath(new URL('../../../', import.meta.url));
const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));

function files(relative: string): string[] {
  const path = join(WEB, relative);
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** What a person can read: comments are the code's own voice, and may still say GOLD. */
function rendered(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// First-party surfaces: what GildOps says about itself. Whole directories, so a new screen is
// covered the day it lands. `app/(public)` is a tenant's own surface and is guarded separately below.
const FIRST_PARTY = [
  'app',
  'components',
  'features',
  'lib/marketing',
  'lib/brand.ts',
  'lib/seo',
  'lib/shell.ts',
  'lib/domain/public-site',
  'lib/adapters/email',
  'scripts/demo',
];

describe('the platform is named GildOps on its own surfaces', () => {
  it('names the platform once, as GildOps', () => {
    expect(PLATFORM_NAME).toBe('GildOps');
  });

  it('never renders the legacy name on a first-party public, auth or shell surface', () => {
    for (const file of FIRST_PARTY.flatMap(files)) {
      const text = rendered(readFileSync(file, 'utf8'));
      expect(text, `${file} renders GOLD`).not.toMatch(/\bGOLD\b/);
    }
  });

  it('keeps the platform name off a tenant’s public pages', () => {
    for (const file of files('app/(public)')) {
      expect(readFileSync(file, 'utf8'), `${file} names the platform`).not.toMatch(/PLATFORM_NAME|@\/lib\/brand/);
    }
  });

  it('draws the marketing chrome and metadata from the platform name, not the operator organization', () => {
    const layout = readFileSync(join(WEB, 'app/(marketing)/layout.tsx'), 'utf8');
    expect(layout).toMatch(/name=\{PLATFORM_NAME\}/);
    expect(layout).toMatch(/siteName: PLATFORM_NAME/);
    expect(layout).not.toMatch(/name=\{site\.profile\.displayName\}/);
  });

  it('seeds the published homepage under the platform name, so a fresh database matches the code', () => {
    const migration = readFileSync(join(REPO, 'supabase/migrations/20261007000001_the_platform_is_named_gildops.sql'), 'utf8');
    const sql = migration.replace(/^\s*--.*$/gm, '');
    expect(sql).not.toMatch(/\bGOLD\b(?! organization does not exist)/);
    expect(sql).toMatch(/'GildOps \| Run your business/);
  });
});

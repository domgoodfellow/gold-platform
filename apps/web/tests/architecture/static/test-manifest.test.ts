import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `test-manifest.json` is the one place a test's category is written down (docs/testing.md), and
 * every `pnpm test:<category>` command is built from it. This is what keeps it true.
 *
 * **Omission is made impossible by the gate rather than by discipline:** `pnpm check` runs an
 * unfiltered `vitest run`, so a new test file runs whether or not anyone classified it, and this
 * file is what fails until it is classified. Nothing is quietly left out of the gate — the worst a
 * forgotten manifest entry can do is turn the gate red.
 */

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

type Category = { runner: 'vitest' | 'pytest' | 'playwright'; dir: string; requires: string; gate: boolean; description: string };
type Entry = { category: string; concerns: string[]; note?: string };
const manifest = JSON.parse(readFileSync(join(ROOT, 'test-manifest.json'), 'utf8')) as {
  categories: Record<string, Category>;
  tiers: Record<string, string[]>;
  files: Record<string, Entry>;
};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (['node_modules', '__pycache__', '.auth', 'support'].includes(entry.name)) return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const rel = (path: string) => relative(ROOT, path).split(sep).join('/');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** Every file that is a test by its runner's own rule. Support files (setup, helpers) are not. */
const onDisk = [
  ...walk(join(ROOT, 'apps/web/tests')).filter((f) => /\.test\.tsx?$/.test(f)),
  ...walk(join(ROOT, 'apps/web/e2e')).filter((f) => /\.spec\.ts$/.test(f)),
  ...walk(join(ROOT, 'apps/api/tests')).filter((f) => /[/\\]test_[^/\\]+\.py$/.test(f)),
]
  .map(rel)
  .sort();

const runnerOf = (path: string) => (path.endsWith('.py') ? 'pytest' : path.includes('/e2e/') ? 'playwright' : 'vitest');

describe('every test file is classified exactly once', () => {
  it('has an entry for each test file on disk', () => {
    const unclassified = onDisk.filter((path) => !manifest.files[path]);
    expect(unclassified, 'add these to test-manifest.json — see docs/testing.md, "Classifying a new test"').toEqual([]);
  });

  it('has no entry for a file that is gone', () => {
    const stale = Object.keys(manifest.files).filter((path) => !onDisk.includes(path));
    expect(stale, 'remove or rename these in test-manifest.json').toEqual([]);
  });

  it('names a known category and at least one concern for each entry', () => {
    for (const [path, entry] of Object.entries(manifest.files)) {
      expect(manifest.categories[entry.category], `${path}: unknown category "${entry.category}"`).toBeDefined();
      expect(entry.concerns.length, `${path}: give it at least one concern`).toBeGreaterThan(0);
    }
  });

  it('puts each file in a category whose runner is the one that runs it', () => {
    for (const [path, entry] of Object.entries(manifest.files)) {
      expect(manifest.categories[entry.category].runner, path).toBe(runnerOf(path));
    }
  });

  it('keeps each file directly in the directory of its category, so a path says what a test is', () => {
    for (const [path, entry] of Object.entries(manifest.files)) {
      expect(path.slice(0, path.lastIndexOf('/')), `${path} is "${entry.category}"`).toBe(manifest.categories[entry.category].dir);
    }
  });

  it('keeps smoke specs, and only smoke specs, under e2e/smoke', () => {
    for (const [path, entry] of Object.entries(manifest.files)) {
      expect(entry.category === 'playwright-smoke', path).toBe(path.startsWith('apps/web/e2e/smoke/'));
    }
  });
});

describe('a category that needs no database really needs none', () => {
  // What makes a file need Postgres: a client for it, or the helper that founds a business in it.
  // Built from parts so this file's own source does not match itself.
  const NEEDS_DATABASE = new RegExp(['@supabase/supabase-js', 'pg', '@/tests/support/founding'].map((module) => `from '${module}'`).join('|'));

  it('imports no database client in a category that declares none', () => {
    for (const [path, entry] of Object.entries(manifest.files)) {
      const category = manifest.categories[entry.category];
      if (category.runner !== 'vitest' || category.requires !== 'none') continue;
      expect(NEEDS_DATABASE.test(read(path)), `${path} is "${entry.category}" but reaches for a database`).toBe(false);
    }
  });

  it('imports a database client in a category that declares one', () => {
    for (const [path, entry] of Object.entries(manifest.files)) {
      const category = manifest.categories[entry.category];
      if (category.runner !== 'vitest' || category.requires !== 'database') continue;
      expect(NEEDS_DATABASE.test(read(path)), `${path} is "${entry.category}" but uses no database`).toBe(true);
    }
  });
});

describe('the full gate keeps every classified test', () => {
  const rootScripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
  const webScripts = (JSON.parse(read('apps/web/package.json')) as { scripts: Record<string, string> }).scripts;

  it('runs the whole of Vitest and the whole of pytest, unfiltered', () => {
    expect(webScripts.test).toBe('vitest run');
    expect(webScripts.check).toContain('pnpm test');
    expect(rootScripts.check).toContain('pnpm -r --stream check');
    expect(rootScripts.check).toContain('pnpm check:api');
    expect(rootScripts['check:api']).toBe('python -m pytest apps/api/tests -q');
  });

  it('counts a category in the gate unless it needs a running app or a vendor sandbox', () => {
    for (const [name, category] of Object.entries(manifest.categories)) {
      expect(category.gate, name).toBe(!['running-app', 'sandbox-credentials'].includes(category.requires));
    }
  });

  it('gives every category a command', () => {
    const commands = ['unit', 'component', 'architecture', 'architecture:db', 'db', 'contract', 'api', 'e2e', 'smoke', 'fast', 'local', 'provider'];
    for (const command of commands) {
      expect(rootScripts[`test:${command}`], `test:${command}`).toBe(`node scripts/test.mjs ${command}`);
    }
  });
});

describe('the execution tiers cover the suite exactly once', () => {
  const rootScripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
  const tiered = Object.values(manifest.tiers).flat();
  const inTheGate = Object.entries(manifest.categories).filter(([, category]) => category.gate).map(([name]) => name);

  it('places every category in exactly one tier', () => {
    expect([...tiered].sort()).toEqual(Object.keys(manifest.categories).sort());
  });

  it('makes fast plus local the whole gate, so the two tiers together are what pnpm check runs', () => {
    expect([...manifest.tiers.fast, ...manifest.tiers.local].sort()).toEqual([...inTheGate].sort());
  });

  it('keeps everything in the fast tier free of a database, an app and a vendor', () => {
    for (const name of manifest.tiers.fast) expect(manifest.categories[name].requires, name).toBe('none');
  });

  it('defines check:fast as the fast tier around the fast tests, and leaves check as the gate', () => {
    expect(rootScripts['check:fast']).toBe(
      'pnpm --filter @gold/web typecheck && pnpm --filter @gold/web lint && pnpm test:fast && pnpm --filter @gold/web build',
    );
  });

  it('lets a vendor-sandbox test run only when its credentials are present', () => {
    for (const [path, entry] of Object.entries(manifest.files)) {
      if (entry.category !== 'provider-contract') continue;
      expect(read(path), `${path} must skip itself without credentials`).toMatch(/skipIf\(|process\.env\./);
    }
  });
});

describe('the Python suite is reproducible', () => {
  it('declares pytest for anyone who runs the gate, apart from what ships', () => {
    const dev = read('apps/api/requirements-dev.txt');
    expect(dev).toMatch(/^-r requirements\.txt$/m);
    expect(dev).toMatch(/^pytest==/m);
    expect(read('apps/api/requirements.txt')).not.toMatch(/pytest/);
  });

  it('sets the import root once, so no test edits sys.path', () => {
    expect(read('apps/api/pytest.ini')).toMatch(/^pythonpath\s*=\s*\.$/m);
    for (const path of onDisk.filter((f) => f.endsWith('.py'))) {
      expect(read(path), path).not.toContain('sys.path');
    }
  });
});

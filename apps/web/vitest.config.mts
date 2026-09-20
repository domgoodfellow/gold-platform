import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

type Manifest = {
  categories: Record<string, { runner: string; dir: string; gate: boolean }>;
  files: Record<string, { category: string }>;
};
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../../test-manifest.json', import.meta.url)), 'utf8')) as Manifest;

// `pnpm test:<category>` (scripts/test.mjs) names categories from `test-manifest.json` in
// GOLD_TEST_CATEGORIES, and this turns them into an exact include list. With it unset — which is
// what `pnpm test` and `pnpm check` do — the glob finds every file, so a test nobody classified
// still runs there and `tests/architecture/static/test-manifest.test.ts` is what fails for it.
function includeFor(categories: string | undefined): string[] {
  if (!categories) return ['tests/**/*.test.ts'];
  const wanted = categories.split(',');
  return Object.entries(manifest.files)
    .filter(([path, entry]) => path.startsWith('apps/web/tests/') && wanted.includes(entry.category))
    .map(([path]) => path.replace(/^apps\/web\//, ''));
}

// A Vitest category outside the gate (a vendor sandbox, called with credentials) must never ride
// along in the default run, or `pnpm check` would call a live vendor. Excluded by directory, and
// only when no category was asked for by name.
function excludeFor(categories: string | undefined): string[] {
  if (categories) return configDefaults.exclude;
  const outsideTheGate = Object.values(manifest.categories)
    .filter((category) => category.runner === 'vitest' && !category.gate)
    .map((category) => `${category.dir.replace(/^apps\/web\//, '')}/**`);
  return [...configDefaults.exclude, ...outsideTheGate];
}

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: includeFor(process.env.GOLD_TEST_CATEGORIES),
    exclude: excludeFor(process.env.GOLD_TEST_CATEGORIES),
    // These tests talk to a real Postgres with real RLS. That is the point: an in-memory
    // fake cannot prove a policy, and a policy is what the milestone claims.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Database suites share one local Postgres and some of its global tables. Every category
    // command keeps this: it is what makes them safe to run in any order.
    fileParallelism: false,
    setupFiles: ['./tests/support/setup.ts'],
  },
});

// Runs one named slice of the suite, as classified in test-manifest.json.
//
//   node scripts/test.mjs <command> [-- extra args for the runner]
//
// The manifest is the only place a test's category is written down (docs/testing.md). This file
// holds no list of tests: it asks the manifest which files a command covers and hands them to
// the runner that owns them.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(`${ROOT}test-manifest.json`, 'utf8'));

// Each command is the union of categories, across runtimes, that it names. The tiers (fast, local,
// e2e, smoke, provider) come from the manifest so that the tier a category is in is written once.
const COMMANDS = {
  ...Object.fromEntries(Object.entries(manifest.tiers).map(([tier, categories]) => [tier, categories])),
  unit: ['unit', 'python-unit'],
  component: ['component', 'python-component'],
  architecture: ['architecture-static'],
  'architecture:db': ['architecture-db'],
  db: ['database-integration'],
  contract: ['offline-contract', 'python-contract'],
  api: ['python-unit', 'python-component', 'python-contract'],
  e2e: ['playwright-acceptance'],
  smoke: ['playwright-smoke'],
};

const [command, ...rest] = process.argv.slice(2);
const extra = rest[0] === '--' ? rest.slice(1) : rest;

if (!COMMANDS[command]) {
  console.error(`Unknown test command "${command}". Known: ${Object.keys(COMMANDS).join(', ')}`);
  process.exit(2);
}

const categories = COMMANDS[command];
const filesFor = (runner) =>
  Object.entries(manifest.files)
    .filter(([, entry]) => categories.includes(entry.category) && manifest.categories[entry.category].runner === runner)
    .map(([path]) => path);

function run(label, cmd, args, env = {}) {
  console.log(`\n> ${label}`);
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

let ran = 0;

const vitestCategories = categories.filter((c) => manifest.categories[c].runner === 'vitest');
if (filesFor('vitest').length > 0) {
  // vitest.config.mts turns this into an explicit include list, so a filter can never match a
  // sibling file by substring, and fileParallelism stays exactly as configured there.
  run(`vitest: ${vitestCategories.join(', ')} (${filesFor('vitest').length} files)`, 'pnpm', ['--filter', '@gold/web', 'exec', 'vitest', 'run', ...extra], {
    GOLD_TEST_CATEGORIES: vitestCategories.join(','),
  });
  ran++;
}

const pytestFiles = filesFor('pytest');
if (command === 'api') {
  // The whole collection, not a list: a Python file nobody classified must still run.
  run('pytest: apps/api/tests', 'python', ['-m', 'pytest', 'apps/api/tests', '-q', ...extra]);
  ran++;
} else if (pytestFiles.length > 0) {
  run(`pytest: ${categories.filter((c) => manifest.categories[c].runner === 'pytest').join(', ')} (${pytestFiles.length} files)`, 'python', ['-m', 'pytest', ...pytestFiles, '-q', ...extra]);
  ran++;
}

const playwrightFiles = filesFor('playwright');
if (playwrightFiles.length > 0) {
  const web = playwrightFiles.map((path) => path.replace(/^apps\/web\//, ''));
  const config = command === 'smoke' ? ['--config', 'playwright.smoke.config.ts'] : [];
  run(`playwright: ${categories.join(', ')} (${web.length} files)`, 'pnpm', ['--filter', '@gold/web', 'exec', 'playwright', 'test', ...config, ...web, ...extra]);
  ran++;
}

if (ran === 0) {
  console.log(`Nothing is classified under ${categories.join(', ')} yet, so nothing ran. That is not a pass.`);
}

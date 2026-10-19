import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Three properties of `.github/workflows/ci.yml` that broke, or could, without anything failing.
 * The workflow cannot be run from here, so what is held is its text, deliberately narrowly.
 */

const workflow = readFileSync(fileURLToPath(new URL('../../../../../.github/workflows/ci.yml', import.meta.url)), 'utf8');
const code = workflow.replace(/^\s*#.*$/gm, ''); // comments explain the rules below and must not trip them

describe('the CI workflow', () => {
  it('sets no environment variable for the whole workflow', () => {
    // A workflow-wide Supabase placeholder would beat the real pair an e2e job writes to .env.local,
    // because a value already in process.env takes precedence over .env.local in Next.js.
    expect(/^env:/m.test(code)).toBe(false);
  });

  it('uses the CLI the lockfile pins, never a floating one', () => {
    expect(code).not.toMatch(/supabase\/setup-cli/);
    expect(code).not.toMatch(/version:\s*latest/);
    for (const line of code.split('\n').filter((entry) => /\bsupabase (start|status)\b/.test(entry))) {
      expect(line, 'a supabase command that is not the workspace one').toMatch(/pnpm exec supabase/);
    }
  });

  it('hands the e2e app the stack’s own Supabase pair through the environment, not only a file', () => {
    expect(code).toMatch(/export NEXT_PUBLIC_SUPABASE_URL=/);
    expect(code).toMatch(/export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/);
  });

  it('runs the contract guard on pull requests and pushes, with the history it compares', () => {
    const contract = code.slice(code.indexOf('\n  contract:'), code.indexOf('\n  e2e:'));
    expect(contract).toMatch(/github\.event_name == 'pull_request' \|\| github\.event_name == 'push'/);
    expect(contract).toMatch(/fetch-depth: 0/);
    expect(contract).toMatch(/node scripts\/contract-guard\.mjs/);
  });

  it('makes the manual smoke job fail at once when it has no deployment or no account', () => {
    const smoke = code.slice(code.indexOf('\n  smoke:'));

    expect(smoke).toMatch(/base_url \(workflow input\)/);
    expect(smoke).toMatch(/SMOKE_EMAIL \(repository secret\)/);
    expect(smoke).toMatch(/SMOKE_PASSWORD \(repository secret\)/);
    // The requirement step runs before anything is installed or checked out.
    expect(smoke.indexOf('Require a deployment URL')).toBeLessThan(smoke.indexOf('actions/checkout'));
  });
});

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { E2E_INSTANCE_HEADER, forbiddenSecretNames, type E2eInstanceIdentity } from '../lib/testing/e2e-instance';

/**
 * The browser harness writes fixtures, signs people in and drives real commands, so it must only
 * reach a database on this machine and never a live provider. It refuses rather than warns.
 *
 * Checking this process is not enough: the app under test runs in its own server process, which
 * reads `apps/web/.env.local` (possibly a hosted project) unless started otherwise. So the target
 * must prove it is the dedicated test instance: it was started with `E2E_INSTANCE_TOKEN`, answers
 * `/api/e2e/instance` for that token, and reports a local Supabase equal to this run's plus no
 * provider secrets. A server started normally has no token and answers 404, so it is refused.
 */
type Env = Record<string, string | undefined>;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLocal(value: string): boolean {
  try {
    return LOOPBACK.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

/** What this runner's own environment must satisfy before any server is contacted. */
export function e2eEnvironmentProblems(env: Env): string[] {
  const problems: string[] = [];
  for (const name of ['SUPABASE_URL', 'SUPABASE_DB_URL', 'DATABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
    const value = env[name];
    if (value && !isLocal(value)) problems.push(`${name} is not on this machine.`);
  }
  if (!env.SUPABASE_URL) problems.push('SUPABASE_URL is not set; run `pnpm db:start` so .env.test exists.');
  if (!isLocal(env.E2E_BASE_URL ?? 'http://localhost:3000')) problems.push('E2E_BASE_URL is not on this machine.');
  for (const name of forbiddenSecretNames(env)) problems.push(`${name} is set; blank it for browser tests.`);
  if (!env.E2E_INSTANCE_TOKEN || env.E2E_INSTANCE_TOKEN.length < 32) {
    problems.push('E2E_INSTANCE_TOKEN (32+ characters) is not set; start a dedicated test server with the same token.');
  }
  return problems;
}

/** What the target server's own answer must satisfy. `status` is the HTTP status of the identity request. */
export function e2eTargetProblems(env: Env, status: number, identity: E2eInstanceIdentity | null): string[] {
  if (status !== 200 || !identity) {
    return [`The server at ${env.E2E_BASE_URL ?? 'http://localhost:3000'} is not the dedicated test instance (identity check returned ${status}).`];
  }
  const problems: string[] = [];
  if (!isLocal(identity.supabaseUrl)) problems.push('The target server uses a Supabase that is not on this machine.');
  else if (identity.supabaseUrl !== env.SUPABASE_URL) problems.push('The target server uses a different local Supabase from this run.');
  if (identity.providerSecrets.length) problems.push(`The target server holds provider secrets: ${identity.providerSecrets.join(', ')}.`);
  return problems;
}

/** Asks the target synchronously, so it can run while a Playwright config loads. */
function askTarget(base: string, token: string): { status: number; identity: E2eInstanceIdentity | null } {
  const script = `fetch(process.argv[1],{headers:{[process.argv[2]]:process.argv[3]},redirect:'manual'})
    .then(async r=>{const body=r.status===200?await r.text():'null';process.stdout.write(JSON.stringify({status:r.status,body}))})
    .catch(()=>process.stdout.write(JSON.stringify({status:0,body:'null'})))`;
  const out = execFileSync(process.execPath, ['-e', script, new URL('/api/e2e/instance', base).href, E2E_INSTANCE_HEADER, token], { timeout: 120_000 }).toString();
  const { status, body } = JSON.parse(out) as { status: number; body: string };
  try {
    return { status, identity: JSON.parse(body) as E2eInstanceIdentity | null };
  } catch {
    return { status, identity: null };
  }
}

/** Loads .env.test the way the setups do (existing values win), then refuses an unsafe runner or target. */
export function assertLocalE2eEnvironment(): void {
  loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test'), quiet: true });
  let problems = e2eEnvironmentProblems(process.env);
  if (!problems.length) {
    const { status, identity } = askTarget(process.env.E2E_BASE_URL ?? 'http://localhost:3000', process.env.E2E_INSTANCE_TOKEN!);
    problems = e2eTargetProblems(process.env, status, identity);
  }
  if (problems.length) throw new Error(`Refusing to run browser tests:\n- ${problems.join('\n- ')}`);
}

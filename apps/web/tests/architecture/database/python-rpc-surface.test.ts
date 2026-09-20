import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The database functions the Python runtime calls, checked against the database it will call them in.
 *
 * `apps/api` reaches Postgres only by naming a function over PostgREST, under a machine role or the
 * caller's own token. Nothing else proves those names still exist or that the role Python arrives
 * as may execute them: a renamed function, or a revoked grant, fails only when a real webhook or
 * a real person arrives. (`ai-tools.test.ts` does this for the assistant's tools alone.)
 *
 * The table below is the contract. A **new** function called from Python that is not in it fails
 * the first test, which is the point: whoever adds it must say which role calls it, and this file
 * then holds the grant. Machine-only doors must additionally be closed to every signed-in role
 * (CLAUDE.md, "Provider bindings and secrets").
 */

const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const API_APP = fileURLToPath(new URL('../../../../api/app', import.meta.url));

/** Each machine role and the doors only it may use. */
const MACHINE: Record<string, string[]> = {
  payment_webhook: ['record_provider_payment'],
  platform_billing_webhook: ['apply_platform_subscription_event', 'record_platform_billing_notice'],
  voice_webhook: ['record_call_event'],
  provider_operator: ['read_provider_account_credential', 'record_provider_account_verification'],
  integration_operator: [
    'read_integration_credential',
    'store_integration_credential',
    'clear_integration_credential',
    'record_integration_health',
    'replace_integration_resources',
  ],
  automation_runner: ['run_due_automations', 'queued_messages', 'record_message_delivery', 'places_to_watch', 'record_external_readings'],
};

/** Called with the signed-in person's own token, so `authenticated` must be able to execute them. */
const AS_THE_CALLER = [
  'can_manage_integrations',
  'record_integration_connection',
  'disconnect_integration',
  'change_customer_stage',
  'record_call_outcome',
  'work_at_risk',
  'customers_not_contacted',
  'schedule_ahead',
  'invoiced_and_incurred',
  'work_marked_complete',
  'time_committed',
];

function pythonFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__pycache__') return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? pythonFiles(full) : entry.name.endsWith('.py') ? [full] : [];
  });
}

/** Every function name apps/api/app names for the database, by the four ways it writes one. */
function calledFromPython(): string[] {
  const names = new Set<string>();
  const patterns = [
    /rpc\/([a-z_0-9]+)/g, //                           "rpc/record_call_event" in a URL or path
    /_integration_rpc\(\s*settings,\s*"([a-z_0-9]+)"/g, // the integration door helper
    /_post\(\s*settings,\s*"([a-z_0-9]+)"/g, //          the automation runner's helper
    /function="([a-z_0-9]+)"/g, //                        a tool or a domain command's declaration
  ];
  for (const file of pythonFiles(API_APP)) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of patterns) for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  return [...names].sort();
}

let db: Client;
beforeAll(async () => {
  db = new Client({ connectionString: CONNECTION });
  await db.connect();
});
afterAll(async () => {
  await db?.end();
});

async function canExecute(role: string, name: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `select bool_or(has_function_privilege($1, p.oid, 'execute')) as ok
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $2`,
    [role, name],
  );
  return rows[0].ok === true;
}

describe('the database functions the Python runtime calls', () => {
  it('are all named in this contract, so a new one must say which role calls it', () => {
    const declared = new Set([...Object.values(MACHINE).flat(), ...AS_THE_CALLER]);

    expect(calledFromPython().filter((name) => !declared.has(name))).toEqual([]);
  });

  it('are still called: nothing here is a name Python has stopped using', () => {
    const called = new Set(calledFromPython());

    expect([...Object.values(MACHINE).flat(), ...AS_THE_CALLER].filter((name) => !called.has(name))).toEqual([]);
  });

  it('exist in the public schema', async () => {
    const { rows } = await db.query<{ proname: string }>(
      `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`,
    );
    const present = new Set(rows.map((row) => row.proname));

    expect([...Object.values(MACHINE).flat(), ...AS_THE_CALLER].filter((name) => !present.has(name))).toEqual([]);
  });

  it('are executable by the machine role that calls each one', async () => {
    const refused: string[] = [];
    for (const [role, names] of Object.entries(MACHINE)) {
      for (const name of names) if (!(await canExecute(role, name))) refused.push(`${role} cannot execute ${name}`);
    }

    expect(refused).toEqual([]);
  });

  it('are executable by the signed-in caller, wherever Python forwards the caller’s token', async () => {
    const refused: string[] = [];
    for (const name of AS_THE_CALLER) if (!(await canExecute('authenticated', name))) refused.push(name);

    expect(refused).toEqual([]);
  });

  it('are closed to every signed-in and anonymous role, for the machine-only doors', async () => {
    const open: string[] = [];
    for (const names of Object.values(MACHINE)) {
      for (const name of names) {
        for (const role of ['anon', 'authenticated']) {
          if (await canExecute(role, name)) open.push(`${role} can execute ${name}`);
        }
      }
    }

    expect(open).toEqual([]);
  });
});

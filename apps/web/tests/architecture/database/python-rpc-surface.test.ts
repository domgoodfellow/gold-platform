import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The database functions the Python runtime calls, checked against the database it will call them in.
 *
 * `apps/api` reaches Postgres only by naming a function over PostgREST, under a machine role or the
 * caller's own token. Nothing else proves those names still exist, that the role Python arrives as
 * may execute them, or that the **argument names** Python sends are the ones the function now
 * declares: a renamed function, a revoked grant or a renamed parameter fails only when a real
 * webhook or a real person arrives. (`ai-tools.test.ts` does this for the assistant's tools alone.)
 *
 * `apps/api/tests/rpc_contract.json` is the contract: per function, the role that calls it and the
 * argument names Python sends. This file holds that contract to the database; the other half,
 * `apps/api/tests/contract/test_rpc_contract.py`, holds it to the Python source. Renaming a parameter
 * in a migration without updating the contract fails here; renaming it in Python without updating
 * the contract fails there. A **new** function called from Python that is not in the contract fails
 * the first test below, which is the point. Machine-only doors must additionally be closed to every
 * signed-in role (CLAUDE.md, "Provider bindings and secrets").
 */

const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const API = fileURLToPath(new URL('../../../../api', import.meta.url));

type Entry = { role: string; callers: string[]; sends: string[]; optional?: string[] };
const CONTRACT = (JSON.parse(readFileSync(join(API, 'tests', 'rpc_contract.json'), 'utf8')) as {
  functions: Record<string, Entry>;
}).functions;

/** Machine roles the contract names; anything else is called with the signed-in person's own token. */
const AS_THE_CALLER = 'authenticated';
const machineDoors = () =>
  Object.entries(CONTRACT).filter(([, entry]) => entry.role !== AS_THE_CALLER).map(([name]) => name);

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
  for (const file of pythonFiles(join(API, 'app'))) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of patterns) for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  return [...names].sort();
}

/** One callable form of a function: its named inputs, and which of them a caller may leave out. */
type Overload = { inputs: string[]; required: string[] };

/**
 * Whether a call that sends exactly `sent` (with `alwaysSent` never omitted) can be matched by any
 * overload. PostgREST matches by the set of argument names: everything sent must be a declared
 * input, and every input without a default must be sent. A nameless input can never be matched.
 */
function incompatibilities(overloads: Overload[], sent: string[], alwaysSent: string[]): string[] {
  if (overloads.length === 0) return ['no such function'];
  const reasons: string[] = [];
  for (const overload of overloads) {
    const unknown = sent.filter((name) => !overload.inputs.includes(name));
    const unsent = overload.required.filter((name) => !alwaysSent.includes(name));
    if (unknown.length === 0 && unsent.length === 0) return [];
    reasons.push(
      `(${overload.inputs.join(', ')})` +
        (unknown.length ? ` does not take ${unknown.join(', ')}` : '') +
        (unsent.length ? ` requires ${unsent.join(', ')}, which is not always sent` : ''),
    );
  }
  return reasons;
}

let db: Client;
beforeAll(async () => {
  db = new Client({ connectionString: CONNECTION });
  await db.connect();
});
afterAll(async () => {
  await db?.end();
});

async function overloadsOf(name: string, client: Client = db): Promise<Overload[]> {
  const { rows } = await client.query<{
    proargnames: string[] | null;
    proargmodes: string[] | null;
    pronargs: number;
    pronargdefaults: number;
  }>(
    `select p.proargnames, p.proargmodes::text[] as proargmodes, p.pronargs, p.pronargdefaults
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = $1`,
    [name],
  );
  return rows.map((row) => {
    const names = row.proargnames ?? [];
    const modes = row.proargmodes;
    // Input arguments only: a table function's output columns are in proargnames too, marked 't'/'o'.
    const inputs = names.filter((_, index) => (modes ? ['i', 'b', 'v'].includes(modes[index]) : true)).slice(0, row.pronargs);
    const unnamed = inputs.length < row.pronargs || inputs.includes('');
    return {
      inputs: unnamed ? [...inputs, '(unnamed)'] : inputs,
      // Defaults belong to the last `pronargdefaults` inputs.
      required: unnamed ? ['(unnamed)'] : inputs.slice(0, Math.max(0, inputs.length - row.pronargdefaults)),
    };
  });
}

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
  it('are all named in the contract, so a new one must say which role calls it and what it sends', () => {
    expect(calledFromPython().filter((name) => !(name in CONTRACT))).toEqual([]);
  });

  it('are still called: nothing in the contract is a name Python has stopped using', () => {
    const called = new Set(calledFromPython());

    expect(Object.keys(CONTRACT).filter((name) => !called.has(name))).toEqual([]);
  });

  it('exist in the public schema', async () => {
    const { rows } = await db.query<{ proname: string }>(
      `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`,
    );
    const present = new Set(rows.map((row) => row.proname));

    expect(Object.keys(CONTRACT).filter((name) => !present.has(name))).toEqual([]);
  });

  it('are executable by the machine role that calls each one', async () => {
    const refused: string[] = [];
    for (const [name, entry] of Object.entries(CONTRACT)) {
      if (entry.role !== AS_THE_CALLER && !(await canExecute(entry.role, name))) refused.push(`${entry.role} cannot execute ${name}`);
    }

    expect(refused).toEqual([]);
  });

  it('are executable by the signed-in caller, wherever Python forwards the caller’s token', async () => {
    const refused: string[] = [];
    for (const [name, entry] of Object.entries(CONTRACT)) {
      if (entry.role === AS_THE_CALLER && !(await canExecute('authenticated', name))) refused.push(name);
    }

    expect(refused).toEqual([]);
  });

  it('are closed to every signed-in and anonymous role, for the machine-only doors', async () => {
    const open: string[] = [];
    for (const name of machineDoors()) {
      for (const role of ['anon', 'authenticated']) {
        if (await canExecute(role, name)) open.push(`${role} can execute ${name}`);
      }
    }

    expect(open).toEqual([]);
  });
});

describe('the argument names Python sends', () => {
  it('are accepted by the function each is sent to, and leave out nothing it requires', async () => {
    const broken: string[] = [];
    for (const [name, entry] of Object.entries(CONTRACT)) {
      const optional = new Set(entry.optional ?? []);
      const reasons = incompatibilities(
        await overloadsOf(name),
        entry.sends,
        entry.sends.filter((argument) => !optional.has(argument)),
      );
      if (reasons.length) broken.push(`${name}: sends (${entry.sends.join(', ')}) but ${reasons.join(' | ')}`);
    }

    expect(broken).toEqual([]);
  });
});

describe('the argument check catches a mismatch rather than passing by construction', () => {
  // A throwaway function inside a transaction that is rolled back, so nothing is left behind and the
  // real functions are never touched. The mutation: the database renames a parameter and Python
  // still sends the old name.
  async function withProbe<T>(body: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      await client.query('begin');
      await client.query(`create function public.zz_contract_probe(p_alpha uuid, p_beta text default null) returns void language sql as 'select'`);
      await client.query(`create function public.zz_contract_probe(p_gamma uuid) returns void language sql as 'select'`);
      return await body(client);
    } finally {
      await client.query('rollback');
      await client.end();
    }
  }

  it('accepts what an overload takes, and reads defaults and overloads correctly', async () => {
    await withProbe(async (client) => {
      const overloads = await overloadsOf('zz_contract_probe', client);

      expect(overloads).toHaveLength(2);
      expect(incompatibilities(overloads, ['p_alpha'], ['p_alpha'])).toEqual([]);
      expect(incompatibilities(overloads, ['p_alpha', 'p_beta'], ['p_alpha', 'p_beta'])).toEqual([]);
      expect(incompatibilities(overloads, ['p_gamma'], ['p_gamma'])).toEqual([]);
    });
  });

  it('refuses a parameter the database no longer has, and one it now requires that is not sent', async () => {
    await withProbe(async (client) => {
      const overloads = await overloadsOf('zz_contract_probe', client);

      expect(incompatibilities(overloads, ['p_renamed'], ['p_renamed']).length).toBeGreaterThan(0);
      expect(incompatibilities(overloads, ['p_beta'], ['p_beta']).length).toBeGreaterThan(0);
      expect(incompatibilities([], ['p_alpha'], ['p_alpha'])).toEqual(['no such function']);
    });
  });
});

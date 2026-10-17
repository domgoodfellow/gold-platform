import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listConnections, recordConnection } from '@/lib/domain/integrations/connections';
import { listOrganizationConnections } from '@/lib/domain/integrations/connectors';
import { listResources } from '@/lib/domain/integrations/resources';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * A business's own OAuth credential, against real Postgres. What is proven here is the
 * database half: nothing signed in can read a credential or its Vault pointer, only the machine
 * role can, it holds no table grant and exactly five executes, a business sees only its own
 * connections, and health is recorded only by the runtime that asked the provider. The other half
 * — that the API proves the caller before it touches a credential, rotates a token before using
 * it, and never returns one — is `apps/api/tests/component/test_integration_operations.py`.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const SUFFIX = randomUUID().slice(0, 6);
const CONNECTOR = `oauth_fx_${SUFFIX}`;
const SECRET = JSON.stringify({ access_token: `access-${randomUUID()}`, refresh_token: `refresh-${randomUUID()}`, expires_at: 1 });
const ROTATED = JSON.stringify({ access_token: `access-${randomUUID()}`, refresh_token: `refresh-${randomUUID()}`, expires_at: 2 });

type Tenant = { db: SupabaseClient; organizationId: string };

let pg: Client;
let staff: SupabaseClient;
let alice: Tenant;
let bob: Tenant;
let connectionId: string;

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${SUFFIX}`, currency: 'EUR' });
  return { db, organizationId: organizationId as string };
}

/** Acts as the one machine role that may read or write a credential. */
async function asOperator<T>(run: () => Promise<T>): Promise<T> {
  await pg.query('begin');
  try {
    await pg.query('set local role integration_operator');
    const result = await run();
    await pg.query('commit');
    return result;
  } catch (error) {
    await pg.query('rollback');
    throw error;
  }
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  await pg.query(
    `insert into public.platform_connectors (key, name, category, status, auth_method, connection_method, is_public)
     values ($1, 'Fixture app', 'Testing', 'beta', 'oauth2', 'native', true)`,
    [CONNECTOR],
  );
  staff = await asPlatformStaff();
  alice = await newTenant('cred-alice');
  bob = await newTenant('cred-bob');

  connectionId = await recordConnection(alice.db, { organizationId: alice.organizationId, connectorKey: CONNECTOR, accountLabel: 'alice@example.test' });
  // A credential is written by the machine role after the API has proved the caller.
  await asOperator(() => pg.query('select public.store_integration_credential($1, $2)', [connectionId, SECRET]));
}, 90_000);

afterAll(async () => {
  await pg.query('delete from public.integration_connections where connector_key = $1', [CONNECTOR]);
  await pg.query('delete from public.platform_connectors where key = $1', [CONNECTOR]);
  await pg.end();
});

describe('nothing signed in can read a credential', () => {
  it('withholds the Vault pointer from every column a business may select', async () => {
    const pointer = await alice.db.from('integration_connections').select('secret_id');
    expect(pointer.error?.code).toBe('42501');
    const everything = await alice.db.from('integration_connections').select('*');
    expect(everything.error?.code).toBe('42501');
    const named = await alice.db.from('integration_connections').select('id, status, scopes, last_error');
    expect(named.error).toBeNull();
  });

  it('leaves the reading door executable by no signed-in role, the owner of the credential included', async () => {
    for (const client of [alice.db, staff, createClient(SUPABASE_URL, ANON_KEY)]) {
      const attempt = await client.rpc('read_integration_credential', { p_connection_id: connectionId });
      expect(attempt.error?.code).toBe('42501');
      expect(attempt.data).toBeNull();
    }
  });

  it('leaves the other four machine doors just as closed, so a business cannot mark itself healthy', async () => {
    const forge = await alice.db.rpc('record_integration_health', { p_connection_id: connectionId, p_ok: true });
    expect(forge.error?.code).toBe('42501');
    for (const [fn, args] of [
      ['store_integration_credential', { p_connection_id: connectionId, p_secret: 'x' }],
      ['replace_integration_resources', { p_connection_id: connectionId, p_resources: [] }],
      ['clear_integration_credential', { p_connection_id: connectionId }],
    ] as const) {
      const attempt = await alice.db.rpc(fn, args);
      expect(attempt.error?.code, fn).toBe('42501');
    }
  });

  it('leaves Vault unreachable to every signed-in role', async () => {
    const direct = await alice.db.schema('vault' as never).from('decrypted_secrets' as never).select('*');
    expect(direct.error).not.toBeNull();
  });

  it('holds no table grant and only the machine doors it was given', async () => {
    const tables = await pg.query("select 1 from information_schema.role_table_grants where grantee = 'integration_operator'");
    expect(tables.rowCount).toBe(0);
    const columns = await pg.query("select 1 from information_schema.column_privileges where grantee = 'integration_operator' and table_schema = 'public'");
    expect(columns.rowCount).toBe(0);
    const routines = await pg.query(
      "select routine_name from information_schema.routine_privileges where grantee = 'integration_operator' and routine_schema = 'public' order by 1",
    );
    // `record_managed_integration_resource` joined the other five once the DNS bridge needed a
    // single-resource upsert door, so a tenant's own forwarded token never has to write a
    // connection-scoped resource (work order 1 closeout, section 2).
    // The execution slice added the record of an outcome, MCP server and tool registration, a
    // compare-and-swap rotation, retention and the two doors an automation's tools are authorized
    // through -- each a door only the runtime that did the work may use (`integration-tool-grants.test.ts` proves every one is closed to a signed-in session).
    expect(routines.rows.map((row) => row.routine_name)).toEqual([
      'authorize_automation_tool_call',
      'claim_integration_actions',
      'claim_integration_library_job',
      'claim_integration_resource_sync',
      'clear_integration_credential',
      'commit_integration_resource_sync',
      'complete_integration_execution',
      'due_integration_resource_syncs',
      'finish_integration_action',
      'granted_tools_for_automation',
      'purge_integration_executions',
      'queue_granted_integration_library_read',
      'read_integration_credential',
      'record_integration_health',
      'record_managed_integration_resource',
      'record_mcp_discovery',
      'replace_integration_resources',
      'store_integration_credential',
      'swap_integration_credential',
      'upsert_mcp_server',
    ]);
  });

  it('is read by the machine role alone, and what it reads is what the business wrote', async () => {
    const read = await asOperator(() => pg.query('select * from public.read_integration_credential($1)', [connectionId]));
    expect(read.rows[0]?.secret).toBe(SECRET);
    expect(read.rows[0]?.organization_id).toBe(alice.organizationId);
  });
});

describe('the machine role records what happened', () => {
  it('rotates a credential in place, returning nothing', async () => {
    const stored = await asOperator(() => pg.query('select public.store_integration_credential($1, $2) as result', [connectionId, ROTATED]));
    expect(stored.rows[0]?.result).toBe(''); // a void function: nothing comes back
    const read = await asOperator(() => pg.query('select secret from public.read_integration_credential($1)', [connectionId]));
    expect(read.rows[0]?.secret).toBe(ROTATED);
  });

  it('shows the business that verification failed without echoing the provider’s raw text, and never a credential', async () => {
    await asOperator(() => pg.query("select public.record_integration_health($1, false, 'Token has been expired or revoked.')", [connectionId]));
    const [failed] = (await listConnections(alice.db, { organizationId: alice.organizationId })).filter((c) => c.id === connectionId);
    expect(failed).toMatchObject({ status: 'needs_attention', lastError: 'Connection verification failed. Reconnect the application.' });
    expect(JSON.stringify(failed)).not.toContain('Token has been expired');
    expect(JSON.stringify(failed)).not.toContain('refresh-');

    await asOperator(() => pg.query("select public.record_integration_health($1, true, null, 'alice@work.test', array['a','b'])", [connectionId]));
    const [healthy] = (await listConnections(alice.db, { organizationId: alice.organizationId })).filter((c) => c.id === connectionId);
    expect(healthy).toMatchObject({ status: 'active', lastError: null, accountLabel: 'alice@work.test', scopes: ['a', 'b'] });
    expect(healthy?.lastVerifiedAt).not.toBeNull();
  });

  it('lists what a connection can reach, updates it in place, and disables what disappeared', async () => {
    const list = (items: object[]) => asOperator(() => pg.query('select public.replace_integration_resources($1, $2::jsonb)', [connectionId, JSON.stringify(items)]));
    await list([
      { resource_type: 'fx_calendar', external_id: 'cal-1', display_name: 'Team' },
      { resource_type: 'fx_sheet', external_id: 'sheet-1', display_name: 'Leads' },
    ]);
    await list([{ resource_type: 'fx_calendar', external_id: 'cal-1', display_name: 'Team (renamed)' }]);

    const resources = await listResources(alice.db, { organizationId: alice.organizationId, connectionId });
    const byExternal = new Map(resources.map((r) => [r.displayName, r.status]));
    expect(byExternal.get('Team (renamed)')).toBe('active');
    expect(byExternal.get('Leads')).toBe('disabled'); // no longer listed: disabled, never deleted
    expect(resources.filter((r) => r.displayName.startsWith('Team'))).toHaveLength(1); // idempotent
  });

  it('rejects a malformed resource list without writing anything', async () => {
    await expect(asOperator(() => pg.query("select public.replace_integration_resources($1, '{}'::jsonb)", [connectionId]))).rejects.toThrow(/array/);
  });
});

describe('tenant isolation', () => {
  it('shows another business neither the connection nor what it reaches', async () => {
    expect(await listConnections(bob.db, { organizationId: alice.organizationId })).toEqual([]);
    expect(await listResources(bob.db, { organizationId: alice.organizationId })).toEqual([]);
    const claim = await bob.db.rpc('can_manage_integrations', { p_organization_id: alice.organizationId });
    expect(claim.data).toBe(false);
    const own = await alice.db.rpc('can_manage_integrations', { p_organization_id: alice.organizationId });
    expect(own.data).toBe(true);
  });

  it('gives support the connection and its health, and no credential', async () => {
    const rows = await listOrganizationConnections(staff, { organizationId: alice.organizationId });
    const row = rows.find((r) => r.id === connectionId);
    expect(row).toMatchObject({ connectorKey: CONNECTOR, hasCredential: true, status: 'active' });
    const text = JSON.stringify(rows);
    expect(text).not.toContain('refresh-');
    expect(text).not.toContain('access-');
  });

  it('removes the credential on request while the business keeps what it imported', async () => {
    await asOperator(() => pg.query('select public.clear_integration_credential($1)', [connectionId]));
    const read = await asOperator(() => pg.query('select * from public.read_integration_credential($1)', [connectionId]));
    expect(read.rowCount).toBe(0);
    const rows = await listOrganizationConnections(staff, { organizationId: alice.organizationId });
    expect(rows.find((r) => r.id === connectionId)?.hasCredential).toBe(false);
    expect((await listResources(alice.db, { organizationId: alice.organizationId, connectionId })).length).toBeGreaterThan(0);
  });
});

describe('what apps/web is not allowed to hold', () => {
  function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.next', 'tests', 'e2e'].includes(name)) continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) sources(path, out);
      else if (/\.(ts|tsx)$/.test(name) && !name.endsWith('database.types.ts')) out.push(path);
    }
    return out;
  }

  it('never names the reading door, the vault, a client secret or a state secret', () => {
    const root = join(__dirname, '..', '..', '..');
    for (const file of [...sources(join(root, 'app')), ...sources(join(root, 'lib')), ...sources(join(root, 'features'))]) {
      const text = readFileSync(file, 'utf8');
      for (const forbidden of ['read_integration_credential', 'decrypted_secrets', 'OAUTH_CLIENT_SECRET', 'GOLD_OAUTH_STATE_SECRET', 'SUPABASE_JWT_SECRET']) {
        expect(text.includes(forbidden), `${file} names ${forbidden}`).toBe(false);
      }
    }
  });
});

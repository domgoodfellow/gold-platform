import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listConnections, recordConnection } from '@/lib/domain/integrations/connections';
import { getSourceRepository, listSourceRepositories, requireSourceRepository } from '@/lib/domain/source-control/repositories';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * A business's GitHub authorization, against real Postgres. The adapter that talks to GitHub is
 * proven offline by `apps/api/tests/contract/test_github_connector.py`; what is proven here is the
 * half only a database can prove: the installation handle is unreadable by anyone signed in, a
 * repository is something only the machine role can assert, another business sees none of it, and a
 * connection that is withdrawn or lost stops offering its repositories to whatever asks for one.
 *
 * Nothing here talks to GitHub, and nothing here claims a GitHub App is registered anywhere.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const HANDLE = JSON.stringify({ access_token: `ghs_${randomUUID()}`, refresh_token: '987654', expires_at: 1 });

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
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${randomUUID().slice(0, 6)}`, currency: 'EUR' });
  return { db, organizationId: organizationId as string };
}

/** The one machine role that writes a credential, health and discovered resources. */
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

const repo = (id: number, over: Record<string, unknown> = {}) => ({
  resource_type: 'github_repository',
  external_id: String(id),
  display_name: `acme/repo-${id}`,
  metadata: { owner: 'acme', name: `repo-${id}`, default_branch: 'main', visibility: 'private', archived: false, url: `https://github.com/acme/repo-${id}`, ...over },
});

const discover = (repositories: unknown[]) =>
  asOperator(() => pg.query('select public.replace_integration_resources($1, $2::jsonb)', [connectionId, JSON.stringify(repositories)]));
const health = (ok: boolean, error: string | null = null) =>
  asOperator(() => pg.query('select public.record_integration_health($1, $2, $3, $4, $5)', [connectionId, ok, error, ok ? 'acme' : null, ok ? ['contents:read', 'metadata:read'] : null]));

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  staff = await asPlatformStaff();
  alice = await newTenant('gh-alice');
  bob = await newTenant('gh-bob');

  // The API records the connection under the caller's own rights, then the machine role does the rest.
  connectionId = await recordConnection(alice.db, { organizationId: alice.organizationId, connectorKey: 'github', accountLabel: 'acme' });
  await asOperator(() => pg.query('select public.store_integration_credential($1, $2)', [connectionId, HANDLE]));
  await health(true);
  await discover([repo(1), repo(2, { visibility: 'public', archived: true }), repo(3)]);
}, 90_000);

afterAll(async () => {
  await pg.query('delete from public.integration_connections where organization_id = any($1)', [[alice.organizationId, bob.organizationId]]);
  await pg.end();
});

describe('GitHub is a catalogue connector, not a hard-coded one', () => {
  it('is a public beta row that authorizes by sign-in and is source control by category', async () => {
    const { data } = await alice.db.from('platform_connectors').select('key, status, auth_method, category, is_public').eq('key', 'github').single();
    expect(data).toEqual({ key: 'github', status: 'beta', auth_method: 'oauth2', category: 'Source control', is_public: true });
  });
});

describe('the installation handle and the token are unreadable to anyone signed in', () => {
  it('withholds the Vault pointer from the business that owns the connection', async () => {
    expect((await alice.db.from('integration_connections').select('secret_id').eq('id', connectionId)).error?.code).toBe('42501');
    expect((await alice.db.from('integration_connections').select('*').eq('id', connectionId)).error?.code).toBe('42501');
  });

  it('leaves the reading door closed to the owner, another business and staff alike', async () => {
    for (const client of [alice.db, bob.db, staff]) {
      const attempt = await client.rpc('read_integration_credential', { p_connection_id: connectionId });
      expect(attempt.error?.code).toBe('42501');
      expect(attempt.data).toBeNull();
    }
  });

  it('shows the owner the connection and its granted permissions, and shows another business nothing', async () => {
    const mine = await listConnections(alice.db, { organizationId: alice.organizationId });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ connectorKey: 'github', accountLabel: 'acme', status: 'active', scopes: ['contents:read', 'metadata:read'] });
    expect(JSON.stringify(mine)).not.toContain('ghs_');
    expect(await listConnections(bob.db, { organizationId: bob.organizationId })).toEqual([]);
    const sneaking = await bob.db.from('integration_connections').select('id').eq('id', connectionId);
    expect(sneaking.data).toEqual([]);
  });
});

describe('a repository is something only the machine role can assert', () => {
  it('refuses a tenant writing a repository row under a connection, its own included', async () => {
    const forged = await alice.db.from('integration_resources').insert({
      organization_id: alice.organizationId,
      connection_id: connectionId,
      resource_type: 'github_repository',
      external_id: '999',
      display_name: 'acme/forged',
      metadata: { owner: 'acme', name: 'forged', visibility: 'private' },
    });
    expect(forged.error).not.toBeNull();

    const elsewhere = await bob.db.from('integration_resources').insert({
      organization_id: bob.organizationId,
      connection_id: connectionId, // another business's connection
      resource_type: 'github_repository',
      external_id: '999',
      display_name: 'acme/forged',
    });
    expect(elsewhere.error).not.toBeNull();
  });

  it('refuses a tenant rewriting or removing a discovered repository', async () => {
    const before = await pg.query("select id, display_name from public.integration_resources where connection_id = $1 and external_id = '1'", [connectionId]);
    const id = before.rows[0].id as string;

    await alice.db.from('integration_resources').update({ display_name: 'acme/renamed', metadata: { owner: 'x', name: 'y' } }).eq('id', id);
    await alice.db.from('integration_resources').delete().eq('id', id);

    const after = await pg.query('select display_name, metadata from public.integration_resources where id = $1', [id]);
    expect(after.rows[0].display_name).toBe('acme/repo-1');
    expect(after.rows[0].metadata.owner).toBe('acme');
  });

  it('refuses a signed-in role calling the machine doors that write them', async () => {
    for (const client of [alice.db, staff]) {
      const attempt = await client.rpc('replace_integration_resources', { p_connection_id: connectionId, p_resources: [repo(500)] });
      expect(attempt.error?.code).toBe('42501');
    }
  });
});

describe('Studio asks for repositories and never for a vendor', () => {
  it('lists what the business authorized, in one neutral shape', async () => {
    const found = await listSourceRepositories(alice.db, { organizationId: alice.organizationId });
    expect(found.map((r) => r.fullName)).toEqual(['acme/repo-1', 'acme/repo-2', 'acme/repo-3']);
    expect(found[0]).toMatchObject({
      connectionId, owner: 'acme', name: 'repo-1', defaultBranch: 'main', visibility: 'private', archived: false, url: 'https://github.com/acme/repo-1',
    });
    expect(found[1]).toMatchObject({ visibility: 'public', archived: true });
    expect(JSON.stringify(found)).not.toMatch(/github_repository|ghs_|installation/i);
  });

  it('gives another business none, and refuses its asking for this one by id', async () => {
    expect(await listSourceRepositories(bob.db, { organizationId: bob.organizationId })).toEqual([]);
    const mine = (await listSourceRepositories(alice.db, { organizationId: alice.organizationId }))[0]!;
    expect(await getSourceRepository(bob.db, { organizationId: bob.organizationId, repositoryId: mine.id })).toBeNull();
    await expect(requireSourceRepository(bob.db, { organizationId: bob.organizationId, repositoryId: mine.id })).rejects.toThrow(/not authorized/);
    // Naming the other business does not help either: what answers is the caller's own rights.
    expect(await listSourceRepositories(bob.db, { organizationId: alice.organizationId })).toEqual([]);
    expect((await requireSourceRepository(alice.db, { organizationId: alice.organizationId, repositoryId: mine.id })).id).toBe(mine.id);
  });

  it('stops offering a repository the vendor no longer lists', async () => {
    await discover([repo(1), repo(3)]);
    const found = await listSourceRepositories(alice.db, { organizationId: alice.organizationId });
    expect(found.map((r) => r.fullName)).toEqual(['acme/repo-1', 'acme/repo-3']);
    await discover([repo(1), repo(2, { visibility: 'public', archived: true }), repo(3)]);
    expect(await listSourceRepositories(alice.db, { organizationId: alice.organizationId })).toHaveLength(3);
  });
});

describe('a lost or withdrawn authorization stops offering its repositories', () => {
  it('turns the connection to needs attention when the installation is gone, and offers nothing until it is verified again', async () => {
    await health(false, 'GitHub no longer recognizes this installation. It may have been removed. Reconnect it.');

    const connection = (await listConnections(alice.db, { organizationId: alice.organizationId }))[0]!;
    expect(connection.status).toBe('needs_attention');
    expect(connection.lastError).toMatch(/no longer recognizes/);
    expect(await listSourceRepositories(alice.db, { organizationId: alice.organizationId })).toEqual([]);

    await health(true);
    expect(await listSourceRepositories(alice.db, { organizationId: alice.organizationId })).toHaveLength(3);
  });

  it('deletes the handle on disconnect and keeps every repository away from whatever asks', async () => {
    await asOperator(() => pg.query('select public.clear_integration_credential($1)', [connectionId]));
    // The API clears the credential and then the ordinary door, under the owner's own rights, retires the connection.
    await alice.db.rpc('disconnect_integration', { p_organization_id: alice.organizationId, p_connection_id: connectionId });

    const row = await pg.query('select status, secret_id from public.integration_connections where id = $1', [connectionId]);
    expect(row.rows[0]).toEqual({ status: 'disconnected', secret_id: null });
    expect(await listSourceRepositories(alice.db, { organizationId: alice.organizationId })).toEqual([]);
  });
});

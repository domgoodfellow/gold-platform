import { BUCKET } from '@/lib/domain/documents/documents';
import { supabaseFileStore } from '@/lib/adapters/storage/supabase-file-store';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordConnection } from '@/lib/domain/integrations/connections';
import { uploadImportFile } from '@/lib/domain/integrations/resources';
import { foundBusiness } from '@/tests/support/founding';

/**
 * A tenant session cannot manufacture the evidence `app.services.dns` treats as proof that
 * GildOps itself discovered a Cloudflare zone or created a DNS record -- work order 1 closeout,
 * section 2.
 *
 * What is provable here, against real Postgres and real RLS: an ordinary `integration.manage`
 * session cannot insert or edit a connection-scoped `integration_resources` row (a `cloudflare_zone`
 * or a `cloudflare_dns_record`, or any other provider-discovered resource) through any path; the
 * machine door (`record_managed_integration_resource`, `integration_operator` only) can; another
 * organization is unaffected either way; and the one legitimate tenant-direct path -- an uploaded
 * import file, which owns no connection -- keeps working exactly as before.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const FIXTURE_CONNECTOR = `fixture_${randomUUID().slice(0, 6)}`;

let pg: Client;

type Tenant = { db: SupabaseClient; organizationId: string };

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
  return { db, organizationId };
}

/** Acts as the one machine role that may record a connection-scoped resource. */
async function asIntegrationOperator<T>(run: () => Promise<T>): Promise<T> {
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

let alice: Tenant;
let bob: Tenant;

describe('a connection-scoped integration_resources row is not tenant-forgeable', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    pg = new Client(DB_URL);
    await pg.connect();
    await pg.query(
      `insert into public.platform_connectors (key, name, category, status, auth_method, connection_method, is_public)
       values ($1, 'Fixture app', 'Testing', 'live', 'none', 'custom', true)`,
      [FIXTURE_CONNECTOR],
    );
    alice = await newTenant('res-auth-alice');
    bob = await newTenant('res-auth-bob');
  });

  afterAll(async () => {
    await pg.query('delete from public.integration_connections where connector_key = $1', [FIXTURE_CONNECTOR]);
    await pg.query('delete from public.platform_connectors where key = $1', [FIXTURE_CONNECTOR]);
    await pg.end();
  });

  it('refuses a tenant session inserting a connection-scoped cloudflare_zone row directly', async () => {
    const connectionId = await recordConnection(alice.db, { organizationId: alice.organizationId, connectorKey: FIXTURE_CONNECTOR });

    const { error } = await alice.db.from('integration_resources').insert({
      organization_id: alice.organizationId,
      connection_id: connectionId,
      resource_type: 'cloudflare_zone',
      external_id: 'forged-zone',
      display_name: 'forged.example.com',
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('refuses a tenant session inserting a connection-scoped cloudflare_dns_record row directly', async () => {
    const connectionId = await recordConnection(alice.db, { organizationId: alice.organizationId, connectorKey: FIXTURE_CONNECTOR });

    const { error } = await alice.db.from('integration_resources').insert({
      organization_id: alice.organizationId,
      connection_id: connectionId,
      resource_type: 'cloudflare_dns_record',
      external_id: 'forged-record-id',
      display_name: 'CNAME forged.example.com',
      metadata: { type: 'CNAME', name: 'forged.example.com', value: 'attacker-controlled.example.net' },
    });

    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('refuses a tenant session editing an existing connection-scoped resource, even one it can see', async () => {
    const connectionId = await recordConnection(alice.db, { organizationId: alice.organizationId, connectorKey: FIXTURE_CONNECTOR });
    const resourceId = await asIntegrationOperator(async () => {
      const { rows } = await pg.query(
        `select public.record_managed_integration_resource($1, 'cloudflare_zone', 'zone-real', 'real.example.com', '{}'::jsonb) as id`,
        [connectionId],
      );
      return rows[0].id as string;
    });

    // RLS's `using` clause excludes a connection-scoped row from this session's update target
    // entirely, so this is the same "ambiguous refusal" shape the same-organization reference rule already names elsewhere: no
    // error, zero rows touched, never a change.
    const { error } = await alice.db
      .from('integration_resources')
      .update({ display_name: 'tampered.example.com' })
      .eq('id', resourceId);
    void error;

    const { rows } = await pg.query('select display_name from public.integration_resources where id = $1', [resourceId]);
    expect(rows[0].display_name).toBe('real.example.com');
  });

  it('refuses a tenant session claiming a row by setting connection_id on an update', async () => {
    const connectionId = await recordConnection(alice.db, { organizationId: alice.organizationId, connectorKey: FIXTURE_CONNECTOR });
    const { resourceId: fileResourceId } = await uploadImportFile(alice.db, { files: supabaseFileStore(alice.db, BUCKET),
      organizationId: alice.organizationId,
      file: new File(['name,email\nA,a@example.test\n'], 'leads.csv', { type: 'text/csv' }),
    });

    const { error } = await alice.db
      .from('integration_resources')
      .update({ connection_id: connectionId })
      .eq('id', fileResourceId);

    expect(error).not.toBeNull();
    expect(error!.code).toBe('42501');
  });

  it('lets integration_operator record and correct a managed resource', async () => {
    const connectionId = await recordConnection(alice.db, { organizationId: alice.organizationId, connectorKey: FIXTURE_CONNECTOR });

    const firstId = await asIntegrationOperator(async () => {
      const { rows } = await pg.query(
        `select public.record_managed_integration_resource($1, 'cloudflare_zone', 'zone-1', 'example.com', '{"status":"active"}'::jsonb) as id`,
        [connectionId],
      );
      return rows[0].id as string;
    });

    // Recording the same (connection, resource_type, external_id) again corrects the same row —
    // the upsert this door exists to make safe under a retry.
    const secondId = await asIntegrationOperator(async () => {
      const { rows } = await pg.query(
        `select public.record_managed_integration_resource($1, 'cloudflare_zone', 'zone-1', 'example.com', '{"status":"pending"}'::jsonb) as id`,
        [connectionId],
      );
      return rows[0].id as string;
    });
    expect(secondId).toBe(firstId);

    const { data, error } = await alice.db.from('integration_resources').select('metadata').eq('id', firstId).maybeSingle();
    expect(error).toBeNull();
    expect(data?.metadata).toEqual({ status: 'pending' });
  });

  it('is unaffected across organizations: bob cannot see or touch alice’s connection-scoped resource', async () => {
    const connectionId = await recordConnection(alice.db, { organizationId: alice.organizationId, connectorKey: FIXTURE_CONNECTOR });
    const resourceId = await asIntegrationOperator(async () => {
      const { rows } = await pg.query(
        `select public.record_managed_integration_resource($1, 'cloudflare_zone', 'zone-iso', 'alice-only.example.com', '{}'::jsonb) as id`,
        [connectionId],
      );
      return rows[0].id as string;
    });

    const { data: bobRead } = await bob.db.from('integration_resources').select('id').eq('id', resourceId);
    expect(bobRead).toEqual([]);

    const { error: bobWrite } = await bob.db
      .from('integration_resources')
      .update({ display_name: 'hijacked' })
      .eq('id', resourceId);
    // Either RLS matches no row (silent no-op) or refuses outright — never a change.
    void bobWrite;
    const { rows } = await pg.query('select display_name from public.integration_resources where id = $1', [resourceId]);
    expect(rows[0].display_name).toBe('alice-only.example.com');
  });

  it('leaves the ordinary tenant-owned import-file flow working exactly as before', async () => {
    const { resourceId, parsed } = await uploadImportFile(alice.db, { files: supabaseFileStore(alice.db, BUCKET),
      organizationId: alice.organizationId,
      file: new File(['name,email\nJane,jane@example.test\n'], 'leads.csv', { type: 'text/csv' }),
    });
    expect(parsed.totalRows).toBe(1);

    const { data, error } = await alice.db
      .from('integration_resources')
      .select('connection_id, resource_type')
      .eq('id', resourceId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).toMatchObject({ connection_id: null, resource_type: 'file_upload' });

    // And a tenant may still edit its own file resource's own row (no connection_id involved).
    const update = await alice.db.from('integration_resources').update({ display_name: 'Renamed import' }).eq('id', resourceId);
    expect(update.error).toBeNull();
  });
});

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assistantMayRead, listGrantedResourceIds, setAssistantAccess } from '@/lib/domain/integrations/assistant-grants';
import { recordConnection } from '@/lib/domain/integrations/connections';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Connected is not permitted. A connection authorizes an outside app; the assistant may read a
 * resource only when somebody with `integration.manage` named that resource, and only while the
 * resource and its connection are both active.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SUFFIX = randomUUID().slice(0, 6);
const FIXTURE = `grants_${SUFFIX}`;

type Tenant = { db: SupabaseClient; organizationId: string };

let pg: Client;
let owner: Tenant;
let other: Tenant;
let connectionId: string;
let resourceId: string;

async function newTenant(label: string): Promise<Tenant> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${SUFFIX}`, currency: 'EUR' });
  return { db, organizationId: organizationId as string };
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  owner = await newTenant('grants-owner');
  other = await newTenant('grants-other');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  await pg.query(
    `insert into public.platform_connectors (key, name, category, status, auth_method, connection_method, is_public)
     values ($1, 'Grants app', 'Testing', 'live', 'none', 'custom', true)`,
    [FIXTURE],
  );

  connectionId = await recordConnection(owner.db, { organizationId: owner.organizationId, connectorKey: FIXTURE, accountLabel: 'Grants file' });
  await pg.query("update public.integration_connections set status = 'active' where id = $1", [connectionId]);
  const inserted = await pg.query(
    `insert into public.integration_resources (organization_id, connection_id, resource_type, external_id, display_name)
     values ($1, $2, 'sheet', $3, 'Leads') returning id`,
    [owner.organizationId, connectionId, `ext-${SUFFIX}`],
  );
  resourceId = inserted.rows[0].id;
}, 60_000);

afterAll(async () => {
  await pg.query('delete from public.integration_connections where connector_key = $1', [FIXTURE]);
  await pg.query('delete from public.platform_connectors where key = $1', [FIXTURE]);
  await pg.end();
});

describe('the assistant reads only what somebody granted', () => {
  it('starts with no access, even on an active connection', async () => {
    expect(await assistantMayRead(owner.db, { organizationId: owner.organizationId, resourceId })).toBe(false);
    expect((await listGrantedResourceIds(owner.db, { organizationId: owner.organizationId, resourceIds: [resourceId] })).size).toBe(0);
  });

  it('allows a resource once granted, and withdrawing ends it', async () => {
    await setAssistantAccess(owner.db, { organizationId: owner.organizationId, resourceId, allowed: true });
    await setAssistantAccess(owner.db, { organizationId: owner.organizationId, resourceId, allowed: true }); // idempotent
    expect(await assistantMayRead(owner.db, { organizationId: owner.organizationId, resourceId })).toBe(true);

    await setAssistantAccess(owner.db, { organizationId: owner.organizationId, resourceId, allowed: false });
    expect(await assistantMayRead(owner.db, { organizationId: owner.organizationId, resourceId })).toBe(false);
  });

  it('stops honouring a grant when the connection is disconnected or the resource disabled, without deleting it', async () => {
    await setAssistantAccess(owner.db, { organizationId: owner.organizationId, resourceId, allowed: true });

    await pg.query("update public.integration_connections set status = 'disconnected' where id = $1", [connectionId]);
    expect(await assistantMayRead(owner.db, { organizationId: owner.organizationId, resourceId })).toBe(false);
    await pg.query("update public.integration_connections set status = 'active' where id = $1", [connectionId]);

    await pg.query("update public.integration_resources set status = 'disabled' where id = $1", [resourceId]);
    expect(await assistantMayRead(owner.db, { organizationId: owner.organizationId, resourceId })).toBe(false);
    await pg.query("update public.integration_resources set status = 'active' where id = $1", [resourceId]);

    expect(await assistantMayRead(owner.db, { organizationId: owner.organizationId, resourceId })).toBe(true);
  });

  it('never lets another business grant, read or revoke it', async () => {
    await expect(
      setAssistantAccess(other.db, { organizationId: owner.organizationId, resourceId, allowed: true }),
    ).rejects.toThrow();
    expect(await assistantMayRead(other.db, { organizationId: owner.organizationId, resourceId })).toBe(false);
    expect((await listGrantedResourceIds(other.db, { organizationId: owner.organizationId, resourceIds: [resourceId] })).size).toBe(0);

    await setAssistantAccess(other.db, { organizationId: owner.organizationId, resourceId, allowed: false });
    expect(await assistantMayRead(owner.db, { organizationId: owner.organizationId, resourceId })).toBe(true); // the delete matched nothing
  });

  it('refuses a grant that names somebody else as the granter, and has no update grant', async () => {
    await pg.query('delete from public.assistant_resource_grants where resource_id = $1', [resourceId]);
    const forged = await owner.db.from('assistant_resource_grants').insert({
      organization_id: owner.organizationId,
      resource_id: resourceId,
      granted_by: (await other.db.auth.getUser()).data.user!.id,
    });
    expect(forged.error?.code).toBe('42501');

    const update = await owner.db.from('assistant_resource_grants').update({ resource_id: resourceId }).eq('organization_id', owner.organizationId);
    expect(update.error?.code).toBe('42501');
  });
});

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordConnection } from '@/lib/domain/integrations/connections';
import {
  connectorUsage,
  getConnector,
  listOrganizationConnections,
  setConnectorApp,
  upsertConnector,
  type ConnectorInput,
} from '@/lib/domain/integrations/connectors';
import { groupByCategory, publishedConnectors } from '@/lib/domain/integrations/published';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * The connector catalogue, against real Postgres. A connector is an outside app a business may
 * authorize; it is neither a provider (`platform_providers`) nor a business's own connection
 * (`integration_connections`). What this proves is that the *table* refuses a connection to a
 * connector that is planned or private — not that a screen hides a button.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const admin = () =>
  createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const SUFFIX = randomUUID().slice(0, 6);
const BETA = `beta_${SUFFIX}`;
const PRIVATE = `private_${SUFFIX}`;
const EDITED = `edited_${SUFFIX}`;

let pg: Client;
let staff: SupabaseClient;
let tenant: { db: SupabaseClient; organizationId: string };

async function newTenant(label: string) {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} ${SUFFIX}`, currency: 'EUR' });
  return { db, organizationId: organizationId as string };
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  staff = await asPlatformStaff();
  tenant = await newTenant('connector-tenant');

  // Fixtures the catalogue has no write door for yet, so they are placed as the database owner does.
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  await pg.query(
    `insert into public.platform_connectors (key, name, category, status, auth_method, connection_method, is_public) values
       ($1, 'Beta app', 'Testing', 'beta', 'none', 'custom', true),
       ($2, 'Private app', 'Testing', 'live', 'none', 'custom', false)`,
    [BETA, PRIVATE],
  );
}, 60_000);

afterAll(async () => {
  await pg.query('delete from public.integration_connections where connector_key = any($1)', [[BETA, PRIVATE, EDITED]]);
  await pg.query('delete from public.platform_connectors where key = any($1)', [[BETA, PRIVATE, EDITED]]);
  await pg.end();
});

describe('the connector catalogue', () => {
  it('seeds the named connectors as data, and marks only the one that runs as live', async () => {
    const { data, error } = await tenant.db.from('platform_connectors').select('key, status').eq('is_public', true);
    expect(error).toBeNull();
    const byKey = new Map((data ?? []).map((row) => [row.key, row.status]));
    for (const key of ['google_workspace', 'microsoft_365', 'notion', 'slack', 'hubspot', 'salesforce', 'quickbooks', 'shopify', 'dropbox', 'csv']) {
      expect(byKey.has(key), key).toBe(true);
    }
    expect(byKey.get('csv')).toBe('live');
    expect(byKey.get('google_workspace')).toBe('planned');
  });

  it('shows a business only public connectors, and staff every one', async () => {
    const asTenant = await tenant.db.from('platform_connectors').select('key').in('key', [BETA, PRIVATE]);
    expect((asTenant.data ?? []).map((row) => row.key)).toEqual([BETA]);

    const asStaff = await staff.from('platform_connectors').select('key').in('key', [BETA, PRIVATE]);
    expect((asStaff.data ?? []).map((row) => row.key).sort()).toEqual([BETA, PRIVATE].sort());
  });

  it('grants nobody a write on the catalogue', async () => {
    for (const client of [tenant.db, staff]) {
      const insert = await client.from('platform_connectors').insert({
        key: `nope_${SUFFIX}`, name: 'x', category: 'x', auth_method: 'none', connection_method: 'custom',
      });
      expect(insert.error?.code).toBe('42501');
      const update = await client.from('platform_connectors').update({ status: 'live' }).eq('key', 'notion');
      expect(update.error?.code).toBe('42501');
    }
  });

  it('refuses a connection to a planned connector, at the table', async () => {
    await expect(
      recordConnection(tenant.db, { organizationId: tenant.organizationId, connectorKey: 'notion' }),
    ).rejects.toThrow();

    const direct = await tenant.db.from('integration_connections').insert({
      organization_id: tenant.organizationId,
      connector_key: 'notion',
      connected_by: (await tenant.db.auth.getUser()).data.user!.id,
    });
    expect(direct.error?.code).toBe('42501');
  });

  it('refuses a connection to a private connector the business cannot see', async () => {
    await expect(
      recordConnection(tenant.db, { organizationId: tenant.organizationId, connectorKey: PRIVATE }),
    ).rejects.toThrow();
  });

  it('refuses a connection to a key nobody catalogued', async () => {
    await expect(
      recordConnection(tenant.db, { organizationId: tenant.organizationId, connectorKey: 'not_a_connector' }),
    ).rejects.toThrow();
  });

  it('allows a connection to a beta connector, and the catalogue edit never rewrites it', async () => {
    const id = await recordConnection(tenant.db, { organizationId: tenant.organizationId, connectorKey: BETA });
    expect(id).toBeTruthy();

    await pg.query("update public.platform_connectors set status = 'planned' where key = $1", [BETA]);
    const kept = await tenant.db.from('integration_connections').select('connector_key, status').eq('id', id).single();
    expect(kept.data).toMatchObject({ connector_key: BETA });
  });

  it('keeps a connector distinct from a provider', async () => {
    const providers = await staff.from('platform_providers').select('key');
    const connectors = await staff.from('platform_connectors').select('key');
    const providerKeys = new Set((providers.data ?? []).map((row) => row.key));
    for (const row of connectors.data ?? []) expect(providerKeys.has(row.key), row.key).toBe(false);
  });
});

const DRAFT: ConnectorInput = {
  key: EDITED,
  name: 'Edited app',
  description: 'Operational text.',
  category: 'Testing',
  suite: null,
  status: 'planned',
  authMethod: 'oauth2',
  connectionMethod: 'native',
  isPublic: false,
  displayOrder: 5,
  iconRef: null,
  marketingSlug: `edited-${SUFFIX}`,
  marketingSummary: 'Public summary.',
  marketingDescription: 'Public description.',
  capabilities: ['app_connections'],
};

describe('editing the catalogue as platform staff', () => {
  it('turns planned into beta into public as data, and a business sees each step', async () => {
    await upsertConnector(staff, DRAFT);
    expect(await getConnector(tenant.db, EDITED)).toBeNull(); // private: invisible to a business

    await upsertConnector(staff, { ...DRAFT, status: 'beta', isPublic: true });
    const seen = await getConnector(tenant.db, EDITED);
    expect(seen).toMatchObject({ status: 'beta', isPublic: true, marketingSummary: 'Public summary.' });
  });

  it('keeps operational and public copy independent', async () => {
    await upsertConnector(staff, { ...DRAFT, status: 'beta', isPublic: true, marketingDescription: 'Rewritten for the site.' });
    const after = await getConnector(staff, EDITED);
    expect(after).toMatchObject({ description: 'Operational text.', status: 'beta', marketingDescription: 'Rewritten for the site.' });
  });

  it('refuses the door to a business, and a value the table forbids', async () => {
    await expect(upsertConnector(tenant.db, DRAFT)).rejects.toThrow(/platform staff/);
    await expect(upsertConnector(staff, { ...DRAFT, capabilities: ['nonsense' as never] })).rejects.toThrow();
  });

  it('shows the apps inside a suite exactly as visibly as the connector', async () => {
    const google = await getConnector(tenant.db, 'google_workspace');
    expect(google?.apps.map((app) => app.key)).toEqual(['drive', 'calendar', 'gmail', 'docs', 'sheets']);

    await setConnectorApp(staff, { connectorKey: PRIVATE, key: 'inner', name: 'Inner', description: '', displayOrder: 1 });
    const hidden = await tenant.db.from('platform_connector_apps').select('key').eq('key', 'inner');
    expect(hidden.data).toEqual([]);
    await expect(
      setConnectorApp(tenant.db, { connectorKey: PRIVATE, key: 'x', name: 'X', description: '', displayOrder: 0 }),
    ).rejects.toThrow(/platform staff/);
  });
});

describe('support visibility of a business connections', () => {
  it('shows staff the metadata and never a credential, and refuses a business', async () => {
    await recordConnection(tenant.db, { organizationId: tenant.organizationId, connectorKey: 'csv', accountLabel: 'Leads export' });

    const rows = await listOrganizationConnections(staff, { organizationId: tenant.organizationId });
    const csv = rows.find((row) => row.connectorKey === 'csv');
    expect(csv).toMatchObject({ connectorName: 'CSV / spreadsheet file', accountLabel: 'Leads export', hasCredential: false });
    expect(Object.keys(csv ?? {}).some((key) => /secret|token|credential$/i.test(key) && key !== 'hasCredential')).toBe(false);

    await expect(listOrganizationConnections(tenant.db, { organizationId: tenant.organizationId })).rejects.toThrow(/platform staff/);
  });

  it('returns nothing about another business to a business asking directly', async () => {
    const direct = await tenant.db.from('integration_connections').select('id').neq('organization_id', tenant.organizationId);
    expect(direct.data).toEqual([]);
  });
});

describe('platform usage of the catalogue', () => {
  it('shows staff counts per connector, and refuses a business', async () => {
    await recordConnection(tenant.db, { organizationId: tenant.organizationId, connectorKey: 'csv', accountLabel: 'Usage export' });
    const usage = await connectorUsage(staff);
    expect(usage.get('csv')?.organizations).toBeGreaterThanOrEqual(1);
    expect(Object.keys(usage.get('csv') ?? {}).sort()).toEqual(['activeConnections', 'attentionConnections', 'organizations']);
    await expect(connectorUsage(tenant.db)).rejects.toThrow(/platform staff/);
  });
});

describe('the published catalogue', () => {
  const anon = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

  it('is readable without a session, and carries public columns only', async () => {
    const rows = await publishedConnectors(anon());
    expect(rows.map((row) => row.key)).toContain('google_workspace');
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ['apps', 'category', 'description', 'key', 'logoUrl', 'name', 'slug', 'status', 'suite', 'summary'].sort(),
      );
    }
    expect(rows.find((row) => row.key === 'google_workspace')?.apps).toContain('Drive');
  });

  it('gives an anonymous caller no way to read the catalogue table itself', async () => {
    const direct = await anon().from('platform_connectors').select('key');
    expect(direct.error?.code).toBe('42501');
  });

  it('publishes a row only when it is public and has public copy', async () => {
    await pg.query("update public.platform_connectors set is_public = true, marketing_summary = '' where key = $1", [BETA]);
    expect((await publishedConnectors(anon())).map((row) => row.key)).not.toContain(BETA);
    await pg.query("update public.platform_connectors set marketing_summary = 'Now published.' where key = $1", [BETA]);
    expect((await publishedConnectors(anon())).find((row) => row.key === BETA)?.summary).toBe('Now published.');
    await pg.query('update public.platform_connectors set is_public = false where key = $1', [BETA]);
    expect((await publishedConnectors(anon())).map((row) => row.key)).not.toContain(BETA);
    expect((await publishedConnectors(anon())).map((row) => row.key)).not.toContain(PRIVATE);
  });

  it('follows an admin edit of the public copy and never shows a provider', async () => {
    await upsertConnector(staff, { ...DRAFT, status: 'beta', isPublic: true, marketingSummary: 'First wording.' });
    expect((await publishedConnectors(anon())).find((row) => row.key === EDITED)?.summary).toBe('First wording.');
    await upsertConnector(staff, { ...DRAFT, status: 'beta', isPublic: true, marketingSummary: 'Second wording.' });
    const rows = await publishedConnectors(anon());
    expect(rows.find((row) => row.key === EDITED)?.summary).toBe('Second wording.');

    const providers = await staff.from('platform_providers').select('key');
    const published = new Set(rows.map((row) => row.key));
    for (const provider of providers.data ?? []) expect(published.has(provider.key), provider.key).toBe(false);
  });

  it('groups by whatever categories the catalogue holds', () => {
    const groups = groupByCategory([
      { key: 'a', category: 'X' }, { key: 'b', category: 'Y' }, { key: 'c', category: 'X' },
    ] as never);
    expect(groups.map((group) => [group.category, group.items.length])).toEqual([['X', 2], ['Y', 1]]);
  });

  it('leaves the marketing site with no connector or vendor list of its own', () => {
    const root = join(__dirname, '..', '..', '..');
    const content = readFileSync(join(root, 'lib/marketing/content.ts'), 'utf8');
    const page = readFileSync(join(root, 'app/(marketing)/integrations/page.tsx'), 'utf8');
    expect(content).not.toMatch(/export const INTEGRATIONS/);
    expect(page).toContain('getPublishedConnectors');
    for (const vendor of ['Twilio', 'Resend', 'OpenAI', 'Anthropic']) expect(page, vendor).not.toContain(vendor);
  });
});

describe('the tenant communications settings', () => {
  it('offers no wholesale AI or speech vendor to a business', () => {
    const page = readFileSync(join(__dirname, '..', '..', '..', 'app/organizations/[organizationId]/settings/communications/page.tsx'), 'utf8');
    for (const vendor of ['anthropic', 'openai_compatible', 'deepgram', 'elevenlabs']) expect(page, vendor).not.toContain(vendor);
    expect(page).toContain('title="Communications"');
  });
});

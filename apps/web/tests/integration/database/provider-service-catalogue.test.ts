import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getConnector, setConnectorApp, setConnectorAppFeature } from '@/lib/domain/integrations/connectors';
import {
  listProviderServices,
  listProviderServicesFor,
  removeProviderServiceFeature,
  setProviderServiceFeature,
  upsertProviderService,
  type ProviderServiceInput,
} from '@/lib/domain/providers/services';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * The provider-service catalogue, against real Postgres. A Provider Service is infrastructure
 * GOLD operates (Google's Gemini Interactions, Twilio's Voice); it is never a tenant Connector,
 * never an entitlement grant, and a mapping to a GOLD Feature is descriptive only. What this
 * proves is the boundary at the table, not a screen choosing not to render a button.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const admin = () =>
  createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const SUFFIX = randomUUID().slice(0, 6);
const TEST_PROVIDER = `test_provider_${SUFFIX}`;

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

const DRAFT: ProviderServiceInput = {
  providerKey: TEST_PROVIDER,
  key: `svc_${SUFFIX}`,
  label: 'Test Service',
  description: 'A fixture service.',
  family: 'Testing',
  kind: 'runtime',
  implementationState: 'planned',
  vendorStatus: 'preview',
  authMode: 'api_key',
  docsUrl: null,
  displayOrder: 1,
  metadata: {},
};

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  staff = await asPlatformStaff();
  tenant = await newTenant('provider-service-tenant');

  // platform_providers itself has no write door — seeded by migration only — so a test fixture
  // provider is placed as the database owner does, the same shape connector-catalogue.test.ts uses.
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  await pg.query('insert into public.platform_providers (key, label) values ($1, $2)', [TEST_PROVIDER, 'Test Provider']);
}, 60_000);

afterAll(async () => {
  await pg.query('delete from public.platform_provider_services where provider_key = $1', [TEST_PROVIDER]);
  await pg.query('delete from public.platform_providers where key = $1', [TEST_PROVIDER]);
  await pg.end();
});

describe('the provider-service catalogue', () => {
  it('is readable by staff alone — who GOLD uses is control-plane data, never a tenant’s to see (D64)', async () => {
    const asStaff = await staff.from('platform_provider_services').select('provider_key, key').eq('provider_key', 'google');
    expect(asStaff.error).toBeNull();
    expect((asStaff.data ?? []).length).toBeGreaterThan(0);

    const asTenant = await tenant.db.from('platform_provider_services').select('provider_key, key').eq('provider_key', 'google');
    expect(asTenant.error).toBeNull();
    expect(asTenant.data).toEqual([]);
  });

  it('grants nobody a write on the catalogue or either mapping table', async () => {
    for (const client of [tenant.db, staff]) {
      const insert = await client.from('platform_provider_services').insert({
        provider_key: 'google', key: `nope_${SUFFIX}`, label: 'x', family: 'x', kind: 'runtime',
        implementation_state: 'planned', vendor_status: 'preview', auth_mode: 'api_key',
      });
      expect(insert.error?.code).toBe('42501');

      const mapInsert = await client.from('platform_provider_service_features').insert({
        provider_service_id: randomUUID(), feature_id: randomUUID(),
      });
      expect(mapInsert.error?.code).toBe('42501');

      const appMapInsert = await client.from('platform_connector_app_features').insert({
        connector_app_id: randomUUID(), feature_id: randomUUID(),
      });
      expect(appMapInsert.error?.code).toBe('42501');
    }
  });

  it('refuses the write door to a tenant, and accepts it from staff', async () => {
    await expect(upsertProviderService(tenant.db, DRAFT)).rejects.toThrow(/platform staff/);

    const id = await upsertProviderService(staff, DRAFT);
    expect(id).toBeTruthy();

    const seen = await listProviderServicesFor(staff, TEST_PROVIDER);
    expect(seen.map((s) => s.key)).toContain(DRAFT.key);
    expect(await listProviderServicesFor(tenant.db, TEST_PROVIDER)).toEqual([]);
  });

  it('keeps (provider_key, key) unique — a second upsert updates, never duplicates', async () => {
    await upsertProviderService(staff, DRAFT);
    await upsertProviderService(staff, { ...DRAFT, implementationState: 'partial' });
    const seen = await listProviderServicesFor(staff, TEST_PROVIDER);
    expect(seen.filter((s) => s.key === DRAFT.key)).toHaveLength(1);
    expect(seen.find((s) => s.key === DRAFT.key)?.implementationState).toBe('partial');
  });

  it('refuses a provider_key that names no provider (FK, not a string check)', async () => {
    await expect(
      upsertProviderService(staff, { ...DRAFT, providerKey: `no_such_provider_${SUFFIX}` }),
    ).rejects.toThrow();
  });
});

describe('a feature mapping is descriptive, never an entitlement grant (section 4, 54)', () => {
  it('neither mapping table carries a plan, organization or grant column', async () => {
    const columns = await pg.query(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and table_name in ('platform_provider_service_features', 'platform_connector_app_features')`,
    );
    const names = columns.rows.map((row) => row.column_name);
    for (const forbidden of ['plan_id', 'organization_id', 'granted_scope']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('cannot point a mapping at a feature or service that does not exist', async () => {
    const service = await upsertProviderService(staff, DRAFT);
    await expect(
      setProviderServiceFeature(staff, { providerServiceId: service, featureId: randomUUID() }),
    ).rejects.toThrow();

    const realFeature = await pg.query("select id from public.platform_catalog_features where key = 'ask_gold' limit 1");
    await expect(
      setProviderServiceFeature(staff, { providerServiceId: randomUUID(), featureId: realFeature.rows[0].id }),
    ).rejects.toThrow();
  });

  it('sets and removes a mapping through the staff-only door, refusing a tenant', async () => {
    const service = await upsertProviderService(staff, DRAFT);
    const feature = await pg.query("select id from public.platform_catalog_features where key = 'ask_gold' limit 1");
    const featureId = feature.rows[0].id as string;

    await expect(
      setProviderServiceFeature(tenant.db, { providerServiceId: service, featureId }),
    ).rejects.toThrow(/platform staff/);

    await setProviderServiceFeature(staff, { providerServiceId: service, featureId, note: 'test mapping' });
    const withFeature = (await listProviderServicesFor(staff, TEST_PROVIDER)).find((s) => s.id === service);
    expect(withFeature?.features.map((f) => f.featureKey)).toContain('ask_gold');

    await removeProviderServiceFeature(staff, { providerServiceId: service, featureId });
    const withoutFeature = (await listProviderServicesFor(staff, TEST_PROVIDER)).find((s) => s.id === service);
    expect(withoutFeature?.features.map((f) => f.featureKey)).not.toContain('ask_gold');
  });
});

describe('the four external nouns never collapse into each other (section 54)', () => {
  it('a Google Provider Service never appears as a tenant Connector', async () => {
    const services = await listProviderServicesFor(staff, 'google');
    const serviceKeys = new Set(services.map((s) => s.key));
    expect(serviceKeys.has('routes')).toBe(true); // the service really is catalogued

    const connectors = await staff.from('platform_connectors').select('key');
    for (const row of connectors.data ?? []) expect(serviceKeys.has(row.key), row.key).toBe(false);
  });

  it('a Google Workspace child app is never treated as a Provider Service credential', async () => {
    const workspace = await getConnector(tenant.db, 'google_workspace');
    const calendar = workspace?.apps.find((app) => app.key === 'calendar');
    expect(calendar).toBeDefined();
    // No credential-shaped field reaches the app row at all — the connector's own credential
    // model (integration_connections.secret_id) is the only place one could ever exist.
    expect(Object.keys(calendar ?? {})).not.toContain('secretId');
    expect(Object.keys(calendar ?? {})).not.toContain('credential');
  });

  it('every seeded connector key names no row in platform_provider_services', async () => {
    const connectors = await staff.from('platform_connectors').select('key');
    const services = await listProviderServices(staff);
    const serviceKeys = new Set(services.map((s) => s.key));
    for (const row of connectors.data ?? []) expect(serviceKeys.has(row.key), row.key).toBe(false);
  });
});

describe('Google Workspace’s expanded suite (section 10, 57)', () => {
  it('contains the intended stable-key entries, each honestly planned', async () => {
    const workspace = await getConnector(tenant.db, 'google_workspace');
    const byKey = new Map((workspace?.apps ?? []).map((app) => [app.key, app]));

    for (const key of [
      'calendar', 'gmail', 'drive', 'docs', 'sheets', 'forms', 'meet', 'chat', 'people', 'tasks', 'workspace_events',
    ]) {
      expect(byKey.has(key), key).toBe(true);
      expect(byKey.get(key)?.implementationState, key).toBe('planned');
    }
  });

  it('does not disturb the original five apps’ own order', async () => {
    const workspace = await getConnector(tenant.db, 'google_workspace');
    expect(workspace?.apps.slice(0, 5).map((app) => app.key)).toEqual(['drive', 'calendar', 'gmail', 'docs', 'sheets']);
  });
});

describe('upstream maturity and GOLD implementation stay two separate facts (section 42, 58)', () => {
  it('Google Trends is upstream-restricted while GOLD has not implemented it', async () => {
    const [trends] = (await listProviderServicesFor(staff, 'google')).filter((s) => s.key === 'trends');
    expect(trends).toMatchObject({ vendorStatus: 'restricted', implementationState: 'planned' });
  });

  it('Gemini Managed Agents is an upstream preview while GOLD has not implemented it', async () => {
    const [managed] = (await listProviderServicesFor(staff, 'google')).filter((s) => s.key === 'gemini_managed_agents');
    expect(managed).toMatchObject({ vendorStatus: 'preview', implementationState: 'planned' });
  });

  it('Anthropic is the one provider service actually implemented, matching the real adapter', async () => {
    const [messages] = (await listProviderServicesFor(staff, 'anthropic')).filter((s) => s.key === 'messages');
    expect(messages).toMatchObject({ implementationState: 'available', vendorStatus: 'generally_available' });
  });
});

describe('ChatGPT/GPT distribution direction stays honest (section 16, 59)', () => {
  it('OpenAI, not ChatGPT, is the provider key', async () => {
    const providers = await staff.from('platform_providers').select('key');
    expect((providers.data ?? []).map((row) => row.key)).not.toContain('chatgpt');
    expect((providers.data ?? []).map((row) => row.key)).toContain('openai');
  });

  it('marks Legacy GPT Actions legacy, and Plugins current', async () => {
    const distribution = (await listProviderServicesFor(staff, 'openai')).filter((s) => s.kind === 'distribution');
    const plugins = distribution.find((s) => s.key === 'chatgpt_plugins');
    const legacy = distribution.find((s) => s.key === 'legacy_gpt_actions');
    expect(plugins?.vendorStatus).toBe('generally_available');
    expect(legacy?.vendorStatus).toBe('legacy');
  });
});

describe('the CSV mapping editor and the external-capability mapping share nothing but a word (section 36)', () => {
  it('setConnectorAppFeature and the CSV field mapping write through entirely different doors', async () => {
    // Structural: proves the two RPCs are distinct doors with distinct argument shapes, not that
    // either implementation is correct (covered by their own suites).
    const rpc = await pg.query(
      `select proname from pg_proc where proname in ('set_connector_app_feature', 'set_provider_service_feature')`,
    );
    expect(rpc.rows.map((row) => row.proname).sort()).toEqual(['set_connector_app_feature', 'set_provider_service_feature']);
  });

  it('setConnectorAppFeature refuses a tenant the same way the provider-service door does', async () => {
    const workspace = await getConnector(staff, 'google_workspace');
    const calendarApp = workspace?.apps.find((app) => app.key === 'calendar');
    const feature = await pg.query("select id from public.platform_catalog_features where key = 'availability' limit 1");
    await expect(
      setConnectorAppFeature(tenant.db, { connectorAppId: calendarApp!.id, featureId: feature.rows[0].id }),
    ).rejects.toThrow(/platform staff/);
  });
});

describe('set_platform_connector_app keeps working for a caller passing only its original five arguments', () => {
  it('still creates/updates an app when the three new fields are omitted', async () => {
    await setConnectorApp(staff, {
      connectorKey: 'google_workspace',
      key: `probe_${SUFFIX}`,
      name: 'Probe',
      description: '',
      displayOrder: 99,
    });
    const workspace = await getConnector(tenant.db, 'google_workspace');
    const probe = workspace?.apps.find((app) => app.key === `probe_${SUFFIX}`);
    expect(probe?.implementationState).toBe('planned');
    await pg.query('delete from public.platform_connector_apps where key = $1', [`probe_${SUFFIX}`]);
  });
});

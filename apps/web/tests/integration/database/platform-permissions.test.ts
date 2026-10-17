import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { platformOverview } from '@/lib/application/platform/platform-overview';
import { foundBusiness } from '@/tests/support/founding';
import { PLATFORM_CAPABILITIES, platformPermissions } from '@/lib/domain/platform/permissions';
import { platformDestinationsFor } from '@/lib/platform-navigation';

// Real PostgREST calls and PostgreSQL policies enforce the same live staff capabilities.

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function signedInUser(label: string): Promise<{ db: SupabaseClient; userId: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signedIn = await db.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  return { db, userId: data.user.id };
}

/** Written over a direct connection, as every staff row is — nothing in the application may write one. */
async function makeStaff(userId: string, capabilities?: string[]) {
  const pg = new Client(CONNECTION);
  await pg.connect();
  try {
    if (capabilities) {
      await pg.query('insert into public.platform_staff (user_id, name, capabilities) values ($1, $2, $3)', [
        userId,
        'Operator',
        capabilities,
      ]);
    } else {
      await pg.query('insert into public.platform_staff (user_id, name) values ($1, $2)', [userId, 'Operator']);
    }
  } finally {
    await pg.end();
  }
}

describe('platform permissions on the staff row', () => {
  beforeAll(() => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  });

  it('gives a member of staff everything by default, so no existing operator lost a door', async () => {
    const { db, userId } = await signedInUser('perm-default');
    await makeStaff(userId);
    expect([...(await platformPermissions(db))].sort()).toEqual([...PLATFORM_CAPABILITIES].sort());
  });

  it('reads exactly the permissions a narrower row names', async () => {
    const { db, userId } = await signedInUser('perm-limited');
    await makeStaff(userId, ['platform.providers']);
    const permissions = await platformPermissions(db);
    expect([...permissions]).toEqual(['platform.providers']);
    expect(platformDestinationsFor(permissions).map((destination) => destination.key)).toEqual(['providers', 'ai-runtime']);
  });

  it('reads a permission removed on the next request, not at the next sign-in', async () => {
    const { db, userId } = await signedInUser('perm-live');
    await makeStaff(userId, ['platform.providers', 'platform.health']);
    expect((await platformPermissions(db)).has('platform.health')).toBe(true);

    const pg = new Client(CONNECTION);
    await pg.connect();
    await pg.query("update public.platform_staff set capabilities = array['platform.providers'] where user_id = $1", [userId]);
    await pg.end();

    expect((await platformPermissions(db)).has('platform.health')).toBe(false);
  });

  it('is empty for somebody who is not staff — a member of GOLD holds no platform authority', async () => {
    const { db } = await signedInUser('perm-nobody');
    expect((await platformPermissions(db)).size).toBe(0);
  });

  it('refuses a permission the platform does not define', async () => {
    const { userId } = await signedInUser('perm-unknown');
    await expect(makeStaff(userId, ['platform.everything'])).rejects.toThrow(/platform_staff_capabilities_known/);
  });

  it('lets nobody edit their own row through the API — a permission is granted by hand, never self-issued', async () => {
    const { db, userId } = await signedInUser('perm-selfgrant');
    await makeStaff(userId, ['platform.health']);

    const { data, error } = await db
      .from('platform_staff')
      .update({ capabilities: [...PLATFORM_CAPABILITIES] })
      .eq('user_id', userId)
      .select();

    // No update grant exists: a privilege error, or nothing changed. Either way the row is as it was.
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    expect([...(await platformPermissions(db))]).toEqual(['platform.health']);
  });

  it('shows the staff table to nobody who is not staff', async () => {
    const { db } = await signedInUser('perm-outsider');
    const { data } = await db.from('platform_staff').select('user_id');
    expect(data ?? []).toEqual([]);
  });
});

const RPC_CAPABILITIES: Record<string, string> = {
  "start_support_session": "platform.organizations",
  "end_support_session": "platform.organizations",
  "bootstrap_gold_internal_workspace": "platform.organizations",
  "grant_plan_product": "platform.commercial",
  "revoke_plan_product": "platform.commercial",
  "grant_plan_module": "platform.commercial",
  "revoke_plan_module": "platform.commercial",
  "set_plan_feature_override": "platform.commercial",
  "clear_plan_feature_override": "platform.commercial",
  "update_platform_product": "platform.catalogue",
  "update_catalog_product": "platform.catalogue",
  "update_catalog_module": "platform.catalogue",
  "update_catalog_feature": "platform.catalogue",
  "upsert_platform_connector": "platform.catalogue",
  "remove_platform_connector_app": "platform.catalogue",
  "set_connector_app_feature": "platform.catalogue",
  "remove_connector_app_feature": "platform.catalogue",
  "set_platform_connector_app": "platform.catalogue",
  "platform_connector_usage": "platform.catalogue",
  "platform_meter_observations": "platform.catalogue",
  "organization_integration_connections": "platform.organizations",
  "set_provider_binding_status": "platform.providers",
  "record_provider_resource": "platform.providers",
  "store_provider_secret": "platform.providers",
  "set_provider_resource_status": "platform.providers",
  "set_default_provider_account": "platform.providers",
  "record_provider_account": "platform.providers",
  "store_provider_account_credential": "platform.providers",
  "set_provider_account_status": "platform.providers",
  "begin_provider_binding": "platform.providers",
  "record_provider_binding_reconciliation": "platform.providers",
  "platform_provider_organization_overview": "platform.providers",
  "upsert_platform_provider_service": "platform.providers",
  "set_provider_service_feature": "platform.providers",
  "remove_provider_service_feature": "platform.providers",
  "platform_ai_runtime_assignment_overview": "platform.providers",
  "record_ai_runtime_assignment": "platform.providers",
  "sync_phone_number": "platform.providers",
  "record_provider_rate": "platform.commercial",
  "record_product_price": "platform.commercial",
  "record_usage_reconciliation": "platform.commercial",
  "create_plan": "platform.commercial",
  "update_plan": "platform.commercial",
  "set_plan_quota": "platform.commercial",
  "remove_plan_quota": "platform.commercial",
  "record_plan_price": "platform.commercial",
  "record_plan_provider_price": "platform.commercial",
  "record_retail_rate": "platform.commercial",
  "organization_commercial_summary": "platform.commercial",
  "record_plan_margin_policy": "platform.commercial",
  "record_phone_number_month": "platform.commercial",
  "record_provider_cost_rate": "platform.commercial",
  "attach_plan_addon": "platform.commercial",
  "detach_plan_addon": "platform.commercial",
  "platform_usage_cost_components": "platform.commercial",
  "set_plan_allowance": "platform.commercial",
  "record_plan_utilization_assumption": "platform.commercial",
  "set_meter_cost_model_component": "platform.commercial",
  "record_commercial_retail_rate": "platform.commercial",
  "save_commercial_draft_scenario": "platform.commercial",
  "organization_usage_detail": "platform.commercial",
  "platform_usage_economics": "platform.commercial",
  "organization_cost_to_serve": "platform.commercial",
  "organization_revenue_summary": "platform.commercial",
  "platform_revenue_portfolio": "platform.commercial",
  "record_commercial_term": "platform.commercial",
  "record_plan_assignment": "platform.commercial",
  "record_plan_agreement": "platform.commercial",
  "record_plan_quota_override": "platform.commercial",
  "record_organization_plan_agreement": "platform.commercial",
  "compose_organization_charges": "platform.commercial",
  "finalize_organization_charges": "platform.commercial",
  "record_infrastructure_cost": "platform.commercial",
  "record_commercial_adjustment": "platform.commercial",
  "record_agreement_provider_price": "platform.commercial",
  "provision_organization": "platform.organizations",
  "hand_off_accepted_proposal": "platform.organizations",
  "platform_health_summary": "platform.health"
};
describe('granular platform authority at the database boundary', () => {
  let pg: Client;
  const actors = new Map<string, { db: SupabaseClient; userId: string }>();
  const args = new Map<string, Record<string, null>>();
  let organizationId: string;
  let owner: { db: SupabaseClient; userId: string };

  beforeAll(async () => {
    // Never send these mutation fixtures to a hosted database.
    for (const url of [SUPABASE_URL, CONNECTION]) {
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
        throw new Error('Platform authorization fixtures require loopback Supabase.');
      }
    }
    pg = new Client(CONNECTION);
    await pg.connect();
    for (const capability of [...PLATFORM_CAPABILITIES, 'empty', 'outsider']) {
      const actor = await signedInUser('rpc-' + capability.replaceAll('.', '-'));
      if (capability !== 'outsider') await makeStaff(actor.userId, capability === 'empty' ? [] : [capability]);
      actors.set(capability, actor);
    }
    const { rows } = await pg.query<{ proname: string; names: string[] }>(
      'select proname, proargnames[1:pronargs] as names from pg_proc where pronamespace = $1::regnamespace and proname = any($2)',
      ['public', Object.keys(RPC_CAPABILITIES)],
    );
    expect(rows).toHaveLength(Object.keys(RPC_CAPABILITIES).length);
    for (const row of rows) args.set(row.proname, Object.fromEntries((row.names ?? []).map((name) => [name, null])));
    owner = await signedInUser('rpc-tenant-owner');
    const { data } = await owner.db.auth.getUser();
    organizationId = await foundBusiness({ ownerEmail: data.user!.email!, name: 'P0 tenant ' + randomUUID(), currency: 'CAD' });
  });

  afterAll(async () => { await pg?.end(); });

  for (const capability of PLATFORM_CAPABILITIES) {
    it('refuses every foreign platform RPC for ' + capability, async () => {
      const actor = actors.get(capability)!;
      for (const [name, required] of Object.entries(RPC_CAPABILITIES)) {
        if (required === capability) continue;
        const result = await actor.db.rpc(name, args.get(name)!);
        expect(result.error?.code, capability + ' must not execute ' + name).toBe('42501');
      }
    });
  }

  for (const kind of ['empty', 'outsider']) {
    it('refuses every privileged RPC for ' + kind, async () => {
      for (const name of Object.keys(RPC_CAPABILITIES)) {
        const result = await actors.get(kind)!.db.rpc(name, args.get(name)!);
        expect(result.error?.code, kind + ' must not execute ' + name).toBe('42501');
      }
    });
  }

  it('checks revocation on the next direct RPC with the same signed-in session', async () => {
    const actor = actors.get('platform.providers')!;
    expect((await actor.db.rpc('platform_ai_runtime_assignment_overview')).error).toBeNull();
    await pg.query('update public.platform_staff set capabilities = $2 where user_id = $1', [actor.userId, []]);
    try {
      expect((await actor.db.rpc('platform_ai_runtime_assignment_overview')).error?.code).toBe('42501');
    } finally {
      await pg.query('update public.platform_staff set capabilities = $2 where user_id = $1', [actor.userId, ['platform.providers']]);
    }
  });

  it('fails closed for null and unknown helper capabilities', async () => {
    for (const capability of [null, 'platform.everything']) {
      await pg.query('begin');
      try {
        await pg.query("select set_config('request.jwt.claim.sub', $1, true)", [actors.get('platform.providers')!.userId]);
        await pg.query('set local role authenticated');
        await expect(pg.query('select app.require_platform_capability($1)', [capability])).rejects.toMatchObject({ code: '42501' });
      } finally { await pg.query('rollback'); }
    }
  });

  it('keeps staff rows self-readable and prevents enumeration of other staff', async () => {
    const actor = actors.get('platform.health')!;
    const result = await actor.db.from('platform_staff').select('user_id');
    expect(result.error).toBeNull();
    expect(result.data).toEqual([{ user_id: actor.userId }]);
  });

  it('gives health-only staff exact summary counts without raw provider or pricing reads', async () => {
    const actor = actors.get('platform.health')!;
    const overview = await platformOverview(actor.db, { recentLimit: 1 });
    const total = await pg.query('select count(*)::integer as count from public.organizations');
    const rates = await pg.query('select count(*)::integer as count from public.platform_provider_rates');
    expect(overview.organizations.total).toBe(total.rows[0].count);
    expect(overview.organizations.live + overview.organizations.settingUp).toBe(overview.organizations.total);
    expect(overview.organizations.recent).toHaveLength(1);
    expect(overview.rates.provider).toBe(rates.rows[0].count);
    for (const table of ['platform_provider_accounts', 'platform_provider_rates', 'organization_provider_bindings', 'organization_plan_assignments']) {
      const result = await actor.db.from(table).select('id').limit(1);
      expect(result.error, table).toBeNull();
      expect(result.data, table).toEqual([]);
    }
  });

  it('keeps tenant reads scoped even when the owner has no platform capability', async () => {
    const own = await owner.db.from('organizations').select('id').eq('id', organizationId);
    expect(own.error).toBeNull();
    expect(own.data).toEqual([{ id: organizationId }]);
    expect((await owner.db.rpc('organization_allowance_state', { p_organization_id: organizationId })).error).toBeNull();
    const other = await actors.get('platform.providers')!.db.rpc('organization_allowance_state', { p_organization_id: organizationId });
    expect(other.error?.code).toBe('42501');
    const options = await actors.get('platform.providers')!.db.rpc('existing_client_tenant_options', {
      p_organization_id: organizationId, p_customer_id: randomUUID(),
    });
    expect(options.error).toBeNull();
    expect(options.data).toEqual([]);
  });

  it('permits organization-only provisioning and audited support without commercial authority', async () => {
    const actor = actors.get('platform.organizations')!;
    const { data } = await owner.db.auth.getUser();
    const provisioned = await actor.db.rpc('provision_organization', {
      p_owner_email: data.user!.email!, p_name: 'P0 provisioned ' + randomUUID(),
      p_role: 'Admin', p_capabilities: ['organization.manage'], p_display_name: 'Owner',
      p_timezone: 'UTC', p_currency: 'CAD',
    });
    expect(provisioned.error).toBeNull();
    expect(provisioned.data).toBeTruthy();
    const opened = await actor.db.rpc('start_support_session', { p_organization_id: organizationId, p_reason: 'P0 support authorization verification' });
    expect(opened.error).toBeNull();
    expect((await actor.db.rpc('organization_integration_connections', { p_organization_id: organizationId })).error).toBeNull();
    expect((await actor.db.rpc('end_support_session', { p_id: opened.data })).error).toBeNull();
  });

  it('permits commercial-only package changes without catalogue authority', async () => {
    const db = actors.get('platform.commercial')!.db;
    const plan = await db.rpc('create_plan', {
      p_key: 'p0_' + randomUUID().replaceAll('-', ''), p_kind: 'plan', p_label: 'P0 test package',
      p_description: '', p_billable: false, p_sale_status: 'active', p_display_order: 0,
    });
    expect(plan.error).toBeNull();
    const catalogModule = await pg.query('select id from public.platform_catalog_modules limit 1');
    expect(catalogModule.rows).toHaveLength(1);
    const granted = await db.rpc('grant_plan_module', { p_plan_id: plan.data, p_module_id: catalogModule.rows[0].id });
    expect(granted.error).toBeNull();
  });

  it('requires commercial authority in addition to organization authority for the internal bootstrap', async () => {
    const result = await actors.get('platform.organizations')!.db.rpc('bootstrap_gold_internal_workspace', {
      p_organization_id: organizationId, p_role: 'Admin', p_capabilities: ['organization.manage'],
    });
    expect(result.error?.code).toBe('42501');
  });

  it('denies direct handoff insertion and anonymous execution of platform commands', async () => {
    expect((await pg.query("select has_table_privilege('authenticated','public.customer_proposal_handoffs','insert') as allowed")).rows[0].allowed).toBe(false);
    const anonymous = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
    const result = await anonymous.rpc('sync_phone_number', {
      p_organization_id: organizationId, p_provider_resource_id: randomUUID(), p_e164: '+14165550000',
    });
    expect(result.error?.code).toBe('42501');
  });

  it('restricts connector-logo writes to catalogue authority', async () => {
    for (const capability of PLATFORM_CAPABILITIES) {
      await pg.query('begin');
      try {
        await pg.query("select set_config('request.jwt.claim.sub', $1, true)", [actors.get(capability)!.userId]);
        await pg.query('set local role authenticated');
        const write = pg.query('insert into storage.objects(bucket_id,name) values($1,$2)', [
          'connector-logos', 'p0-' + randomUUID(),
        ]);
        if (capability === 'platform.catalogue') expect((await write).rowCount).toBe(1);
        else await expect(write).rejects.toMatchObject({ code: '42501' });
      } finally { await pg.query('rollback'); }
    }
  });

  it('shows a provider account only to the provider operator, independent of staff membership', async () => {
    const created = await actors.get('platform.providers')!.db.rpc('record_provider_account', {
      p_provider_key: 'twilio', p_label: 'P0 local provider account ' + randomUUID(),
      p_external_account_id: null, p_credential_kind: 'api_key', p_credential_identifier: null,
    });
    expect(created.error).toBeNull();
    for (const capability of PLATFORM_CAPABILITIES) {
      const read = await actors.get(capability)!.db.from('platform_provider_accounts').select('id').eq('id', created.data);
      expect(read.error).toBeNull();
      expect(read.data).toEqual(capability === 'platform.providers' ? [{ id: created.data }] : []);
    }
  });
});

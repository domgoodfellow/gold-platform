import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asPlatformStaff, foundBusiness } from '@/tests/support/founding';

/**
 * Which platform tables each kind of caller can read.
 *
 * Every platform table was `using (true)` for `authenticated`, and a booking visitor is
 * `authenticated` (D22). Three classes now, and each is proved from both sides: what the
 * allowed callers see equals the table's real row count, and what the others see is nothing.
 *
 *   vocabulary    any signed-in caller, a booking visitor included
 *   commercial    a member of some business, or staff
 *   control plane staff only
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const VOCABULARY = [
  'platform_meters',
  'platform_products',
  'platform_catalog_products',
  'platform_catalog_modules',
  'platform_catalog_features',
  'platform_catalog_feature_dependencies',
] as const;

const COMMERCIAL = [
  'platform_plans',
  'platform_plan_product_grants',
  'platform_plan_module_grants',
  'platform_plan_feature_grants',
  'platform_plan_quotas',
  'platform_plan_prices',
  'platform_retail_rates',
] as const;

const CONTROL_PLANE = [
  'platform_providers',
  'platform_provider_services',
  'platform_provider_service_features',
  'platform_connector_app_features',
  'platform_plan_provider_prices',
] as const;

const FIXTURE = `visibility-${randomUUID().slice(0, 8)}`;

let pg: Client;
let staff: SupabaseClient;
let member: SupabaseClient;
let visitor: SupabaseClient;
let signedOut: SupabaseClient;

function fresh(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function realCount(table: string): Promise<number> {
  const { rows } = await pg.query(`select count(*)::int as n from public.${table}`);
  return rows[0].n;
}

async function seenBy(db: SupabaseClient, table: string): Promise<number> {
  const { count, error } = await db.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  staff = await asPlatformStaff();

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `vis-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  member = fresh();
  expect((await member.auth.signInWithPassword({ email, password })).error).toBeNull();
  await foundBusiness({ ownerEmail: email, name: `Visibility ${randomUUID().slice(0, 6)}`, currency: 'EUR' });

  visitor = fresh();
  expect((await visitor.auth.signInAnonymously()).error).toBeNull();
  signedOut = fresh();

  // Two tables the seed leaves empty, filled through their own staff doors so the deny has a row
  // to refuse. Removed afterwards over the direct connection.
  const rate = await staff.rpc('record_retail_rate', {
    p_meter_id: 'email_send',
    p_currency: 'EUR',
    p_unit_amount_micros: 1,
    p_source: 'visibility fixture',
    p_source_url: null,
    p_approval_state: 'approved',
    p_note: FIXTURE,
  });
  expect(rate.error).toBeNull();
  const { rows: prices } = await pg.query('select id from public.platform_plan_prices limit 1');
  const provisioned = await staff.rpc('record_plan_provider_price', {
    p_plan_price_id: prices[0].id,
    p_environment: 'sandbox',
    p_product_reference: `prod_${FIXTURE}`,
    p_price_reference: `price_${FIXTURE}`,
    p_provider: 'stripe',
  });
  expect(provisioned.error).toBeNull();
}, 90_000);

afterAll(async () => {
  await pg.query('delete from public.platform_retail_rates where note = $1', [FIXTURE]);
  await pg.query('delete from public.platform_plan_provider_prices where price_reference = $1', [`price_${FIXTURE}`]);
  await pg.end();
});

describe('vocabulary is readable by any signed-in caller', () => {
  for (const table of VOCABULARY) {
    it(`${table}: member, visitor and staff see every row`, async () => {
      const expected = await realCount(table);
      for (const db of [member, visitor, staff]) expect(await seenBy(db, table)).toBe(expected);
    });
  }

  it('the vocabulary tables are not empty, so the equality above is not vacuous', async () => {
    for (const table of ['platform_meters', 'platform_catalog_products', 'platform_catalog_features']) {
      expect(await realCount(table)).toBeGreaterThan(0);
    }
  });
});

describe('commercial configuration is for a member of some business or staff', () => {
  for (const table of COMMERCIAL) {
    it(`${table}: member and staff see every row, a booking visitor sees none`, async () => {
      const expected = await realCount(table);
      expect(await seenBy(member, table)).toBe(expected);
      expect(await seenBy(staff, table)).toBe(expected);
      expect(await seenBy(visitor, table)).toBe(0);
    });
  }

  it('is not vacuous: the tables the deny is proved on hold rows', async () => {
    for (const table of ['platform_plans', 'platform_plan_product_grants', 'platform_plan_quotas', 'platform_retail_rates']) {
      expect(await realCount(table)).toBeGreaterThan(0);
    }
  });
});

describe('the control plane is for staff only', () => {
  for (const table of CONTROL_PLANE) {
    it(`${table}: staff see every row, a member and a visitor see none`, async () => {
      const expected = await realCount(table);
      expect(await seenBy(staff, table)).toBe(expected);
      expect(await seenBy(member, table)).toBe(0);
      expect(await seenBy(visitor, table)).toBe(0);
    });
  }

  it('is not vacuous: who GOLD uses is recorded', async () => {
    expect(await realCount('platform_providers')).toBeGreaterThan(0);
    expect(await realCount('platform_provider_services')).toBeGreaterThan(0);
    expect(await realCount('platform_plan_provider_prices')).toBeGreaterThan(0);
  });

  it('keeps the vendor rows of the runtime mapping table from anybody but staff, and the module rows from nobody', async () => {
    const providerRows = await pg.query(`select count(*)::int as n from public.platform_catalog_runtime_mappings where mapping_kind = 'provider_key'`);
    expect(providerRows.rows[0].n).toBeGreaterThan(0);

    const asStaff = await staff.from('platform_catalog_runtime_mappings').select('id').eq('mapping_kind', 'provider_key');
    expect((asStaff.data ?? []).length).toBe(providerRows.rows[0].n);
    for (const db of [member, visitor]) {
      const denied = await db.from('platform_catalog_runtime_mappings').select('id').eq('mapping_kind', 'provider_key');
      expect(denied.error).toBeNull();
      expect(denied.data).toEqual([]);
      const modules = await db.from('platform_catalog_runtime_mappings').select('id').eq('mapping_kind', 'module_key');
      expect((modules.data ?? []).length).toBeGreaterThan(0);
    }
  });
});

describe('a caller with no session reads nothing at all', () => {
  it.each([...VOCABULARY, ...COMMERCIAL, ...CONTROL_PLANE])('%s is refused before any policy runs', async (table) => {
    const { error, data } = await signedOut.from(table).select('*').limit(1);
    expect(data).toBeNull();
    expect(error?.code).toBe('42501');
  });
});

describe('no platform read policy is dead', () => {
  it('leaves no table with a using (true) select policy beside another select policy for the same role', async () => {
    const { rows } = await pg.query(
      `select p.tablename
         from pg_policies p
        where p.schemaname = 'public' and p.cmd = 'SELECT' and p.permissive = 'PERMISSIVE' and p.qual <> 'true'
          and exists (select 1 from pg_policies t
                       where t.schemaname = p.schemaname and t.tablename = p.tablename
                         and t.cmd = 'SELECT' and t.qual = 'true' and t.roles = p.roles)`,
    );
    expect(rows).toEqual([]);
  });
});

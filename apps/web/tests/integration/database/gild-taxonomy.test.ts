import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GILD_PRODUCT_KEYS } from '@/lib/domain/catalogue/catalogue';
import { WORKSPACES } from '@/lib/navigation';

/**
 * The catalogue's customer-facing Product set is the eight Gild Products, with the shared Gild
 * Workspace beneath them (`20261001000001`). What is proven here is what the migration promised:
 * the set is exactly that and cannot drift back, every Module has a deliberate home, nothing planned
 * was made to look available, and no Plan lost reach because a key changed.
 */

const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Every Module, and the Product it belongs to. A Module with no row here has no deliberate destination. */
const MODULE_HOME: Record<string, string> = {
  customers_contacts: 'sales',
  sales: 'sales',
  data: 'sales',
  cases: 'service',
  voice: 'comms',
  sms: 'comms',
  email: 'comms',
  pricing: 'finance',
  quotes_estimates: 'finance',
  invoicing: 'finance',
  payments: 'finance',
  job_economics: 'finance',
  intelligence: 'agents',
  tools: 'agents',
  workflows: 'automations',
  triggers: 'automations',
  logic: 'automations',
  actions: 'automations',
  runtime_review: 'automations',
  work_management: 'field',
  scheduling: 'field',
  resources: 'field',
  assets_locations: 'field',
  dispatch: 'field',
  website: 'studio',
  public_booking: 'studio',
  customer_portal: 'studio',
  forms_intake: 'studio',
  brand_domains: 'studio',
  dashboards: 'workspace',
  reports: 'workspace',
  analytics: 'workspace',
};

let pg: Client;

beforeAll(async () => {
  pg = new Client(CONNECTION);
  await pg.connect();
});

afterAll(async () => {
  await pg.end();
});

describe('the Gild Product set', () => {
  it('is exactly the eight Products, in customer order, plus the one shared Workspace', async () => {
    const { rows } = await pg.query<{ key: string; kind: string }>(
      'select key, kind from public.platform_catalog_products order by display_order',
    );
    expect(rows.filter((row) => row.kind === 'product').map((row) => row.key)).toEqual([...GILD_PRODUCT_KEYS]);
    expect(rows.filter((row) => row.kind === 'workspace').map((row) => row.key)).toEqual(['workspace']);
  });

  it('cannot be written back to an old key, by insert or by rename', async () => {
    for (const old of ['crm', 'communications', 'operations', 'financial_operations', 'automation', 'insights', 'customer_experience']) {
      await expect(
        pg.query('insert into public.platform_catalog_products (key, label) values ($1, $2)', [old, 'Old']),
      ).rejects.toMatchObject({ constraint: 'platform_catalog_products_key_check' });
      await expect(
        pg.query("update public.platform_catalog_products set key = $1 where key = 'service'", [old]),
      ).rejects.toMatchObject({ constraint: 'platform_catalog_products_key_check' });
    }
  });

  it('holds the Workspace kind to the workspace key and nothing else', async () => {
    await expect(
      pg.query("update public.platform_catalog_products set kind = 'workspace' where key = 'sales'"),
    ).rejects.toMatchObject({ constraint: 'platform_catalog_products_workspace_kind' });
  });

  it('gives every Module a deliberate home', async () => {
    const { rows } = await pg.query<{ module: string; product: string }>(
      `select m.key as module, p.key as product
         from public.platform_catalog_modules m
         join public.platform_catalog_products p on p.id = m.product_id`,
    );
    expect(Object.fromEntries(rows.map((row) => [row.module, row.product]))).toEqual(MODULE_HOME);
  });

  it('has a Product for every navigation workspace, so the sidebar cannot name one the catalogue lacks', () => {
    for (const workspace of WORKSPACES) expect(GILD_PRODUCT_KEYS as readonly string[]).toContain(workspace.key);
  });
});

describe('what the migration did not overstate', () => {
  it('leaves Gild Service planned and unlisted, with nothing available in it', async () => {
    const product = await pg.query("select sale_status, lifecycle from public.platform_catalog_products where key = 'service'");
    expect(product.rows[0]).toMatchObject({ sale_status: 'unlisted', lifecycle: 'experimental' });
    const { rows } = await pg.query<{ state: string }>(
      `select f.implementation_state as state
         from public.platform_catalog_features f
         join public.platform_catalog_modules m on m.id = f.module_id
         join public.platform_catalog_products p on p.id = m.product_id
        where p.key = 'service'`,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.state === 'planned')).toBe(true);
  });

  it('puts Ask under Agents on the runtime evidence, and keeps the planned agent tools planned', async () => {
    const { rows } = await pg.query<{ feature: string; product: string; state: string }>(
      `select f.key as feature, p.key as product, f.implementation_state as state
         from public.platform_catalog_features f
         join public.platform_catalog_modules m on m.id = f.module_id
         join public.platform_catalog_products p on p.id = m.product_id
        where f.key in ('ask_gold', 'agent_tools')`,
    );
    const byKey = Object.fromEntries(rows.map((row) => [row.feature, row]));
    expect(byKey.ask_gold).toMatchObject({ product: 'agents', state: 'available' });
    expect(byKey.agent_tools).toMatchObject({ product: 'agents', state: 'planned' });
  });

  it('keeps reporting available, under the shared Workspace and not a Product', async () => {
    const { rows } = await pg.query<{ feature: string; state: string }>(
      `select f.key as feature, f.implementation_state as state
         from public.platform_catalog_features f
         join public.platform_catalog_modules m on m.id = f.module_id
         join public.platform_catalog_products p on p.id = m.product_id
        where p.key = 'workspace'`,
    );
    const states = Object.fromEntries(rows.map((row) => [row.feature, row.state]));
    expect(states).toMatchObject({ saved_dashboards: 'available', saved_reports: 'available', utilization: 'available' });
  });

  it('keeps every runtime mapping pointing at a Feature that exists', async () => {
    const orphaned = await pg.query<{ n: string }>(
      `select count(*)::text as n
         from public.platform_catalog_runtime_mappings r
         left join public.platform_catalog_features f on f.id = r.feature_id
        where f.id is null`,
    );
    expect(orphaned.rows[0].n).toBe('0');
    const total = await pg.query<{ n: string }>('select count(*)::text as n from public.platform_catalog_runtime_mappings');
    expect(Number(total.rows[0].n)).toBeGreaterThan(0);
  });
});

describe('no Plan lost reach', () => {
  it('gives every Plan that grants the shared Workspace whole the Module that moved to Agents', async () => {
    const { rows } = await pg.query<{ plan: string }>(
      `select pl.key as plan
         from public.platform_plan_product_grants g
         join public.platform_plans pl on pl.id = g.plan_id
         join public.platform_catalog_products p on p.id = g.product_id and p.key = 'workspace'
        where not exists (
          select 1 from public.platform_plan_module_grants mg
            join public.platform_catalog_modules m on m.id = mg.module_id and m.key = 'intelligence'
           where mg.plan_id = g.plan_id)
          and not exists (
          select 1 from public.platform_plan_product_grants pg2
            join public.platform_catalog_products p2 on p2.id = pg2.product_id and p2.key = 'agents'
           where pg2.plan_id = g.plan_id)`,
    );
    expect(rows).toEqual([]);
  });

  it('keeps GOLD Internal granting every Product and the shared Workspace whole', async () => {
    const { rows } = await pg.query<{ key: string }>(
      `select p.key
         from public.platform_plan_product_grants g
         join public.platform_plans pl on pl.id = g.plan_id and pl.key = 'gold_internal'
         join public.platform_catalog_products p on p.id = g.product_id`,
    );
    expect(rows.map((row) => row.key).sort()).toEqual([...GILD_PRODUCT_KEYS, 'workspace'].sort());
  });
});

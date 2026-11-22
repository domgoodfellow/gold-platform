import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapOperatingOrganization } from '@/lib/domain/platform/operating-organization';
import { CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { foundBusiness } from '@/tests/support/founding';
import { setAsideOperatingOrganization } from '@/tests/support/operating-organization';

/**
 * GildOps sells and accounts through its operating Organization's Finance (ADR-057). These are the
 * facts every later Finance check rests on: who holds the new Finance permissions, who counts as
 * GildOps' seller-side member, and which plans offer the operator features. Platform staff status
 * must never answer any of them.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const NEW = ['subscription.manage', 'cost.read', 'cost.manage'];

type Person = { db: SupabaseClient; userId: string; email: string };

let pg: Client;
let restore: () => Promise<void>;
let owner: Person;
let bookkeeper: Person;
let staffOutsider: Person;
let otherOwner: Person;
let gildops: string;
let other: string;

async function person(label: string, options: { staff?: boolean } = {}): Promise<Person> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  if (options.staff) await pg.query('insert into public.platform_staff (user_id, name) values ($1, $2)', [created.data.user.id, 'Operator']);
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await db.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { db, userId: created.data.user.id, email };
}

/** Runs `sql` as `who` inside a transaction that is rolled back. */
async function asPerson<T>(who: Person, sql: string, params: unknown[] = []): Promise<T> {
  await pg.query('begin');
  try {
    await pg.query('set local role authenticated');
    await pg.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: who.userId, role: 'authenticated' })]);
    const { rows } = await pg.query(sql, params);
    return rows[0]?.value as T;
  } finally {
    await pg.query('rollback');
  }
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  restore = await setAsideOperatingOrganization(pg);

  owner = await person('gildops-owner', { staff: true });
  gildops = await foundBusiness({ ownerEmail: owner.email, name: `GildOps ${randomUUID().slice(0, 8)}`, currency: 'CAD' });
  otherOwner = await person('other-owner');
  other = await foundBusiness({ ownerEmail: otherOwner.email, name: `Other ${randomUUID().slice(0, 8)}`, currency: 'CAD' });

  bookkeeper = await person('gildops-bookkeeper');
  const { rows } = await pg.query<{ id: string }>(
    `insert into public.roles (organization_id, name, capabilities, created_by)
     values ($1, 'Bookkeeper', array['invoice.issue','payment.record','report.read'], $2) returning id`,
    [gildops, owner.userId],
  );
  await pg.query('insert into public.memberships (organization_id, user_id, role_id, created_by) values ($1, $2, $3, $4)', [gildops, bookkeeper.userId, rows[0].id, owner.userId]);

  // Every platform permission, and no membership of GildOps.
  staffOutsider = await person('staff-outsider', { staff: true });
}, 120_000);

afterAll(async () => {
  try {
    await restore?.();
  } finally {
    await pg.end();
  }
});

describe('Finance permissions for subscriptions and costs', () => {
  it('gives a newly founded business’s founding role the three new permissions', async () => {
    const { rows } = await pg.query<{ capabilities: string[] }>(
      `select r.capabilities from public.memberships m join public.roles r on r.id = m.role_id
        where m.organization_id = $1 and m.user_id = $2`,
      [gildops, owner.userId],
    );
    expect(rows[0].capabilities).toEqual(expect.arrayContaining(NEW));
  });

  it('keeps the database list of permissions the same as the one in code', async () => {
    const { rows } = await pg.query<{ def: string }>("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'roles_capabilities_known'");
    const listed = [...rows[0].def.matchAll(/'([^']+)'::text/g)].map((match) => match[1]).sort();
    expect(listed).toEqual([...CAPABILITIES].sort());
    expect(listed).toEqual(expect.arrayContaining(NEW));
  });
});

describe('who sells GildOps', () => {
  it('answers no for everyone while no operating organization is configured', async () => {
    expect(await asPerson<boolean>(owner, 'select app.platform_seller_member() as value')).toBe(false);
    expect(await asPerson<boolean>(owner, "select app.platform_seller_has('cost.read') as value")).toBe(false);
    expect(await asPerson<string | null>(owner, 'select app.platform_seller_id() as value')).toBeNull();
  });

  describe('once GildOps is the operating organization', () => {
    beforeAll(async () => {
      await bootstrapOperatingOrganization(owner.db, { organizationId: gildops });
    }, 60_000);

    it('names GildOps as the seller', async () => {
      expect(await asPerson<string>(owner, 'select app.platform_seller_id() as value')).toBe(gildops);
    });

    it('counts GildOps’ members by their own Finance permissions', async () => {
      expect(await asPerson<boolean>(owner, 'select app.platform_seller_member() as value')).toBe(true);
      expect(await asPerson<boolean>(owner, "select app.platform_seller_has('cost.read') as value")).toBe(true);
      expect(await asPerson<boolean>(bookkeeper, 'select app.platform_seller_member() as value')).toBe(true);
      expect(await asPerson<boolean>(bookkeeper, "select app.platform_seller_has('cost.read') as value")).toBe(false);
      expect(await asPerson<boolean>(bookkeeper, "select app.platform_seller_has('subscription.manage') as value")).toBe(false);
    });

    it('refuses platform staff who are not GildOps members, whatever platform permissions they hold', async () => {
      const { rows } = await pg.query<{ capabilities: string[] }>('select capabilities from public.platform_staff where user_id = $1', [staffOutsider.userId]);
      expect(rows[0].capabilities.length).toBeGreaterThan(0);
      expect(await asPerson<boolean>(staffOutsider, 'select app.platform_seller_member() as value')).toBe(false);
      for (const capability of NEW) {
        expect(await asPerson<boolean>(staffOutsider, 'select app.platform_seller_has($1) as value', [capability])).toBe(false);
      }
    });

    it('refuses another business’s owner, who holds the same permissions in their own business', async () => {
      expect(await asPerson<boolean>(otherOwner, "select app.has_capability($1, 'cost.read') as value", [other])).toBe(true);
      expect(await asPerson<boolean>(otherOwner, 'select app.platform_seller_member() as value')).toBe(false);
      expect(await asPerson<boolean>(otherOwner, "select app.platform_seller_has('cost.read') as value")).toBe(false);
    });
  });
});

describe('the catalogue features that offer the new Finance destinations', () => {
  it('lets only GildOps’ own plan include the operator Product', async () => {
    const { rows } = await pg.query<{ key: string }>(
      `select pl.key from public.platform_plan_product_grants g
         join public.platform_plans pl on pl.id = g.plan_id
         join public.platform_catalog_products p on p.id = g.product_id and p.key = 'operator'`,
    );
    expect(rows.map((row) => row.key)).toEqual(['gold_internal']);
  });

  it('keeps the operator Product unlisted, with subscriptions to platform plans in it and recurring items under Gild Finance', async () => {
    const { rows } = await pg.query<{ product: string; kind: string; product_sale: string; feature: string; feature_sale: string }>(
      `select p.key as product, p.kind, p.sale_status as product_sale, f.key as feature, f.sale_status as feature_sale
         from public.platform_catalog_features f
         join public.platform_catalog_modules m on m.id = f.module_id
         join public.platform_catalog_products p on p.id = m.product_id
        where f.key in ('recurring_items','subscriptions','supplier_costs','cost_to_serve','package_economics')
        order by f.key`,
    );
    expect(rows).toEqual([
      { product: 'operator', kind: 'operator', product_sale: 'unlisted', feature: 'cost_to_serve', feature_sale: 'unlisted' },
      { product: 'operator', kind: 'operator', product_sale: 'unlisted', feature: 'package_economics', feature_sale: 'unlisted' },
      { product: 'finance', kind: 'product', product_sale: 'active', feature: 'recurring_items', feature_sale: 'active' },
      { product: 'operator', kind: 'operator', product_sale: 'unlisted', feature: 'subscriptions', feature_sale: 'unlisted' },
      { product: 'operator', kind: 'operator', product_sale: 'unlisted', feature: 'supplier_costs', feature_sale: 'unlisted' },
    ]);
  });
});

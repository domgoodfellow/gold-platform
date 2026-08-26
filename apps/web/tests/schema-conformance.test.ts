import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CAPABILITIES } from '@/lib/domain/tenancy/capabilities';

/**
 * I1 and I2, enforced for every table that exists — including ones not written yet.
 *
 * The tenancy test proves isolation for the three tables shipped so far. This one asks the
 * catalog instead of asking the code, so a table added in six months with RLS forgotten, or
 * a unique index written (user_id, organization_id) instead of (organization_id, user_id),
 * fails here without anyone remembering to extend a list.
 *
 * "Tenant-owned" is defined mechanically: any table in `public` with an `organization_id`
 * column. That is the definition the rule actually cares about, and it cannot drift from a
 * hand-maintained enumeration.
 */

const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let db: Client;

beforeAll(async () => {
  db = new Client({ connectionString: CONNECTION });
  await db.connect();
});

afterAll(async () => {
  await db?.end();
});

describe('schema conformance', () => {
  it('has at least one table to check', async () => {
    const { rows } = await db.query<{ count: string }>(
      `select count(*)::text as count
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'`,
    );
    // Guards against the whole file passing vacuously if the schema failed to apply.
    expect(Number(rows[0].count)).toBeGreaterThan(0);
  });

  it('enables and forces RLS on every table in public (I1)', async () => {
    const { rows } = await db.query<{ table_name: string; enabled: boolean; forced: boolean }>(
      `select c.relname as table_name,
              c.relrowsecurity as enabled,
              c.relforcerowsecurity as forced
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and (c.relrowsecurity = false or c.relforcerowsecurity = false)`,
    );

    expect(rows).toEqual([]);
  });

  it('leads every unique index on a tenant-owned table with organization_id (I2)', async () => {
    const { rows } = await db.query<{ table_name: string; index_name: string; first: string }>(
      `select t.relname as table_name,
              i.relname as index_name,
              a.attname as first
         from pg_index x
         join pg_class i on i.oid = x.indexrelid
         join pg_class t on t.oid = x.indrelid
         join pg_namespace n on n.oid = t.relnamespace
         join pg_attribute a on a.attrelid = t.oid and a.attnum = x.indkey[0]
        where n.nspname = 'public'
          and x.indisunique
          and not x.indisprimary
          and exists (
            select 1 from pg_attribute o
             where o.attrelid = t.oid and o.attname = 'organization_id' and o.attnum > 0
          )
          and a.attname <> 'organization_id'`,
    );

    expect(rows).toEqual([]);
  });

  it('leads every exclusion constraint on a tenant-owned table with organization_id (I2)', async () => {
    const { rows } = await db.query<{ table_name: string; constraint_name: string }>(
      `select t.relname as table_name, c.conname as constraint_name
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_namespace n on n.oid = t.relnamespace
         join pg_attribute a on a.attrelid = t.oid and a.attnum = c.conkey[1]
        where n.nspname = 'public'
          and c.contype = 'x'
          and exists (
            select 1 from pg_attribute o
             where o.attrelid = t.oid and o.attname = 'organization_id' and o.attnum > 0
          )
          and a.attname <> 'organization_id'`,
    );

    expect(rows).toEqual([]);
  });

  it('backs every declared capability with a database policy (I16)', async () => {
    // A capability enforced only in TypeScript is a capability a direct RPC call ignores.
    // This asserts each one named in code appears in some policy's USING or WITH CHECK, so
    // adding an entry to CAPABILITIES without the policy that gives it teeth fails here
    // rather than shipping as a promise the UI makes and the database does not keep.
    const { rows } = await db.query<{ expression: string }>(
      `select coalesce(pg_get_expr(p.polqual, p.polrelid), '')
              || ' '
              || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as expression
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'`,
    );

    const allPolicies = rows.map((r) => r.expression).join(' ');
    const unenforced = CAPABILITIES.filter(
      (capability) => !allPolicies.includes(`'${capability}'`),
    );

    expect(unenforced).toEqual([]);
  });

  it('catches a violation rather than passing by construction', async () => {
    // A negative control. Without this, every assertion above could be querying nothing and
    // nobody would know until the day it mattered.
    await db.query('create table public.__conformance_probe (id uuid primary key)');
    try {
      const { rows } = await db.query(
        `select c.relname
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind = 'r'
            and (c.relrowsecurity = false or c.relforcerowsecurity = false)`,
      );
      expect(rows.map((r) => r.relname)).toContain('__conformance_probe');
    } finally {
      await db.query('drop table public.__conformance_probe');
    }
  });
});

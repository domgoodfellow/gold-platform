import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The shape of the function surface, asked of the real local Postgres.
 *
 * `app` holds the helpers and definer functions the rest of the schema leans on. It is not an
 * exposed schema and only `authenticated` holds USAGE on it, but neither fact is the guarantee:
 * a privileged function is executable by the roles that need it and by nobody else, so a later
 * change to schema exposure cannot open all of them at once.
 */

const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let pg: Client;
beforeAll(async () => {
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
});
afterAll(async () => {
  await pg.end();
});

describe('SECURITY DEFINER functions in app', () => {
  it('none is executable by PUBLIC or anon', async () => {
    const { rows } = await pg.query(
      `select p.proname
         from pg_proc p
        where p.pronamespace = 'app'::regnamespace
          and p.prosecdef
          and (has_function_privilege('public', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
        order by 1`,
    );
    expect(rows.map((row) => row.proname)).toEqual([]);
  });

  it('each one that a signed-in role runs has been granted by name', async () => {
    // What `authenticated` can execute among them is a short, deliberate list. A new entry needs
    // a reason, written here next to it.
    const { rows } = await pg.query(
      `select p.proname
         from pg_proc p
        where p.pronamespace = 'app'::regnamespace
          and p.prosecdef
          and has_function_privilege('authenticated', p.oid, 'execute')
          and p.prorettype <> 'pg_catalog.trigger'::regtype
        order by 1`,
    );
    expect(rows.map((row) => row.proname)).toEqual(
      [
        // The authorization vocabulary: policies and invoker functions call these as the caller.
        'current_external_customer',
        'current_external_tenant',
        'current_role_id',
        'current_tenant_ids',
        'has_capability',
        'is_organization_member',
        'is_platform_staff',
        'require_platform_staff',
        // Called by invoker functions (`open_call`, `set_calling_number`, the entitlement readers)
        // and by one policy (`publishes_bookings`).
        'may_spend_on',
        'phone_number_owner',
        'plan_grants_feature',
        'publishes_bookings',
      ].sort(),
    );
  });

  it('an unusable-by-design function refuses a signed-in role rather than running', async () => {
    await pg.query('begin');
    try {
      await pg.query('set local role authenticated');
      for (const call of [
        'select app.due_scheduled_automations(interval \'1 minute\')',
        'select app.due_reading_automations()',
      ]) {
        await expect(pg.query(call)).rejects.toMatchObject({ code: '42501' });
        await pg.query('rollback');
        await pg.query('begin');
        await pg.query('set local role authenticated');
      }
    } finally {
      await pg.query('rollback');
    }
  });

  it('the one grant a signed-in role keeps for an invoker caller still works', async () => {
    await pg.query('begin');
    try {
      await pg.query('set local role authenticated');
      const { rows } = await pg.query(`select app.phone_number_owner('+10000000000') as owner`);
      expect(rows[0].owner).toBeNull();
    } finally {
      await pg.query('rollback');
    }
  });
});

describe('objects removed as dead surface stay removed', () => {
  it('has none of the functions that had no caller', async () => {
    const { rows } = await pg.query(
      `select n.nspname || '.' || p.proname as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where (n.nspname, p.proname) in (
          ('public', 'store_integration_secret'), ('public', 'retail_rate_at'),
          ('public', 'add_runtime_mapping'), ('public', 'remove_runtime_mapping'),
          ('public', 'sync_phone_number'), ('public', 'release_phone_number_assignment'),
          ('public', 'set_user_phone_number_preference'), ('app', 'enable_default_modules'))`,
    );
    expect(rows).toEqual([]);
  });

  it('keeps the writer of a tenant credential to the machine role', async () => {
    const { rows } = await pg.query(
      `select has_function_privilege('authenticated', 'public.store_integration_credential(uuid, text)', 'execute') as signed_in,
              has_function_privilege('integration_operator', 'public.store_integration_credential(uuid, text)', 'execute') as machine`,
    );
    expect(rows[0]).toEqual({ signed_in: false, machine: true });
  });
});

describe('index and key hygiene', () => {
  it('has no two indexes on one table with the same key columns and predicate', async () => {
    const { rows } = await pg.query(
      `select indrelid::regclass::text as table_name
         from pg_index
        where indrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
        group by indrelid, indkey, indclass, coalesce(pg_get_expr(indpred, indrelid), ''), coalesce(pg_get_expr(indexprs, indrelid), '')
       having count(*) > 1`,
    );
    expect(rows).toEqual([]);
  });

  it('gives agent_run_documents its document as identity', async () => {
    const { rows } = await pg.query(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'public.agent_run_documents'::regclass and contype = 'p'`,
    );
    expect(rows).toEqual([{ def: 'PRIMARY KEY (organization_id, document_id)' }]);
  });

  it('leaves no public table without a primary key', async () => {
    const { rows } = await pg.query(
      `select relname from pg_class c
        where relnamespace = 'public'::regnamespace and relkind = 'r'
          and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indisprimary)`,
    );
    expect(rows).toEqual([]);
  });
});

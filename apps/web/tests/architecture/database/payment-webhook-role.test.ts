import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

/**
 * What the payment webhook's database role can and cannot do (D14). Split out of `adapters.test.ts`,
 * whose I15 boundary scan reads source only: this half inspects grants in the real local Postgres.
 */

const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * The writer with no human caller.
 *
 * **The handler itself is Python and lives in `apps/api`** (D2, D26), with its own tests under
 * `apps/api/tests` — including the signature check and the shape of the token it mints. What
 * belongs here is the half that is a fact about *this database*: that the role it arrives as
 * can do almost nothing, which is the claim D14 makes concrete when it refuses service-role.
 */
describe('the writer with no human caller', () => {
  it('holds no grant on any table, and exactly one execute', async () => {
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      // The claim D14 makes concrete. If this role could `select` one row of one table, the
      // argument for it over service-role would be a matter of degree.
      const { rows: tables } = await client.query(
        `select table_name, privilege_type
           from information_schema.role_table_grants
          where grantee = 'payment_webhook'`,
      );
      expect(tables).toEqual([]);

      const { rows: functions } = await client.query(
        `select p.proname
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and has_function_privilege('payment_webhook', p.oid, 'execute')
            and p.proname not in (
              select proname from pg_proc pp
               join pg_namespace nn on nn.oid = pp.pronamespace
              where nn.nspname = 'public' and has_function_privilege('public', pp.oid, 'execute')
            )`,
      );
      expect(functions.map((row) => row.proname)).toEqual(['record_provider_payment']);
    } finally {
      await client.end();
    }
  });

  it('has an integration actor that cannot sign in', async () => {
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      // A real row, so `events.actor_id` is satisfiable — with nothing GoTrue could
      // authenticate against. The only way to act as it is to hold the JWT secret.
      const { rows } = await client.query(
        `select encrypted_password, email
           from auth.users
          where id = '00000000-0000-4000-8000-0000000000a1'`,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].encrypted_password).toBeNull();
      expect(rows[0].email).toBeNull();
    } finally {
      await client.end();
    }
  });
});

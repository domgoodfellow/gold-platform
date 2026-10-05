import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The shape of the voice model, asked of the real local Postgres.
 *
 * A call is one business fact; its legs belong to the carrier. The carrier’s callbacks write them
 * through three narrow functions, a tenant writes a call through none of its status columns, and a
 * number’s readiness is derived rather than stored. Each of these is a fact about the schema, so
 * each is asserted from it.
 */

const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let pg: Client;
beforeAll(async () => {
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
});
afterAll(async () => {
  await pg.end();
});

const columns = async (table: string) =>
  (await pg.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [table])).rows.map((row) => row.column_name as string);

describe('a call is not a carrier leg', () => {
  it('has no provider identifier of its own; only a participant does', async () => {
    expect((await columns('calls')).filter((name) => /external|sid|provider/.test(name))).toEqual([]);
    expect(await columns('call_participants')).toContain('external_id');
  });

  it('keeps a leg’s identifier unique within a business', async () => {
    const { rows } = await pg.query(
      `select indexdef from pg_indexes where schemaname = 'public' and tablename = 'call_participants' and indexdef ilike '%external_id%'`,
    );
    expect(rows[0].indexdef).toMatch(/\(organization_id, external_id\)/);
  });

  it('names an internal participant by membership, not by a global user', async () => {
    const names = await columns('call_participants');
    expect(names).toContain('membership_id');
    expect(names).not.toContain('member_id');
  });

  it('can be from nobody the business has recorded, and says which number it was on', async () => {
    const { rows } = await pg.query(
      `select column_name, is_nullable from information_schema.columns where table_name = 'calls' and column_name in ('customer_id', 'phone_number_id', 'answered_at')`,
    );
    expect(Object.fromEntries(rows.map((row) => [row.column_name, row.is_nullable]))).toEqual({
      customer_id: 'YES',
      phone_number_id: 'YES',
      answered_at: 'YES',
    });
  });

  it('resolves a caller by the one customer rule the conversation uses', async () => {
    const { rows } = await pg.query(`select prosrc from pg_proc where proname = 'resolve_new_call_customer'`);
    expect(rows[0].prosrc).toMatch(/app\.resolve_customer/);
    expect(rows[0].prosrc).not.toMatch(/normalize_phone|contact_matches/);
  });
});

describe('what the carrier and a tenant may write', () => {
  it('lets the voice integration touch no table, and run exactly three functions', async () => {
    const { rows: tables } = await pg.query(
      `select table_name from information_schema.role_table_grants where grantee = 'voice_webhook' and table_schema = 'public'`,
    );
    expect(tables).toEqual([]);
    const { rows } = await pg.query(
      `select p.proname from pg_proc p
        where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
          and p.prokind = 'f'
          and has_function_privilege('voice_webhook', p.oid, 'execute')
          and p.proowner = (select proowner from pg_proc where proname = 'record_call_event' limit 1)
          and not has_function_privilege('authenticated', p.oid, 'execute')
          and p.proname in ('record_call_event', 'record_call_leg', 'record_inbound_call')
        order by 1`,
    );
    expect(rows.map((row) => row.proname)).toEqual(['record_call_event', 'record_call_leg', 'record_inbound_call']);
  });

  it('names no organization in any function the carrier calls', async () => {
    const { rows } = await pg.query(
      `select proname, pg_get_function_arguments(oid) as args from pg_proc where proname in ('record_call_event', 'record_call_leg', 'record_inbound_call')`,
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row.args).not.toMatch(/organization/);
  });

  it('gives a signed-in role no write to a call or a leg, and no read of the carrier’s address for a recording', async () => {
    const { rows } = await pg.query(
      `select
         has_table_privilege('authenticated', 'public.calls', 'update') as update_calls,
         has_column_privilege('authenticated', 'public.calls', 'status', 'update') as update_status,
         has_column_privilege('authenticated', 'public.calls', 'duration_seconds', 'update') as update_duration,
         has_table_privilege('authenticated', 'public.call_participants', 'insert') as insert_leg,
         has_table_privilege('authenticated', 'public.call_participants', 'update') as update_leg,
         has_table_privilege('authenticated', 'public.call_events', 'insert') as insert_event,
         has_column_privilege('authenticated', 'public.calls', 'recording_url', 'select') as read_recording_url,
         has_column_privilege('authenticated', 'public.calls', 'recording_available_at', 'select') as read_recording_flag`,
    );
    expect(rows[0]).toEqual({
      update_calls: false,
      update_status: false,
      update_duration: false,
      insert_leg: false,
      update_leg: false,
      insert_event: false,
      read_recording_url: false,
      read_recording_flag: true,
    });
  });

  it('forbids a call, or a leg, from moving backward whoever writes it', async () => {
    const { rows } = await pg.query(
      `select tgrelid::regclass::text as table_name from pg_trigger
        where tgname in ('calls_status_only_moves_forward', 'call_participants_status_only_moves_forward') order by 1`,
    );
    expect(rows.map((row) => row.table_name)).toEqual(['call_participants', 'calls']);
  });

  it('bills a call from one place: the settling function, on the transition into completed', async () => {
    // `charge_for_call` is the charge; `settle_call` is the only function that calls it.
    const { rows } = await pg.query(
      `select proname from pg_proc where prosrc ~ 'charge_for_call' and pronamespace in ('public'::regnamespace, 'app'::regnamespace) order by 1`,
    );
    expect(rows.map((row) => row.proname)).toEqual(['settle_call']);
  });
});

describe('a number is an identity whose readiness is read', () => {
  it('stores no readiness of its own, and separates voice from text', async () => {
    const names = await columns('phone_numbers');
    expect(names).not.toContain('health');
    expect(names).not.toContain('health_checked_at');
    expect(names).not.toContain('inbound_enabled');
    expect(names).toEqual(expect.arrayContaining(['voice_inbound_enabled', 'voice_outbound_enabled', 'sms_inbound_enabled', 'sms_outbound_enabled', 'purpose', 'origin']));
  });

  it('derives readiness under the reader’s own rights', async () => {
    const { rows } = await pg.query(`select reloptions from pg_class where relname = 'phone_number_readiness'`);
    expect(rows[0].reloptions).toContain('security_invoker=true');
  });

  it('lets a tenant write nothing about a number but through the configuring doors', async () => {
    const { rows } = await pg.query(
      `select has_table_privilege('authenticated', 'public.phone_numbers', 'insert') as i,
              has_table_privilege('authenticated', 'public.phone_numbers', 'update') as u,
              has_table_privilege('authenticated', 'public.phone_numbers', 'delete') as d`,
    );
    expect(rows[0]).toEqual({ i: false, u: false, d: false });
  });

  it('refuses inbound traffic on a number GildOps does not hold', async () => {
    const { rows } = await pg.query(
      `select conname from pg_constraint where conrelid = 'public.phone_numbers'::regclass and conname = 'phone_numbers_inbound_needs_a_number_we_hold'`,
    );
    expect(rows).toHaveLength(1);
  });
});

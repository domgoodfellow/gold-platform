import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The shape of the economics model, asked of the real local Postgres.
 *
 * Retail usage pricing is meter-based and effective-dated in `platform_retail_rates`; a usage
 * event is written by one function; and nothing about a usage event can disagree with the
 * business it belongs to. Each of these is a fact about the schema, so each is asserted from it.
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

describe('the second retail price list stays gone', () => {
  it('has no communication_rates table, view or type', async () => {
    const { rows } = await pg.query(
      `select to_regclass('public.communication_rates') as relation,
              to_regclass('public.communication_credits') as credits,
              (select count(*)::int from pg_type where typname = 'communication_channel') as channel_type`,
    );
    expect(rows[0]).toEqual({ relation: null, credits: null, channel_type: 0 });
  });

  it('has no function that prices a channel or is keyed by one', async () => {
    const { rows } = await pg.query(
      `select p.proname
         from pg_proc p
        where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace)
          and (p.proname = 'channel_rate' or p.prosrc ~* 'communication_rates|communication_channel')`,
    );
    expect(rows).toEqual([]);
  });

  it('has one retail-rate resolver, and it is keyed by meter, currency, organization and moment', async () => {
    const { rows } = await pg.query(
      `select p.proname, pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p
        where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.proname like '%retail_rate_at'`,
    );
    // The organization joined the key in `20261022000007` — a rate resolved for nobody in
    // particular was how one organization's negotiated rate could leak into another's usage.
    expect(rows).toEqual([
      { proname: 'retail_rate_at', args: 'p_meter_id text, p_currency text, p_organization_id uuid, p_at timestamp with time zone' },
    ]);
  });
});

describe('a usage event is written by one function', () => {
  it('is inserted by no signed-in, anonymous or machine role', async () => {
    const { rows } = await pg.query(
      `select r.rolname
         from pg_roles r
        where r.rolname in ('anon', 'authenticated', 'automation_runner', 'voice_webhook', 'payment_webhook',
                            'integration_operator', 'provider_operator', 'platform_billing_webhook')
          and (has_table_privilege(r.rolname, 'public.usage_events', 'insert')
               or has_table_privilege(r.rolname, 'public.usage_events', 'update')
               or has_table_privilege(r.rolname, 'public.usage_events', 'delete'))`,
    );
    expect(rows).toEqual([]);
  });

  it('is inserted by app.record_usage and by nothing else', async () => {
    const { rows } = await pg.query(
      `select n.nspname || '.' || p.proname as name
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'app') and p.prosrc ~* 'insert\\s+into\\s+public\\.usage_events'
        order by 1`,
    );
    expect(rows.map((row) => row.name)).toEqual(['app.record_usage']);
  });

  it('is not executable by anybody who is signed in', async () => {
    const { rows } = await pg.query(
      `select has_function_privilege('authenticated', p.oid, 'execute') as signed_in,
              has_function_privilege('anon', p.oid, 'execute') as anonymous
         from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'record_usage'`,
    );
    expect(rows).toEqual([{ signed_in: false, anonymous: false }]);
  });

  it('cannot name a resource, binding, account or rate that belongs to another business, provider or meter', async () => {
    const { rows } = await pg.query(
      `select conname, pg_get_constraintdef(oid) as def
         from pg_constraint
        where conrelid = 'public.usage_events'::regclass and contype = 'f'
          and conname in ('usage_events_binding_same_org_and_provider', 'usage_events_resource_same_org_and_binding',
                          'usage_events_account_same_provider', 'usage_events_provider_rate_matches',
                          'usage_events_retail_rate_matches')
        order by conname`,
    );
    expect(rows.map((row) => row.conname)).toEqual([
      'usage_events_account_same_provider',
      'usage_events_binding_same_org_and_provider',
      'usage_events_provider_rate_matches',
      'usage_events_resource_same_org_and_binding',
      'usage_events_retail_rate_matches',
    ]);
    const byName = Object.fromEntries(rows.map((row) => [row.conname, row.def as string]));
    // The organization is part of every reference to something a business owns.
    expect(byName.usage_events_binding_same_org_and_provider).toContain('(organization_id, provider_binding_id, provider_key)');
    expect(byName.usage_events_resource_same_org_and_binding).toContain('(organization_id, provider_binding_id, provider_resource_id)');
    // A rate is for this meter and this currency, so the amount and the rate row cannot disagree.
    expect(byName.usage_events_retail_rate_matches).toContain('(retail_rate_id, meter_id, customer_currency)');
  });

  it('keeps every provenance column away from a business', async () => {
    const { rows } = await pg.query(
      `select column_name from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'usage_events' and grantee = 'authenticated'
          and privilege_type = 'SELECT'
          and column_name in ('provider_key', 'provider_account_id', 'provider_binding_id', 'provider_resource_id',
                              'provider_rate_id', 'provider_cost_micros', 'provider_currency')`,
    );
    expect(rows).toEqual([]);
  });
});

describe('a meter says what is measured, and an event says how it was fulfilled', () => {
  it('gives the meter no fulfilment topology: the same meter can be carried by GOLD or by a business', async () => {
    const { rows } = await pg.query(
      `select count(*)::int as n from information_schema.columns
        where table_schema = 'public' and table_name = 'platform_meters' and column_name = 'fulfilled_through'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('records fulfilment on the event and ties it to whether a binding is named', async () => {
    const { rows } = await pg.query(
      `select pg_get_constraintdef(oid) as def from pg_constraint
        where conrelid = 'public.usage_events'::regclass and conname = 'usage_events_fulfilment_matches_binding'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toContain("fulfilled_through = 'organization_binding'");
    expect(rows[0].def).toContain('provider_binding_id IS NOT NULL');
  });
});

describe('usage is never lost for want of a price', () => {
  it('lets the charge, the currency and the provider cost each be absent, and says absent is not zero', async () => {
    const { rows } = await pg.query(
      `select column_name, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'usage_events'
          and column_name in ('customer_charge_micros', 'customer_currency', 'provider_cost_micros')
        order by column_name`,
    );
    // Nullable, and with no default that would turn "not priced" back into a made-up zero.
    expect(rows).toEqual([
      { column_name: 'customer_charge_micros', is_nullable: 'YES', column_default: null },
      { column_name: 'customer_currency', is_nullable: 'YES', column_default: null },
      { column_name: 'provider_cost_micros', is_nullable: 'YES', column_default: null },
    ]);
  });

  it('cannot hold a charge with no currency, a rate row with no charge, or a cost that does not apply', async () => {
    const { rows } = await pg.query(
      `select conname from pg_constraint
        where conrelid = 'public.usage_events'::regclass and contype = 'c'
          and conname in ('usage_events_charge_needs_currency', 'usage_events_retail_rate_needs_charge',
                          'usage_events_provider_rate_needs_cost', 'usage_events_cost_applicability')
        order by conname`,
    );
    expect(rows.map((row) => row.conname)).toEqual([
      'usage_events_charge_needs_currency',
      'usage_events_cost_applicability',
      'usage_events_provider_rate_needs_cost',
      'usage_events_retail_rate_needs_charge',
    ]);
  });

  it('has no path that returns before recording a call for want of a currency', async () => {
    const { rows } = await pg.query(
      `select prosrc from pg_proc where pronamespace = 'app'::regnamespace and proname = 'charge_for_call'`,
    );
    expect(rows[0].prosrc).not.toMatch(/currency/i);
  });
});

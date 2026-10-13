import { readFile } from 'node:fs/promises';
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
          and a.attname <> 'organization_id'
        -- Ordered, because the exceptions below are asserted exactly and an unordered
        -- result would make this test pass or fail on the planner's mood.
        order by t.relname, i.relname`,
    );

    // **Six exceptions, and they share one rule rather than being separate lapses.**
    //
    // I2 exists so one tenant's uniqueness cannot block another's: two businesses must both be
    // able to call a status "Booked". Every index below is the opposite question — **an
    // identifier the outside world *presents* must be resolvable without already knowing which
    // tenant it belongs to**, while an identifier the inside world *uses* is scoped by the
    // tenant that owns it.
    //
    //   * `external_actors_one_tenant_per_user` enforces that one *actor* never spans two
    //     tenants (D22's "always exactly one tenant, never a set"). Leading it with
    //     `organization_id` would permit exactly the row it forbids, and
    //     `app.current_external_tenant()` would then have a set to return.
    //   * `customer_portal_invites_token_unique` is a secret a customer arrives holding, with
    //     no tenant in hand to scope it by.
    //   * `customer_proposal_invites_token_unique` is the same shape one product over
    //     (20261024000001) — a secret a prospect arrives holding, before `claim_proposal_invite`
    //     has given their browser any tenant to be scoped by.
    //   * `organization_invitations_token_hash_unique` is the same shape one axis over
    //     (20260915000003) — a hash of a secret an invitee arrives holding, looked up by
    //     `accept_invitation` before that caller has any membership for a tenant to be scoped
    //     by. Hashed rather than plaintext (it grants a role, not a view), which changes what is
    //     stored but not why the index cannot lead with `organization_id`.
    //   * `organization_domains_active_hostname_unique` is the same shape as the portal token and
    //     the invitation hash: a browser arrives holding a hostname, with no tenant in hand to
    //     scope it by, so it must be unique across every claim or resolution would have to guess
    //     which business `shop.example.com` means. Only an unreleased claim counts.
    //   * `forms_public_key_unique` (20261115000001) is the same shape again: a visitor arrives
    //     holding a form's public key with no tenant in hand, so the key must be unique across
    //     every business or it could not say which form it means. It names only a published form
    //     anybody could already open.
    //   * `platform_retail_rates_id_meter_currency_unique` is the inverse case: not an outsider's
    //     secret, but a row that may belong to *no* tenant at all. `platform_retail_rates` gained
    //     an optional `organization_id` in `20261018000001` for a negotiated override; most rows
    //     are still the platform-default rate, shared by every business, with `organization_id`
    //     null. This constraint exists only so `usage_events_retail_rate_matches` (I18's own named
    //     exception, below) has a composite key to point at, and `id` already makes it globally
    //     collision-proof regardless of tenant — leading it with `organization_id` would buy
    //     nothing I2 exists to prevent, since no two tenants' rows can collide here either way.
    //     `20261028000001` records why forcing the alternative would actually be wrong: it would
    //     require every usage event to match a retail-rate row carrying its *own* organization_id,
    //     but the row nearly every usage event prices against is the shared default, whose
    //     `organization_id` is null by construction — a composite FK on that shape could never
    //     match a real tenant id against a null, so it would refuse to record usage the moment no
    //     negotiated rate existed for that tenant, which is the common case.
    //
    // Named individually rather than excluded by a pattern, so a seventh cannot arrive quietly
    // by matching a rule somebody loosened. A new entry here should have to argue for itself.
    expect(rows).toEqual([
      {
        table_name: 'customer_portal_invites',
        index_name: 'customer_portal_invites_token_unique',
        first: 'token',
      },
      {
        table_name: 'customer_proposal_invites',
        index_name: 'customer_proposal_invites_token_unique',
        first: 'token',
      },
      {
        table_name: 'external_actors',
        index_name: 'external_actors_one_tenant_per_user',
        first: 'user_id',
      },
      {
        table_name: 'forms',
        index_name: 'forms_public_key_unique',
        first: 'public_key',
      },
      {
        table_name: 'organization_domains',
        index_name: 'organization_domains_active_hostname_unique',
        first: 'hostname',
      },
      {
        table_name: 'organization_invitations',
        index_name: 'organization_invitations_token_hash_unique',
        first: 'token_hash',
      },
      {
        table_name: 'platform_retail_rates',
        index_name: 'platform_retail_rates_id_meter_currency_unique',
        first: 'id',
      },
    ]);
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

  it('backs every declared capability with a database policy or a database function (I16)', async () => {
    // A capability enforced only in TypeScript is a capability a direct RPC call ignores.
    // This asserts each one named in code appears in some policy's USING or WITH CHECK, so
    // adding an entry to CAPABILITIES without the thing that gives it teeth fails here
    // rather than shipping as a promise the UI makes and the database does not keep.
    //
    // **Function bodies count too, and that is a clarification rather than a loosening.** What
    // this invariant forbids is enforcement that lives outside the database, where a direct call
    // walks past it. A function that raises on `app.has_capability` is inside it and is refused
    // just as hard — `add_member_by_email` has enforced `role.manage` that way since M1, because
    // `auth.users` is not readable and no policy could have expressed it.
    //
    // `report.read` is the case that made this explicit. It gates an aggregate, and an aggregate
    // has no rows to put a policy on: the invoices and costs underneath it must stay readable by
    // any member, because a job screen shows them. What is gated is the summing, and the summing
    // is a function. `20260903000003` records why that is a real disclosure rather than a second
    // gate over rows somebody could already read.
    const { rows: policies } = await db.query<{ expression: string }>(
      `select coalesce(pg_get_expr(p.polqual, p.polrelid), '')
              || ' '
              || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as expression
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'`,
    );

    // Only where the capability is actually consulted. Matching `has_capability` in the same
    // body is what keeps this from passing on a function that merely mentions the string in a
    // comment, which would make the whole assertion decorative.
    const { rows: functions } = await db.query<{ body: string }>(
      `select p.prosrc as body
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'app')
          and p.prosrc like '%has_capability%'`,
    );

    const enforcement = [
      ...policies.map((r) => r.expression),
      ...functions.map((r) => r.body),
    ].join(' ');

    const unenforced = CAPABILITIES.filter(
      (capability) => !enforcement.includes(`'${capability}'`),
    );

    expect(unenforced).toEqual([]);
  });

  it('catches a capability nothing enforces, rather than passing by construction', async () => {
    // The negative control for the check above. Without it, widening the search from policies to
    // function bodies could have made the assertion unfalsifiable and nobody would know.
    const { rows: policies } = await db.query<{ expression: string }>(
      `select coalesce(pg_get_expr(p.polqual, p.polrelid), '') as expression from pg_policy p`,
    );
    const { rows: functions } = await db.query<{ body: string }>(
      `select p.prosrc as body from pg_proc p where p.prosrc like '%has_capability%'`,
    );

    const enforcement = [
      ...policies.map((r) => r.expression),
      ...functions.map((r) => r.body),
    ].join(' ');

    expect(enforcement).not.toContain(`'report.write_everything'`);
  });

  it('keeps the generated database types current with the schema (D15)', async () => {
    // Stale generated types are strictly worse than none: `tsc` cheerfully validates every
    // query against a schema that no longer exists, and passes. This asks the catalog and
    // compares it to the checked-in file, in the same spirit as everything else here —
    // and it fails by naming the table or column that drifted, which is the instruction to
    // run `pnpm db:types`.
    const source = await readFile(
      new URL('../../../lib/db/database.types.ts', import.meta.url),
      'utf8',
    );
    const declared = declaredColumns(source);

    // Vacuity guard, like the first test in this file: a parser that matched nothing would
    // make both comparisons below trivially true.
    expect(declared.size).toBeGreaterThan(0);

    const { rows } = await db.query<{ table_name: string; column_name: string }>(
      `select c.relname as table_name, a.attname as column_name
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         join pg_attribute a on a.attrelid = c.oid
        where n.nspname = 'public'
          and c.relkind = 'r'
          and a.attnum > 0
          and not a.attisdropped`,
    );

    const actual = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));

    expect({
      inSchemaButNotInTypes: [...actual].filter((c) => !declared.has(c)).sort(),
      inTypesButNotInSchema: [...declared].filter((c) => !actual.has(c)).sort(),
    }).toEqual({ inSchemaButNotInTypes: [], inTypesButNotInSchema: [] });
  });

  it('makes every reference between tenant-owned tables composite (I18)', async () => {
    // A foreign key from one tenant-owned table to another must carry organization_id, so
    // that a row can only ever reference an entity in its own tenant. RLS cannot do this:
    // a policy on the referencing table sees that row's organization_id and is satisfied,
    // while the id it points at belongs to somebody else. `customer_locations` is the case
    // that motivated it and `memberships` had it already; this asserts it from the catalog
    // so the next junction table cannot ship without it.
    //
    // References to `organizations` itself are excluded automatically: that table has no
    // organization_id column, so it never matches the second condition.
    const { rows } = await db.query<{ constraint_name: string; table_name: string }>(
      `select c.conname as constraint_name, t.relname as table_name
         from pg_constraint c
         join pg_class t on t.oid = c.conrelid
         join pg_class r on r.oid = c.confrelid
         join pg_namespace n on n.oid = t.relnamespace
         join pg_namespace rn on rn.oid = r.relnamespace
        where c.contype = 'f'
          and n.nspname = 'public'
          and rn.nspname = 'public'
          and exists (
            select 1 from pg_attribute a
             where a.attrelid = t.oid and a.attname = 'organization_id'
               and a.attnum > 0 and not a.attisdropped
          )
          and exists (
            select 1 from pg_attribute a
             where a.attrelid = r.oid and a.attname = 'organization_id'
               and a.attnum > 0 and not a.attisdropped
          )
          and not exists (
            select 1 from pg_attribute a
             where a.attrelid = t.oid and a.attname = 'organization_id'
               and a.attnum = any (c.conkey)
          )
          -- Service-owned references carry the independently linked tenant's key.
          -- Check the exact paired columns; this does not exempt other cross-tenant FKs.
          and not (t.relname = 'engagement_deliverables'
            and r.relname in ('public_sites','forms','ai_assistant_deployments','automation_rules')
            and (select array_agg(a.attname::text order by k.ordinality)
              from unnest(c.conkey) with ordinality k(attnum,ordinality)
              join pg_attribute a on a.attrelid=t.oid and a.attnum=k.attnum)
              = array['tenant_organization_id',case r.relname when 'public_sites' then 'site_id'
                when 'forms' then 'form_id' when 'ai_assistant_deployments' then 'ai_deployment_id' else 'automation_rule_id' end]
            and (select array_agg(a.attname::text order by k.ordinality)
              from unnest(c.confkey) with ordinality k(attnum,ordinality)
              join pg_attribute a on a.attrelid=r.oid and a.attnum=k.attnum)=array['organization_id','id'])`,
    );

    // **One exception, for the reason `platform_retail_rates_id_meter_currency_unique` is named
    // above (I2), the same fact seen from the referencing side.** `usage_events_retail_rate_matches`
    // points at a row that may belong to no tenant at all — the shared platform-default rate —
    // not at another tenant's own row. Composite-with-`organization_id` would require that shared
    // row's `organization_id` (null) to equal the usage event's own (never null), which can never
    // be true; every usage event once no negotiated rate exists for its organization — the common
    // case — would then be refused rather than recorded. `20261028000001` records the full
    // reasoning and the real bug its investigation found (`app.retail_rate_at` resolving with no
    // regard to organization at all, which is what RLS cannot catch on this side either, since the
    // function runs as its own definer rather than through a row a policy could refuse).
    expect(rows).toEqual([
      { constraint_name: 'usage_events_retail_rate_matches', table_name: 'usage_events' },
    ]);
  });

  it('catches a plain reference between tenant-owned tables', async () => {
    // The negative control for the test above: the foreign key anyone would write by
    // reflex, which is the one that lets a row point across the wall.
    await db.query(`create table public.__fk_probe (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      customer_id uuid not null references public.customers (id)
    )`);
    try {
      const { rows } = await db.query<{ table_name: string }>(
        `select t.relname as table_name
           from pg_constraint c
           join pg_class t on t.oid = c.conrelid
           join pg_class r on r.oid = c.confrelid
           join pg_namespace n on n.oid = t.relnamespace
          where c.contype = 'f'
            and n.nspname = 'public'
            and exists (
              select 1 from pg_attribute a
               where a.attrelid = t.oid and a.attname = 'organization_id'
                 and a.attnum > 0 and not a.attisdropped
            )
            and exists (
              select 1 from pg_attribute a
               where a.attrelid = r.oid and a.attname = 'organization_id'
                 and a.attnum > 0 and not a.attisdropped
            )
            and not exists (
              select 1 from pg_attribute a
               where a.attrelid = t.oid and a.attname = 'organization_id'
                 and a.attnum = any (c.conkey)
            )`,
      );
      expect(rows.map((r) => r.table_name)).toContain('__fk_probe');
    } finally {
      await db.query('drop table public.__fk_probe');
    }
  });

  it('keeps attachment references real rather than polymorphic (I18)', async () => {
    // The I18 assertion above checks that foreign keys between tenant-owned tables carry
    // organization_id. It cannot see the design that has no foreign key at all: a
    // polymorphic `(entity_type, entity_id)` pair points at a different table depending on
    // its own contents, so Postgres cannot constrain it and nothing stops a row from naming
    // another tenant's record. `documents` is four nullable columns for exactly this reason.
    //
    // `events` is the deliberate exception and the only one. It is an append-only log rather
    // than a reference: nothing joins to it expecting integrity, and its rows describe things
    // that happened rather than pointing at things that must exist.
    const { rows } = await db.query<{ table_name: string }>(
      `select c.relname as table_name
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relname <> 'events'
          and exists (
            select 1 from pg_attribute a
             where a.attrelid = c.oid and a.attname = 'entity_id'
               and a.attnum > 0 and not a.attisdropped
          )
          and exists (
            select 1 from pg_attribute a
             where a.attrelid = c.oid and a.attname = 'entity_type'
               and a.attnum > 0 and not a.attisdropped
          )`,
    );

    expect(rows).toEqual([]);
  });

  it('keeps every platform-maintained column out of every grant', async () => {
    // **Written from a sweep, after the same bug was found twice.** A `grant insert on <table>`
    // is table-wide: it covers every column that table will ever have, so a column added by a
    // later migration inherits it silently. Twenty-four columns across nine tables had inherited
    // one. Three mattered, and in each case a migration's own comment claimed the opposite —
    // `external_actors.customer_id` was "in no column grant" while a grant from eight migrations
    // earlier covered it, and `work_items.status_releases_resource` was "in no column grant"
    // while the same thing was true of it.
    //
    // The columns below are the ones the *platform* answers for: derived mirrors, and the diary
    // window that `app.check_work_item_update_capability` authorizes on update and
    // `create_booking` writes as the table's owner. Each entry names the privilege it must not
    // hold, because `scheduled_during` is legitimately updatable and never insertable.
    //
    // This asserts the *current* privilege rather than reading the migrations, because the
    // migrations are what got it wrong: each was locally coherent and the damage was in what
    // they inherited from each other.
    const MAINTAINED: [string, string, 'INSERT' | 'UPDATE'][] = [
      ['work_items', 'occupies', 'INSERT'],
      ['work_items', 'occupies', 'UPDATE'],
      ['work_items', 'status_releases_resource', 'INSERT'],
      ['work_items', 'status_releases_resource', 'UPDATE'],
      ['work_items', 'scheduled_during', 'INSERT'],
      ['external_actors', 'customer_id', 'INSERT'],
      ['external_actors', 'customer_id', 'UPDATE'],
      // A field definition's meaning. Changing a kind reinterprets every value already stored
      // under that key and renaming a key orphans them; neither fails at the edit.
      ['field_definitions', 'kind', 'UPDATE'],
      ['field_definitions', 'key', 'UPDATE'],
      // A rule's trigger is what the rule *is*. Editing one turns it into a different rule while
      // keeping the record of what the old one did.
      ['automation_rules', 'trigger_kind', 'UPDATE'],
      ['automation_rules', 'trigger_event_action', 'UPDATE'],
    ];

    const { rows } = await db.query(
      `select table_name, column_name, privilege_type
         from information_schema.column_privileges
        where table_schema = 'public'
          and grantee in ('authenticated', 'anon')
          and privilege_type in ('INSERT', 'UPDATE')`,
    );
    const granted = new Set(
      rows.map((r) => `${r.table_name}.${r.column_name}.${r.privilege_type}`),
    );

    const offenders = MAINTAINED.filter(([t, c, p]) => granted.has(`${t}.${c}.${p}`)).map(
      ([t, c, p]) => `${t}.${c} (${p})`,
    );

    expect(offenders).toEqual([]);

    // Non-vacuous: the query has to be returning something, or the filter above is checking an
    // empty set and every line of the list is decoration.
    expect(granted.has('work_items.title.INSERT')).toBe(true);
    expect(granted.has('work_items.scheduled_during.UPDATE')).toBe(true);
  });

  it('lets no application role empty a table', async () => {
    // **RLS does not apply to `truncate`**, which is what makes this different from every other
    // privilege in this schema: a policy is evaluated per row and a column grant per column, and
    // truncating considers neither. Supabase's default privileges grant it to `anon` and
    // `authenticated` on every table, so this was true of all forty-five until
    // `20260902000004` — not reachable through PostgREST, which has no truncate verb, and not a
    // standard this repository holds anywhere else: `payment_webhook` holds no table grant at
    // all, precisely so a policy written wrongly later still hits a missing privilege.
    const { rows } = await db.query(
      `select table_name, grantee
         from information_schema.role_table_grants
        where table_schema = 'public'
          and privilege_type = 'TRUNCATE'
          and grantee in ('anon', 'authenticated')`,
    );

    expect(rows.map((r) => `${r.grantee}:${r.table_name}`)).toEqual([]);
  });

  it('keeps the internals schema off the API surface', async () => {
    // **What actually makes `app` unreachable is this line, not the grants inside it.** Several
    // `app` functions are executable by PUBLIC because no `revoke` was written for them — they
    // read across tenants and two of them write — and the sweep that found this had to answer
    // why that is not a hole. The answer is that PostgREST exposes the schemas named here and
    // nothing else, so there is no request that reaches them; `anon` does not even hold `usage`
    // on the schema.
    //
    // That makes one line of a config file load-bearing for an authorization boundary, which is
    // worth a test rather than a comment: adding `app` to this list would publish the platform's
    // internals as REST endpoints, and nothing else in the tree would look different.
    const config = await readFile(
      new URL('../../../../../supabase/config.toml', import.meta.url),
      'utf8',
    );
    const exposed = config
      .split(/\r?\n/)
      .find((line) => line.trimStart().startsWith('schemas'));

    expect(exposed, 'config.toml declares no exposed schemas').toBeDefined();
    expect(exposed).not.toContain('"app"');

    const { rows } = await db.query(
      `select has_schema_privilege('anon', 'app', 'usage') as anon_usage`,
    );
    expect(rows[0].anon_usage).toBe(false);
  });

  it('settles every session scope once per statement rather than once per row', async () => {
    // **A `stable` function in a policy may be called once per statement, and is not obliged to
    // be.** Only `immutable` gets folded to a constant; a bare `app.current_external_tenant()`
    // in a `using` clause is evaluated for every row the statement touches, and each evaluation
    // reads `external_actors`. Wrapping it in a scalar subquery with nothing correlated inside
    // makes it an InitPlan: computed once, before the scan.
    //
    // The reason this is a schema-wide scan and not a note on twelve policies is that Supabase's
    // own advisor checks `auth.uid()` and `auth.jwt()` by name and cannot see a scope function
    // this schema invented — which is exactly how the two `app.` ones below were written bare
    // while every `auth.uid()` beside them was wrapped correctly. The rule is about the shape of
    // a session-scoped function, so the next one is caught without anybody remembering.
    //
    // `app.has_capability` is deliberately absent from this list. It takes the row's own
    // `organization_id` as an argument, so it depends on the row and cannot be lifted out of
    // one; asserting it here would demand a fix that does not exist.
    const SCOPES = [
      'auth.uid',
      'auth.jwt',
      'app.current_tenant_ids',
      'app.current_external_tenant',
      'app.current_external_customer',
    ];

    const bareCalls = (expression: string) =>
      SCOPES.filter((fn) =>
        new RegExp(String.raw`(?<!\( SELECT )${fn.replace('.', '\\.')}\(`).test(expression),
      );

    const { rows } = await db.query<{ table_name: string; policy: string; expression: string }>(
      `select c.relname as table_name,
              p.polname as policy,
              coalesce(pg_get_expr(p.polqual, p.polrelid), '')
                || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') as expression
         from pg_policy p
         join pg_class c on c.oid = p.polrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'`,
    );

    expect(rows.length).toBeGreaterThan(0);

    const unwrapped = rows
      .flatMap((row) =>
        bareCalls(row.expression).map((fn) => `${row.table_name}.${row.policy}: ${fn}()`),
      )
      .sort();

    expect(unwrapped).toEqual([]);
  });

  it('catches an unwrapped scope rather than passing by construction', async () => {
    // The negative control for the scan above, which would otherwise pass on a database whose
    // policies had all been deleted.
    await db.query('create table public.__scope_probe (id uuid primary key)');
    try {
      await db.query('alter table public.__scope_probe enable row level security');
      await db.query(
        `create policy scope_probe_select on public.__scope_probe
           for select to authenticated using (id = app.current_external_tenant())`,
      );

      const { rows } = await db.query<{ expression: string }>(
        `select coalesce(pg_get_expr(p.polqual, p.polrelid), '') as expression
           from pg_policy p
           join pg_class c on c.oid = p.polrelid
          where c.relname = '__scope_probe'`,
      );

      expect(rows[0].expression).toMatch(/(?<!\( SELECT )app\.current_external_tenant\(/);
    } finally {
      await db.query('drop table public.__scope_probe');
    }
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

/**
 * Every `table.column` the generated types declare under `public.Tables`.
 *
 * Parsed from the file's text rather than imported as a type, because this check has to run
 * at runtime and TypeScript types do not survive to it. The file is machine-generated, so
 * its indentation is stable; the vacuity guard in the test covers the day it stops being.
 */
function declaredColumns(source: string): Set<string> {
  const columns = new Set<string>();
  const lines = source.split(/\r?\n/);

  // `graphql_public` is matched exactly, not by suffix, so it cannot be mistaken for this.
  let i = lines.findIndex((line) => line === '  public: {');
  if (i < 0) return columns;

  i = lines.findIndex((line, n) => n > i && line === '    Tables: {');
  if (i < 0) return columns;

  let table: string | null = null;
  let inRow = false;

  for (let n = i + 1; n < lines.length; n += 1) {
    const line = lines[n];

    // A sibling key at Tables' own indentation — `Views`, `Functions` — ends the section.
    if (/^ {4}\w+: \{$/.test(line)) break;

    const tableStart = line.match(/^ {6}"?([A-Za-z_][A-Za-z0-9_]*)"?: \{$/);
    if (tableStart) {
      table = tableStart[1];
      inRow = false;
      continue;
    }

    if (table && line === '        Row: {') {
      inRow = true;
      continue;
    }

    if (inRow) {
      if (line === '        }') {
        inRow = false;
        continue;
      }
      const column = line.match(/^ {10}"?([A-Za-z_][A-Za-z0-9_]*)"?\??: /);
      if (column) columns.add(`${table}.${column[1]}`);
    }
  }

  return columns;
}

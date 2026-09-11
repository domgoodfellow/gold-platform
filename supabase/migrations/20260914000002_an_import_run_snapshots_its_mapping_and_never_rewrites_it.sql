-- An import run: staged rows, applied once, idempotent on a second try.
--
-- **I8, applied to this engine.** `import_runs.mapping_snapshot` is a copy, not a join —
-- `integration_mappings` carries no foreign key any run consults at apply time, the same
-- reasoning `work_item_priced_lines` already gives for holding no foreign key back to
-- `price_book_items`. Editing a mapping tomorrow must never reinterpret a run that already
-- applied.
--
-- **Idempotency lives in one unique index.** `external_record_links (organization_id,
-- connector_key, external_record_id, gold_entity_type)` is the whole mechanism — re-running the
-- same file upserts against the row this index finds rather than creating a second customer.
--
-- **Every write here is a door, not a grant.** Unlike `integration_connections` (an ordinary
-- tenant record, RLS policy-gated the way `customers` is), these three tables are a state
-- machine — staging then applying is one guarded sequence, not independent CRUD, so nobody holds
-- insert or update on any of them directly. `begin_import_run`, `stage_import_rows` and
-- `apply_import_run` are the whole of how a row in any of them changes, and each is `security
-- definer` because there is no RLS insert/update policy here to lean on (D44's shape, restated
-- for a tenant door rather than a staff one) — `app.require_capability` does inline the check a
-- policy would otherwise have made, including the capability check `apply_import_run` makes a
-- second time per row against `customer.create`/`customer.update`, since a security definer
-- function bypasses `customers`' own RLS and must not silently grant more than the caller holds.

-- ---------------------------------------------------------------------------
-- import_runs
-- ---------------------------------------------------------------------------

create table public.import_runs (
  id                uuid        primary key default gen_random_uuid(),
  organization_id   uuid        not null references public.organizations (id) on delete cascade,

  -- Informational navigation only, never consulted to replay this run (I8, above). Both nullable
  -- on delete set null rather than cascade — a run's own history outlives the resource or mapping
  -- that produced it, the same reasoning `report_definitions`' typed filter columns already use.
  -- Composite (I18) below, not an inline `references`, leading with `organization_id`.
  resource_id       uuid,
  mapping_id        uuid,

  -- Snapshotted at begin_import_run, not read live from integration_connections at apply time —
  -- the identity half of the idempotency key must survive either row being renamed or gone.
  connector_key     text        not null,
  mapping_snapshot  jsonb       not null check (jsonb_typeof(mapping_snapshot) = 'object'),

  status            text        not null default 'pending'
                                 check (status in ('pending', 'running', 'completed', 'completed_with_errors', 'failed')),

  rows_seen         integer     not null default 0 check (rows_seen >= 0),
  rows_created      integer     not null default 0 check (rows_created >= 0),
  rows_updated      integer     not null default 0 check (rows_updated >= 0),
  rows_skipped      integer     not null default 0 check (rows_skipped >= 0),
  rows_failed       integer     not null default 0 check (rows_failed >= 0),

  initiated_by      uuid        not null references auth.users (id),
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  error             text,
  created_at        timestamptz not null default now(),

  -- The composite-FK target `import_staging_rows` and `external_record_links` lead with (I2).
  unique (organization_id, id),

  foreign key (organization_id, resource_id)
    references public.integration_resources (organization_id, id) on delete set null,
  foreign key (organization_id, mapping_id)
    references public.integration_mappings (organization_id, id) on delete set null
);

comment on table public.import_runs is
  'One execution of a mapping against staged source rows. mapping_snapshot is a copy, never a live join (I8) — editing integration_mappings tomorrow cannot reinterpret a run that already applied.';

create index import_runs_org_idx on public.import_runs (organization_id, created_at desc);

alter table public.import_runs enable row level security;
alter table public.import_runs force  row level security;

create policy import_runs_select on public.import_runs
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

grant select on public.import_runs to authenticated;

-- ---------------------------------------------------------------------------
-- import_staging_rows
-- ---------------------------------------------------------------------------

create table public.import_staging_rows (
  id                    uuid        primary key default gen_random_uuid(),
  organization_id       uuid        not null references public.organizations (id) on delete cascade,
  -- Composite (I18) below, not an inline `references`.
  run_id                uuid        not null,

  -- Stable within the source — a natural key column if the source has one, else a row index.
  -- Not globally unique on its own; scoped to the run.
  source_record_key     text        not null check (length(btrim(source_record_key)) between 1 and 500),

  raw                   jsonb       not null default '{}'::jsonb check (jsonb_typeof(raw) = 'object'),
  normalized            jsonb       not null default '{}'::jsonb check (jsonb_typeof(normalized) = 'object'),
  validation_errors     jsonb       not null default '[]'::jsonb check (jsonb_typeof(validation_errors) = 'array'),

  proposed_action       text        not null default 'create' check (proposed_action in ('create', 'update', 'skip')),
  -- Composite (I18) below.
  matched_customer_id   uuid,

  status                text        not null default 'ready'
                                     check (status in ('ready', 'duplicate', 'invalid', 'ignored', 'applied', 'failed')),

  created_at            timestamptz not null default now(),

  unique (organization_id, run_id, source_record_key),

  foreign key (organization_id, run_id)
    references public.import_runs (organization_id, id) on delete cascade,
  foreign key (organization_id, matched_customer_id)
    references public.customers (organization_id, id) on delete set null
);

comment on table public.import_staging_rows is
  'One source row, reviewed before it is applied. A durable record of what a run saw — not deleted after applying.';

create index import_staging_rows_run_idx on public.import_staging_rows (organization_id, run_id, status);

alter table public.import_staging_rows enable row level security;
alter table public.import_staging_rows force  row level security;

create policy import_staging_rows_select on public.import_staging_rows
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

grant select on public.import_staging_rows to authenticated;

-- ---------------------------------------------------------------------------
-- external_record_links — the idempotency backbone
-- ---------------------------------------------------------------------------

create table public.external_record_links (
  id                  uuid        primary key default gen_random_uuid(),
  organization_id     uuid        not null references public.organizations (id) on delete cascade,

  connector_key       text        not null,
  external_record_id  text        not null check (length(btrim(external_record_id)) between 1 and 500),
  gold_entity_type    text        not null check (gold_entity_type in ('customer')),
  gold_entity_id      uuid        not null,

  -- A hash of the normalized source row, so a future sync can tell "unchanged since last time"
  -- from "changed, re-apply" without re-reading the whole row. Not consulted by this slice's
  -- import-only path; carried now so a later sync doesn't need a second migration to add it.
  source_hash         text,

  -- Informational only, both nullable on delete set null — a link outlives the run or resource
  -- that first wrote it, the same reasoning import_runs.resource_id already carries. Composite
  -- (I18) below.
  run_id              uuid,
  resource_id         uuid,

  first_imported_at   timestamptz not null default now(),
  last_synced_at      timestamptz not null default now(),

  -- The whole idempotency mechanism: a second run naming the same source record upserts this
  -- row rather than creating a second one.
  unique (organization_id, connector_key, external_record_id, gold_entity_type),

  foreign key (organization_id, run_id)
    references public.import_runs (organization_id, id) on delete set null,
  foreign key (organization_id, resource_id)
    references public.integration_resources (organization_id, id) on delete set null
);

comment on table public.external_record_links is
  'Which GOLD entity a given external record already became. The unique index is what makes a re-run of the same source idempotent rather than duplicating.';

create index external_record_links_entity_idx on public.external_record_links (organization_id, gold_entity_type, gold_entity_id);

alter table public.external_record_links enable row level security;
alter table public.external_record_links force  row level security;

create policy external_record_links_select on public.external_record_links
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

grant select on public.external_record_links to authenticated;

-- ---------------------------------------------------------------------------
-- begin_import_run — snapshot a mapping, open a run
-- ---------------------------------------------------------------------------

create function public.begin_import_run(p_organization_id uuid, p_mapping_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor         uuid := app.require_capability(p_organization_id, 'integration.manage');
  v_mapping       record;
  v_connector_key text;
  v_run_id        uuid;
begin
  select m.resource_id, m.mapping, m.dedupe_key, m.target_entity
    into v_mapping
  from public.integration_mappings m
  where m.id = p_mapping_id
    and m.organization_id = p_organization_id;

  if not found then
    raise exception 'no such mapping for that organization' using errcode = '22023';
  end if;

  select c.connector_key into v_connector_key
  from public.integration_resources r
  join public.integration_connections c on c.id = r.connection_id
  where r.id = v_mapping.resource_id
    and r.organization_id = p_organization_id;

  if v_connector_key is null then
    raise exception 'that mapping''s resource has no connection' using errcode = '22023';
  end if;

  insert into public.import_runs
    (organization_id, resource_id, mapping_id, connector_key, mapping_snapshot, initiated_by)
  values (
    p_organization_id,
    v_mapping.resource_id,
    p_mapping_id,
    v_connector_key,
    jsonb_build_object(
      'mapping', v_mapping.mapping,
      'dedupe_key', v_mapping.dedupe_key,
      'target_entity', v_mapping.target_entity
    ),
    v_actor
  )
  returning id into v_run_id;

  return v_run_id;
end;
$fn$;

comment on function public.begin_import_run(uuid, uuid) is
  'Opens a run and freezes the mapping it will use (I8). The run never reads integration_mappings again.';

revoke all on function public.begin_import_run(uuid, uuid) from public;
grant execute on function public.begin_import_run(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- stage_import_rows — parsed rows in, reviewable rows out
-- ---------------------------------------------------------------------------

-- Takes rows already parsed and coerced by the caller (the same field-kind validation
-- `resolveCustom`/`parseCustom` already run for every other write into `custom`, reused rather
-- than reimplemented here — this function's own job is matching and duplicate detection, not
-- shape validation). Re-callable: staging again for a still-pending run replaces what was there,
-- so a "change the mapping, come back" flow needs no separate clear step.
create function public.stage_import_rows(p_organization_id uuid, p_run_id uuid, p_rows jsonb)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_status     text;
  v_dedupe_key text;
  v_count      integer;
begin
  perform app.require_capability(p_organization_id, 'integration.manage');

  select r.status, r.mapping_snapshot ->> 'dedupe_key'
    into v_status, v_dedupe_key
  from public.import_runs r
  where r.id = p_run_id
    and r.organization_id = p_organization_id;

  if not found then
    raise exception 'no such run for that organization' using errcode = '22023';
  end if;
  if v_status <> 'pending' then
    raise exception 'rows can only be staged for a run that has not yet applied' using errcode = '22023';
  end if;

  delete from public.import_staging_rows where run_id = p_run_id and organization_id = p_organization_id;

  -- `seq` is the caller's own array index, carried in the payload rather than derived here —
  -- Postgres refuses `WITH ORDINALITY` together with an explicit column definition list, and
  -- `created_at` cannot serve as the tiebreak either: every row in one `insert` statement shares
  -- the same statement-time `now()`, which made an earlier version of this function's duplicate
  -- ranking non-deterministic. In-batch duplicates are ranked in the same pass rather than a
  -- second `update`: two source rows resolving to the same email, neither matching an existing
  -- customer, would otherwise both propose "create" — only the first (by input order) stands.
  with source as (
    select x.seq, x.source_record_key, x.raw, x.normalized, x.validation_errors
    from jsonb_to_recordset(p_rows) as x(
      seq integer,
      source_record_key text,
      raw jsonb,
      normalized jsonb,
      validation_errors jsonb
    )
  ),
  matched as (
    select s.seq, c.id as customer_id
    from source s
    left join lateral (
      select c.id
      from public.customers c
      where c.organization_id = p_organization_id
        and v_dedupe_key = 'email'
        and s.normalized ->> 'email' is not null
        and lower(c.email) = lower(s.normalized ->> 'email')
      limit 1
    ) as c on true
  ),
  ranked as (
    select s.seq,
           row_number() over (partition by s.normalized ->> 'email' order by s.seq) as dup_rank
    from source s
    where s.normalized ->> 'email' is not null
  )
  insert into public.import_staging_rows
    (organization_id, run_id, source_record_key, raw, normalized, validation_errors, proposed_action, matched_customer_id, status)
  select
    p_organization_id,
    p_run_id,
    s.source_record_key,
    s.raw,
    s.normalized,
    s.validation_errors,
    case
      when jsonb_array_length(s.validation_errors) > 0 then 'skip'
      when coalesce(r.dup_rank, 1) > 1 then 'skip'
      when m.customer_id is not null then 'update'
      else 'create'
    end,
    m.customer_id,
    case
      when jsonb_array_length(s.validation_errors) > 0 then 'invalid'
      when coalesce(r.dup_rank, 1) > 1 then 'duplicate'
      else 'ready'
    end
  from source s
  left join matched m on m.seq = s.seq
  left join ranked r on r.seq = s.seq;

  select count(*) into v_count
  from public.import_staging_rows
  where run_id = p_run_id and organization_id = p_organization_id;

  update public.import_runs set rows_seen = v_count where id = p_run_id;

  return v_count;
end;
$fn$;

comment on function public.stage_import_rows(uuid, uuid, jsonb) is
  'Bulk-inserts parsed, already-validated rows for review; matches each against existing customers by the run''s dedupe key and marks in-batch duplicates. Re-callable while the run is still pending.';

revoke all on function public.stage_import_rows(uuid, uuid, jsonb) from public;
grant execute on function public.stage_import_rows(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- apply_import_run — the one writer, one row at a time, one failure at a time
-- ---------------------------------------------------------------------------

-- Each row runs in its own exception block — a plpgsql `begin/exception/end` inside the loop is
-- an implicit savepoint, the same subtransaction discipline `app.fire_event_automations` already
-- uses so one bad rule can't break a customer's booking. Here it means row 4,001's unique-index
-- collision doesn't roll back rows 1 through 4,000 that already committed.
create function public.apply_import_run(p_organization_id uuid, p_run_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor       uuid := app.require_capability(p_organization_id, 'integration.manage');
  v_status      text;
  v_row         record;
  v_customer_id uuid;
  v_created     integer := 0;
  v_updated     integer := 0;
  v_failed      integer := 0;
  v_skipped     integer := 0;
begin
  select status into v_status
  from public.import_runs
  where id = p_run_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'no such run for that organization' using errcode = '22023';
  end if;
  -- Applying is a one-way transition, the same shape D32 already gives a configuration proposal:
  -- what was applied must not be rewritten later to say something else was. Failed rows are
  -- reviewed and re-staged into a new run, never replayed onto this one.
  if v_status <> 'pending' then
    raise exception 'this run has already been applied' using errcode = '22023';
  end if;

  update public.import_runs set status = 'running' where id = p_run_id;

  for v_row in
    select * from public.import_staging_rows
    where run_id = p_run_id and organization_id = p_organization_id and status = 'ready'
    order by created_at
  loop
    begin
      v_customer_id := null;

      if v_row.proposed_action = 'create' then
        if not app.has_capability(p_organization_id, 'customer.create') then
          raise exception 'you cannot add customers here' using errcode = '42501';
        end if;

        insert into public.customers (organization_id, name, email, phone, custom, created_by)
        values (
          p_organization_id,
          v_row.normalized ->> 'name',
          v_row.normalized ->> 'email',
          v_row.normalized ->> 'phone',
          coalesce(v_row.normalized -> 'custom', '{}'::jsonb),
          v_actor
        )
        returning id into v_customer_id;

        insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
        values (
          p_organization_id, v_actor, 'customer', v_customer_id, 'customer.imported',
          jsonb_build_object('run_id', p_run_id, 'source_record_key', v_row.source_record_key)
        );

        v_created := v_created + 1;

      elsif v_row.proposed_action = 'update' then
        if not app.has_capability(p_organization_id, 'customer.update') then
          raise exception 'you cannot change customers here' using errcode = '42501';
        end if;
        if v_row.matched_customer_id is null then
          raise exception 'no matched customer to update' using errcode = '22023';
        end if;

        update public.customers
           set name   = coalesce(v_row.normalized ->> 'name', name),
               phone  = coalesce(v_row.normalized ->> 'phone', phone),
               custom = coalesce(v_row.normalized -> 'custom', custom)
         where id = v_row.matched_customer_id
           and organization_id = p_organization_id;

        v_customer_id := v_row.matched_customer_id;

        insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
        values (
          p_organization_id, v_actor, 'customer', v_customer_id, 'customer.import_matched',
          jsonb_build_object('run_id', p_run_id, 'source_record_key', v_row.source_record_key)
        );

        v_updated := v_updated + 1;
      end if;

      insert into public.external_record_links
        (organization_id, connector_key, external_record_id, gold_entity_type, gold_entity_id, run_id, resource_id, last_synced_at)
      select r.organization_id, r.connector_key, v_row.source_record_key, 'customer', v_customer_id, p_run_id, r.resource_id, now()
      from public.import_runs r
      where r.id = p_run_id
      on conflict (organization_id, connector_key, external_record_id, gold_entity_type)
      do update set gold_entity_id = excluded.gold_entity_id, run_id = excluded.run_id, last_synced_at = now();

      update public.import_staging_rows set status = 'applied' where id = v_row.id;
    exception when others then
      v_failed := v_failed + 1;
      update public.import_staging_rows
         set status = 'failed',
             validation_errors = validation_errors || jsonb_build_array(sqlerrm)
       where id = v_row.id;
    end;
  end loop;

  select count(*) into v_skipped
  from public.import_staging_rows
  where run_id = p_run_id and organization_id = p_organization_id
    and status in ('duplicate', 'invalid', 'ignored');

  update public.import_runs
     set status       = case when v_failed > 0 then 'completed_with_errors' else 'completed' end,
         finished_at  = now(),
         rows_created = v_created,
         rows_updated = v_updated,
         rows_skipped = v_skipped,
         rows_failed  = v_failed
   where id = p_run_id;
end;
$fn$;

comment on function public.apply_import_run(uuid, uuid) is
  'The one writer. Each staged row runs in its own subtransaction, so one failure marks that row failed rather than rolling back the rows already applied. Refuses a second application of the same run.';

revoke all on function public.apply_import_run(uuid, uuid) from public;
grant execute on function public.apply_import_run(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Recording the ordinary lifecycle — connections, resources, mappings, disconnect
-- ---------------------------------------------------------------------------

-- Plain functions, not SECURITY DEFINER — each relies on the insert/update policy already on
-- the table it writes (the `create_customer` shape), and exists only to pair the write with the
-- event a business's timeline should carry.
create function public.record_integration_connection(
  p_organization_id uuid,
  p_connector_key   text,
  p_account_label   text
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'record_integration_connection requires an authenticated caller' using errcode = '42501';
  end if;

  insert into public.integration_connections (organization_id, connector_key, account_label, connected_by)
  values (p_organization_id, p_connector_key, p_account_label, v_actor)
  returning id into v_id;

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'integration_connection', v_id, 'integration_connection.connected',
    jsonb_build_object('connector_key', p_connector_key));

  return v_id;
end;
$fn$;

revoke all on function public.record_integration_connection(uuid, text, text) from public;
grant execute on function public.record_integration_connection(uuid, text, text) to authenticated;

create function public.disconnect_integration(p_organization_id uuid, p_connection_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'disconnect_integration requires an authenticated caller' using errcode = '42501';
  end if;

  update public.integration_connections
     set status = 'disconnected', updated_at = now()
   where id = p_connection_id
     and organization_id = p_organization_id;

  if not found then
    raise exception 'no such connection for that organization' using errcode = '22023';
  end if;

  -- Never touches integration_resources, integration_mappings, import_runs or
  -- external_record_links — the requirement this door exists to hold: disconnecting must not
  -- unexpectedly delete, or even reach, a customer this business already imported.
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'integration_connection', p_connection_id, 'integration_connection.disconnected', '{}'::jsonb);
end;
$fn$;

revoke all on function public.disconnect_integration(uuid, uuid) from public;
grant execute on function public.disconnect_integration(uuid, uuid) to authenticated;

create function public.record_integration_resource(
  p_organization_id uuid,
  p_connection_id   uuid,
  p_resource_type   text,
  p_display_name    text,
  p_external_id     text,
  p_storage_path    text,
  p_metadata        jsonb
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'record_integration_resource requires an authenticated caller' using errcode = '42501';
  end if;

  insert into public.integration_resources
    (organization_id, connection_id, resource_type, display_name, external_id, storage_path, metadata)
  values
    (p_organization_id, p_connection_id, p_resource_type, p_display_name, p_external_id, p_storage_path, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'integration_resource', v_id, 'integration_resource.added',
    jsonb_build_object('resource_type', p_resource_type, 'display_name', p_display_name));

  return v_id;
end;
$fn$;

revoke all on function public.record_integration_resource(uuid, uuid, text, text, text, text, jsonb) from public;
grant execute on function public.record_integration_resource(uuid, uuid, text, text, text, text, jsonb) to authenticated;

create function public.record_integration_mapping(
  p_organization_id uuid,
  p_resource_id     uuid,
  p_target_entity   text,
  p_mapping         jsonb,
  p_dedupe_key      text
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'record_integration_mapping requires an authenticated caller' using errcode = '42501';
  end if;

  insert into public.integration_mappings
    (organization_id, resource_id, target_entity, mapping, dedupe_key, created_by)
  values
    (p_organization_id, p_resource_id, p_target_entity, p_mapping, p_dedupe_key, v_actor)
  returning id into v_id;

  return v_id;
end;
$fn$;

revoke all on function public.record_integration_mapping(uuid, uuid, text, jsonb, text) from public;
grant execute on function public.record_integration_mapping(uuid, uuid, text, jsonb, text) to authenticated;

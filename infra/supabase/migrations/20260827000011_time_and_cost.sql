-- What a job actually consumed: time worked, and money spent.
--
-- This is where money enters the schema, so I10 is settled here rather than inherited:
-- "Money is integer minor units, and currency is per-tenant configuration."
--
-- roadmap.md assigns I10 to M3, alongside pricing. That is the right home for I4 -- there is
-- exactly one price calculation -- and it is not a reason to defer this, because a recorded
-- COST is not a PRICE. A price is derived from configuration a business publishes and is the
-- thing I4 governs; a cost is an observation about one job that already happened. Recording
-- what a subcontractor charged needs no pricing engine, and postponing it would mean the
-- first pricing slice inventing the money columns as a side effect. roadmap.md's `Enforces`
-- line for M2 is corrected in the same change rather than quietly outgrown.
--
-- Two absences worth stating:
--
--   * There is no rate on a resource and no computed labour cost. That is a price
--     calculation wearing a different hat, and I4 says there is exactly one of those. Time is
--     recorded as time; what an hour is worth is M3's.
--   * There is no `billable` flag. Nothing invoices, so nothing reads it.

-- ---------------------------------------------------------------------------
-- The tenant's currency
-- ---------------------------------------------------------------------------

-- "Currency is per-tenant configuration and is never assumed" -- so it is chosen at founding
-- beside the timezone, and there is no platform default that quietly becomes an assumption.
-- ISO 4217 is three uppercase letters; Postgres holds no catalogue of them, and inventing one
-- here would be a table nobody maintains. The regex is the honest limit of what this schema
-- can check, and it is stated rather than dressed up.
alter table public.organizations
  add column currency text not null default 'EUR'
  constraint organizations_currency_shape check (currency ~ '^[A-Z]{3}$');

comment on column public.organizations.currency is
  'ISO 4217 code this business trades in. Never assumed by the platform; snapshotted onto each amount (I10).';

-- ---------------------------------------------------------------------------
-- Time worked
-- ---------------------------------------------------------------------------

create table public.work_item_time_entries (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  work_item_id    uuid        not null,

  -- Who did it. A resource rather than a user, because a business logs time against people
  -- who have never signed in -- and D19 is explicit that a person-Resource is not a User.
  resource_id     uuid,

  -- What actually happened, as opposed to work_items.scheduled_during, which is what was
  -- planned. They differ constantly and that difference is the whole reporting value; one
  -- column serving both would destroy it the first time a job ran late.
  --
  -- No exclusion constraint here, deliberately. Two overlapping time entries are a
  -- correction or a mistake to be reported on, not an impossibility -- I7 is about
  -- committing a resource to future work, and refusing a timesheet that overlaps would mean
  -- refusing to record something that genuinely occurred.
  worked_during   tstzrange   not null,

  note            text        check (note is null or length(btrim(note)) between 1 and 1000),

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  constraint work_item_time_entries_window_is_bounded_half_open
    check (
      lower(worked_during) is not null
      and upper(worked_during) is not null
      and not isempty(worked_during)
      and lower_inc(worked_during)
      and not upper_inc(worked_during)
    ),

  -- I18, twice.
  constraint work_item_time_entries_work_item_same_org
    foreign key (organization_id, work_item_id)
    references public.work_items (organization_id, id) on delete cascade,

  constraint work_item_time_entries_resource_same_org
    foreign key (organization_id, resource_id)
    references public.resources (organization_id, id) on delete set null (resource_id)
);

comment on table public.work_item_time_entries is
  'Time actually worked on a job, as opposed to time scheduled. See the migration for why both exist.';

create index work_item_time_entries_org_work_item_idx
  on public.work_item_time_entries (organization_id, work_item_id);

alter table public.work_item_time_entries enable row level security;
alter table public.work_item_time_entries force row level security;

create policy work_item_time_entries_select on public.work_item_time_entries
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy work_item_time_entries_insert on public.work_item_time_entries
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'work_item.record')
  );

grant select, insert on public.work_item_time_entries to authenticated;

-- ---------------------------------------------------------------------------
-- Money spent
-- ---------------------------------------------------------------------------

create table public.work_item_costs (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  work_item_id    uuid        not null,

  description     text        not null check (length(btrim(description)) between 1 and 200),

  -- I10: integer minor units, never a float, and never a decimal that a client will round.
  -- bigint rather than integer because 2^31 minor units is about twenty-one million euro,
  -- which is a plausible number to meet and a terrible one to discover a wraparound on.
  amount_minor    bigint      not null,

  -- Snapshotted, not joined. "Amounts and terms are snapshotted onto the record at the
  -- moment of commitment; catalogue edits are not retroactive" -- a business that changes
  -- the currency it trades in has not changed what last year's jobs cost, and reading the
  -- organization's current currency at render time would silently rewrite them (I8).
  currency        text        not null check (currency ~ '^[A-Z]{3}$'),

  incurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  -- Negative is allowed and is not an oversight: a refund, a credit, or a correction is a
  -- new row with a negative amount rather than an edit to the row that was wrong, because
  -- history is not rewritten. Zero is not: a cost of nothing is a row that says nothing.
  constraint work_item_costs_amount_not_zero check (amount_minor <> 0),

  constraint work_item_costs_work_item_same_org
    foreign key (organization_id, work_item_id)
    references public.work_items (organization_id, id) on delete cascade
);

comment on table public.work_item_costs is
  'What a job cost the business, in integer minor units with the currency snapshotted (I10, I8).';

create index work_item_costs_org_work_item_idx
  on public.work_item_costs (organization_id, work_item_id);

alter table public.work_item_costs enable row level security;
alter table public.work_item_costs force row level security;

create policy work_item_costs_select on public.work_item_costs
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy work_item_costs_insert on public.work_item_costs
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'work_item.record')
  );

-- No update or delete policy on either table. A timesheet and a cost are records of what
-- happened; correcting one is a new row, which is the same rule `events` follows and the
-- reason neither has an edit path.
grant select, insert on public.work_item_costs to authenticated;

-- ---------------------------------------------------------------------------
-- The new capability
-- ---------------------------------------------------------------------------

alter table public.roles drop constraint roles_capabilities_known;

alter table public.roles
  add constraint roles_capabilities_known
  check (capabilities <@ array[
    'customer.create',
    'role.manage',
    'field.manage',
    'location.create',
    'resource.create',
    'work_item.create',
    'asset.create',
    'document.create',
    'work_item.transition',
    'work_item.schedule',
    'work_item.record'
  ]::text[]);

-- Whoever moves work along records what it consumed: the technician closing a job is the
-- person who knows how long it took and what the part cost.
update public.roles
   set capabilities = capabilities || array['work_item.record']::text[]
 where 'work_item.transition' = any (capabilities)
   and not ('work_item.record' = any (capabilities));

-- ---------------------------------------------------------------------------
-- Recording, each as one transaction
-- ---------------------------------------------------------------------------

create function public.record_work_item_time(
  p_work_item_id uuid,
  p_resource_id  uuid,
  p_started_at   timestamptz,
  p_ended_at     timestamptz,
  p_note         text
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'record_work_item_time requires an authenticated caller'
      using errcode = '42501';
  end if;

  if p_ended_at <= p_started_at then
    raise exception 'time worked must end after it starts' using errcode = '23514';
  end if;

  select w.organization_id into v_org
    from public.work_items w
   where w.id = p_work_item_id;

  if v_org is null then
    raise exception 'no such work item' using errcode = '23503';
  end if;

  insert into public.work_item_time_entries
    (organization_id, work_item_id, resource_id, worked_during, note, created_by)
  values
    (v_org, p_work_item_id, p_resource_id,
     tstzrange(p_started_at, p_ended_at, '[)'), p_note, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item', p_work_item_id, 'work_item.time_recorded',
     jsonb_build_object(
       'time_entry_id', v_id,
       'resource_id', p_resource_id,
       'started_at', p_started_at,
       'ended_at', p_ended_at
     ));

  return v_id;
end;
$fn$;

revoke all on function public.record_work_item_time(uuid, uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.record_work_item_time(uuid, uuid, timestamptz, timestamptz, text) to authenticated;

create function public.record_work_item_cost(
  p_work_item_id uuid,
  p_description  text,
  p_amount_minor bigint
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_org      uuid;
  v_currency text;
  v_id       uuid;
begin
  if v_actor is null then
    raise exception 'record_work_item_cost requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- The currency is read from the organization and written onto the row, not passed in. A
  -- caller does not get to assert what currency a business trades in, and the snapshot is
  -- what keeps a later change from rewriting this amount's meaning (I8).
  select w.organization_id, o.currency into v_org, v_currency
    from public.work_items w
    join public.organizations o on o.id = w.organization_id
   where w.id = p_work_item_id;

  if v_org is null then
    raise exception 'no such work item' using errcode = '23503';
  end if;

  insert into public.work_item_costs
    (organization_id, work_item_id, description, amount_minor, currency, created_by)
  values (v_org, p_work_item_id, p_description, p_amount_minor, v_currency, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item', p_work_item_id, 'work_item.cost_recorded',
     jsonb_build_object(
       'cost_id', v_id,
       'description', p_description,
       'amount_minor', p_amount_minor,
       'currency', v_currency
     ));

  return v_id;
end;
$fn$;

revoke all on function public.record_work_item_cost(uuid, text, bigint) from public;
grant execute on function public.record_work_item_cost(uuid, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- create_organization gains the currency
-- ---------------------------------------------------------------------------

drop function public.create_organization(text, text, text[], text, text);

create function public.create_organization(
  p_name         text,
  p_role         text,
  p_capabilities text[],
  p_display_name text,
  p_timezone     text,
  p_currency     text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_role  uuid;
begin
  if v_actor is null then
    raise exception 'create_organization requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Timezone coalesces and currency does not, and the asymmetry is the point. UTC is the
  -- absence of an assumption about a business; there is no neutral currency, so a platform
  -- default would be the platform deciding what this business trades in. The column's
  -- default exists only to make it NOT NULL on rows that predate it.
  if p_currency is null then
    raise exception 'an organization must say what currency it trades in'
      using errcode = '23514';
  end if;

  insert into public.organizations (name, timezone, currency, created_by)
  values (p_name, coalesce(p_timezone, 'UTC'), p_currency, v_actor)
  returning id into v_org;

  insert into public.roles (organization_id, name, capabilities, created_by)
  values (v_org, p_role, p_capabilities, v_actor)
  returning id into v_role;

  insert into public.memberships
    (organization_id, user_id, role_id, display_name, created_by)
  values (v_org, v_actor, v_role, p_display_name, v_actor);

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'organization', v_org, 'organization.created',
     jsonb_build_object(
       'name', p_name, 'role', p_role, 'timezone', p_timezone, 'currency', p_currency
     ));

  return v_org;
end;
$fn$;

revoke all on function public.create_organization(text, text, text[], text, text, text) from public;
grant execute on function public.create_organization(text, text, text[], text, text, text) to authenticated;

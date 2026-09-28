-- Work Order 5: routing as a real Communications capability. A route is a business phone
-- configuration a tenant understands — a number (or the organization's catch-all), when it
-- applies, who it rings and how, and what happens if nobody answers. It is not a workflow
-- engine: one row is one route, and a route's own targets are the only nesting this schema has.
--
-- **Scheduling is consumed, not duplicated.** `when_mode = 'business_hours'` reads the one
-- organization-wide `operating_hours` table (`lib/domain/scheduling/operating-hours.ts`); there
-- is no per-route calendar, because the current Scheduling domain has no route-scoped concept to
-- hang one on, and inventing a second calendar table would be exactly the second-truth CLAUDE.md
-- refuses (I4/I5's reasoning, restated for time-of-day).
--
-- **Geography is deliberately absent.** NextFund's province-pool behavior is a real, useful
-- pattern for one tenant with a Canadian-provincial number strategy; it is not the routing
-- architecture. Nothing here names a province, an area code or a region — a future geographic
-- ring strategy is a `destination_type`/resolver addition, not a schema-wide assumption every
-- tenant pays for.

create table public.communication_routes (
  id                         uuid        primary key default gen_random_uuid(),
  organization_id            uuid        not null references public.organizations (id) on delete cascade,
  name                       text        not null check (length(btrim(name)) between 1 and 120),

  -- Null means the organization's catch-all — applies when no route names the incoming number.
  -- At most one such row per organization (the partial unique index below).
  number_id                  uuid        null,

  enabled                    boolean     not null default true,
  when_mode                  text        not null default 'always'
                               check (when_mode in ('always', 'business_hours')),

  ring_strategy              text        not null default 'everyone'
                               check (ring_strategy in ('everyone', 'sequential', 'round_robin')),
  ring_timeout_seconds       integer     not null default 20 check (ring_timeout_seconds between 5 and 120),

  destination_type           text        not null check (destination_type in ('members', 'external_number', 'route')),
  destination_external_number text       null check (destination_external_number is null or destination_external_number ~ '^\+[1-9][0-9]{7,14}$'),
  destination_route_id       uuid        null,

  fallback_type               text       not null default 'voicemail'
                               check (fallback_type in ('voicemail', 'members', 'external_number', 'route', 'none')),
  fallback_external_number    text       null check (fallback_external_number is null or fallback_external_number ~ '^\+[1-9][0-9]{7,14}$'),
  fallback_route_id           uuid       null,

  -- "Return calls to the last agent" (tenant-facing wording) — optional, off by default, tried
  -- before the ordinary destination when a matching recent outbound call exists.
  callback_affinity_enabled   boolean    not null default false,

  -- Advanced by `advance_route_round_robin` below, one `update` per call so Postgres's own row
  -- lock is the concurrency guard — no separate lock table, no read-then-write race.
  round_robin_cursor          integer    not null default 0,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  created_by                  uuid        null references auth.users (id),

  unique (organization_id, id),
  foreign key (organization_id, number_id) references public.phone_numbers (organization_id, id) on delete set null,
  foreign key (organization_id, destination_route_id) references public.communication_routes (organization_id, id) on delete set null,
  foreign key (organization_id, fallback_route_id) references public.communication_routes (organization_id, id) on delete set null,

  check (destination_type <> 'external_number' or destination_external_number is not null),
  check (destination_type <> 'route' or destination_route_id is not null),
  check (fallback_type <> 'external_number' or fallback_external_number is not null),
  check (fallback_type <> 'route' or fallback_route_id is not null),
  -- No direct self-loop; a longer cycle (A falls back to B falls back to A) is still possible at
  -- the schema level and is refused by the resolver at resolve-time (a visited-route-id set),
  -- since a constraint here cannot see the whole graph a later edit might create.
  check (destination_route_id is distinct from id),
  check (fallback_route_id is distinct from id)
);

-- Exactly one organization-wide catch-all.
create unique index communication_routes_one_default_per_org
  on public.communication_routes (organization_id) where number_id is null;

-- I2: tenant id leads.
create index communication_routes_org_number_idx on public.communication_routes (organization_id, number_id);

comment on table public.communication_routes is
  'A tenant''s own phone configuration: a number (or the organization catch-all), when it applies, who it rings and how, and its fallback. Not a workflow engine — one row is one route.';

alter table public.communication_routes enable row level security;
alter table public.communication_routes force row level security;

create policy communication_routes_select on public.communication_routes
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- Configuring routing is `field.manage`, the same capability Work Order 1's Configure surface
-- already uses for call outcomes and stages — configuring how this business behaves, not
-- operating it (`call.place` is a different capability and stays so).
create policy communication_routes_insert on public.communication_routes
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'field.manage')
    and created_by = auth.uid()
  );

create policy communication_routes_update on public.communication_routes
  for update to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'field.manage'))
  with check (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'field.manage'));

grant select, insert on public.communication_routes to authenticated;
-- Every column but the two that must never move once set — a route is renamed, retuned and
-- redirected freely, but changing which organization it belongs to or who created it would be a
-- second business's configuration wearing this one's history (I8, restated for a config row).
grant update (
  name, number_id, enabled, when_mode, ring_strategy, ring_timeout_seconds,
  destination_type, destination_external_number, destination_route_id,
  fallback_type, fallback_external_number, fallback_route_id,
  callback_affinity_enabled, round_robin_cursor, updated_at
) on public.communication_routes to authenticated;

-- No update trigger — matching `phone_numbers`' own convention (Work Orders 1/3): the writer
-- sets `updated_at = now()` explicitly in its own update, rather than a repo-wide trigger this
-- schema has never used.

-- ---------------------------------------------------------------------------
-- A route's own targets — ordered members for its primary destination, its fallback, or both.
-- ---------------------------------------------------------------------------
create table public.communication_route_targets (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  route_id        uuid        not null,
  slot            text        not null check (slot in ('primary', 'fallback')),
  member_id       uuid        not null,
  position        integer     not null default 0,
  created_at      timestamptz not null default now(),

  unique (organization_id, route_id, slot, member_id),
  foreign key (organization_id, route_id) references public.communication_routes (organization_id, id) on delete cascade,
  foreign key (organization_id, member_id) references public.memberships (organization_id, id) on delete cascade
);

create index communication_route_targets_route_idx on public.communication_route_targets (organization_id, route_id, slot, position);

comment on table public.communication_route_targets is
  'The members one route rings, ordered, for its primary destination and/or its fallback. Not a reusable Team — a route''s own list.';

alter table public.communication_route_targets enable row level security;
alter table public.communication_route_targets force row level security;

create policy communication_route_targets_select on public.communication_route_targets
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy communication_route_targets_write on public.communication_route_targets
  for all to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'field.manage'))
  with check (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'field.manage'));

grant select, insert, update, delete on public.communication_route_targets to authenticated;

-- ---------------------------------------------------------------------------
-- The one door that advances a round-robin cursor — an update, not a read-then-write, so two
-- simultaneous inbound calls to the same route can never compute the same next index.
-- ---------------------------------------------------------------------------
create function public.advance_route_round_robin(
  p_organization_id uuid,
  p_route_id uuid
) returns integer language sql volatile security invoker set search_path = '' as $$
  update public.communication_routes
     set round_robin_cursor = round_robin_cursor + 1
   where organization_id = p_organization_id and id = p_route_id
  returning round_robin_cursor;
$$;
revoke all on function public.advance_route_round_robin(uuid, uuid) from public;
grant execute on function public.advance_route_round_robin(uuid, uuid) to authenticated;

comment on function public.advance_route_round_robin(uuid, uuid) is
  'security invoker: the select/update policies on communication_routes decide, same as every other tenant-writable table here. The update statement itself is the concurrency guard.';

-- ---------------------------------------------------------------------------
-- One calculation of "is this business open right now" (I4/I5), callable from either runtime.
-- ---------------------------------------------------------------------------
-- The routing resolver runs in Python (`apps/api`, D30 — the carrier's webhook needs a
-- synchronous decision and the two runtimes cannot call each other), so this predicate could not
-- stay `lib/domain/scheduling/operating-hours.ts`'s `openWindows` alone: a Python re-derivation
-- of the same day/window logic would be a second calculation this repository refuses to carry
-- (`comms.voice.call_controls`'s own gap-tracking entry is the cautionary example — the thing not
-- built is safer than the thing built twice and left to drift). One SQL function, read by both.
create function app.is_within_operating_hours(
  p_organization_id uuid,
  p_at timestamptz default now()
) returns boolean language sql stable security invoker set search_path = '' as $$
  select case
    -- No hours configured is "no claim" — always open — the same rule `openWindows` states for
    -- an empty set (the load-bearing absence: no seeded working week).
    when not exists (select 1 from public.operating_hours where organization_id = p_organization_id) then true
    else exists (
      select 1
        from public.operating_hours h
        join public.organizations o on o.id = p_organization_id
       where h.organization_id = p_organization_id
         and h.day_of_week = extract(isodow from p_at at time zone coalesce(o.timezone, 'UTC'))::smallint
         and (p_at at time zone coalesce(o.timezone, 'UTC'))::time >= h.opens_at
         and (p_at at time zone coalesce(o.timezone, 'UTC'))::time <  h.closes_at
    )
  end;
$$;
revoke all on function app.is_within_operating_hours(uuid, timestamptz) from public;
grant execute on function app.is_within_operating_hours(uuid, timestamptz) to authenticated;

-- `app.*` is internal (PostgREST exposes only `public`/`graphql_public` — `supabase/config.toml`),
-- so the routing resolver (Python, over PostgREST under the caller's own token) reaches the same
-- one calculation through this thin wrapper rather than a schema it cannot call at all.
create function public.organization_open_now(
  p_organization_id uuid,
  p_at timestamptz default now()
) returns boolean language sql stable security invoker set search_path = '' as $$
  select app.is_within_operating_hours(p_organization_id, p_at);
$$;
revoke all on function public.organization_open_now(uuid, timestamptz) from public;
grant execute on function public.organization_open_now(uuid, timestamptz) to authenticated;

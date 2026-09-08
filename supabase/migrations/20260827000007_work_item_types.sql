-- Work item types: the thing M1 deliberately left out, and the first half of M2's criterion.
--
-- 20260827000003_work_items.sql states the debt precisely, and this migration is the change
-- it names:
--
--   "No work item TYPE. [...] With a single implicit type per tenant, a `type` column's only
--    consumer would be itself: the reason types exist is to scope which statuses apply, and
--    with one type there is nothing to scope. Statuses are therefore per organization here,
--    and become per type in the change that adds types."
--
-- The caller arrives with the column, as the rule requires. After this migration the board is
-- a *type's* board, the status list is a *type's* status list, and the new-work-item form
-- must know the type before it can offer a status at all.
--
-- A type is not a table of behaviour, and this is the load-bearing claim. Nothing in the
-- platform branches on which type a work item has -- an Installation and a Repair are the
-- same row with different configuration hanging off them, which is exactly what
-- domain-model.md asserts when it says a job, service call, inspection, delivery,
-- installation, booking and appointment are one table. What a type owns is SCOPE: which
-- statuses exist, and -- in the next slice -- which moves between them are legal. The moment
-- a type earns a branch in application code, that branch is the bug.

-- ---------------------------------------------------------------------------
-- work_item_types
-- ---------------------------------------------------------------------------

create table public.work_item_types (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  -- The tenant's own word, again. "Installation", "Onderhoud", "Callout" -- the platform has
  -- no opinion and never translates it (D6).
  name            text        not null check (length(btrim(name)) between 1 and 64),

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id)
);

comment on table public.work_item_types is
  'What kind of work this is, per tenant. Scopes which statuses apply; nothing branches on it. See domain-model.md.';

-- Deliberately no `position`, and the asymmetry with work_item_statuses is the point. A
-- status has an order because a board is a sequence and rendering one in arbitrary order is
-- not a board. A list of types is a picker: it has no left-to-right meaning, so ordering by
-- name is the correct answer rather than a fallback, and a column nobody would ever set to
-- anything interesting is a column that will be maintained for no reader.

-- I2. Two tenants both running a type called "Installation" is the ordinary case.
create unique index work_item_types_org_name_unique
  on public.work_item_types (organization_id, lower(name));

-- The target of the composite references below (I18).
alter table public.work_item_types
  add constraint work_item_types_org_id_unique unique (organization_id, id);

alter table public.work_item_types enable row level security;
alter table public.work_item_types force row level security;

create policy work_item_types_select on public.work_item_types
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- field.manage, for the same reason the statuses policy uses it: defining a type is "change
-- the shape of what this business records", and a capability with no operation distinct from
-- another is vocabulary nobody can act on differently.
create policy work_item_types_insert on public.work_item_types
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'field.manage')
  );

grant select, insert on public.work_item_types to authenticated;

-- ---------------------------------------------------------------------------
-- Statuses become a type's statuses
-- ---------------------------------------------------------------------------

alter table public.work_item_statuses add column type_id uuid;

-- A one-time repair, and the only place in this schema where the platform chooses a word on a
-- tenant's behalf. "Never hardcode terminology" forbids code that bakes a business's
-- vocabulary into a branch; this is a migration naming rows that were written before the
-- concept of a name existed. It runs against development databases only -- no organization
-- has ever been founded with a board, because create_organization writes a role and a
-- membership and nothing else -- and an operator can define their own types the moment this
-- ships. Both alternatives are worse in kind rather than in degree: delete a tenant's board,
-- or refuse to apply against a colleague's database.
--
-- created_by is INFERRED rather than invented: whoever configured the board first owns the
-- type that board turned out to belong to.
insert into public.work_item_types (organization_id, name, created_by)
select distinct on (s.organization_id) s.organization_id, 'Work', s.created_by
  from public.work_item_statuses s
 order by s.organization_id, s.created_at;

update public.work_item_statuses s
   set type_id = t.id
  from public.work_item_types t
 where t.organization_id = s.organization_id
   and s.type_id is null;

alter table public.work_item_statuses alter column type_id set not null;

alter table public.work_item_statuses
  add constraint work_item_statuses_type_same_org
  foreign key (organization_id, type_id)
  references public.work_item_types (organization_id, id) on delete cascade;

-- The name is unique within a TYPE now, not within the organization. Two types both having a
-- "Scheduled" column is not a collision -- it is the ordinary shape of a business that
-- installs and also repairs. It still leads with organization_id (I2); the type is inserted
-- after it, never before it.
drop index public.work_item_statuses_org_name_unique;

create unique index work_item_statuses_org_type_name_unique
  on public.work_item_statuses (organization_id, type_id, lower(name));

drop index public.work_item_statuses_org_position_idx;

create index work_item_statuses_org_type_position_idx
  on public.work_item_statuses (organization_id, type_id, position);

-- The target of the three-column reference below. This is what makes "an Installation sitting
-- in a Repair status" unwritable rather than merely unlikely -- the same trick as I18, applied
-- to a mismatch inside one tenant rather than one across two.
alter table public.work_item_statuses
  add constraint work_item_statuses_org_type_id_unique unique (organization_id, type_id, id);

-- ---------------------------------------------------------------------------
-- Work items gain their type
-- ---------------------------------------------------------------------------

alter table public.work_items add column type_id uuid;

-- Inferred, with no word invented: a work item's type is whatever its status turned out to
-- belong to. That is also precisely the rule the new constraint enforces from here on.
update public.work_items w
   set type_id = s.type_id
  from public.work_item_statuses s
 where s.id = w.status_id
   and s.organization_id = w.organization_id;

alter table public.work_items alter column type_id set not null;

-- Replaced rather than kept alongside: the three-column form implies the two-column one, and
-- two constraints saying overlapping things is two places to read when one of them fires.
alter table public.work_items drop constraint work_items_status_same_org;

alter table public.work_items
  add constraint work_items_type_same_org
    foreign key (organization_id, type_id)
    references public.work_item_types (organization_id, id),

  add constraint work_items_status_same_org_and_type
    foreign key (organization_id, type_id, status_id)
    references public.work_item_statuses (organization_id, type_id, id);

create index work_items_org_type_idx
  on public.work_items (organization_id, type_id);

-- ---------------------------------------------------------------------------
-- Creation as one transaction
-- ---------------------------------------------------------------------------

create function public.create_work_item_type(
  p_organization_id uuid,
  p_name            text
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
    raise exception 'create_work_item_type requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.work_item_types (organization_id, name, created_by)
  values (p_organization_id, p_name, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'work_item_type', v_id, 'work_item_type.created',
     jsonb_build_object('name', p_name));

  return v_id;
end;
$fn$;

revoke all on function public.create_work_item_type(uuid, text) from public;
grant execute on function public.create_work_item_type(uuid, text) to authenticated;

-- create_work_item_status gains the type. Dropped and recreated rather than replaced, because
-- the argument list changes and `create or replace` cannot change a signature.
drop function public.create_work_item_status(uuid, text, integer);

create function public.create_work_item_status(
  p_organization_id uuid,
  p_type_id         uuid,
  p_name            text,
  p_position        integer
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
    raise exception 'create_work_item_status requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.work_item_statuses
    (organization_id, type_id, name, position, created_by)
  values (p_organization_id, p_type_id, p_name, p_position, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'work_item_status', v_id, 'work_item_status.created',
     jsonb_build_object('type_id', p_type_id, 'name', p_name, 'position', p_position));

  return v_id;
end;
$fn$;

revoke all on function public.create_work_item_status(uuid, uuid, text, integer) from public;
grant execute on function public.create_work_item_status(uuid, uuid, text, integer) to authenticated;

-- create_work_item does NOT gain a type argument, and the omission is deliberate. A work
-- item's type is implied by its status -- the three-column constraint above says so -- and an
-- argument that must agree with another argument is an argument that can disagree with it.
-- The form still asks for a type first, because it cannot offer a status otherwise; that is a
-- UI ordering, not a parameter.
drop function public.create_work_item(uuid, text, uuid, uuid, uuid, uuid, uuid, jsonb);

create function public.create_work_item(
  p_organization_id uuid,
  p_title           text,
  p_status_id       uuid,
  p_customer_id     uuid,
  p_location_id     uuid,
  p_resource_id     uuid,
  p_asset_id        uuid,
  p_custom          jsonb
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_type  uuid;
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'create_work_item requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Not SECURITY DEFINER, so this read is the caller's own: another tenant's status is not
  -- visible here and comes back null, exactly as a status that does not exist at all does.
  select s.type_id into v_type
    from public.work_item_statuses s
   where s.id = p_status_id
     and s.organization_id = p_organization_id;

  if v_type is null then
    -- The code a composite reference would have raised, because from the caller's position
    -- this is the same fact: no such status here.
    raise exception 'no such work item status in this organization'
      using errcode = '23503';
  end if;

  insert into public.work_items
    (organization_id, type_id, title, status_id, customer_id, location_id, resource_id,
     asset_id, custom, created_by)
  values
    (p_organization_id, v_type, p_title, p_status_id, p_customer_id, p_location_id,
     p_resource_id, p_asset_id, coalesce(p_custom, '{}'::jsonb), v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'work_item', v_id, 'work_item.created',
     jsonb_build_object(
       'title', p_title,
       'type_id', v_type,
       'status_id', p_status_id,
       'customer_id', p_customer_id,
       'resource_id', p_resource_id,
       'asset_id', p_asset_id
     ));

  return v_id;
end;
$fn$;

revoke all on function public.create_work_item(uuid, text, uuid, uuid, uuid, uuid, uuid, jsonb) from public;
grant execute on function public.create_work_item(uuid, text, uuid, uuid, uuid, uuid, uuid, jsonb) to authenticated;

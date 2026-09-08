-- Work Item: the universal operational object, and the first place D6 has teeth.
--
-- "A job, service call, inspection, delivery, installation, booking, or appointment is a
-- Work Item with different configuration, not a different table" (domain-model.md).
--
-- What this migration does NOT contain, and why, because the absences are larger than the
-- presences and every one of them is a roadmap boundary rather than an oversight:
--
--   * No scheduled window, and therefore no exclusion constraint. I7 -- two work items can
--     never occupy the same resource and window -- is M2, and roadmap.md is explicit that an
--     application-level overlap check is not that milestone either. Shipping window columns
--     now without the constraint that governs them would create precisely the state I7
--     exists to prevent, and would be worse than shipping neither.
--
--   * No transition validation. I13 asks whether a status change is legal for that tenant,
--     which needs an allowed-transitions table nothing reads yet. This migration gives a
--     work item a status; M2 governs how it moves between them.
--
--   * No work item TYPE. The domain model gives a work item "a per-tenant type", and M2's
--     acceptance criteria are where an operator defines one. With a single implicit type per
--     tenant, a `type` column's only consumer would be itself: the reason types exist is to
--     scope which statuses apply, and with one type there is nothing to scope. Statuses are
--     therefore per organization here, and become per type in the change that adds types.
--
-- What it does contain is the shape that is expensive to add later: tenancy, four composite
-- references, and `custom` from birth.

-- ---------------------------------------------------------------------------
-- work_item_statuses  (D6: statuses are data, not enums)
-- ---------------------------------------------------------------------------

-- The first real exercise of D6. A Postgres enum here would mean a migration and a deploy
-- every time a customer renames a column on their board, which is the single most ordinary
-- configuration request this product will receive.
create table public.work_item_statuses (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  -- The tenant's own word. "Booked", "Op de planning", "Awaiting parts" -- the platform has
  -- no opinion and never translates it.
  name            text        not null check (length(btrim(name)) between 1 and 64),

  -- Board order. The caller is the list: statuses without an order render in whatever order
  -- the database felt like, which is not a board.
  position        integer     not null default 0,

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id)
);

-- Deliberately no `is_terminal`. Nothing closes a work item yet, and the flag's only purpose
-- is to tell "still open" from "finished" for reporting and automation that do not exist.

-- I2. Two tenants both calling a status "Scheduled" is the ordinary case.
create unique index work_item_statuses_org_name_unique
  on public.work_item_statuses (organization_id, lower(name));

create index work_item_statuses_org_position_idx
  on public.work_item_statuses (organization_id, position);

-- The target of work_items' composite reference (I18).
alter table public.work_item_statuses
  add constraint work_item_statuses_org_id_unique unique (organization_id, id);

alter table public.work_item_statuses enable row level security;
alter table public.work_item_statuses force row level security;

create policy work_item_statuses_select on public.work_item_statuses
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- Configuring the board is field.manage rather than a capability of its own: both are
-- "change the shape of what this business records", and a capability with no operation
-- distinct from another is vocabulary nobody can act on differently.
create policy work_item_statuses_insert on public.work_item_statuses
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'field.manage')
  );

grant select, insert on public.work_item_statuses to authenticated;

-- ---------------------------------------------------------------------------
-- work_items
-- ---------------------------------------------------------------------------

create table public.work_items (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  title           text        not null check (length(btrim(title)) between 1 and 300),

  -- Required: a work item without a state is not on the board. Which states exist is the
  -- tenant's business entirely.
  status_id       uuid        not null,

  -- All three optional. Internal work has no customer, a workshop job has no site, and
  -- unassigned work is the normal state of a job that has just arrived. Each is a composite
  -- reference, so `null` means "not set" and anything else means "in this tenant".
  customer_id     uuid,
  location_id     uuid,
  resource_id     uuid,

  custom          jsonb       not null default '{}'::jsonb
                              check (jsonb_typeof(custom) = 'object'),
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  -- I18, four times over. `references customers (id)` is the reflex and it is wrong: RLS on
  -- a work item checks the work item's own organization_id and is satisfied, while the
  -- customer_id beside it could name anyone. Carrying organization_id into the reference
  -- makes the cross-tenant row impossible to write rather than merely unlikely.
  --
  -- The nullable three rely on MATCH SIMPLE, which is the default: a reference with any NULL
  -- column is not checked at all. That is exactly the wanted behaviour -- no customer means
  -- no customer to verify -- and it is safe here only because organization_id is NOT NULL,
  -- so the pair can never be half-populated in the dangerous direction.
  constraint work_items_status_same_org
    foreign key (organization_id, status_id)
    references public.work_item_statuses (organization_id, id),

  constraint work_items_customer_same_org
    foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete set null (customer_id),

  constraint work_items_location_same_org
    foreign key (organization_id, location_id)
    references public.locations (organization_id, id) on delete set null (location_id),

  constraint work_items_resource_same_org
    foreign key (organization_id, resource_id)
    references public.resources (organization_id, id) on delete set null (resource_id)
);

comment on table public.work_items is
  'The universal operational object. A job, booking, inspection or delivery is this table with different configuration. See domain-model.md.';

create index work_items_org_created_at_idx
  on public.work_items (organization_id, created_at desc);

-- The board query: everything in one status, in one tenant.
create index work_items_org_status_idx
  on public.work_items (organization_id, status_id);

alter table public.work_items enable row level security;
alter table public.work_items force row level security;

create policy work_items_select on public.work_items
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy work_items_insert on public.work_items
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'work_item.create')
  );

-- No update policy. Moving a work item between statuses is I13's business and needs the
-- transition rules M2 owns; an update policy now would let a work item move anywhere, which
-- is the behaviour I13 exists to forbid. RLS default-denies what has no policy.

grant select, insert on public.work_items to authenticated;

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
    'work_item.create'
  ]::text[]);

update public.roles
   set capabilities = capabilities || array['work_item.create']::text[]
 where 'customer.create' = any (capabilities)
   and not ('work_item.create' = any (capabilities));

-- ---------------------------------------------------------------------------
-- Custom fields on work items
-- ---------------------------------------------------------------------------

alter table public.field_definitions drop constraint field_definitions_entity_type_check;

alter table public.field_definitions
  add constraint field_definitions_entity_type_check
  check (entity_type in ('customer', 'location', 'resource', 'work_item'));

create trigger work_items_custom_conforms
  before insert or update of custom, organization_id on public.work_items
  for each row execute function app.check_custom_fields('work_item');

-- ---------------------------------------------------------------------------
-- Creation as one transaction
-- ---------------------------------------------------------------------------

create function public.create_work_item_status(
  p_organization_id uuid,
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

  insert into public.work_item_statuses (organization_id, name, position, created_by)
  values (p_organization_id, p_name, p_position, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'work_item_status', v_id, 'work_item_status.created',
     jsonb_build_object('name', p_name, 'position', p_position));

  return v_id;
end;
$fn$;

revoke all on function public.create_work_item_status(uuid, text, integer) from public;
grant execute on function public.create_work_item_status(uuid, text, integer) to authenticated;

create function public.create_work_item(
  p_organization_id uuid,
  p_title           text,
  p_status_id       uuid,
  p_customer_id     uuid,
  p_location_id     uuid,
  p_resource_id     uuid,
  p_custom          jsonb
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
    raise exception 'create_work_item requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.work_items
    (organization_id, title, status_id, customer_id, location_id, resource_id,
     custom, created_by)
  values
    (p_organization_id, p_title, p_status_id, p_customer_id, p_location_id, p_resource_id,
     coalesce(p_custom, '{}'::jsonb), v_actor)
  returning id into v_id;

  -- The timeline entry a customer's history hangs off. `events` cannot be backfilled, so a
  -- work item that existed before its own creation event is a hole nothing can repair.
  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'work_item', v_id, 'work_item.created',
     jsonb_build_object(
       'title', p_title,
       'status_id', p_status_id,
       'customer_id', p_customer_id,
       'resource_id', p_resource_id
     ));

  return v_id;
end;
$fn$;

revoke all on function public.create_work_item(uuid, text, uuid, uuid, uuid, uuid, jsonb) from public;
grant execute on function public.create_work_item(uuid, text, uuid, uuid, uuid, uuid, jsonb) to authenticated;

-- Location, and the first many-to-many in the schema.
--
-- The domain model's wording is the reason this is its own table rather than columns on
-- customer: "one customer can have many sites and one site can serve many customers". A
-- shopping centre serving four of a tenant's customers is one location, not four addresses
-- typed four times.
--
-- The tenancy problem a junction table introduces is new. `customers` and `locations` are
-- each RLS-scoped on their own, but a row in `customer_locations` names two entities, and
-- nothing said so far stops it naming one of yours and one of somebody else's. RLS on the
-- junction would check the row's own organization_id and happily accept a customer_id from
-- another tenant. The composite foreign keys below are what make that unrepresentable, in
-- the same way memberships_role_same_org does for a membership's role.
--
-- This is also the first entity born carrying `custom` rather than having it retrofitted,
-- which is the whole argument of D18.

-- ---------------------------------------------------------------------------
-- locations
-- ---------------------------------------------------------------------------

create table public.locations (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  -- What the tenant calls this place. Deliberately NOT unique per tenant: two sites called
  -- "Warehouse" is ordinary, and a business with a real site code will express it as a
  -- custom field rather than as a column every other tenant carries.
  label           text        not null check (length(btrim(label)) between 1 and 200),

  -- One text column, not street/city/postcode/country. Address shape is per-country and
  -- getting it wrong in the schema is expensive; a tenant that needs the split has the
  -- registry. Structured geocoding arrives with the scheduling that needs it (M2), not here.
  address         text        not null check (length(btrim(address)) between 1 and 500),

  -- "An address with access instructions" -- gate codes, key safes, who to ask for.
  access_notes    text        check (access_notes is null or length(btrim(access_notes)) <= 2000),

  custom          jsonb       not null default '{}'::jsonb
                              check (jsonb_typeof(custom) = 'object'),
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id)
);

comment on table public.locations is
  'A place work happens or a customer is served. Many-to-many with customers.';

create index locations_org_created_at_idx
  on public.locations (organization_id, created_at desc);

-- The target of the composite foreign key from customer_locations. Leads with
-- organization_id, as I2 requires, and is what makes "this location is in this tenant" a
-- thing the database can check rather than a thing every caller must remember.
alter table public.locations
  add constraint locations_org_id_unique unique (organization_id, id);

-- `customers` needs the same, for the other half of the junction. It could not have been
-- written in the customers migration because nothing referenced it then, and adding a
-- constraint is not modifying an applied migration -- it is a new one, which is the rule.
alter table public.customers
  add constraint customers_org_id_unique unique (organization_id, id);

alter table public.locations enable row level security;
alter table public.locations force row level security;

create policy locations_select on public.locations
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy locations_insert on public.locations
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'location.create')
  );

-- No update or delete policy: neither has a caller in this change, and RLS default-denies
-- what has no policy.

grant select, insert on public.locations to authenticated;

-- ---------------------------------------------------------------------------
-- customer_locations
-- ---------------------------------------------------------------------------

create table public.customer_locations (
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  customer_id     uuid        not null,
  location_id     uuid        not null,
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  -- Leads with organization_id like every other key here. It is also the whole of the
  -- table's identity: a link either exists or it does not, so there is no surrogate id to
  -- add and nothing that a second row could usefully say.
  primary key (organization_id, customer_id, location_id),

  -- The point of this table's design. Referencing customers (organization_id, id) rather
  -- than customers (id) means a row can only ever join two entities that are already in the
  -- SAME tenant as the row itself -- not because a policy checks it, but because no other
  -- row can be written down. An RLS policy on this table sees organization_id and would
  -- accept a customer_id belonging to anyone.
  constraint customer_locations_customer_same_org
    foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete cascade,

  constraint customer_locations_location_same_org
    foreign key (organization_id, location_id)
    references public.locations (organization_id, id) on delete cascade
);

-- The reverse direction: "which customers are served here". The forward direction is already
-- served by the primary key's leading columns.
create index customer_locations_org_location_idx
  on public.customer_locations (organization_id, location_id);

alter table public.customer_locations enable row level security;
alter table public.customer_locations force row level security;

create policy customer_locations_select on public.customer_locations
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- Linking is location.create rather than a capability of its own. Attaching a site to a
-- customer is part of maintaining the location list, and a capability with no distinct
-- operation behind it is vocabulary nobody can act on differently.
create policy customer_locations_insert on public.customer_locations
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'location.create')
  );

grant select, insert on public.customer_locations to authenticated;

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
    'location.create'
  ]::text[]);

-- Whoever can already add customers can add the places those customers are served. Both are
-- the same day-to-day operational work, and splitting them would produce a role that can
-- record half of a job.
update public.roles
   set capabilities = capabilities || array['location.create']::text[]
 where 'customer.create' = any (capabilities)
   and not ('location.create' = any (capabilities));

-- ---------------------------------------------------------------------------
-- Custom fields on locations
-- ---------------------------------------------------------------------------

-- The registry learns a second entity type. This is the migration D7 said would otherwise be
-- painful, and it is one line here precisely because the column shipped with the table.
alter table public.field_definitions drop constraint field_definitions_entity_type_check;

alter table public.field_definitions
  add constraint field_definitions_entity_type_check
  check (entity_type in ('customer', 'location'));

-- app.check_custom_fields takes the entity type as a trigger argument, so the second entity
-- reuses the function rather than copying it. That was the reason for the argument.
create trigger locations_custom_conforms
  before insert or update of custom, organization_id on public.locations
  for each row execute function app.check_custom_fields('location');

-- ---------------------------------------------------------------------------
-- Creation as one transaction
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER, like every other create_* here: locations_insert already requires
-- location.create, so the capability is checked by RLS whether the caller arrives through
-- this function or through a raw insert. This exists to bind the location and its event
-- into one transaction.
create function public.create_location(
  p_organization_id uuid,
  p_label           text,
  p_address         text,
  p_access_notes    text,
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
    raise exception 'create_location requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.locations
    (organization_id, label, address, access_notes, custom, created_by)
  values
    (p_organization_id, p_label, p_address, p_access_notes,
     coalesce(p_custom, '{}'::jsonb), v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'location', v_id, 'location.created',
     jsonb_build_object('label', p_label));

  return v_id;
end;
$fn$;

revoke all on function public.create_location(uuid, text, text, text, jsonb) from public;
grant execute on function public.create_location(uuid, text, text, text, jsonb) to authenticated;

-- Linking is its own transaction boundary for the same reason: the link and the event that
-- records it belong together, and events cannot be backfilled.
create function public.link_customer_location(
  p_organization_id uuid,
  p_customer_id     uuid,
  p_location_id     uuid
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'link_customer_location requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.customer_locations
    (organization_id, customer_id, location_id, created_by)
  values
    (p_organization_id, p_customer_id, p_location_id, v_actor);

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'location', p_location_id, 'location.linked',
     jsonb_build_object('customer_id', p_customer_id));
end;
$fn$;

revoke all on function public.link_customer_location(uuid, uuid, uuid) from public;
grant execute on function public.link_customer_location(uuid, uuid, uuid) to authenticated;

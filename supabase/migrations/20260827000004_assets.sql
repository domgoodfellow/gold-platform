-- Asset: anything the business owns, services, rents, sells, or tracks.
--
-- "Machines, vehicles, equipment, properties, customer-owned equipment" (domain-model.md).
-- The last clause is the one that shapes this table: an asset is frequently NOT the tenant's
-- own property, it is the customer's machine that the tenant maintains. So an asset can name
-- a customer, and it can name the location it sits at, and both are optional because a
-- tenant's own van belongs to nobody and a portable generator sits nowhere in particular.
--
-- Asset and Resource look similar and are not the same thing, which is worth stating because
-- the next person will wonder. A Resource is consumed BY work for a window -- it is capacity.
-- An Asset is what work is ABOUT -- it is subject. The same physical van is both: a Resource
-- when it carries a technician to a job, an Asset when the job is servicing the van. Merging
-- them would force one row to answer two unrelated questions, and the scheduling engine only
-- ever asks the first.

create table public.assets (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  name            text        not null check (length(btrim(name)) between 1 and 200),

  -- Optional, and composite. Customer-owned equipment names its owner; the tenant's own
  -- plant names nobody.
  customer_id     uuid,
  -- Where it is. A property IS a location for some businesses, and that is fine: this names
  -- the site the asset sits at, not the asset itself.
  location_id     uuid,

  custom          jsonb       not null default '{}'::jsonb
                              check (jsonb_typeof(custom) = 'object'),
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  -- I18. MATCH SIMPLE means a reference with a NULL column is not checked, which is what
  -- "optional" has to mean, and it is safe because organization_id is NOT NULL.
  constraint assets_customer_same_org
    foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete set null (customer_id),

  constraint assets_location_same_org
    foreign key (organization_id, location_id)
    references public.locations (organization_id, id) on delete set null (location_id)
);

comment on table public.assets is
  'What work is about, as opposed to Resource, which is what work is done with. See domain-model.md.';

-- No unique index on name: two machines called "Compressor" on different sites is ordinary,
-- and a business that identifies assets by serial number has field definitions for it.

create index assets_org_created_at_idx
  on public.assets (organization_id, created_at desc);

create index assets_org_customer_idx
  on public.assets (organization_id, customer_id);

-- The target of work_items' reference below.
alter table public.assets
  add constraint assets_org_id_unique unique (organization_id, id);

alter table public.assets enable row level security;
alter table public.assets force row level security;

create policy assets_select on public.assets
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy assets_insert on public.assets
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'asset.create')
  );

grant select, insert on public.assets to authenticated;

-- ---------------------------------------------------------------------------
-- Work items gain a subject
-- ---------------------------------------------------------------------------

-- The caller for this column arrives in the same change: the work item form gains an asset
-- selector, and the board renders it. "Service the compressor" is a work item ABOUT an
-- asset, which is the relationship that makes maintenance a rule set over the kernel rather
-- than a module of its own.
alter table public.work_items add column asset_id uuid;

alter table public.work_items
  add constraint work_items_asset_same_org
  foreign key (organization_id, asset_id)
  references public.assets (organization_id, id) on delete set null (asset_id);

create index work_items_org_asset_idx
  on public.work_items (organization_id, asset_id);

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
    'asset.create'
  ]::text[]);

update public.roles
   set capabilities = capabilities || array['asset.create']::text[]
 where 'customer.create' = any (capabilities)
   and not ('asset.create' = any (capabilities));

-- ---------------------------------------------------------------------------
-- Custom fields on assets
-- ---------------------------------------------------------------------------

alter table public.field_definitions drop constraint field_definitions_entity_type_check;

alter table public.field_definitions
  add constraint field_definitions_entity_type_check
  check (entity_type in ('customer', 'location', 'resource', 'work_item', 'asset'));

create trigger assets_custom_conforms
  before insert or update of custom, organization_id on public.assets
  for each row execute function app.check_custom_fields('asset');

-- ---------------------------------------------------------------------------
-- Creation as one transaction
-- ---------------------------------------------------------------------------

create function public.create_asset(
  p_organization_id uuid,
  p_name            text,
  p_customer_id     uuid,
  p_location_id     uuid,
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
    raise exception 'create_asset requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.assets
    (organization_id, name, customer_id, location_id, custom, created_by)
  values
    (p_organization_id, p_name, p_customer_id, p_location_id,
     coalesce(p_custom, '{}'::jsonb), v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'asset', v_id, 'asset.created',
     jsonb_build_object('name', p_name, 'customer_id', p_customer_id));

  return v_id;
end;
$fn$;

revoke all on function public.create_asset(uuid, text, uuid, uuid, jsonb) from public;
grant execute on function public.create_asset(uuid, text, uuid, uuid, jsonb) to authenticated;

-- create_work_item gains the asset. Dropped and recreated rather than replaced, because
-- adding a parameter changes the signature and CREATE OR REPLACE would leave the old arity
-- behind as an overload.
drop function public.create_work_item(uuid, text, uuid, uuid, uuid, uuid, jsonb);

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
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'create_work_item requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.work_items
    (organization_id, title, status_id, customer_id, location_id, resource_id, asset_id,
     custom, created_by)
  values
    (p_organization_id, p_title, p_status_id, p_customer_id, p_location_id, p_resource_id,
     p_asset_id, coalesce(p_custom, '{}'::jsonb), v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'work_item', v_id, 'work_item.created',
     jsonb_build_object(
       'title', p_title,
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

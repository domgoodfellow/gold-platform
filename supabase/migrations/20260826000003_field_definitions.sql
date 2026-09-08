-- Field definitions: the per-tenant registry that governs what may appear in an entity's
-- `custom` column, and the first entity to carry one.
--
-- Why now rather than later (D7, D18): retrofitting per-tenant fields onto entities that
-- already hold production data is the most painful migration in this category of product.
-- Every entity M1 still owes -- Location, Asset, Work Item, Resource -- can now be born with
-- `custom` instead of having it bolted on afterwards. This is the cheapest this will ever be:
-- there is exactly one tenant-owned entity and no production data anywhere.
--
-- The split is the same one the roles migration drew, for the same reason:
--   * WHICH entity types and WHICH field kinds exist is platform vocabulary. Each names
--     something the code renders and validates, so adding one is a migration, deliberately.
--   * WHICH fields a tenant defines, what they are called, and whether they are required is
--     tenant data. That is the whole point of the table.

-- ---------------------------------------------------------------------------
-- field_definitions
-- ---------------------------------------------------------------------------

create table public.field_definitions (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  -- Only 'customer' today, because it is the only tenant-owned entity that exists. This
  -- list grows by migration as Location, Asset, Work Item and Resource land -- not by
  -- tenant configuration, because a tenant cannot invent a core entity.
  entity_type     text        not null check (entity_type in ('customer')),

  -- The JSONB key, and also the HTML form field name. Constrained to a lowercase identifier
  -- so that neither a JSON path nor a form parser has to quote or escape it, and so that
  -- renaming the label never changes where the data lives.
  key             text        not null check (key ~ '^[a-z][a-z0-9_]{0,62}$'),

  -- What the operator sees. Free text, and separate from `key` precisely so it can be
  -- changed without rewriting every stored row.
  label           text        not null check (length(btrim(label)) between 1 and 100),

  -- Platform vocabulary again: each kind has a render branch and a validation branch, in
  -- the domain layer and in app.check_custom_fields below. A kind with no code behind it is
  -- a promise the field editor makes and nothing keeps.
  kind            text        not null check (kind in ('text', 'number', 'boolean')),

  required        boolean     not null default false,
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id)
);

comment on table public.field_definitions is
  'Per-tenant, per-entity registry governing what may appear in that entity''s custom column. See constraints.md D7.';

-- I2, and the sharpest test of it in the schema so far: two businesses both wanting a field
-- called `vat_number` on their customers is the ordinary case, not a collision. Leading with
-- organization_id is what makes both succeed.
create unique index field_definitions_org_entity_key_unique
  on public.field_definitions (organization_id, entity_type, key);

alter table public.field_definitions enable row level security;
alter table public.field_definitions force row level security;

create policy field_definitions_select on public.field_definitions
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy field_definitions_insert on public.field_definitions
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'field.manage')
  );

-- No update or delete policy. Renaming a label and removing a field both have real
-- semantics -- a removed field leaves its values stranded in `custom` -- and neither has a
-- caller in this change. RLS default-denies what has no policy.

grant select, insert on public.field_definitions to authenticated;

-- ---------------------------------------------------------------------------
-- The new capability
-- ---------------------------------------------------------------------------

-- roles_capabilities_known cannot be edited in place because its migration has been applied,
-- so it is dropped and rewritten here. That is the sanctioned form of a correction.
alter table public.roles drop constraint roles_capabilities_known;

alter table public.roles
  add constraint roles_capabilities_known
  check (capabilities <@ array['customer.create', 'role.manage', 'field.manage']::text[]);

-- Whoever can already manage roles can manage fields. Both are configuration of the same
-- kind, and an organization whose only administrator suddenly cannot define a field would be
-- locked out of this feature with no way to grant themselves in.
update public.roles
   set capabilities = capabilities || array['field.manage']::text[]
 where 'role.manage' = any (capabilities)
   and not ('field.manage' = any (capabilities));

-- ---------------------------------------------------------------------------
-- customers.custom
-- ---------------------------------------------------------------------------

alter table public.customers
  add column custom jsonb not null default '{}'::jsonb
  check (jsonb_typeof(custom) = 'object');

comment on column public.customers.custom is
  'Tenant-defined fields, governed by field_definitions. See constraints.md D7.';

-- Deliberately NO GIN index yet. D7 describes one, and it will be right the moment something
-- filters customers by a custom value -- but nothing does in this change, and an index with
-- no query is the same speculative abstraction as a column with no reader. Adding it later is
-- `create index concurrently` against a table whose shape does not change; adding the column
-- and the registry later is the migration D7 exists to avoid. The expensive half is here.

-- ---------------------------------------------------------------------------
-- Conformance to the registry, enforced in the database
-- ---------------------------------------------------------------------------

-- This spans two tables, so no CHECK constraint can see it. The precedent is public.assign_role
-- in the previous migration: an invariant spanning rows cannot be a column constraint and must
-- not be a domain-only check, because a direct PostgREST insert walks straight past one.
-- `customers` grants INSERT to authenticated, so that path is real and not hypothetical.
--
-- It rejects and never rewrites. A trigger that quietly performed a business step -- defaulting
-- a value, coercing a type -- would be the database owning a workflow, which constraints.md
-- forbids. Refusing malformed input is constraint enforcement, which it requires.
--
-- SECURITY INVOKER (the default), like public.create_customer and for the same reason: the
-- caller is already a member of the organization, so RLS lets them read their own tenant's
-- definitions and the function needs no privilege of its own.
--
-- The entity type arrives as a trigger argument rather than being hardcoded, so Location and
-- Asset attach to this same function instead of copying it.
create function app.check_custom_fields()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_entity text := tg_argv[0];
  v_key    text;
  v_def    record;
  v_type   text;
begin
  -- Every key present must be declared. This is the half that makes `custom` a registry
  -- rather than a junk drawer.
  for v_key in select jsonb_object_keys(new.custom)
  loop
    if not exists (
      select 1
        from public.field_definitions d
       where d.organization_id = new.organization_id
         and d.entity_type = v_entity
         and d.key = v_key
    ) then
      raise exception 'no field named % is defined for %', v_key, v_entity
        using errcode = '23514';
    end if;
  end loop;

  -- Every declared field must be present if required, and well-typed if present.
  for v_def in
    select d.key, d.kind, d.required
      from public.field_definitions d
     where d.organization_id = new.organization_id
       and d.entity_type = v_entity
  loop
    v_type := jsonb_typeof(new.custom -> v_def.key);

    if v_type is null or v_type = 'null' then
      if v_def.required then
        raise exception 'field % is required', v_def.key
          using errcode = '23514';
      end if;
      continue;
    end if;

    if (v_def.kind = 'text' and v_type <> 'string')
      or (v_def.kind = 'number' and v_type <> 'number')
      or (v_def.kind = 'boolean' and v_type <> 'boolean')
    then
      raise exception 'field % expects %, got %', v_def.key, v_def.kind, v_type
        using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$fn$;

-- Fires on write only, so defining a required field does not retroactively invalidate
-- customers that already exist. That is I8 -- editing today's configuration never changes
-- yesterday's committed work -- and here it falls out of the trigger's shape rather than
-- needing its own rule.
create trigger customers_custom_conforms
  before insert or update of custom, organization_id on public.customers
  for each row execute function app.check_custom_fields('customer');

-- ---------------------------------------------------------------------------
-- create_customer gains the custom payload
-- ---------------------------------------------------------------------------

-- Dropped and recreated rather than replaced, because adding a parameter changes the
-- signature and CREATE OR REPLACE would leave the four-argument version behind as an
-- overload. The previous migration is untouched; this is a new one, which is the rule.
--
-- The custom payload goes through the same transaction as the customer and its event: a
-- customer whose declared fields arrived in a second round trip is a customer that briefly
-- violated its own tenant's registry.
drop function public.create_customer(uuid, text, text, text);

create function public.create_customer(
  p_organization_id uuid,
  p_name            text,
  p_email           text,
  p_phone           text,
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
    raise exception 'create_customer requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.customers (organization_id, name, email, phone, custom, created_by)
  values (
    p_organization_id,
    p_name,
    p_email,
    p_phone,
    coalesce(p_custom, '{}'::jsonb),
    v_actor
  )
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'customer', v_id, 'customer.created',
     jsonb_build_object('name', p_name));

  return v_id;
end;
$fn$;

revoke all on function public.create_customer(uuid, text, text, text, jsonb) from public;
grant execute on function public.create_customer(uuid, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Creating a definition as one transaction
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER, like create_customer and create_role: field_definitions_insert already
-- requires field.manage, so the capability check happens in RLS whether the caller arrives
-- through this function or through a raw insert. This exists to bind the definition and its
-- event into one transaction, nothing more.
create function public.create_field_definition(
  p_organization_id uuid,
  p_entity_type     text,
  p_key             text,
  p_label           text,
  p_kind            text,
  p_required        boolean
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
    raise exception 'create_field_definition requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.field_definitions
    (organization_id, entity_type, key, label, kind, required, created_by)
  values
    (p_organization_id, p_entity_type, p_key, p_label, p_kind, p_required, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'field_definition', v_id, 'field_definition.created',
     jsonb_build_object('entity_type', p_entity_type, 'key', p_key, 'kind', p_kind));

  return v_id;
end;
$fn$;

revoke all on function public.create_field_definition(uuid, text, text, text, text, boolean) from public;
grant execute on function public.create_field_definition(uuid, text, text, text, text, boolean) to authenticated;

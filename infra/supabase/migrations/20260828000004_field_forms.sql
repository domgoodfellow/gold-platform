-- A registry becomes a form.
--
-- `field_definitions` has governed *what may be stored* since D7. What it has never governed
-- is what an operator sees: the fields came back in creation order, so the shape of every
-- form in the platform was a side effect of the order somebody happened to define things in,
-- and could only be changed by defining them again. M3's criterion is that a business shape
-- is stood up through configuration with no migration; a form whose order is an artefact of
-- history fails that in the most literal way.
--
-- Two changes, and the second is the load-bearing one.
--
-- `position` makes the order configuration. It follows work_item_statuses exactly -- a plain
-- integer the operator supplies, not a swap API -- because that precedent exists, works, and
-- has an edit form somebody already knows how to read. It is deliberately NOT unique: a
-- unique (organization_id, entity_type, position) turns every reorder into a dance around
-- the constraint and buys nothing, because ties break on created_at and a form with two
-- fields nominally in slot 3 still renders deterministically.
--
-- The column grant is the other change, and it is a decision about I8 rather than a
-- convenience. Label, required and position may be edited. `kind` may not, and `key` may
-- not, and neither omission is an oversight:
--
--   * Changing a `kind` would reinterpret every value already stored under that key. A
--     customer whose `service_level` was the number 3 does not become the text "3" because
--     somebody edited the form today -- app.check_custom_fields would start refusing the
--     next write to a row that was valid when it was made, which is exactly the retroactive
--     rewrite I8 forbids, arriving as a constraint violation on an unrelated edit.
--   * A `key` is what every `custom` object in the tenant carries forever. Renaming it
--     orphans every value already written under the old name -- they do not move, they
--     simply stop being declared, and the same trigger starts refusing them.
--
-- Both are reachable as "define a new field" and were always going to be. What this refuses
-- is the path that looks like a rename and is a data migration.

-- ---------------------------------------------------------------------------
-- Where a field sits on the form
-- ---------------------------------------------------------------------------

alter table public.field_definitions
  add column position integer not null default 0;

comment on column public.field_definitions.position is
  'Where this field sits on its entity form. Ties break on created_at. Not unique, deliberately.';

-- Backfill from the order these were actually being rendered in, so applying this migration
-- changes no form that exists. Creation order was the implicit answer; this makes it the
-- explicit one, and from here it is the tenant's to change.
with ranked as (
  select id,
         row_number() over (
           partition by organization_id, entity_type order by created_at, id
         ) - 1 as seq
    from public.field_definitions
)
update public.field_definitions d
   set position = ranked.seq
  from ranked
 where ranked.id = d.id;

create index field_definitions_org_entity_position_idx
  on public.field_definitions (organization_id, entity_type, position);

-- ---------------------------------------------------------------------------
-- Editing a definition
-- ---------------------------------------------------------------------------

-- The first update policy on this table. Until now a mistyped label was permanent.
create policy field_definitions_update on public.field_definitions
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'field.manage')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'field.manage')
  );

-- See the header. `kind`, `key` and `entity_type` are absent on purpose, and the grant is
-- what enforces it -- a policy sees the old row or the new one, never both, so it cannot
-- express "this column may not change". The grant can, and does so for every caller: a raw
-- PostgREST update naming `kind` is refused exactly as a form would be. Same division of
-- labour as `grant update (status_id)` on work_items, for the same reason.
grant update (label, required, position) on public.field_definitions to authenticated;

create function public.update_field_definition(
  p_id       uuid,
  p_label    text,
  p_required boolean,
  p_position integer
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
begin
  if v_actor is null then
    raise exception 'update_field_definition requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Making a field required does not reach back: app.check_custom_fields fires on write
  -- only, so entities that already exist without it stay valid until something edits them.
  -- That is the same shape the original registry migration relied on, and it is I8.
  update public.field_definitions
     set label    = p_label,
         required = p_required,
         position = p_position
   where id = p_id
  returning organization_id into v_org;

  -- Zero rows means the policy refused, or there is no such field. A refused update affects
  -- nothing and raises nothing, so without this check the event below would record a change
  -- that never happened -- the same trap change_work_item_status names.
  if v_org is null then
    raise exception 'no such field, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'field_definition', p_id, 'field_definition.updated',
     jsonb_build_object('label', p_label, 'required', p_required, 'position', p_position));
end;
$fn$;

revoke all on function public.update_field_definition(uuid, text, boolean, integer) from public;
grant execute on function public.update_field_definition(uuid, text, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- A new field lands at the end of the form
-- ---------------------------------------------------------------------------

-- Replaced rather than edited in place: the original migration has been applied. The only
-- change is the position, which the caller deliberately does not supply -- appending is the
-- one sensible reading of "add a field", and letting a caller choose would put a number on
-- every create form that nobody wants to think about before they have seen the form.
create or replace function public.create_field_definition(
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
  v_actor    uuid := (select auth.uid());
  v_id       uuid;
  v_position integer;
begin
  if v_actor is null then
    raise exception 'create_field_definition requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Reads through RLS as the caller, so this cannot count another tenant's fields.
  select coalesce(max(position) + 1, 0) into v_position
    from public.field_definitions
   where organization_id = p_organization_id
     and entity_type = p_entity_type;

  insert into public.field_definitions
    (organization_id, entity_type, key, label, kind, required, position, created_by)
  values
    (p_organization_id, p_entity_type, p_key, p_label, p_kind, p_required, v_position, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'field_definition', v_id, 'field_definition.created',
     jsonb_build_object('entity_type', p_entity_type, 'key', p_key, 'kind', p_kind));

  return v_id;
end;
$fn$;

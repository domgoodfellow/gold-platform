-- Checklist templates: the steps every job of one type involves.
--
-- 20260827000010_checklists.sql deferred this and named the three questions it would have had
-- to answer by guesswork. Each now has an answer with a caller behind it:
--
--   1. WHERE IS ONE DEFINED? On the type, which is already the thing that scopes statuses and
--      transitions. A template is one more way a tenant says what this kind of work is.
--
--   2. WHAT HAPPENS WHEN A TEMPLATE CHANGES AFTER WORK HAS BEEN INSTANTIATED FROM IT? Nothing.
--      Instantiation COPIES rows at creation, so a job carries the steps it was created with
--      for the rest of its life. That is I8 -- "editing today's configuration never changes
--      yesterday's committed work" -- and it is the reason this is a copy rather than a
--      reference. A join to the template would mean editing a template silently rewrote what
--      a technician had already agreed to do, and unticking steps they had already ticked.
--
--   3. MAY AN OPERATOR EDIT AN INSTANTIATED LIST? They may add to it, exactly as before. They
--      may not rewrite a step's label -- the column grant already forbids it -- and that rule
--      does not change because the step arrived from a template.
--
-- So the template is a way of WRITING work_item_checklist_items rows, never a second place a
-- checklist lives. There is exactly one table a screen reads a job's steps from.

create table public.work_item_type_checklist_items (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  type_id         uuid        not null,

  label           text        not null check (length(btrim(label)) between 1 and 200),
  position        integer     not null default 0,

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  -- I18.
  constraint work_item_type_checklist_items_type_same_org
    foreign key (organization_id, type_id)
    references public.work_item_types (organization_id, id) on delete cascade
);

comment on table public.work_item_type_checklist_items is
  'Steps every work item of one type starts with. Copied onto the job at creation, never joined (I8).';

create index work_item_type_checklist_items_org_type_idx
  on public.work_item_type_checklist_items (organization_id, type_id, position);

alter table public.work_item_type_checklist_items enable row level security;
alter table public.work_item_type_checklist_items force row level security;

create policy work_item_type_checklist_items_select on public.work_item_type_checklist_items
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- field.manage, not work_item.create. This is the shape of jobs rather than a job -- the same
-- distinction the checklist migration drew when it put the per-job rows under work_item.create.
create policy work_item_type_checklist_items_insert on public.work_item_type_checklist_items
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'field.manage')
  );

create policy work_item_type_checklist_items_delete on public.work_item_type_checklist_items
  for delete to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'field.manage')
  );

grant select, insert, delete on public.work_item_type_checklist_items to authenticated;

-- ---------------------------------------------------------------------------
-- Defining a template step
-- ---------------------------------------------------------------------------

create function public.add_type_checklist_item(
  p_organization_id uuid,
  p_type_id         uuid,
  p_label           text,
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
    raise exception 'add_type_checklist_item requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.work_item_type_checklist_items
    (organization_id, type_id, label, position, created_by)
  values (p_organization_id, p_type_id, p_label, p_position, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'work_item_type', p_type_id,
     'work_item_type.checklist_item_added',
     jsonb_build_object('template_item_id', v_id, 'label', p_label));

  return v_id;
end;
$fn$;

revoke all on function public.add_type_checklist_item(uuid, uuid, text, integer) from public;
grant execute on function public.add_type_checklist_item(uuid, uuid, text, integer) to authenticated;

create function public.remove_type_checklist_item(p_id uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_type  uuid;
begin
  if v_actor is null then
    raise exception 'remove_type_checklist_item requires an authenticated caller'
      using errcode = '42501';
  end if;

  delete from public.work_item_type_checklist_items
   where id = p_id
  returning organization_id, type_id into v_org, v_type;

  if v_org is null then
    raise exception 'no such template step, or you may not change it'
      using errcode = '42501';
  end if;

  -- Jobs already created keep their copies. That is the whole point of copying.
  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item_type', v_type, 'work_item_type.checklist_item_removed',
     jsonb_build_object('template_item_id', p_id));
end;
$fn$;

revoke all on function public.remove_type_checklist_item(uuid) from public;
grant execute on function public.remove_type_checklist_item(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- create_work_item instantiates the template
-- ---------------------------------------------------------------------------

-- Dropped and recreated rather than replaced, because the body changes and the whole point of
-- this function is that the work item and everything born with it are one transaction. A job
-- that exists without the steps its type says it involves is a job somebody will complete
-- without doing them.
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
  v_steps integer;
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

  -- The copy. Position and label are taken as they are now; nothing links back, so editing
  -- the template later cannot reach this job (I8).
  insert into public.work_item_checklist_items
    (organization_id, work_item_id, label, position, created_by)
  select t.organization_id, v_id, t.label, t.position, v_actor
    from public.work_item_type_checklist_items t
   where t.organization_id = p_organization_id
     and t.type_id = v_type
   order by t.position;

  get diagnostics v_steps = row_count;

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
       'asset_id', p_asset_id,
       'checklist_items', v_steps
     ));

  return v_id;
end;
$fn$;

revoke all on function public.create_work_item(uuid, text, uuid, uuid, uuid, uuid, uuid, jsonb) from public;
grant execute on function public.create_work_item(uuid, text, uuid, uuid, uuid, uuid, uuid, jsonb) to authenticated;

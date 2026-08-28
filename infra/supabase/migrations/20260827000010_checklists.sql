-- Checklists: what a job actually involves, item by item.
--
-- Deliberately per WORK ITEM, not per type. A template -- "every boiler service has these
-- eight steps" -- is the obviously desirable next thing and it is not this change: it needs a
-- screen to define one, a rule for what happens when a template changes after work has been
-- instantiated from it (which is I8), and an answer to whether an operator may edit an
-- instantiated list. None of those has a caller yet, and inventing all three at once is how a
-- feature arrives with three guesses baked into its schema. What ships is the half that a
-- template would instantiate INTO, so the template becomes a way of writing these rows rather
-- than a second place a checklist lives.

-- The composite reference below needs `unique (organization_id, id)` on work_items, which
-- 20260827000005_documents.sql already added for the same reason -- a document attaches to a
-- work item and had to carry the tenant into the reference.

create table public.work_item_checklist_items (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  work_item_id    uuid        not null,

  label           text        not null check (length(btrim(label)) between 1 and 200),

  -- Order matters: a checklist is a sequence of steps, and one rendered in arbitrary order
  -- is a set of unrelated assertions. Same reasoning as work_item_statuses.position.
  position        integer     not null default 0,

  -- Null means not done. Two columns rather than a boolean because "who ticked this, and
  -- when" is the whole evidentiary value of a checklist -- a bare `done` flag records that
  -- somebody claims it happened and nothing about who or when (I11).
  done_at         timestamptz,
  done_by         uuid        references auth.users (id),

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  -- Both or neither. A row with a tick and no ticker, or a ticker and no time, is a record
  -- that has lost the half that made it worth keeping.
  constraint work_item_checklist_items_done_together
    check ((done_at is null) = (done_by is null)),

  -- I18.
  constraint work_item_checklist_items_work_item_same_org
    foreign key (organization_id, work_item_id)
    references public.work_items (organization_id, id) on delete cascade
);

comment on table public.work_item_checklist_items is
  'Steps a work item involves. Per work item; a per-type template would write these rows, not replace them.';

-- Deliberately no unique index on label: "check the filter" twice on one job is a data entry
-- slip, not a violation, and a constraint would turn it into an unexplained 23505.
create index work_item_checklist_items_org_work_item_idx
  on public.work_item_checklist_items (organization_id, work_item_id, position);

alter table public.work_item_checklist_items enable row level security;
alter table public.work_item_checklist_items force row level security;

create policy work_item_checklist_items_select on public.work_item_checklist_items
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- work_item.create: whoever records the work records what it involves. This is not a
-- configuration act -- these rows are the job, not the shape of jobs -- so field.manage would
-- be the wrong half of the distinction the rest of this schema draws.
create policy work_item_checklist_items_insert on public.work_item_checklist_items
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'work_item.create')
  );

-- Ticking is work_item.transition, and the shared capability is the point rather than an
-- economy: both are "the person doing this job is telling the system where it has got to".
-- A capability with no operation distinct from another is vocabulary nobody can act on
-- differently.
create policy work_item_checklist_items_update on public.work_item_checklist_items
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'work_item.transition')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'work_item.transition')
    -- I11: you may only tick something as yourself. Untick sets both to null, which this
    -- allows and the check constraint above keeps consistent.
    and (done_by is null or done_by = (select auth.uid()))
  );

grant select, insert on public.work_item_checklist_items to authenticated;

-- Only the tick. A caller cannot rewrite a step's label through this grant, which would let
-- somebody change what they had agreed to do after doing something else.
grant update (done_at, done_by) on public.work_item_checklist_items to authenticated;

-- ---------------------------------------------------------------------------
-- Writing, each as one transaction
-- ---------------------------------------------------------------------------

create function public.add_checklist_item(
  p_work_item_id uuid,
  p_label        text,
  p_position     integer
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
    raise exception 'add_checklist_item requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- The organization is derived from the work item rather than passed in: it is not a fact
  -- the caller gets to assert, and deriving it under the caller's own RLS means another
  -- tenant's work item is simply absent.
  select w.organization_id into v_org
    from public.work_items w
   where w.id = p_work_item_id;

  if v_org is null then
    raise exception 'no such work item' using errcode = '23503';
  end if;

  insert into public.work_item_checklist_items
    (organization_id, work_item_id, label, position, created_by)
  values (v_org, p_work_item_id, p_label, p_position, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item', p_work_item_id, 'work_item.checklist_item_added',
     jsonb_build_object('checklist_item_id', v_id, 'label', p_label));

  return v_id;
end;
$fn$;

revoke all on function public.add_checklist_item(uuid, text, integer) from public;
grant execute on function public.add_checklist_item(uuid, text, integer) to authenticated;

create function public.set_checklist_item_done(
  p_checklist_item_id uuid,
  p_done              boolean
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_work  uuid;
begin
  if v_actor is null then
    raise exception 'set_checklist_item_done requires an authenticated caller'
      using errcode = '42501';
  end if;

  update public.work_item_checklist_items
     set done_at = case when p_done then now() else null end,
         done_by = case when p_done then v_actor else null end
   where id = p_checklist_item_id
  returning organization_id, work_item_id into v_org, v_work;

  -- A row refused by the UPDATE policy is invisible to the statement rather than an error.
  if v_org is null then
    raise exception 'no such checklist item, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item', v_work,
     case when p_done then 'work_item.checklist_item_checked'
          else 'work_item.checklist_item_unchecked' end,
     jsonb_build_object('checklist_item_id', p_checklist_item_id));
end;
$fn$;

revoke all on function public.set_checklist_item_done(uuid, boolean) from public;
grant execute on function public.set_checklist_item_done(uuid, boolean) to authenticated;

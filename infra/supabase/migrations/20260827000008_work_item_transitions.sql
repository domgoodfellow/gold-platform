-- Transitions, and the first update policy `work_items` has ever had.
--
-- This is I13: "A work item's status transition is valid according to that tenant's
-- configured transitions." Until now a work item could not change status at all, because
-- 20260827000003_work_items.sql deliberately shipped no update policy:
--
--   "No update policy. Moving a work item between statuses is I13's business and needs the
--    transition rules M2 owns; an update policy now would let a work item move anywhere,
--    which is the behaviour I13 exists to forbid."
--
-- Three choices here are load-bearing and none of them is obvious.
--
-- 1. THE CHECK IS A TRIGGER, NOT ONLY DOMAIN CODE. D6 says transition validity is "enforced
--    in the domain layer against configuration, not by the type system" -- and the clause
--    doing the work there is "not by the type system", which rules out a Postgres enum. It
--    cannot mean domain code *alone*, because I12 requires that a direct PostgREST call be
--    refused exactly as a form is, and a TypeScript check is not present on that path at all.
--    The precedent is already in this schema: app.check_custom_fields is a validating trigger
--    for I17, and the domain re-checks "for the message rather than the guarantee". Same
--    shape here. This is not the database owning a workflow -- the trigger performs no step,
--    it refuses an illegal one.
--
-- 2. NO CONFIGURED TRANSITIONS MEANS NOTHING MOVES. The alternative -- treating an unconfigured
--    type as unconstrained -- is the more forgiving first experience and it quietly deletes
--    the invariant: a tenant who never opens the transitions screen would have I13 hold
--    vacuously while believing it holds. "Valid according to that tenant's configured
--    transitions" has exactly one reading when there are none.
--
-- 3. THE COLUMN GRANT IS PART OF THE AUTHORIZATION, NOT A TIDINESS MEASURE. An RLS policy
--    cannot see the old and the new row together -- USING sees only the old, WITH CHECK only
--    the new -- so no policy can say "you may change the status but not the customer".
--    `grant update (status_id)` says it instead, and it binds a direct PostgREST caller and
--    an RPC alike, because neither runs as the table owner.

-- ---------------------------------------------------------------------------
-- work_item_transitions
-- ---------------------------------------------------------------------------

create table public.work_item_transitions (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  -- Denormalised from the two statuses on purpose. Both status references carry it, so it
  -- cannot disagree with them, and it is what lets the trigger below find the row with one
  -- index lookup rather than a join.
  type_id         uuid        not null,

  from_status_id  uuid        not null,
  to_status_id    uuid        not null,

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  -- A move to the status you are already in is not a move. Without this the board would
  -- offer a button that does nothing, and the timeline would record travel that never
  -- happened.
  constraint work_item_transitions_not_self check (from_status_id <> to_status_id),

  -- I18 and I20 together, and the reason both statuses carry type_id. A transition is the
  -- one row in this schema that names two statuses, so it is the one place a board could be
  -- wired to another tenant's column -- or, within one tenant, to another type's. The
  -- three-column references make both unwritable.
  constraint work_item_transitions_type_same_org
    foreign key (organization_id, type_id)
    references public.work_item_types (organization_id, id) on delete cascade,

  constraint work_item_transitions_from_same_org_and_type
    foreign key (organization_id, type_id, from_status_id)
    references public.work_item_statuses (organization_id, type_id, id),

  constraint work_item_transitions_to_same_org_and_type
    foreign key (organization_id, type_id, to_status_id)
    references public.work_item_statuses (organization_id, type_id, id)
);

comment on table public.work_item_transitions is
  'Which moves between statuses this tenant allows, per work item type. Enforces I13. See domain-model.md.';

-- I2. Two tenants wiring the same pair of column names together is the ordinary case, and so
-- is one tenant wiring the same pair on two different types.
create unique index work_item_transitions_org_type_pair_unique
  on public.work_item_transitions (organization_id, type_id, from_status_id, to_status_id);

-- The trigger's query, and the board's: everything reachable from where this item is now.
create index work_item_transitions_org_type_from_idx
  on public.work_item_transitions (organization_id, type_id, from_status_id);

alter table public.work_item_transitions enable row level security;
alter table public.work_item_transitions force row level security;

create policy work_item_transitions_select on public.work_item_transitions
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- field.manage again: wiring a board is the same act as naming its columns.
create policy work_item_transitions_insert on public.work_item_transitions
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'field.manage')
  );

grant select, insert on public.work_item_transitions to authenticated;

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
    'work_item.transition'
  ]::text[]);

-- Whoever records work moves it. Configuring which moves are legal is a different act and
-- stays with field.manage -- the distinction the platform cares about is between doing the
-- work and deciding the shape of the work.
update public.roles
   set capabilities = capabilities || array['work_item.transition']::text[]
 where 'work_item.create' = any (capabilities)
   and not ('work_item.transition' = any (capabilities));

-- ---------------------------------------------------------------------------
-- Moving a work item
-- ---------------------------------------------------------------------------

-- The first update policy on work_items. It answers "may this actor change work here",
-- which is all an RLS policy is able to answer: it sees the old row in USING and the new row
-- in WITH CHECK, never both at once, so "may they change *this column*" and "is that move
-- legal" are the grant's job and the trigger's job respectively.
create policy work_items_update on public.work_items
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'work_item.transition')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'work_item.transition')
  );

-- Only this column. A caller holding work_item.transition may move a work item along its
-- board and may not, on the same grant, reassign it, retitle it, or move it to another
-- customer. Those are separate operations and will arrive with their own capability.
grant update (status_id) on public.work_items to authenticated;

create function app.check_status_transition()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  -- Not a move. Nothing to validate, and no event will be written either.
  if new.status_id is not distinct from old.status_id then
    return new;
  end if;

  if not exists (
    select 1
      from public.work_item_transitions t
     where t.organization_id = new.organization_id
       and t.type_id        = new.type_id
       and t.from_status_id = old.status_id
       and t.to_status_id   = new.status_id
  ) then
    -- Names ids rather than words, and that is deliberate: this message is the guarantee,
    -- not the sentence a person reads. The domain layer re-checks against the same rows to
    -- produce that sentence, exactly as parseCustom does for I17.
    raise exception 'work item % may not move from status % to status %',
      new.id, old.status_id, new.status_id
      using errcode = '23514';
  end if;

  return new;
end;
$fn$;

comment on function app.check_status_transition() is
  'I13. Refuses a status change that this tenant has not configured for this work item type.';

create trigger work_items_transition_configured
  before update of status_id on public.work_items
  for each row execute function app.check_status_transition();

-- ---------------------------------------------------------------------------
-- Configuring and moving, each as one transaction
-- ---------------------------------------------------------------------------

create function public.create_work_item_transition(
  p_organization_id uuid,
  p_type_id         uuid,
  p_from_status_id  uuid,
  p_to_status_id    uuid
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
    raise exception 'create_work_item_transition requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.work_item_transitions
    (organization_id, type_id, from_status_id, to_status_id, created_by)
  values (p_organization_id, p_type_id, p_from_status_id, p_to_status_id, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'work_item_transition', v_id, 'work_item_transition.created',
     jsonb_build_object(
       'type_id', p_type_id,
       'from_status_id', p_from_status_id,
       'to_status_id', p_to_status_id
     ));

  return v_id;
end;
$fn$;

revoke all on function public.create_work_item_transition(uuid, uuid, uuid, uuid) from public;
grant execute on function public.create_work_item_transition(uuid, uuid, uuid, uuid) to authenticated;

create function public.change_work_item_status(
  p_work_item_id uuid,
  p_status_id    uuid
)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_from  uuid;
begin
  if v_actor is null then
    raise exception 'change_work_item_status requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Read first, because the event needs the status being left and no UPDATE ... RETURNING
  -- can hand back the old row. Not SECURITY DEFINER, so this is the caller's own read and
  -- another tenant's work item comes back as nothing at all.
  select w.organization_id, w.status_id into v_org, v_from
    from public.work_items w
   where w.id = p_work_item_id;

  if v_org is null then
    raise exception 'no such work item, or you may not move it'
      using errcode = '42501';
  end if;

  -- Refused rather than silently ignored. The board never offers this button -- a
  -- self-transition cannot be configured at all -- so reaching here means the caller and the
  -- database disagree about where the item is, which is worth saying out loud.
  if v_from = p_status_id then
    raise exception 'work item % is already in status %', p_work_item_id, p_status_id
      using errcode = '23514';
  end if;

  -- The capability lives in work_items_update and the legality of the move lives in
  -- app.check_status_transition. Neither is repeated here; this function owns the
  -- transaction boundary, which is the update and its event together.
  --
  -- `returning` is not decoration. A row that fails an UPDATE policy's USING clause is
  -- simply not visible to the statement, so the update touches nothing and raises NOTHING --
  -- and without this check the function would go on to write an event for a move that never
  -- happened. This is the shape public.assign_role already uses, for the same reason.
  update public.work_items
     set status_id = p_status_id
   where id = p_work_item_id
  returning organization_id into v_org;

  if v_org is null then
    raise exception 'you may not move work item %', p_work_item_id
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item', p_work_item_id, 'work_item.status_changed',
     jsonb_build_object('from_status_id', v_from, 'to_status_id', p_status_id));
end;
$fn$;

revoke all on function public.change_work_item_status(uuid, uuid) from public;
grant execute on function public.change_work_item_status(uuid, uuid) to authenticated;

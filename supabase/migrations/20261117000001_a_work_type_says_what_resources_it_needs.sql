-- A work type says what resources it needs.
--
-- **A requirement is a minimum need, stated once on the type.** A resource class, a quantity and
-- the capabilities a resource must hold — all of them, never any of them — and nothing else. Not
-- a rule language: class, quantity and capabilities are the whole of the problem today, and a
-- predicate DSL built for it would be an engine nobody asked for. It lives on the work type and is
-- never copied onto a work item, so changing it changes what every job of that kind reads as
-- needing, and a job's own assignments stay exactly what they were (`work_item_resource_assignments`
-- is still the only answer to who is on a job).
--
-- **What the database enforces, and what it deliberately does not.** It enforces the structure —
-- tenant, class vocabulary, quantity, capability references, that only schedulable work can need
-- resources — and the three places this has to agree with something else: scheduling cannot be
-- turned off while a type needs resources; a capability a type needs cannot be archived out from
-- under it; public booking commits one resource, so a bookable type may need at most one resource
-- once (never "2 ×", never two requirements) and the resource it commits must be eligible. It does
-- **not** require that a job's assignments satisfy its type: partial and unassigned work is valid
-- state, and when completeness becomes a hard boundary is a later, feasibility-level decision.
--
-- **Eligibility is not availability.** `app.resource_is_eligible` answers *can this resource do the
-- role*, from class and capabilities alone. Whether it is free at ten on Tuesday is, and stays, the
-- assignment constraint's and `freeWindows`'.

-- ---------------------------------------------------------------------------
-- Requirements
-- ---------------------------------------------------------------------------

create table public.work_item_type_resource_requirements (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  type_id         uuid        not null,
  resource_class  text        not null,
  quantity        integer     not null,
  -- The order the business reads them in, and the order a matching prefers them in.
  position        integer     not null default 0,
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),
  constraint work_item_type_resource_requirements_org_id_unique unique (organization_id, id),
  constraint work_item_type_resource_requirements_class_known
    check (resource_class in ('person', 'vehicle', 'equipment', 'facility', 'other')),
  -- "2 × Person" is one requirement with a quantity, not two identical rows; a bound only so a
  -- typo does not become fifty-thousand slots in a matching.
  constraint work_item_type_resource_requirements_quantity_positive
    check (quantity between 1 and 50),
  constraint work_item_type_resource_requirements_type_same_org
    foreign key (organization_id, type_id)
    references public.work_item_types (organization_id, id) on delete cascade
);

create index work_item_type_resource_requirements_by_type
  on public.work_item_type_resource_requirements (organization_id, type_id, position, id);

comment on table public.work_item_type_resource_requirements is
  'The minimum resource need of work of a type: a class, a quantity and the capabilities (all of them) a resource must hold. Minimum, not an allowlist; derived coverage is never stored.';

alter table public.work_item_type_resource_requirements enable row level security;
alter table public.work_item_type_resource_requirements force row level security;

create policy work_item_type_resource_requirements_select on public.work_item_type_resource_requirements
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- Defining what a kind of work is: `field.manage`, as work types, statuses and capabilities are.
create policy work_item_type_resource_requirements_insert on public.work_item_type_resource_requirements
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'field.manage')
  );

create policy work_item_type_resource_requirements_update on public.work_item_type_resource_requirements
  for update to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'field.manage'))
  with check (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'field.manage'));

create policy work_item_type_resource_requirements_delete on public.work_item_type_resource_requirements
  for delete to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'field.manage'));

grant select, delete on public.work_item_type_resource_requirements to authenticated;
grant insert (id, organization_id, type_id, resource_class, quantity, position, created_by)
  on public.work_item_type_resource_requirements to authenticated;
grant update (resource_class, quantity, position) on public.work_item_type_resource_requirements to authenticated;

-- The capabilities a requirement names, by id — never by name, so renaming one changes nothing.
create table public.work_item_type_resource_requirement_capabilities (
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  requirement_id  uuid        not null,
  capability_id   uuid        not null,
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),
  primary key (organization_id, requirement_id, capability_id),
  constraint requirement_capabilities_requirement_same_org
    foreign key (organization_id, requirement_id)
    references public.work_item_type_resource_requirements (organization_id, id) on delete cascade,
  -- No cascade: a capability is archived, never deleted, and what a type needs must not vanish.
  constraint requirement_capabilities_capability_same_org
    foreign key (organization_id, capability_id)
    references public.resource_capabilities (organization_id, id)
);

create index work_item_type_resource_requirement_capabilities_by_capability
  on public.work_item_type_resource_requirement_capabilities (organization_id, capability_id);

alter table public.work_item_type_resource_requirement_capabilities enable row level security;
alter table public.work_item_type_resource_requirement_capabilities force row level security;

create policy work_item_type_resource_requirement_capabilities_select
  on public.work_item_type_resource_requirement_capabilities
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy work_item_type_resource_requirement_capabilities_insert
  on public.work_item_type_resource_requirement_capabilities
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'field.manage')
  );

create policy work_item_type_resource_requirement_capabilities_delete
  on public.work_item_type_resource_requirement_capabilities
  for delete to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'field.manage'));

grant select, delete on public.work_item_type_resource_requirement_capabilities to authenticated;
grant insert (organization_id, requirement_id, capability_id, created_by)
  on public.work_item_type_resource_requirement_capabilities to authenticated;

-- ---------------------------------------------------------------------------
-- Eligibility: one definition, in the database, for the places that must agree on it
-- ---------------------------------------------------------------------------

-- Class matches, and the resource holds every capability the requirement names. Definer because
-- `create_booking` runs for a visitor who may read none of these tables, and because a booking
-- must be judged by what is true now rather than by what the caller could see.
create function app.resource_is_eligible(p_organization_id uuid, p_resource_id uuid, p_requirement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.resources r
      join public.work_item_type_resource_requirements q
        on q.organization_id = r.organization_id
       and q.id = p_requirement_id
     where r.organization_id = p_organization_id
       and r.id = p_resource_id
       and r.resource_class = q.resource_class
       and not exists (
         select 1
           from public.work_item_type_resource_requirement_capabilities c
          where c.organization_id = q.organization_id
            and c.requirement_id = q.id
            and not exists (
              select 1
                from public.resource_capability_assignments a
               where a.organization_id = r.organization_id
                 and a.resource_id = r.id
                 and a.capability_id = c.capability_id
            )
       )
  );
$fn$;

revoke all on function app.resource_is_eligible(uuid, uuid, uuid) from public;

-- What public booking may offer for a type: every resource when the type needs nothing (as before),
-- only the eligible ones when it needs one thing, and none when it needs more than booking can
-- commit. Ids only — a resource can be a person, and who is free is not a fact a booking page
-- publishes — and only for the business the caller is bound to.
create function public.bookable_resource_ids(p_type_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select r.id
    from public.work_item_types t
    join public.resources r
      on r.organization_id = t.organization_id
   where t.id = p_type_id
     and t.organization_id = app.current_external_tenant()
     and t.booking_status_id is not null
     and (
       not exists (
         select 1 from public.work_item_type_resource_requirements q
          where q.organization_id = t.organization_id and q.type_id = t.id
       )
       or (
         (select count(*) from public.work_item_type_resource_requirements q
           where q.organization_id = t.organization_id and q.type_id = t.id) = 1
         and exists (
           select 1 from public.work_item_type_resource_requirements q
            where q.organization_id = t.organization_id
              and q.type_id = t.id
              and q.quantity = 1
              and app.resource_is_eligible(r.organization_id, r.id, q.id)
         )
       )
     );
$fn$;

revoke all on function public.bookable_resource_ids(uuid) from public;
grant execute on function public.bookable_resource_ids(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The invariants that tie requirements to everything else
-- ---------------------------------------------------------------------------

-- A requirement can only be written for a schedulable type, and — while a type is open for public
-- booking — only as the single one-resource requirement booking can honour. Definer with `for share`
-- on the type, so it serialises against switching scheduling off and against publishing the type
-- (whoever arrives second waits and then sees the first).
create function app.check_requirement_allowed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_schedulable boolean;
  v_bookable    boolean;
  v_others      integer;
begin
  select t.schedulable, t.booking_status_id is not null
    into v_schedulable, v_bookable
    from public.work_item_types t
   where t.organization_id = new.organization_id
     and t.id = new.type_id
     for share;

  if not coalesce(v_schedulable, false) then
    raise exception 'work type % does not use the schedule, so it cannot need resources', new.type_id
      using errcode = 'GD008';
  end if;

  if v_bookable then
    select count(*) into v_others
      from public.work_item_type_resource_requirements q
     where q.organization_id = new.organization_id
       and q.type_id = new.type_id
       and q.id <> new.id;

    if v_others > 0 or new.quantity > 1 then
      raise exception 'work type % is open for public booking, which supports one required resource', new.type_id
        using errcode = 'GD011';
    end if;
  end if;

  return new;
end;
$fn$;

revoke all on function app.check_requirement_allowed() from public;

create trigger work_item_type_resource_requirements_allowed
  before insert or update of quantity on public.work_item_type_resource_requirements
  for each row execute function app.check_requirement_allowed();

-- Scheduling cannot be turned off under a type that needs resources, and the business is told to
-- remove them first — nothing is deleted on its behalf.
create function app.check_type_has_no_requirements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if old.schedulable and not new.schedulable and exists (
    select 1 from public.work_item_type_resource_requirements q
     where q.organization_id = old.organization_id and q.type_id = old.id
  ) then
    raise exception 'work type % still needs resources', old.id
      using errcode = 'GD009';
  end if;

  return new;
end;
$fn$;

revoke all on function app.check_type_has_no_requirements() from public;

create trigger work_item_types_no_requirements_when_unscheduled
  before update of schedulable on public.work_item_types
  for each row execute function app.check_type_has_no_requirements();

-- A type that needs more than booking can commit cannot be opened for public booking.
create function app.check_bookable_type_requirements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.booking_status_id is not null and (
    (select count(*) from public.work_item_type_resource_requirements q
      where q.organization_id = new.organization_id and q.type_id = new.id) > 1
    or exists (
      select 1 from public.work_item_type_resource_requirements q
       where q.organization_id = new.organization_id and q.type_id = new.id and q.quantity > 1
    )
  ) then
    raise exception 'work type % needs more than one resource and cannot be booked publicly', new.id
      using errcode = 'GD011';
  end if;

  return new;
end;
$fn$;

revoke all on function app.check_bookable_type_requirements() from public;

create trigger work_item_types_bookable_requirements
  before update of booking_status_id, booking_duration_minutes on public.work_item_types
  for each row execute function app.check_bookable_type_requirements();

-- A capability a type needs cannot be archived: the meaning of that kind of work would change
-- without anyone having said so.
create function app.check_capability_not_required()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if old.archived_at is null and new.archived_at is not null and exists (
    select 1 from public.work_item_type_resource_requirement_capabilities c
     where c.organization_id = old.organization_id and c.capability_id = old.id
  ) then
    raise exception 'capability % is required by a work type', old.id
      using errcode = 'GD010';
  end if;

  return new;
end;
$fn$;

revoke all on function app.check_capability_not_required() from public;

create trigger resource_capabilities_not_required_when_archived
  before update of archived_at on public.resource_capabilities
  for each row execute function app.check_capability_not_required();

-- An archived capability is not newly attached to a requirement (it may stay on ones already there).
create function app.check_requirement_capability_assignable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if exists (
    select 1 from public.resource_capabilities c
     where c.organization_id = new.organization_id
       and c.id = new.capability_id
       and c.archived_at is not null
  ) then
    raise exception 'capability % is archived', new.capability_id
      using errcode = 'GD007';
  end if;

  return new;
end;
$fn$;

revoke all on function app.check_requirement_capability_assignable() from public;

create trigger work_item_type_resource_requirement_capabilities_assignable
  before insert on public.work_item_type_resource_requirement_capabilities
  for each row execute function app.check_requirement_capability_assignable();

-- ---------------------------------------------------------------------------
-- Doors: each change is one transaction
-- ---------------------------------------------------------------------------

create function app.set_requirement_capabilities(p_organization_id uuid, p_requirement_id uuid, p_capability_ids uuid[])
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor  uuid := (select auth.uid());
  v_wanted uuid[] := coalesce(p_capability_ids, '{}'::uuid[]);
begin
  delete from public.work_item_type_resource_requirement_capabilities c
   where c.organization_id = p_organization_id
     and c.requirement_id = p_requirement_id
     and not (c.capability_id = any (v_wanted));

  insert into public.work_item_type_resource_requirement_capabilities
    (organization_id, requirement_id, capability_id, created_by)
  select p_organization_id, p_requirement_id, wanted.capability_id, v_actor
    from (select distinct unnest(v_wanted) as capability_id) wanted
   where not exists (
     select 1 from public.work_item_type_resource_requirement_capabilities existing
      where existing.organization_id = p_organization_id
        and existing.requirement_id = p_requirement_id
        and existing.capability_id = wanted.capability_id
   );
end;
$fn$;

revoke all on function app.set_requirement_capabilities(uuid, uuid, uuid[]) from public;
grant execute on function app.set_requirement_capabilities(uuid, uuid, uuid[]) to authenticated;

create function public.create_resource_requirement(
  p_type_id        uuid,
  p_resource_class text,
  p_quantity       integer,
  p_capability_ids uuid[]
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
    raise exception 'create_resource_requirement requires an authenticated caller'
      using errcode = '42501';
  end if;

  select t.organization_id into v_org from public.work_item_types t where t.id = p_type_id;
  if v_org is null then
    raise exception 'no such work type, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.work_item_type_resource_requirements
    (organization_id, type_id, resource_class, quantity, position, created_by)
  values (
    v_org, p_type_id, p_resource_class, p_quantity,
    coalesce((select max(q.position) + 1 from public.work_item_type_resource_requirements q
               where q.organization_id = v_org and q.type_id = p_type_id), 0),
    v_actor
  )
  returning id into v_id;

  perform app.set_requirement_capabilities(v_org, v_id, p_capability_ids);

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item_type', p_type_id, 'work_item_type.requirement_added',
     jsonb_build_object(
       'requirement_id', v_id,
       'resource_class', p_resource_class,
       'quantity', p_quantity,
       'capability_ids', to_jsonb(coalesce(p_capability_ids, '{}'::uuid[]))
     ));

  return v_id;
end;
$fn$;

revoke all on function public.create_resource_requirement(uuid, text, integer, uuid[]) from public;
grant execute on function public.create_resource_requirement(uuid, text, integer, uuid[]) to authenticated;

create function public.update_resource_requirement(
  p_id             uuid,
  p_resource_class text,
  p_quantity       integer,
  p_capability_ids uuid[]
)
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
    raise exception 'update_resource_requirement requires an authenticated caller'
      using errcode = '42501';
  end if;

  update public.work_item_type_resource_requirements
     set resource_class = p_resource_class,
         quantity       = p_quantity
   where id = p_id
  returning organization_id, type_id into v_org, v_type;

  if v_org is null then
    raise exception 'no such requirement, or you may not change it'
      using errcode = '42501';
  end if;

  perform app.set_requirement_capabilities(v_org, p_id, p_capability_ids);

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item_type', v_type, 'work_item_type.requirement_changed',
     jsonb_build_object(
       'requirement_id', p_id,
       'resource_class', p_resource_class,
       'quantity', p_quantity,
       'capability_ids', to_jsonb(coalesce(p_capability_ids, '{}'::uuid[]))
     ));
end;
$fn$;

revoke all on function public.update_resource_requirement(uuid, text, integer, uuid[]) from public;
grant execute on function public.update_resource_requirement(uuid, text, integer, uuid[]) to authenticated;

create function public.delete_resource_requirement(p_id uuid)
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
    raise exception 'delete_resource_requirement requires an authenticated caller'
      using errcode = '42501';
  end if;

  delete from public.work_item_type_resource_requirements
   where id = p_id
  returning organization_id, type_id into v_org, v_type;

  if v_org is null then
    raise exception 'no such requirement, or you may not change it'
      using errcode = '42501';
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'work_item_type', v_type, 'work_item_type.requirement_removed',
     jsonb_build_object('requirement_id', p_id));
end;
$fn$;

revoke all on function public.delete_resource_requirement(uuid) from public;
grant execute on function public.delete_resource_requirement(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Booking: the commit reasserts what the page offered
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_booking(p_organization_id uuid, p_type_id uuid, p_resource_id uuid, p_starts_at timestamp with time zone, p_name text, p_email text, p_phone text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor    uuid := (select auth.uid());
  v_scope    uuid := app.current_external_tenant();
  v_type     public.work_item_types;
  v_email    text := nullif(btrim(p_email), '');
  v_customer uuid;
  v_item     uuid;
  v_requirements integer;
  v_max_quantity integer;
  v_requirement  uuid;
begin
  if v_actor is null then
    raise exception 'create_booking requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- **The whole authorization of this function, and it is one line.** This runs privileged, so
  -- nothing below is restrained by RLS -- every scope below is therefore written out rather
  -- than assumed. A caller bound to another business, or to none, stops here.
  if v_scope is null or v_scope is distinct from p_organization_id then
    raise exception 'you are not booking with this business'
      using errcode = '42501';
  end if;

  -- **Added by 20260829000010: re-checked rather than inferred from how the visitor got here.**
  -- The organization id is an argument, so a stranger holding one from before the switch was
  -- thrown would otherwise still commit work -- the same reasoning D17 gives about a path
  -- segment being routing convenience and never an authorization input.
  perform app.assert_module_enabled(p_organization_id, 'booking');

  -- One booking per visitor. Without this a single anonymous session could fill a diary, and
  -- the binding is the only thing that identifies them. A distinct SQLSTATE, because 23505 is
  -- also what a duplicate email raises and the two mean opposite things to a person.
  if exists (
    select 1
    from public.work_items w
    where w.organization_id = p_organization_id
      and w.created_by = v_actor
  ) then
    raise exception 'this visitor has already booked'
      using errcode = 'GD001';
  end if;

  select * into v_type
  from public.work_item_types
  where id = p_type_id
    and organization_id = p_organization_id
    and booking_status_id is not null;

  if v_type.id is null then
    raise exception 'that is not something this business takes bookings for'
      using errcode = '42501';
  end if;

  -- **What this kind of work needs, reasserted at commit.** Public booking commits one resource, so
  -- it can only honour a type that needs at most one resource: more than that is refused rather than
  -- booked short (the configuration guards refuse to build such a type, and this is the same fact
  -- for a caller that arrives around them). With one requirement, the resource the visitor's slot
  -- names must still be eligible *now* — class and capabilities can change between the page and the
  -- booking, and a stale or hand-written call must not commit a resource that cannot do the work.
  -- Availability is separate and stays the assignment constraint's: eligible AND free.
  select count(*), max(q.quantity), min(q.id::text)::uuid
    into v_requirements, v_max_quantity, v_requirement
    from public.work_item_type_resource_requirements q
   where q.organization_id = p_organization_id
     and q.type_id = p_type_id;

  if v_requirements > 1 or coalesce(v_max_quantity, 0) > 1 then
    raise exception 'this kind of work needs more than one resource and cannot be booked publicly'
      using errcode = 'GD011';
  end if;

  if v_requirements = 1
     and not app.resource_is_eligible(p_organization_id, p_resource_id, v_requirement) then
    raise exception 'that resource cannot do this work'
      using errcode = 'GD012';
  end if;

  -- **A returning customer books against the record they already have.** The first draft
  -- created a new row every time and refused to look one up, on the grounds that matching an
  -- address somebody typed lets a stranger attach a booking to another customer's history.
  -- That reasoning was about *reading*, and the read policies above key on `created_by` rather
  -- than on the customer -- so attaching discloses nothing at all. What it does risk is a
  -- booking landing on the wrong person's record when somebody mistypes, which is a
  -- data-quality problem the business can see and fix, and a far smaller one than a business
  -- unable to take a second booking from its own customer.
  if v_email is not null then
    select c.id into v_customer
    from public.customers c
    where c.organization_id = p_organization_id
      and lower(c.email) = lower(v_email);
  end if;

  if v_customer is null then
    insert into public.customers (organization_id, name, email, phone, created_by)
    values (p_organization_id, p_name, v_email, nullif(btrim(p_phone), ''), v_actor)
    returning id into v_customer;
  end if;

  -- The duration is the type's, never the caller's. A caller who could choose it could book
  -- the van for a week. This is the one place a booking's shape is decided, and it is decided
  -- by what the business published.
  insert into public.work_items (
    organization_id, type_id, status_id, customer_id, title,
    scheduled_during, created_by
  )
  values (
    p_organization_id,
    p_type_id,
    v_type.booking_status_id,
    v_customer,
    v_type.name || ' — ' || p_name,
    tstzrange(
      p_starts_at,
      p_starts_at + make_interval(mins => v_type.booking_duration_minutes),
      '[)'
    ),
    v_actor
  )
  returning id into v_item;

  -- The one resource this booking takes. The assignment carries the window onto the resource's
  -- own row (`app.set_assignment_occupies`) and the exclusion constraint on it is what refuses a
  -- slot somebody else took — in this transaction, with nothing checked first.
  insert into public.work_item_resource_assignments
    (organization_id, work_item_id, resource_id, created_by)
  values (p_organization_id, v_item, p_resource_id, v_actor);

  -- **I6, and this is where it is proved rather than described.** Nothing checked whether the
  -- slot was still free. The exclusion constraint refuses this insert in the transaction that
  -- would have written it, which is the only re-assertion that does not race -- a check before
  -- the insert races identically, which is the whole content of that invariant.

  if v_type.booking_price_item_id is not null then
    perform public.add_work_item_priced_line(v_item, v_type.booking_price_item_id, 1);
  end if;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'work_item', v_item, 'work_item.booked',
     jsonb_build_object(
       'title', v_type.name,
       'customer_id', v_customer,
       'resource_ids', jsonb_build_array(p_resource_id),
       'starts_at', p_starts_at
     ));

  return v_item;
end;
$function$;

-- Public booking can take every resource a kind of work needs, not just one.
--
-- `20261117000001` let a type say what it needs and capped public booking at one requirement of
-- quantity one, because `create_booking` committed one resource. This lifts that: the booking
-- commits a *set*, and the database verifies that set instead of choosing it.
--
-- **Who chooses, who checks.** Choosing a feasible combination is a matching problem and belongs in
-- TypeScript (`lib/domain/scheduling/feasibility.ts`). Checking one is not: `create_booking` is
-- handed an allocation -- which resource fills which required slot -- and refuses it unless every
-- slot is filled by exactly the quantity asked, every resource is eligible for the requirement it
-- names, and no resource appears twice. That is a certificate, cheap to verify and impossible to
-- forge into a booking the type does not allow. Working hours, time off and double-booking are not
-- re-implemented here: they are the assignment triggers' and the exclusion constraint's, in this
-- same transaction, exactly as for any other assignment.
--
-- **A type that needs nothing still books one resource**, as it always did: capacity has to come
-- from somewhere or a public page could fill one hour with unlimited customers. That case is the
-- allocation entry whose requirement is null.

-- ---------------------------------------------------------------------------
-- The one-resource guards go
-- ---------------------------------------------------------------------------

drop trigger work_item_types_bookable_requirements on public.work_item_types;
drop function app.check_bookable_type_requirements();

create or replace function app.check_requirement_allowed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_schedulable boolean;
begin
  -- `for share` on the type still serialises this against switching scheduling off.
  select t.schedulable
    into v_schedulable
    from public.work_item_types t
   where t.organization_id = new.organization_id
     and t.id = new.type_id
     for share;

  if not coalesce(v_schedulable, false) then
    raise exception 'work type % does not use the schedule, so it cannot need resources', new.type_id
      using errcode = 'GD008';
  end if;

  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- What a visitor's booking may draw on: ids only
-- ---------------------------------------------------------------------------

-- Replaces `bookable_resource_ids`. One row per (requirement, eligible resource), in the business's
-- reading order and with a stable rank per resource, so the booking page and the commit agree on
-- what "first" means. Ids and positions only: a resource can be a person, and who could do a job is
-- not something a booking page publishes. A type with no requirements answers with one implicit
-- slot (null requirement, quantity 1) that every resource is eligible for.
drop function public.bookable_resource_ids(uuid);

create function public.bookable_candidates(p_type_id uuid)
returns table (requirement_id uuid, req_position integer, quantity integer, resource_id uuid, resource_rank integer)
language sql
stable
security definer
set search_path = ''
as $fn$
  with t as (
    select t.organization_id, t.id
      from public.work_item_types t
     where t.id = p_type_id
       and t.booking_status_id is not null
       and t.organization_id = app.current_external_tenant()
  ),
  ranked as (
    select r.organization_id,
           r.id,
           (row_number() over (partition by r.organization_id order by r.name, r.id))::integer as rank
      from public.resources r
      join t on t.organization_id = r.organization_id
  )
  select q.id, q.position, q.quantity, ranked.id, ranked.rank
    from t
    join public.work_item_type_resource_requirements q
      on q.organization_id = t.organization_id and q.type_id = t.id
    join ranked on ranked.organization_id = t.organization_id
   where app.resource_is_eligible(ranked.organization_id, ranked.id, q.id)
  union all
  select null::uuid, 0, 1, ranked.id, ranked.rank
    from t
    join ranked on ranked.organization_id = t.organization_id
   where not exists (
     select 1 from public.work_item_type_resource_requirements q
      where q.organization_id = t.organization_id and q.type_id = t.id
   );
$fn$;

revoke all on function public.bookable_candidates(uuid) from public;
grant execute on function public.bookable_candidates(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The booking
-- ---------------------------------------------------------------------------

drop function public.create_booking(uuid, uuid, uuid, timestamptz, text, text, text);

-- `p_allocations` is `[{ "requirement_id": uuid|null, "resource_id": uuid }, ...]`: one entry per
-- required slot. A visitor sends a time and the server works out the rest; the allocation is the
-- server's own, and is verified here regardless of who built it.
create function public.create_booking(
  p_organization_id uuid,
  p_type_id         uuid,
  p_allocations     jsonb,
  p_starts_at       timestamptz,
  p_name            text,
  p_email           text,
  p_phone           text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor     uuid := (select auth.uid());
  v_scope     uuid := app.current_external_tenant();
  v_type      public.work_item_types;
  v_email     text := nullif(btrim(p_email), '');
  v_customer  uuid;
  v_item      uuid;
  v_entry     jsonb;
  v_resource  uuid;
  v_req       uuid;
  v_needs     integer;
  v_resources uuid[] := '{}';
begin
  if v_actor is null then
    raise exception 'create_booking requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- The whole authorization of this function: written out, because everything below runs privileged.
  if v_scope is null or v_scope is distinct from p_organization_id then
    raise exception 'you are not booking with this business'
      using errcode = '42501';
  end if;

  perform app.assert_module_enabled(p_organization_id, 'booking');

  -- One booking per visitor, with its own SQLSTATE: 23505 is also what a duplicate email raises.
  if exists (
    select 1 from public.work_items w
     where w.organization_id = p_organization_id and w.created_by = v_actor
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

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'a booking names the resources it takes'
      using errcode = 'GD014';
  end if;

  -- **The certificate.** Each entry fills one slot of one requirement with one resource; together
  -- they must fill exactly what the type needs. Checked against current configuration -- class and
  -- capabilities can change between the page and the booking.
  for v_entry in select * from jsonb_array_elements(p_allocations) loop
    v_resource := nullif(v_entry ->> 'resource_id', '')::uuid;
    v_req := nullif(v_entry ->> 'requirement_id', '')::uuid;

    if v_resource is null or v_resource = any (v_resources) then
      raise exception 'a booking cannot use the same resource twice'
        using errcode = 'GD014';
    end if;
    v_resources := array_append(v_resources, v_resource);

    if v_req is null then
      if not exists (select 1 from public.resources r where r.organization_id = p_organization_id and r.id = v_resource) then
        raise exception 'that resource cannot do this work'
          using errcode = 'GD012';
      end if;
    elsif not exists (
      select 1 from public.work_item_type_resource_requirements q
       where q.organization_id = p_organization_id and q.type_id = p_type_id and q.id = v_req
    ) or not app.resource_is_eligible(p_organization_id, v_resource, v_req) then
      raise exception 'that resource cannot do this work'
        using errcode = 'GD012';
    end if;
  end loop;

  if exists (
    select 1 from public.work_item_type_resource_requirements q
     where q.organization_id = p_organization_id and q.type_id = p_type_id
  ) then
    -- Every requirement filled to exactly its quantity, and nothing named that no requirement asked for.
    if exists (
      select 1
        from public.work_item_type_resource_requirements q
       where q.organization_id = p_organization_id and q.type_id = p_type_id
         and q.quantity <> (
           select count(*) from jsonb_array_elements(p_allocations) e
            where nullif(e ->> 'requirement_id', '')::uuid = q.id)
    ) or exists (
      select 1 from jsonb_array_elements(p_allocations) e
       where nullif(e ->> 'requirement_id', '') is null
    ) then
      raise exception 'those resources do not fill what this work needs'
        using errcode = 'GD014';
    end if;
  else
    v_needs := jsonb_array_length(p_allocations);
    if v_needs <> 1 then
      raise exception 'those resources do not fill what this work needs'
        using errcode = 'GD014';
    end if;
  end if;

  -- A returning customer books against the record they already have.
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

  -- The duration is the type's, never the caller's.
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
    tstzrange(p_starts_at, p_starts_at + make_interval(mins => v_type.booking_duration_minutes), '[)'),
    v_actor
  )
  returning id into v_item;

  -- Every resource, in this one transaction. Each insert carries the window onto the resource's own
  -- row; the working-hours trigger and the exclusion constraint are what refuse a resource that
  -- stopped working or was taken -- and a refusal on any one rolls back the work item and all the
  -- others. No partial booking.
  insert into public.work_item_resource_assignments (organization_id, work_item_id, resource_id, created_by)
  select p_organization_id, v_item, rid, v_actor
    from unnest(v_resources) as rid;

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
       'resource_ids', to_jsonb(v_resources),
       'starts_at', p_starts_at
     ));

  return v_item;
end;
$fn$;

revoke all on function public.create_booking(uuid, uuid, jsonb, timestamptz, text, text, text) from public;
grant execute on function public.create_booking(uuid, uuid, jsonb, timestamptz, text, text, text) to authenticated;

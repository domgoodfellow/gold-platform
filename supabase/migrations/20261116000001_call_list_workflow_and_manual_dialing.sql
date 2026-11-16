-- The Dialer's call list becomes a working list: read, searched, filtered and counted by the
-- database; callbacks are a recorded fact; and dialing a number that belongs to no contact is its
-- own permission.
--
-- 1. `call.dial_manual`. Until now `call.place` let a member dial any number. Placing calls and
--    dialing any number are separated: `call.place` still lets a member call a contact at their
--    recorded number and return a call the business received; a number that is neither needs
--    `call.dial_manual`. `open_call` is the one place a call is opened before the carrier is asked
--    to ring, so the rule sits there and no screen can route around it.
--
-- 2. A callback is structured: `crm_tasks.callback_of_call_id` names the call it follows. It is set
--    only by `schedule_callback`, which moves the contact's one open Call task (or opens it when
--    there is none), so a callback never creates a second open Call task and is never guessed from
--    a task's wording.
--
-- 3. `call_list_page` and `call_list_counts` read the same rows (`app.call_list_rows`), so a view
--    and its count cannot disagree. Like `call_list_contacts`, they are the Dialer's disclosure:
--    a member who places calls or views contacts sees who is on the list.

-- 1. The permission. Dialing any number is new authority over what a member already had named
--    for them, so only unrestricted administrators (roles holding every existing permission)
--    receive it; every other role is granted it explicitly by someone who holds it.
create function pg_temp.add_capabilities(p_add text[], p_to_unrestricted text[]) returns void
language plpgsql as $$
declare v_constraint text; v_before text[]; v_after text[];
begin
  select pg_get_constraintdef(oid) into v_constraint from pg_constraint
    where conrelid = 'public.roles'::regclass and conname = 'roles_capabilities_known';
  select array_agg(distinct m[1]) into v_before from regexp_matches(v_constraint, '''([^'']+)''::text', 'g') m;
  v_after := v_before || array(select c from unnest(p_add) c where not c = any(v_before));
  alter table public.roles drop constraint roles_capabilities_known;
  execute format('alter table public.roles add constraint roles_capabilities_known check (capabilities <@ array[%s]::text[])',
    (select string_agg(quote_literal(c), ',' order by c) from unnest(v_after) c));
  -- This update only adds a permission, so it cannot leave a business without someone who manages
  -- roles. The guard for that is set aside for it alone, inside this one statement: a failure
  -- undoes the suspension with everything else, and no other session sees the guard off.
  alter table public.roles disable trigger roles_capabilities_update_guard;
  update public.roles set capabilities = capabilities || array(select c from unnest(p_to_unrestricted) c where not c = any(capabilities))
    where capabilities @> v_before and not capabilities @> p_to_unrestricted;
  alter table public.roles enable trigger roles_capabilities_update_guard;
  if (select tgenabled from pg_trigger where tgrelid = 'public.roles'::regclass and tgname = 'roles_capabilities_update_guard') <> 'O' then
    raise exception 'roles_capabilities_update_guard was not restored';
  end if;
end $$;
select pg_temp.add_capabilities(array['call.dial_manual'], array['call.dial_manual']);
drop function pg_temp.add_capabilities(text[], text[]);

-- Whether the asking member may ring this number. With `call.dial_manual`: any number. Without it:
-- the recorded number of a contact who is on the call list or whom the member may view, or a
-- number the business has received a call from. Nothing is inferred about whose number it is.
create function app.outbound_destination_allowed(p_organization_id uuid, p_to_number text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_capability(p_organization_id, 'call.dial_manual')
      or exists (
           select 1 from app.contact_matches(p_organization_id, 'phone', p_to_number) m
            where app.has_capability(p_organization_id, 'customer.read')
               or exists (select 1 from public.crm_tasks t
                           where t.organization_id = p_organization_id and t.customer_id = m
                             and t.status = 'open' and t.kind = 'call'))
      or exists (
           select 1 from public.calls c
            where c.organization_id = p_organization_id and c.direction = 'inbound'
              and app.normalize_phone(c.from_number) = app.normalize_phone(p_to_number))
$$;
revoke all on function app.outbound_destination_allowed(uuid, text) from public, anon;
grant execute on function app.outbound_destination_allowed(uuid, text) to authenticated;

-- Recreated in full: the same room, credit check and event, preceded by the destination rule.
create or replace function public.open_call(
  p_organization_id uuid,
  p_customer_id     uuid,
  p_conference_name text,
  p_from_number     text,
  p_to_number       text
)
returns uuid
language plpgsql
set search_path = ''
as $fn$
declare
  v_id     uuid;
  v_number uuid;
  v_customer uuid;
  d        record;
begin
  -- Only a member who may place calls is told anything about the number; everyone else is refused
  -- by the policy on `calls` below, as before.
  if app.has_capability(p_organization_id, 'call.place')
     and not app.outbound_destination_allowed(p_organization_id, p_to_number) then
    raise exception 'manual dialing is not permitted for this member' using errcode = '42501';
  end if;

  select * into d from app.spend_decision(p_organization_id, 'voice_minutes', 1);

  if not d.allowed then
    if d.reason = 'allowance_hard_limit' then
      raise exception 'this account has used all the calling its plan allows: %', coalesce(d.detail, 'the included minutes are used up')
        using errcode = '23514';
    else
      raise exception 'there is no calling credit left on this account'
        using errcode = '23514';
    end if;
  end if;

  select n.id into v_number from public.phone_numbers n
   where n.organization_id = p_organization_id and n.e164 = p_from_number;

  insert into public.calls
    (organization_id, customer_id, direction, status, from_number, to_number,
     conference_name, phone_number_id, created_by)
  values
    (p_organization_id, p_customer_id, 'outbound', 'ringing', p_from_number, p_to_number,
     p_conference_name, v_number, (select auth.uid()))
  returning id into v_id;

  select customer_id into v_customer from public.calls where id = v_id;
  if v_customer is not null then
    insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
    values (p_organization_id, (select auth.uid()), 'customer', v_customer, 'call.placed',
            jsonb_build_object('call_id', v_id, 'direction', 'outbound', 'to_number', p_to_number));
  end if;

  return v_id;
end;
$fn$;

comment on function public.open_call(uuid, uuid, text, text, text) is
  'A room, the destination rule and credit check that guard it, and the event. security invoker: the calls policies decide whether the caller may place calls; a number that is not a contact''s or a caller''s needs call.dial_manual. The legs are written by a trigger; the customer, when not given, is the one the number names.';

-- 2. Callbacks.
alter table public.crm_tasks add column callback_of_call_id uuid;
alter table public.crm_tasks add constraint crm_tasks_callback_call
  foreign key (organization_id, callback_of_call_id) references public.calls(organization_id, id)
  on delete set null (callback_of_call_id);
comment on column public.crm_tasks.callback_of_call_id is
  'The call this open Call task is a callback for. Set only by schedule_callback.';
create index crm_tasks_callbacks on public.crm_tasks(organization_id, due_at, id)
  where status = 'open' and kind = 'call' and callback_of_call_id is not null;

-- Schedules the callback a call ended with: the contact's one open Call task is moved to the new
-- time and marked as following that call; when they have none, one is opened with the reason
-- given. Needs task permission, and the Dialer's own view of the contact (placing calls or viewing
-- contacts). Two people scheduling at once end with one task.
create function public.schedule_callback(p_organization_id uuid, p_call_id uuid, p_due_at timestamptz, p_reason text default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_customer uuid;
  v_archived boolean;
  v_task uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'follow_up.manage')
     or not (app.has_capability(p_organization_id, 'call.place') or app.has_capability(p_organization_id, 'customer.read')) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if p_due_at is null or not isfinite(p_due_at) then
    raise exception 'Enter when to call back.' using errcode = '22023';
  end if;
  select c.customer_id into v_customer from public.calls c
   where c.organization_id = p_organization_id and c.id = p_call_id;
  if not found then
    raise exception 'no such call here' using errcode = 'P0002';
  end if;
  if v_customer is null then
    raise exception 'This call is not linked to a contact.' using errcode = '23514';
  end if;
  loop
    update public.crm_tasks set due_at = p_due_at, callback_of_call_id = p_call_id
     where organization_id = p_organization_id and customer_id = v_customer and status = 'open' and kind = 'call'
    returning id into v_task;
    if v_task is not null then
      return v_task;
    end if;
    if v_reason is null or length(v_reason) > 200 then
      raise exception 'Enter the reason for calling.' using errcode = '22023';
    end if;
    select k.archived_at is not null into v_archived from public.contacts k
     where k.organization_id = p_organization_id and k.id = v_customer;
    if v_archived then
      raise exception 'This contact is archived.' using errcode = '23514';
    end if;
    insert into public.crm_tasks(organization_id, customer_id, kind, title, due_at, callback_of_call_id, created_by)
    values (p_organization_id, v_customer, 'call', v_reason, p_due_at, p_call_id, (select auth.uid()))
    on conflict (organization_id, customer_id) where status = 'open' and kind = 'call' do nothing
    returning id into v_task;
    if v_task is not null then
      return v_task;
    end if;
  end loop;
end;
$fn$;
revoke all on function public.schedule_callback(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.schedule_callback(uuid, uuid, timestamptz, text) to authenticated;

-- 3. The call list's rows: every open Call task with its contact, matching a search and leaving
--    out the tasks named (skipped for a calling session). The three facts a view is made of are
--    computed once here: `is_mine` (owned by the asking member), `is_due` (due at or before now)
--    and `is_overdue` (due before today began in the business's timezone).
create function app.call_list_rows(p_organization_id uuid, p_search text, p_exclude uuid[])
returns table (
  id uuid, customer_id uuid, opportunity_id uuid, opportunity_title text, title text, notes text,
  due_at timestamptz, owner_membership_id uuid, created_at timestamptz, callback_of_call_id uuid,
  is_mine boolean, is_due boolean, is_overdue boolean,
  contact_name text, contact_email text, contact_phone text, contact_archived boolean, contact_type text,
  company_id uuid, company_name text, contact_title text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select m.id from public.memberships m
     where m.organization_id = p_organization_id and m.user_id = (select auth.uid())
  ),
  today as (
    select date_trunc('day', now() at time zone o.timezone) at time zone o.timezone as starts
      from public.organizations o where o.id = p_organization_id
  ),
  needle as (
    select s.words,
           '%' || replace(replace(replace(s.words, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern,
           -- Digits are matched against phone numbers only when the search reads as a number.
           case when s.words ~ '^[0-9\s()+.\-]+$' and length(regexp_replace(s.words, '\D', '', 'g')) >= 3
                then '%' || regexp_replace(s.words, '\D', '', 'g') || '%' end as digits
      from (select nullif(btrim(coalesce(p_search, '')), '') as words) s
  ),
  open_calls as (
    select t.* from public.crm_tasks t
     where t.organization_id = p_organization_id and t.status = 'open' and t.kind = 'call'
       and not (t.id = any (coalesce(p_exclude, '{}'::uuid[])))
  )
  select t.id, t.customer_id, t.opportunity_id, o.title, t.title, t.notes,
         t.due_at, t.owner_membership_id, t.created_at, t.callback_of_call_id,
         coalesce(t.owner_membership_id = (select id from me), false),
         t.due_at <= now(),
         t.due_at < (select starts from today),
         k.name, k.email, k.phone, k.archived, k.contact_type, k.company_id, k.company_name, k.title
    from open_calls t
    join app.dialer_contact_cards(p_organization_id, array(select c.customer_id from open_calls c)) k on k.id = t.customer_id
    left join public.opportunities o on o.organization_id = t.organization_id and o.id = t.opportunity_id
   cross join needle n
   where n.words is null
      or k.name ilike n.pattern
      or k.company_name ilike n.pattern
      or k.title ilike n.pattern
      or t.title ilike n.pattern
      or (n.digits is not null and regexp_replace(coalesce(k.phone, ''), '\D', '', 'g') like n.digits)
$$;
revoke all on function app.call_list_rows(uuid, text, uuid[]) from public, anon, authenticated;

create function app.call_list_view_known(p_view text) returns boolean language sql immutable set search_path = '' as $$
  select p_view in ('all', 'mine', 'due', 'overdue', 'upcoming', 'callbacks')
$$;
revoke all on function app.call_list_view_known(text) from public, anon, authenticated;

-- One page of a view, earliest due first. `p_task_ids` narrows to named tasks (reading a selection
-- again); `p_callable_only` leaves out contacts with no phone number (choosing who is next).
create function public.call_list_page(
  p_organization_id uuid, p_view text default 'all', p_search text default null, p_exclude uuid[] default '{}',
  p_limit integer default 25, p_offset integer default 0, p_task_ids uuid[] default null, p_callable_only boolean default false)
returns table (
  id uuid, customer_id uuid, opportunity_id uuid, opportunity_title text, title text, notes text,
  due_at timestamptz, owner_membership_id uuid, created_at timestamptz, callback_of_call_id uuid,
  is_mine boolean, is_due boolean, is_overdue boolean,
  contact_name text, contact_email text, contact_phone text, contact_archived boolean, contact_type text,
  company_id uuid, company_name text, contact_title text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if p_organization_id not in (select app.current_tenant_ids())
     or not (app.has_capability(p_organization_id, 'call.place') or app.has_capability(p_organization_id, 'customer.read')) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if not app.call_list_view_known(p_view) then
    raise exception 'unknown call list view' using errcode = '22023';
  end if;
  return query
    select r.* from app.call_list_rows(p_organization_id, p_search, p_exclude) r
     where (case p_view
              when 'mine' then r.is_mine
              when 'due' then r.is_due
              when 'overdue' then r.is_overdue
              when 'upcoming' then not r.is_due
              when 'callbacks' then r.callback_of_call_id is not null
              else true end)
       and (p_task_ids is null or r.id = any (p_task_ids))
       and (not coalesce(p_callable_only, false) or nullif(btrim(coalesce(r.contact_phone, '')), '') is not null)
     order by r.due_at, r.id
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$fn$;
revoke all on function public.call_list_page(uuid, text, text, uuid[], integer, integer, uuid[], boolean) from public, anon;
grant execute on function public.call_list_page(uuid, text, text, uuid[], integer, integer, uuid[], boolean) to authenticated;

-- How many calls each view holds, for the same search and the same tasks left out.
create function public.call_list_counts(p_organization_id uuid, p_search text default null, p_exclude uuid[] default '{}')
returns table (all_calls bigint, mine bigint, due bigint, overdue bigint, upcoming bigint, callbacks bigint)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if p_organization_id not in (select app.current_tenant_ids())
     or not (app.has_capability(p_organization_id, 'call.place') or app.has_capability(p_organization_id, 'customer.read')) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  return query
    select count(*), count(*) filter (where r.is_mine), count(*) filter (where r.is_due),
           count(*) filter (where r.is_overdue), count(*) filter (where not r.is_due),
           count(*) filter (where r.callback_of_call_id is not null)
      from app.call_list_rows(p_organization_id, p_search, p_exclude) r;
end;
$fn$;
revoke all on function public.call_list_counts(uuid, text, uuid[]) from public, anon;
grant execute on function public.call_list_counts(uuid, text, uuid[]) to authenticated;

notify pgrst, 'reload schema';

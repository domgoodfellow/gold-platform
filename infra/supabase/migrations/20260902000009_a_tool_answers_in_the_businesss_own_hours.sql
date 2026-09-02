-- A tool hands a model an instant, and a model is what renders it. So render it here.
--
-- **Found by asking a real model a real question**, which is the only way it could have been
-- found. `work_at_risk` returned `timestamptz`, PostgREST serialised it as UTC, and the answer
-- came back reading *2026-09-01T17:54 to 2026-09-01T18:54* — correct to the second and an hour
-- wrong for a business in Amsterdam, two for one in Helsinki, and nine for the dive school in
-- Cebu that `milestone-m8.test.ts` configures. Every test this repository had still passed,
-- because every one of them founds a business in UTC.
--
-- **I9 is unchanged and this is I9 being obeyed.** An instant is absolute and is stored as one;
-- a zone is applied at render. What is new is only *who renders*: until now that was a screen in
-- the operator's browser, and now it is sometimes a language model that has been handed a number
-- and no context. The instants stay in the answer for anything that needs to compare or sort
-- them; what is added beside them is the business's own wall clock.
--
-- **Rendered rather than described, and the difference matters.** The alternative was telling the
-- model the zone name and letting it convert — which is arithmetic, on dates, by a model, with
-- daylight saving in it. Postgres already knows how to do that correctly and the tenant's zone is
-- already on the row. A model that is handed the right words cannot get them wrong.

drop function public.work_at_risk(uuid);

create function public.work_at_risk(p_organization_id uuid)
returns table (
  work_item_id   uuid,
  title          text,
  status         text,
  reason         text,
  scheduled_from timestamptz,
  scheduled_to   timestamptz,
  -- The same two instants in the words this business uses for them. Named so nothing reading
  -- the answer has to guess which is which.
  starts_local   text,
  ends_local     text,
  time_zone      text,
  resource       text,
  customer       text
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select w.id,
         w.title,
         s.name,
         case
           when upper(w.scheduled_during) <= now() then 'window_passed'
           else 'nobody_assigned'
         end,
         lower(w.scheduled_during),
         upper(w.scheduled_during),
         to_char(lower(w.scheduled_during) at time zone o.timezone, 'YYYY-MM-DD HH24:MI'),
         to_char(upper(w.scheduled_during) at time zone o.timezone, 'YYYY-MM-DD HH24:MI'),
         o.timezone,
         r.name,
         c.name
    from public.work_items w
    join public.work_item_statuses s
      on s.organization_id = w.organization_id
     and s.id = w.status_id
    join public.organizations o
      on o.id = w.organization_id
    left join public.resources r
      on r.organization_id = w.organization_id
     and r.id = w.resource_id
    left join public.customers c
      on c.organization_id = w.organization_id
     and c.id = w.customer_id
   where w.organization_id = p_organization_id
     and w.scheduled_during is not null
     and not w.status_releases_resource
     and (
       upper(w.scheduled_during) <= now()
       or (
         w.resource_id is null
         and (lower(w.scheduled_during) at time zone o.timezone)::date
             = (now() at time zone o.timezone)::date
       )
     )
   order by lower(w.scheduled_during);
$fn$;

comment on function public.work_at_risk(uuid) is
  'Work whose booked window has passed while its status still holds the resource, and work booked for today with nobody assigned. Carries both the instant and the business''s own wall clock, because the thing rendering it is a language model. A tool: stable, security invoker, narrowed by RLS rather than by its argument. See D34.';

revoke execute on function public.work_at_risk(uuid) from public;
grant execute on function public.work_at_risk(uuid) to authenticated;

-- The same treatment for the second tool. `days_since` was already the useful half of its
-- answer, which is why this one read correctly by luck rather than by design.
drop function public.customers_not_contacted(uuid, integer);

create function public.customers_not_contacted(
  p_organization_id uuid,
  p_days integer default 30
)
returns table (
  customer_id       uuid,
  name              text,
  email             text,
  phone             text,
  last_activity     timestamptz,
  last_activity_local text,
  time_zone         text,
  days_since        integer
)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select c.id,
         c.name,
         c.email,
         c.phone,
         max(a.occurred_at),
         to_char(max(a.occurred_at) at time zone o.timezone, 'YYYY-MM-DD HH24:MI'),
         o.timezone,
         case
           when max(a.occurred_at) is not null
             then extract(day from now() - max(a.occurred_at))::integer
         end
    from public.customers c
    join public.organizations o
      on o.id = c.organization_id
    left join public.customer_activity a
      on a.organization_id = c.organization_id
     and a.customer_id = c.id
   where c.organization_id = p_organization_id
   group by c.id, c.name, c.email, c.phone, o.timezone
  having max(a.occurred_at) is null
      or max(a.occurred_at) < now() - make_interval(days => greatest(p_days, 0))
   order by max(a.occurred_at) asc nulls first;
$fn$;

comment on function public.customers_not_contacted(uuid, integer) is
  'Customers with nothing recorded about them for a given number of days, from the same events their own timeline shows. Carries the business''s own wall clock beside the instant. A tool: stable, security invoker. See D34.';

revoke execute on function public.customers_not_contacted(uuid, integer) from public;
grant execute on function public.customers_not_contacted(uuid, integer) to authenticated;

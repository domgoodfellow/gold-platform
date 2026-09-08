-- Which events belong to a customer, in one place, and the second tool that needs it.
--
-- **This migration exists because a second caller arrived for a rule that was inline.** The rule
-- is *what counts as something happening to this customer*, and it has lived inside
-- `listCustomerTimeline` since M4. It is not obvious and it is easy to get wrong three different
-- ways, all of which that function's own comments already warn about:
--
--   * almost everything a business remembers about a customer happened to a **job** rather than
--     to the customer row, so events about their work items are theirs;
--   * one action names the customer as its *object* rather than its subject -- `location.linked`
--     is written against the location and carries the customer in the payload -- so a reader
--     filtering on `entity_id` alone silently misses it;
--   * `events` is polymorphic and holds no foreign key, so none of this can be joined naively.
--
-- The repository's rule is extract first, then call twice, never copy. So the resolution moves
-- here and both callers read it.
--
-- **What deliberately did *not* move is the action list.** `listCustomerTimeline` filters to the
-- actions a customer's history is *made of* -- "anything else is noise on this screen" -- and that
-- is a rendering decision belonging to the screen that renders it. Which events are *about* a
-- customer and which of them are worth showing are two questions, and only the first was ever
-- duplicated.

-- ---------------------------------------------------------------------------
-- customer_activity
-- ---------------------------------------------------------------------------

-- **`security_invoker` and it must stay so.** A view runs as its owner by default, which here
-- would hand every caller every tenant's events -- the same trap `platform_tenants` names, with
-- worse consequences because this one is granted to `authenticated`. RLS on `events`,
-- `work_items` and `customers` is what scopes this, exactly as it scopes the screens.
create view public.customer_activity
with (security_invoker = true) as
  select e.organization_id,
         coalesce(
           -- Written against the customer.
           c.id,
           -- Written against one of their jobs, which is most of what a business remembers.
           w.customer_id,
           -- Written against something else and naming them in the payload. One action does
           -- this today; the cast is safe because nothing else reaches this branch.
           case
             when e.action = 'location.linked' and e.payload ? 'customer_id'
               then (e.payload ->> 'customer_id')::uuid
           end
         ) as customer_id,
         e.id as event_id,
         e.action,
         e.entity_type,
         e.entity_id,
         e.payload,
         e.actor_id,
         e.occurred_at
    from public.events e
    left join public.customers c
      on c.organization_id = e.organization_id
     and c.id = e.entity_id
    left join public.work_items w
      on w.organization_id = e.organization_id
     and w.id = e.entity_id;

comment on view public.customer_activity is
  'Every event that is about a customer, including the ones written against their jobs and the one that names them only in its payload. security_invoker: RLS on the tables underneath is what scopes it.';

grant select on public.customer_activity to authenticated;

-- ---------------------------------------------------------------------------
-- The second tool
-- ---------------------------------------------------------------------------

-- M8's criterion names two questions and this is the other one: *which customers have not been
-- contacted in thirty days*. Like `work_at_risk` it is `stable` and `security invoker`, so it
-- cannot write and cannot see a row its caller could not (D34).
--
-- **Thirty days is the caller's argument and not this platform's opinion.** A business that
-- chases weekly and one that chases quarterly are both ordinary, and a constant here would be
-- the hardcoding this repository refuses everywhere else.
--
-- **What "contacted" means here is *nothing has been recorded about them*, and that is narrower
-- than it sounds -- deliberately.** The platform does not know whether somebody telephoned; it
-- knows what it was told. So this answers from the same events the customer's own timeline
-- shows, which means an operator can always click through and see exactly why a name is on the
-- list. A cleverer definition that a screen could not corroborate would be worse.
--
-- **The `max()` in here is not the aggregate layer M7 owns, and the line is worth stating.** M7
-- is about reports a *tenant defines* -- entity, fields, filters, grouping, period, chosen by an
-- operator and saved. This is one fixed question with one parameter. When a tenant can choose the
-- grouping, it belongs to M7 and this kind of function calls it rather than growing one.
create function public.customers_not_contacted(
  p_organization_id uuid,
  p_days integer default 30
)
returns table (
  customer_id   uuid,
  name          text,
  email         text,
  phone         text,
  last_activity timestamptz,
  days_since    integer
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
         -- Null for a customer nothing has ever been recorded about. Rare rather than dead:
         -- adding somebody writes `customer.created`, so every customer added through the
         -- application has at least that. It is kept for the row that arrives another way --
         -- an import is exactly the case D33 names -- and because "never" and "a long time
         -- ago" are different answers that should not be flattened into one number.
         case
           when max(a.occurred_at) is not null
             then extract(day from now() - max(a.occurred_at))::integer
         end
    from public.customers c
    left join public.customer_activity a
      on a.organization_id = c.organization_id
     and a.customer_id = c.id
   where c.organization_id = p_organization_id
   group by c.id, c.name, c.email, c.phone
  having max(a.occurred_at) is null
      or max(a.occurred_at) < now() - make_interval(days => greatest(p_days, 0))
   -- Longest silence first, and never-heard-from at the very top. That is the order somebody
   -- reading the answer wants to act in.
   order by max(a.occurred_at) asc nulls first;
$fn$;

comment on function public.customers_not_contacted(uuid, integer) is
  'Customers with nothing recorded about them for a given number of days, from the same events their own timeline shows. A tool: stable, security invoker, narrowed by RLS rather than by its argument. See D34.';

revoke execute on function public.customers_not_contacted(uuid, integer) from public;
grant execute on function public.customers_not_contacted(uuid, integer) to authenticated;

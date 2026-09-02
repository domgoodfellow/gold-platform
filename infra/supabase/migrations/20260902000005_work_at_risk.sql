-- The first thing a language model may call, and the shape every tool after it copies.
--
-- `constraints.md` D34 holds the reasoning. What this file is responsible for is the half the
-- database can enforce, and there are three halves worth naming because each of them is a way
-- this could have been built that looks identical from the outside and is not.
--
-- **A tool is a function here, not a query in the other runtime.** The loop runs in `apps/api`
-- and holds this function's name and its arguments -- no SQL, and nothing it does to the answer
-- afterwards. The reason is the first non-negotiable in CLAUDE.md: *at risk of being late* is a
-- definition, and a definition living in Python is business logic in the wrong place. When M7's
-- aggregate layer arrives, a tool that wants a total calls it from here; a tool that computes
-- one in the loop is the second aggregate layer I4 and I5 exist to prevent, one level up.
--
-- **`stable` is the enforcement, and it is Postgres that enforces it rather than review.** An
-- `insert`, `update` or `delete` inside a non-volatile function is refused when the function
-- runs -- *DELETE is not allowed in a non-volatile function* -- so I14's claim that a tool
-- cannot write is a property of the object in the catalogue rather than a promise somebody
-- re-reads each time a tool is added.
--
-- Two things that were checked rather than assumed, because the difference decides what the
-- test has to do. The refusal happens at **execution**, not at creation: `create function` will
-- accept a `stable` function containing a write, in `sql` and in `plpgsql` alike, and the error
-- arrives the first time somebody calls it. And a tool declared `volatile` would of course be
-- allowed to write. So the catalogue is where this is caught: `ai-tools.test.ts` reads
-- `provolatile` for every registered tool name, and a tool added `volatile` by habit fails the
-- gate rather than failing in front of a customer.
--
-- **`security invoker`, and the argument is not what narrows.** This is the part that matters
-- most and is the easiest to get wrong. A model chooses a tool's arguments -- so if
-- `p_organization_id` were what kept a caller inside their own business, then the protection
-- would be a value the model made up. It is not: RLS decides, the caller's own JWT is what RLS
-- reads (D17), and passing another tenant's id returns nothing at all rather than returning
-- their work. The parameter says *which of your businesses*, and never *whose*.
--
-- **A tool's joins are part of what it discloses**, and that was found by testing rather than
-- reasoned out in advance. This function joins `work_item_statuses` to report a job's status in
-- the tenant's own words -- and a portal customer, who may read their own work items but has
-- never been able to read the business's internal board vocabulary, therefore gets nothing back
-- at all rather than a narrowed list. That is the right answer and the general rule is worth
-- keeping: each joined table's own policies apply, so a tool assembled from tables a caller can
-- only partly read answers *less*, never wrongly. A tool that wanted to answer such a caller
-- would have to be built from tables they can actually see, which is a different tool.
--
-- That is also why this axis has no Postgres role of its own. The two machine writers in this
-- schema -- `payment_webhook` and `automation_runner` -- hold one because no person is present.
-- Here a person always is, and a machine role would have to be handed an organization id to
-- filter by, which is precisely the mistake above wearing an identity.
--
-- **Every threshold in here belongs to the tenant.** There is no platform opinion about
-- lateness, no grace period and no working day: what makes a job late is that its own booked
-- window has passed while the status the business configured still holds the resource, or that
-- it is booked for today with nobody assigned to it. `releases_resource` is the tenant's answer
-- to "is this work still occupying its resource" (`20260829000001`), and it is the only
-- judgement this function makes use of -- which is what keeps a hardcoded business hour from
-- arriving here dressed as a definition of risk.

create function public.work_at_risk(p_organization_id uuid)
returns table (
  work_item_id   uuid,
  title          text,
  status         text,
  reason         text,
  scheduled_from timestamptz,
  scheduled_to   timestamptz,
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
         -- Platform vocabulary, legitimately so: this names what the *platform* noticed, not
         -- what the business calls anything. The same standing `automation_runs.outcome` has.
         case
           when upper(w.scheduled_during) <= now() then 'window_passed'
           else 'nobody_assigned'
         end,
         lower(w.scheduled_during),
         upper(w.scheduled_during),
         r.name,
         c.name
    from public.work_items w
    join public.work_item_statuses s
      on s.organization_id = w.organization_id
     and s.id = w.status_id
    join public.organizations o
      on o.id = w.organization_id
    -- Both optional on the row and both optional here. Unassigned work is the ordinary state of
    -- a job that has just arrived, and internal work has no customer.
    left join public.resources r
      on r.organization_id = w.organization_id
     and r.id = w.resource_id
    left join public.customers c
      on c.organization_id = w.organization_id
     and c.id = w.customer_id
   where w.organization_id = p_organization_id
     -- Nothing unscheduled can be late. A job nobody has put in the diary is a job nobody has
     -- promised anything about, and reporting it here would bury the ones that are.
     and w.scheduled_during is not null
     -- The tenant's own answer, and the whole of this function's judgement. Work in a status
     -- the business marked as releasing its resource is finished, cancelled or otherwise off
     -- the board -- by that business's definition rather than by the platform's.
     and not w.status_releases_resource
     and (
       upper(w.scheduled_during) <= now()
       or (
         w.resource_id is null
         -- "Today" is a wall-clock question and gets the business's own zone; the instants it
         -- is asked about stay absolute (I9). A yard in Amsterdam and a clinic in Tokyo are
         -- asking two different questions with these same words, which is the point.
         and (lower(w.scheduled_during) at time zone o.timezone)::date
             = (now() at time zone o.timezone)::date
       )
     )
   -- Soonest first: the answer is read aloud to somebody deciding what to do next.
   order by lower(w.scheduled_during);
$fn$;

comment on function public.work_at_risk(uuid) is
  'Work whose booked window has passed while its status still holds the resource, and work booked for today with nobody assigned. A tool: stable, security invoker, and narrowed by RLS rather than by its argument. See D34.';

-- Postgres grants execute on a new function to PUBLIC, which the automation privilege test
-- found the expensive way (D30). Harmless here -- this reads nothing RLS would not already show
-- the caller -- but an anonymous visitor has no business asking, and a tool whose grants are
-- explicit is one whose grants can be asserted.
revoke execute on function public.work_at_risk(uuid) from public;
grant execute on function public.work_at_risk(uuid) to authenticated;

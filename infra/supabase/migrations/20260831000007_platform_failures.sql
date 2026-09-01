-- What is failing, on the console — the quarter of M5's criterion it deferred to here.
--
-- **The deferral was right and the reason it gave has now expired.** M5 could answer three of
-- its four questions — who exists, what they have switched on, when they last did anything — and
-- not the fourth, because nothing in this schema recorded a failure: a `DomainError` was raised,
-- rendered to whoever caused it, and dropped. A failed-thing table then would have been a table
-- with no writer, which is the speculative abstraction `constraints.md` opens by refusing.
--
-- M6 supplies the writer. An automation is the first thing this platform does that fails **with
-- nobody watching**: a scheduled evaluation that did not fire is a failure no tenant reports and
-- no screen shows. `automation_runs` and `message_deliveries` already record theirs, each with
-- the database's or the provider's own words. This migration is the reader.
--
-- **It adds no table.** That is worth stating, because "give the console a failures table" is the
-- obvious shape and it would have been a second copy of two tables that already exist — and the
-- copy would drift the first time one of them learned a new outcome.

-- ---------------------------------------------------------------------------
-- What staff may read
-- ---------------------------------------------------------------------------

-- **`select` and nothing else, on both halves of I21.** No write policy names this role, *and*
-- the role holds no `insert`, `update` or `delete` grant on any of these tables — so a
-- permissive policy added later still hits a missing privilege. That second half is what
-- survives a careless policy author, and `platform-staff.test.ts` asserts the `permission denied`
-- message rather than merely a failure.
grant select on public.automation_rules      to platform_staff;
grant select on public.automation_runs       to platform_staff;
grant select on public.message_deliveries    to platform_staff;

-- `using (true)` is correct here and nowhere else: the narrowing is the *role*, not the row. A
-- staff policy calling `app.has_capability` would be asking a tenant's authorization question on
-- an axis that has no role to ask about (D28).
create policy automation_rules_platform_select on public.automation_rules
  for select to platform_staff using (true);

create policy automation_runs_platform_select on public.automation_runs
  for select to platform_staff using (true);

create policy message_deliveries_platform_select on public.message_deliveries
  for select to platform_staff using (true);

-- **`message_templates` is deliberately absent, and so is every reading.** A template is what a
-- business says to its own customers, and a delivery's body is what it said — neither is
-- something GOLD needs in order to know that a thing failed. The console reads the *fact* of a
-- failure and its cause; it does not read the mail. Adding those grants would be easy and would
-- need an argument nobody has made.

-- ---------------------------------------------------------------------------
-- The failures view
-- ---------------------------------------------------------------------------

-- **`security_invoker`, and it must stay so** — the same requirement `platform_tenants` carries
-- and for the same reason: a view defaults to running as its owner, which would make it the
-- service-role client D14 and D28 both refuse, with extra steps. With it, a member selecting
-- from this view sees their own business's failures and nobody else's, staff see all of them,
-- and an outsider sees nothing. The view grants no visibility of its own.
--
-- Two sources, one shape. A run that failed and a message that was refused are the same question
-- asked of two tables, and joining them here rather than in two screens is what stops the console
-- growing a second idea of what "failing" means.
create view public.platform_failures
with (security_invoker = true) as
  select 'automation'::text as kind,
         r.organization_id,
         r.occurred_at,
         r.rule_name  as subject,
         r.detail
    from public.automation_runs r
   where r.outcome = 'failed'
  union all
  select 'message'::text,
         d.organization_id,
         d.queued_at,
         d.rule_name,
         d.detail
    from public.message_deliveries d
   where d.state = 'failed';

comment on view public.platform_failures is
  'Automation runs and message deliveries that failed, across every tenant a caller can see. security_invoker: RLS on the underlying tables is the boundary. Adds no table -- see the migration header.';

grant select on public.platform_failures to platform_staff;
grant select on public.platform_failures to authenticated;

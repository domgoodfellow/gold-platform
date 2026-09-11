-- The platform console can already say who exists, when they arrived, what they switched on,
-- and when they last did anything (`platform_tenants`, M5). It cannot yet say which of them are
-- still being configured -- `organizations.operational_state` (`setup`/`live`, M11's readiness
-- work) was never added to this view, so the one column that answers "is this tenant still
-- being set up" was unreachable from the console that exists to answer exactly that.
--
-- **Widening a view, not adding a calculation.** `operational_state` already exists, is already
-- forward-only (`launch_organization`), and is already `security_invoker`-safe -- this migration
-- adds one column to an existing `select`, nothing else. The view's own comment already excludes
-- "how is this tenant doing" as out of scope (that is M7's aggregate layer); *is it still being
-- set up or running for real* is squarely "does this tenant exist and is it alive," which is what
-- this view was always for.

create or replace view public.platform_tenants
with (security_invoker = true) as
select o.id,
       o.name,
       o.created_at,
       o.timezone,
       o.currency,
       o.slug,
       coalesce(
         (select array_agg(m.module_key order by m.module_key)
            from public.organization_modules m
           where m.organization_id = o.id),
         array[]::text[]
       ) as module_keys,
       (select max(e.occurred_at)
          from public.events e
         where e.organization_id = o.id) as last_activity_at,
       -- Appended, not inserted where it reads best: `create or replace view` refuses to change
       -- the name or position of an existing output column (42P16), so a widening migration can
       -- only ever add to the end of the list.
       o.operational_state
  from public.organizations o;

comment on view public.platform_tenants is
  'One row per tenant for the platform console: existence, arrival, lifecycle state, modules, last activity. Runs security_invoker, so RLS on the underlying tables is the boundary. Not the aggregate layer -- see roadmap.md M7.';

grant select on public.platform_tenants to platform_staff;

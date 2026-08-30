-- The tenant list: who exists, when they arrived, what they have switched on, and when they
-- last did anything.
--
-- Those four are `roadmap.md` M5's own words and they are the whole scope. **This is not the
-- aggregate layer**, which is M7, and the reason to say so in a comment is that the difference
-- is one `count(*)` wide: revenue by tenant, jobs this week, seats used — each is one line from
-- here and each would be the second aggregate layer M7 exists to prevent. What separates them
-- is that everything below answers *does this tenant exist and is it alive*, and nothing below
-- answers *how is this tenant doing*.
--
-- **`security_invoker` is what keeps this honest.** A view without it runs as its owner, which
-- would make it a service-role client with extra steps — the precise thing D14 refuses and D28
-- refuses again. With it, the view executes under the caller's own role and every policy on
-- `organizations`, `organization_modules` and `events` still applies. A member selecting from
-- this view sees their own organizations; `platform_staff` sees all of them; an outsider sees
-- nothing. The view grants no visibility of its own, which is why granting it broadly is safe.

create view public.platform_tenants
with (security_invoker = true) as
select o.id,
       o.name,
       o.created_at,
       o.timezone,
       o.currency,
       o.slug,
       -- What this business switched on, in a stable order so two reads agree.
       coalesce(
         (select array_agg(m.module_key order by m.module_key)
            from public.organization_modules m
           where m.organization_id = o.id),
         array[]::text[]
       ) as module_keys,
       -- "When they last did anything", which is the question the milestone asks and the only
       -- reason `events` is on the console's grant list. Null means a business that was created
       -- and has done nothing since -- which `create_organization` makes impossible today, and
       -- which the screen should still be able to render rather than assume away.
       (select max(e.occurred_at)
          from public.events e
         where e.organization_id = o.id) as last_activity_at
  from public.organizations o;

comment on view public.platform_tenants is
  'One row per tenant for the platform console: existence, arrival, modules, last activity. Runs security_invoker, so RLS on the underlying tables is the boundary. Not the aggregate layer -- see roadmap.md M7.';

grant select on public.platform_tenants to platform_staff;

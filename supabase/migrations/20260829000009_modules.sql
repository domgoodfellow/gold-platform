-- Module enablement: what a business has switched on.
--
-- **This was M3's and M3 removed it, for a reason about the wrong noun.** The argument was
-- that there were no modules to enable, because the ownership table in `domain-model.md` was
-- empty and a module needs two independent pieces of evidence with one from a system that
-- shipped. Every clause of that is true about an **engine** -- a body of code that owns
-- entities and rules -- and module enablement is not a claim about code at all. See
-- `constraints.md` D25 for the collision and `roadmap.md` M3 for what it cost.
--
-- **A module is a row, not a directory.** It is what a tenant switches on, sees in their
-- navigation, and is billed for. `vision.md` prices `platform fee + modules + usage`; D21
-- prices partial adoption against this mechanism and has had nothing behind it since M3.
--
-- **This is not authorization, and the distinction is the whole design.** A member who lacks
-- `field.manage` still sees that fields exist and is told why the form is not theirs -- that
-- is I12, and hiding it instead would make the UI the boundary. A module a business has not
-- enabled is *not part of that business*, so there is nothing to explain and nobody to explain
-- it to. The two look identical on a screen and are opposite in the database: capabilities are
-- checked by `app.has_capability` inside RLS, and nothing below is ever consulted by a policy.

-- ---------------------------------------------------------------------------
-- What may be enabled
-- ---------------------------------------------------------------------------

-- Platform vocabulary, like `roles_capabilities_known` one table over: each key names an area
-- of this application that actually exists. A key here with no `AREAS` entry is a promise the
-- billing page makes and the product does not keep, which is why `navigation.test.ts` fails on
-- a module naming no area and on an area naming no module.
--
-- **Deliberately not seeded from `starting_conversation.txt`'s list.** Inventory, Maintenance,
-- Dispatch and Weather are all real modules eventually; none of them is a screen today, and a
-- key nobody can switch on is the speculative abstraction `constraints.md` opens by refusing.
create table public.organization_modules (
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  module_key      text        not null check (module_key ~ '^[a-z][a-z_]{1,40}$'),

  -- When, because billing will ask and because "since when" is the first question about a
  -- charge somebody disputes. Not a boolean `enabled` column: a module that is off is a row
  -- that is absent, so there is no third state where a row says false and something reads it
  -- as true.
  enabled_at      timestamptz not null default now(),
  enabled_by      uuid        not null references auth.users (id),

  -- `organization_id` leads it because it is the primary key (I2). Two businesses enabling
  -- the same module is the ordinary case.
  primary key (organization_id, module_key)
);

comment on table public.organization_modules is
  'What a business has switched on. A row is enablement; absence is not. Never consulted by any RLS policy -- this is billing and navigation, not authorization (D25).';

alter table public.organization_modules enable row level security;
alter table public.organization_modules force row level security;

create policy organization_modules_select on public.organization_modules
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- `organization.manage`, because what a business has bought is a settings question and the
-- role that changes the currency is the role that changes this.
create policy organization_modules_insert on public.organization_modules
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and enabled_by = (select auth.uid())
    and app.has_capability(organization_id, 'organization.manage')
  );

create policy organization_modules_delete on public.organization_modules
  for delete to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'organization.manage')
  );

-- No update policy. Switching a module off and on again is two rows in `events` and a new
-- `enabled_at`, which is what a billing question actually needs; an updated row would lose the
-- fact that it was ever off.
grant select, insert, delete on public.organization_modules to authenticated;

-- ---------------------------------------------------------------------------
-- What every business starts with
-- ---------------------------------------------------------------------------

-- **A founding business gets the operational core and nothing else**, and the split is not
-- arbitrary: the modules seeded below are the ones whose absence would leave an operator with
-- no way to record that work happened. Everything a business might *not* want -- the public
-- booking page, the customer portal, card payments -- starts off, because publishing a page to
-- the internet is not a default anybody should acquire by signing up.
--
-- Existing organizations are backfilled with the same set plus the ones they are evidently
-- already using, so nothing disappears from a live business the moment this ships.
create function app.enable_default_modules(p_organization_id uuid, p_actor uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $fn$
  insert into public.organization_modules (organization_id, module_key, enabled_by)
  select p_organization_id, key, p_actor
  from unnest(array['work', 'scheduling', 'customers', 'billing']) as key
  on conflict do nothing;
$fn$;

comment on function app.enable_default_modules(uuid, uuid) is
  'The operational core, switched on at founding. Booking, the portal and card payments are deliberately not in it: publishing to the internet is not a default.';

-- Every business that already exists, plus what it is visibly already doing. A business with a
-- public slug has a booking page today, and taking it away would be this migration deciding
-- something about a live tenant.
insert into public.organization_modules (organization_id, module_key, enabled_by)
select o.id, key, m.user_id
from public.organizations o
cross join lateral unnest(array['work', 'scheduling', 'customers', 'billing']) as key
join lateral (
  select ms.user_id from public.memberships ms
  where ms.organization_id = o.id
  order by ms.created_at
  limit 1
) m on true
on conflict do nothing;

insert into public.organization_modules (organization_id, module_key, enabled_by)
select o.id, 'booking', m.user_id
from public.organizations o
join lateral (
  select ms.user_id from public.memberships ms
  where ms.organization_id = o.id
  order by ms.created_at
  limit 1
) m on true
where o.slug is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- create_organization switches the core on
-- ---------------------------------------------------------------------------

-- Replaced rather than triggered. A trigger on `organizations` would put a business decision
-- in the database, which `constraints.md` refuses -- "constraints enforce invariants; triggers
-- that quietly perform business steps hide the process from everyone reading the application".
-- Which modules a new business starts with is exactly such a step, so it is a visible line in
-- the founding function.
create or replace function public.create_organization(
  p_name         text,
  p_role         text,
  p_capabilities text[],
  p_display_name text,
  p_timezone     text,
  p_currency     text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_role  uuid;
begin
  if v_actor is null then
    raise exception 'create_organization requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Timezone coalesces and currency does not, and the asymmetry is the point. UTC is the
  -- absence of an assumption about a business; there is no neutral currency, so a platform
  -- default would be the platform deciding what this business trades in.
  if p_currency is null then
    raise exception 'an organization must say what currency it trades in'
      using errcode = '23514';
  end if;

  insert into public.organizations (name, timezone, currency, created_by)
  values (p_name, coalesce(p_timezone, 'UTC'), p_currency, v_actor)
  returning id into v_org;

  insert into public.roles (organization_id, name, capabilities, created_by)
  values (v_org, p_role, p_capabilities, v_actor)
  returning id into v_role;

  insert into public.memberships
    (organization_id, user_id, role_id, display_name, created_by)
  values (v_org, v_actor, v_role, p_display_name, v_actor);

  -- The operational core, and nothing that publishes anything.
  perform app.enable_default_modules(v_org, v_actor);

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'organization', v_org, 'organization.created',
     jsonb_build_object(
       'name', p_name, 'role', p_role, 'timezone', p_timezone, 'currency', p_currency
     ));

  return v_org;
end;
$fn$;

revoke all on function public.create_organization(text, text, text[], text, text, text) from public;
grant execute on function public.create_organization(text, text, text[], text, text, text) to authenticated;

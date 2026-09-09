-- The fourth kind of caller: the people who run GOLD rather than a business on it.
--
-- D28 decides the shape and this migration is it. Three caller shapes already exist and every
-- one of them is narrow *by construction*: a **member** scoped by `app.current_tenant_ids()`
-- reading `memberships`; an **external actor** scoped by `app.current_external_tenant()` and
-- bound to exactly one tenant; and a **machine writer**, `payment_webhook`, holding no table
-- grant at all and one `execute`. Platform staff need the opposite -- read across every tenant
-- -- and are members of none, so `app.current_tenant_ids()` returns nothing for them and every
-- policy in this database declines.
--
-- **It reads. It writes nothing that belongs to a tenant**, and that is enforced twice: no
-- write policy names this role, and -- the half that survives a careless policy author -- the
-- role holds no `insert`, `update` or `delete` grant on any table at all. A policy permitting a
-- staff write would still hit a missing privilege. D28's trigger to revisit is the first thing
-- staff must *write*, and this migration deliberately does not grant one.
--
-- **Rejected here as there: a service-role client.** D14 refuses it generally and the argument
-- is worse for a console -- a key that bypasses RLS makes the blast radius of one bad staff
-- route the whole database rather than the rows the screen meant to show. And rejected: giving
-- staff a membership in every tenant, which is cheapest, and which writes our employees into
-- each customer's own list of who works at their business.

-- ---------------------------------------------------------------------------
-- Who is staff
-- ---------------------------------------------------------------------------

-- **No policy grants anyone write access to this table, and that is the design.** Adding a
-- colleague is a privileged operation performed with database access, exactly as publishing a
-- bookable type was before it had a screen -- see `supabase/snippets/`. A screen for it is
-- a *staff write*, which is precisely the decision D28 says this record does not make.
--
-- It carries no `organization_id` and never will: the whole point of this axis is that it is
-- not scoped to a tenant. That also puts it outside I2, which governs tenant-owned tables.
create table public.platform_staff (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  -- What to call this person on a screen. Not read from `auth.users`: this repository owns no
  -- users table (D19) and an email is not a name.
  name       text        not null check (length(btrim(name)) between 1 and 200),
  created_at timestamptz not null default now()
);

comment on table public.platform_staff is
  'The people who run GOLD. Read by the access-token hook to put them in the platform_staff Postgres role. Written only with database access -- a staff write is a decision D28 does not make.';

alter table public.platform_staff enable row level security;
alter table public.platform_staff force row level security;

-- ---------------------------------------------------------------------------
-- The role
-- ---------------------------------------------------------------------------

-- Declared the way `payment_webhook` already is (20260829000008). PostgREST switches into the
-- role named by the JWT's `role` claim, so "its own Postgres role" means: the hook below writes
-- that claim, and the caller reaches the database as this role. D17 is applied rather than
-- bypassed -- identity still arrives as the caller's own JWT.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'platform_staff') then
    create role platform_staff nologin noinherit;
  end if;
end
$$;

grant platform_staff to authenticator;
grant usage on schema public to platform_staff;

-- **Select, and nothing else, on the four tables the console reads.** No sequence grants, no
-- function grants, and deliberately no `app` schema usage: a staff policy that needed
-- `app.has_capability` would be asking a tenant's authorization question on an axis that has no
-- role to ask about.
grant select on public.organizations        to platform_staff;
grant select on public.memberships          to platform_staff;
grant select on public.organization_modules to platform_staff;
grant select on public.events               to platform_staff;
grant select on public.platform_staff       to platform_staff;

-- ---------------------------------------------------------------------------
-- What staff may read
-- ---------------------------------------------------------------------------

-- `using (true)` reads oddly next to every other policy in this schema, and it is the correct
-- predicate exactly once: this role's entire purpose is cross-tenant read, and it is reachable
-- only by a user the hook found in `platform_staff`. The narrowing is the role, not the row.
create policy organizations_platform_select on public.organizations
  for select to platform_staff using (true);

create policy memberships_platform_select on public.memberships
  for select to platform_staff using (true);

create policy organization_modules_platform_select on public.organization_modules
  for select to platform_staff using (true);

-- "What is failing" is the milestone's third question and `events` is where the answer lives.
create policy events_platform_select on public.events
  for select to platform_staff using (true);

create policy platform_staff_self_select on public.platform_staff
  for select to platform_staff using (true);

-- ---------------------------------------------------------------------------
-- How a staff member arrives in that role
-- ---------------------------------------------------------------------------

-- Supabase's custom access token hook: GoTrue calls this while minting a token and takes back
-- whatever claims it returns. Setting `role` is what makes PostgREST switch -- the same
-- mechanism `payment_webhook` uses, except that this repository does not hold the signing
-- secret for a human's session and must not (the web app holds the anon key only).
--
-- **It runs for every token this project issues**, including anonymous booking visitors, so the
-- default path must be a no-op and is: one lookup, and the event returned untouched unless the
-- caller is staff.
--
-- **A staff member is a different account from an operator account, and that is a consequence
-- worth stating rather than discovering.** This claim replaces `authenticated`, so somebody who
-- is both staff and a member of an organization loses the membership half while signed in --
-- their tenant policies key on a role they are no longer wearing. That is D28 working as
-- designed: our people are not in a customer's list of who works there. One human who both runs
-- GOLD and operates a tenant needs two sign-ins.
create function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_claims jsonb;
begin
  if exists (
    select 1 from public.platform_staff s
     where s.user_id = (event ->> 'user_id')::uuid
  ) then
    v_claims := event -> 'claims';
    v_claims := jsonb_set(v_claims, '{role}', '"platform_staff"');
    event := jsonb_set(event, '{claims}', v_claims);
  end if;

  return event;
end;
$fn$;

comment on function public.custom_access_token_hook(jsonb) is
  'Puts a user listed in platform_staff into the platform_staff Postgres role by rewriting the token role claim. A no-op for everyone else. Enabled in supabase/config.toml.';

-- Only GoTrue may call it, and it is not part of any application surface.
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- The hook reads `platform_staff` as GoTrue's own role, so it needs both the grant and a policy
-- -- FORCE row level security applies to the definer too.
grant select on public.platform_staff to supabase_auth_admin;

create policy platform_staff_auth_admin_select on public.platform_staff
  for select to supabase_auth_admin using (true);

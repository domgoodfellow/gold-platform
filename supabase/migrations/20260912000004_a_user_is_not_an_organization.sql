-- A person exists once in GOLD, independently of every business they belong to.
--
-- `auth.users` remains the credential authority. `memberships` remains the answer to what one
-- organization calls a person and what that membership may do there. This table is deliberately
-- neither: it is the application-owned, global profile for the human behind the Auth user.
--
-- The row exists before onboarding succeeds. Email verification and profile-completeness gates are
-- later slices; making the row's existence depend on either would turn a failed client request into
-- a permanently partial account.

create table public.user_profiles (
  user_id        uuid        primary key references auth.users (id) on delete cascade,
  full_name      text,
  preferred_name text,
  -- Reserved for the avatar slice. Authenticated callers receive no UPDATE grant on this column in
  -- this migration, so introducing the storage policy later cannot be bypassed by typing a path.
  avatar_path    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint user_profiles_full_name_length
    check (full_name is null or length(btrim(full_name)) between 1 and 200),
  constraint user_profiles_preferred_name_length
    check (preferred_name is null or length(btrim(preferred_name)) between 1 and 120),
  constraint user_profiles_avatar_path_length
    check (avatar_path is null or length(btrim(avatar_path)) between 1 and 500)
);

comment on table public.user_profiles is
  'The global application profile for one auth.users identity. Never organization-owned and never the credential authority.';

alter table public.user_profiles enable row level security;
alter table public.user_profiles force  row level security;

create policy user_profiles_select_self on public.user_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy user_profiles_update_self on public.user_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Reading the whole self-owned row is fine. Writing is intentionally narrower: avatar_path gets
-- its own operation once a private storage bucket exists, while ids and timestamps stay database-owned.
grant select on public.user_profiles to authenticated;
grant update (full_name, preferred_name) on public.user_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- One profile for every Auth user, including users created before this migration
-- ---------------------------------------------------------------------------

create function app.ensure_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.user_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$fn$;

revoke all on function app.ensure_user_profile() from public, anon, authenticated;

create trigger auth_user_gets_profile
  after insert on auth.users
  for each row execute function app.ensure_user_profile();

-- Backfill first-class profiles for identities that already existed when this slice arrived.
-- ON CONFLICT keeps this safe if a development database replays equivalent seed/setup work around
-- the migration and, importantly, never overwrites profile values written later.
insert into public.user_profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------------------
-- updated_at is a database fact, not a value a browser may choose
-- ---------------------------------------------------------------------------

create function app.touch_user_profile_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

revoke all on function app.touch_user_profile_updated_at() from public, anon, authenticated;

create trigger user_profiles_touch_updated_at
  before update on public.user_profiles
  for each row execute function app.touch_user_profile_updated_at();

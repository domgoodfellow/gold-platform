-- Personal appearance: no organization ownership, no automatic row creation.
create table public.account_appearance_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  appearance text not null default 'system' check (appearance in ('system', 'light', 'dark')),
  preset text check (preset in ('minimal', 'layered', 'expressive')),
  density text check (density in ('compact', 'comfortable')),
  shape text check (shape in ('square', 'rounded', 'soft')),
  motion text check (motion in ('system', 'reduced')),
  updated_at timestamptz not null default now()
);
alter table public.account_appearance_preferences enable row level security;
alter table public.account_appearance_preferences force row level security;
revoke all on public.account_appearance_preferences from anon;
grant select, insert, update, delete on public.account_appearance_preferences to authenticated;
create policy appearance_owner on public.account_appearance_preferences for all to authenticated
  using (user_id = (select auth.uid()) and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, true))
  with check (user_id = (select auth.uid()) and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, true));
comment on table public.account_appearance_preferences is
  'Private account appearance. Absence preserves legacy defaults; reset deletes the row. Never organization branding or public website design.';

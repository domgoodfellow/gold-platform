-- Support access is separate from membership, and it is a session — explicit, auditable and
-- expiring — never a bare fact about who is listed in `platform_staff` (D45).
--
-- **What this is not.** It does not widen what `platform_staff` may read. Staff already read
-- `organizations`, `memberships`, `organization_modules`, `events` and `platform_staff` in full
-- (D28, restated under 20260915000001 as policy rather than privilege). This table adds nothing
-- to that list — it only records *that* and *why* a staff member opened one particular business,
-- so the platform console can show it back to them rather than a click leaving no trace. Reaching
-- a tenant's own operational data (customers, work items, and the rest) is deliberately still
-- outside what this migration touches — extending `platform_staff`'s reads table by table is its
-- own future slice, named rather than done here.

create table public.platform_support_sessions (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  staff_user_id   uuid        not null references auth.users (id),
  reason          text        check (reason is null or length(btrim(reason)) > 0),
  started_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '4 hours'),
  ended_at        timestamptz
);

comment on table public.platform_support_sessions is
  'An audited, time-boxed record of a staff member opening one organization from the platform console. Grants no additional read on any other table -- it is the "why were you looking" record, not a new access path.';

alter table public.platform_support_sessions enable row level security;
alter table public.platform_support_sessions force row level security;

-- Staff read their own sessions (to know if one is already active before starting another) and
-- every session for an organization they are actively supporting. No policy admits a tenant
-- member -- support sessions are a platform-side fact about platform staff, not something a
-- business reads about itself.
create policy platform_support_sessions_select on public.platform_support_sessions
  for select to authenticated
  using (app.is_platform_staff());

grant select on public.platform_support_sessions to authenticated;

-- No insert/update/delete grant to anyone, staff included -- the same shape D28 already uses for
-- everything staff may only touch through a narrow door.

create function public.start_support_session(
  p_organization_id uuid,
  p_reason          text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  perform app.require_platform_staff();

  insert into public.platform_support_sessions (organization_id, staff_user_id, reason)
  values (p_organization_id, (select auth.uid()), nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.start_support_session(uuid, text) is
  'Opens an audited support session on one organization. Staff-only (app.require_platform_staff). Grants no new read -- see the table comment.';

revoke all on function public.start_support_session(uuid, text) from public;
grant execute on function public.start_support_session(uuid, text) to authenticated;

create function public.end_support_session(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  update public.platform_support_sessions
     set ended_at = now()
   where id = p_id
     and staff_user_id = (select auth.uid())
     and ended_at is null;
end;
$fn$;

comment on function public.end_support_session(uuid) is
  'Ends a support session early. Only the staff member who started it may end it -- it also lapses on its own via expires_at.';

revoke all on function public.end_support_session(uuid) from public;
grant execute on function public.end_support_session(uuid) to authenticated;

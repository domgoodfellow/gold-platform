-- Native calendar appointments are independent of projected Follow-ups and Work commitments.
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace text not null check (workspace in ('crm','communications','marketing','support','field','finance','automations','ai','studio')),
  title text not null check (length(btrim(title)) between 1 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  notes text check (length(notes) <= 10000),
  status text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint calendar_events_positive_duration check (ends_at > starts_at)
);
create index calendar_events_organization_period on public.calendar_events(organization_id, starts_at, ends_at);
alter table public.calendar_events enable row level security;
alter table public.calendar_events force row level security;
create policy calendar_events_read on public.calendar_events for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));
create policy calendar_events_create on public.calendar_events for insert to authenticated
  with check (organization_id in (select app.current_tenant_ids()) and created_by = (select auth.uid()));
create policy calendar_events_update on public.calendar_events for update to authenticated
  using (organization_id in (select app.current_tenant_ids()) and
    (created_by = (select auth.uid()) or app.has_capability(organization_id, 'organization.manage')))
  with check (organization_id in (select app.current_tenant_ids()) and
    (created_by = (select auth.uid()) or app.has_capability(organization_id, 'organization.manage')));
revoke all on public.calendar_events from anon, authenticated;
grant select on public.calendar_events to authenticated;
grant insert (organization_id, workspace, title, starts_at, ends_at, notes, created_by) on public.calendar_events to authenticated;
-- Scope and attribution cannot be reassigned, including by an organization administrator.
grant update (title, starts_at, ends_at, notes, status) on public.calendar_events to authenticated;

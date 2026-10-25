-- Personal dashboard layout: how one person arranges one workspace's operational Dashboard in one
-- organization (widget order, width, height, presentation, hidden secondary widgets). Presentation
-- only: it grants nothing, reads no financial data, and is never an organization-owned saved report
-- dashboard (`dashboards`/`dashboard_reports`) or a personal appearance setting. Absence means the
-- product default; Reset deletes the row. The application validates the layout against the
-- workspace's widget registry before writing; these checks keep the stored shape bounded.
create table public.dashboard_layout_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  workspace text not null check (workspace in ('finance')),
  layout jsonb not null check (
    jsonb_typeof(layout) = 'object'
    and (layout->>'version') = '1'
    and jsonb_typeof(layout->'widgets') = 'array'
    and jsonb_array_length(layout->'widgets') between 1 and 40
    and octet_length(layout::text) <= 16384
  ),
  -- Increases on every save; a save names the revision it started from, so concurrent saves never silently overwrite.
  revision integer not null default 1 check (revision >= 1),
  updated_at timestamptz not null default now(),
  primary key (user_id, organization_id, workspace)
);

alter table public.dashboard_layout_preferences enable row level security;
alter table public.dashboard_layout_preferences force row level security;
revoke all on public.dashboard_layout_preferences from anon;
grant select, insert, update, delete on public.dashboard_layout_preferences to authenticated;

-- Only one's own rows, and only in an organization one currently belongs to.
create policy dashboard_layout_owner on public.dashboard_layout_preferences for all to authenticated
  using (
    user_id = (select auth.uid())
    and organization_id in (select app.current_tenant_ids())
    and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, true)
  )
  with check (
    user_id = (select auth.uid())
    and organization_id in (select app.current_tenant_ids())
    and not coalesce(((select auth.jwt())->>'is_anonymous')::boolean, true)
  );

comment on table public.dashboard_layout_preferences is
  'Personal operational-Dashboard layout per person, organization and workspace. Presentation only; never authorization, never an organization report dashboard, never appearance.';

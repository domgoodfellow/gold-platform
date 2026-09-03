-- A dashboard is a layout of pinned reports, and it has no audience of its own.
--
-- **The audience is derived rather than declared, and that is the design.** A second role list
-- here would be a second thing to keep in step with the first, and the day they disagreed the
-- answer would be whichever policy ran last. Instead the select policy asks whether *any* report
-- pinned to this dashboard is one the caller can read — a question `report_definitions_select`
-- already answers, under RLS, inside the subquery. So a dashboard appears for somebody exactly
-- when it has something on it for them.
--
-- The property that falls out is the one worth having: **one dashboard, and different people see
-- different tiles**, with nothing in application code deciding that. A screen that filtered its
-- own tiles would be a second, weaker copy of D36's rule and must not be added.
--
-- **The platform seeds no dashboard.** `roadmap.md` names four the source lists — executive,
-- operations, manager, employee — and names them as *configuration rather than four screens*.
-- Shipping them as rows would be the hardcoding `constraints.md` forbids arriving as a
-- convenience, exactly as a seeded status list or a starter catalogue would. A business builds
-- its own out of reports it saved, or has none.

create table public.dashboards (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  name            text        not null
                    check (length(btrim(name)) >= 1 and length(btrim(name)) <= 120),
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  constraint dashboards_org_id_unique unique (organization_id, id)
);

comment on table public.dashboards is
  'A named layout of saved reports. Holds no audience: who sees it follows from which of its reports they can read, so there is no second list to fall out of step. See D36.';

create unique index dashboards_org_name_unique
  on public.dashboards (organization_id, lower(name));

alter table public.dashboards enable row level security;
alter table public.dashboards force row level security;

create table public.dashboard_reports (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  dashboard_id    uuid        not null,
  report_id       uuid        not null,

  -- Where it sits. An integer the business sets, like `work_item_statuses.position` and for the
  -- same reason: order is the tenant's to decide and the platform has no opinion about it.
  position        integer     not null default 0,

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  constraint dashboard_reports_dashboard_same_org
    foreign key (organization_id, dashboard_id)
    references public.dashboards (organization_id, id) on delete cascade,
  -- `cascade` rather than `set null`: a pin to a report that no longer exists is not a tile with
  -- a gap, it is not a tile. The report itself keeps `set null` on its filters for the opposite
  -- reason — that report still means something with one fewer filter.
  constraint dashboard_reports_report_same_org
    foreign key (organization_id, report_id)
    references public.report_definitions (organization_id, id) on delete cascade
);

create unique index dashboard_reports_unique
  on public.dashboard_reports (organization_id, dashboard_id, report_id);

create index dashboard_reports_org_dashboard_idx
  on public.dashboard_reports (organization_id, dashboard_id, position);

alter table public.dashboard_reports enable row level security;
alter table public.dashboard_reports force row level security;

-- ---------------------------------------------------------------------------
-- Who sees a dashboard, asked as a question about its reports
-- ---------------------------------------------------------------------------

-- **The `exists` is the whole mechanism.** It joins `report_definitions`, whose own select policy
-- applies inside the subquery, so it is true only when at least one pinned report is one this
-- caller may read. A dashboard nobody has pinned anything readable to simply does not appear —
-- not hidden, not empty, absent — and its name does not leak either.
--
-- Its author and whoever manages reports always see it, for the reason they always see a report:
-- they can rebuild it, so hiding it protects nothing and would make it undeletable by the person
-- meant to delete it.
create policy dashboards_select on public.dashboards
  for select to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'report.read')
    and (
      created_by = (select auth.uid())
      or app.has_capability(organization_id, 'report.manage')
      or exists (
        select 1
        from public.dashboard_reports d
        join public.report_definitions r
          on r.organization_id = d.organization_id
         and r.id = d.report_id
        where d.organization_id = dashboards.organization_id
          and d.dashboard_id = dashboards.id
      )
    )
  );

create policy dashboards_insert on public.dashboards
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'report.manage')
  );

create policy dashboards_update on public.dashboards
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'report.manage')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'report.manage')
  );

create policy dashboards_delete on public.dashboards
  for delete to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'report.manage')
  );

-- **A pin is readable only when its report is**, which is what makes a tile disappear for the
-- wrong reader rather than render empty. The join is the same trick as above and it is doing the
-- real work: `report_definitions_select` runs inside it under this caller's own rights.
create policy dashboard_reports_select on public.dashboard_reports
  for select to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and exists (
      select 1
      from public.report_definitions r
      where r.organization_id = dashboard_reports.organization_id
        and r.id = dashboard_reports.report_id
    )
  );

create policy dashboard_reports_insert on public.dashboard_reports
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'report.manage')
  );

create policy dashboard_reports_delete on public.dashboard_reports
  for delete to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'report.manage')
  );

-- Column grants, not table-wide: `created_by` is what the insert policies pin to `auth.uid()`,
-- and a table-wide grant is a promise about every column these will ever have.
grant select on public.dashboards to authenticated;
grant insert (organization_id, name, created_by) on public.dashboards to authenticated;
grant update (name) on public.dashboards to authenticated;
grant delete on public.dashboards to authenticated;

grant select on public.dashboard_reports to authenticated;
grant insert (organization_id, dashboard_id, report_id, position, created_by)
  on public.dashboard_reports to authenticated;
grant update (position) on public.dashboard_reports to authenticated;
grant delete on public.dashboard_reports to authenticated;

-- A report is a row a business owns, and who may see it is a policy.
--
-- **D36 holds the decisions.** The short version: a definition holds a grouping, a period and up
-- to three filters, and that is the whole of what a report may say — because for this report set
-- the entity *is* the grouping, the fields are the three money columns, and the calculation is
-- the subtraction D35 owns. Four of §17's six are already fixed, so what is left is three columns
-- and a check constraint rather than a query language.
--
-- Nothing here computes anything. A saved report produces its figures by calling
-- `invoiced_and_incurred` with what it stored, which is D35's rule one level up.

-- ---------------------------------------------------------------------------
-- Which role the caller holds here
-- ---------------------------------------------------------------------------

-- `security definer` for exactly the reason `app.current_tenant_ids()` is: the policy below has
-- to know the caller's role, a policy that read `memberships` under RLS to find it is how
-- recursion arrives, and there is no version of this that a client can reach past — it takes an
-- organization and answers about `auth.uid()` only.
--
-- It takes the organization as an argument, so it is evaluated per row rather than lifted into an
-- InitPlan. That is the cost `app.has_capability` already carries and it is the right trade here:
-- a business has tens of saved reports, not thousands, and the alternative is a second way to
-- learn the same fact.
create function app.current_role_id(p_organization_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select m.role_id
  from public.memberships m
  where m.user_id = (select auth.uid())
    and m.organization_id = p_organization_id;
$fn$;

comment on function app.current_role_id(uuid) is
  'The role this caller holds in one organization, or null. Definer for the same reason current_tenant_ids is: a policy that read memberships under RLS to find it would recurse. See D36.';

revoke all on function app.current_role_id(uuid) from public;
grant execute on function app.current_role_id(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Authoring a report is not the same as reading one
-- ---------------------------------------------------------------------------

-- `report.read` is seeing figures; this is writing a definition other people will see, which is
-- closer to `role.manage` than to reading a number and is plausibly a different person. Unlike
-- `report.read` it has a table to put a policy on, so it satisfies I16 the ordinary way.
alter table public.roles drop constraint roles_capabilities_known;

alter table public.roles
  add constraint roles_capabilities_known
  check (capabilities <@ array[
    'customer.create',
    'role.manage',
    'field.manage',
    'location.create',
    'resource.create',
    'work_item.create',
    'asset.create',
    'document.create',
    'work_item.transition',
    'work_item.schedule',
    'work_item.record',
    'organization.manage',
    'price.manage',
    'work_item.price',
    'work_item.update',
    'invoice.issue',
    'payment.record',
    'automation.manage',
    'configuration.propose',
    'assistant.ask',
    'report.read',
    'report.manage'
  ]);

-- ---------------------------------------------------------------------------
-- The definition
-- ---------------------------------------------------------------------------

create table public.report_definitions (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,

  -- The business's own word for this report. The platform ships none and seeds none.
  name            text        not null
                    check (length(btrim(name)) >= 1 and length(btrim(name)) <= 120),

  -- Platform vocabulary, and a check constraint rather than an enum for the reason D6 gives:
  -- an enum is a migration to extend, and these do change when the aggregate learns a grouping.
  -- They are *not* tenant configuration -- a business does not invent a grouping, it picks one
  -- the database implements.
  grouping        text        not null
                    check (grouping in ('customer', 'service', 'resource', 'location')),
  period          text        not null check (period in ('month', 'year', 'all')),

  -- **Typed columns with composite keys, never JSON** (I18, D7). A filter naming a customer of
  -- another business has to be unrepresentable rather than merely unusual, and JSONB is what D7
  -- gives to fields a *tenant* declared -- a filter is platform vocabulary.
  customer_id     uuid,
  resource_id     uuid,
  location_id     uuid,

  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  -- The target a share row points at, so a role can only be attached to a report in its own
  -- business.
  constraint report_definitions_org_id_unique unique (organization_id, id),

  -- `set null` rather than `cascade`: deleting a customer must not silently delete a report
  -- somebody built a dashboard around. It widens to the whole business, which is visible on the
  -- screen, rather than disappearing, which is not.
  constraint report_definitions_customer_same_org
    foreign key (organization_id, customer_id)
    references public.customers (organization_id, id) on delete set null (customer_id),
  constraint report_definitions_resource_same_org
    foreign key (organization_id, resource_id)
    references public.resources (organization_id, id) on delete set null (resource_id),
  constraint report_definitions_location_same_org
    foreign key (organization_id, location_id)
    references public.locations (organization_id, id) on delete set null (location_id)
);

comment on table public.report_definitions is
  'A saved report: a grouping, a period and up to three filters. Holds no figures and no query -- it is arguments for invoiced_and_incurred, which is the one aggregate (D35, D36).';

create unique index report_definitions_org_name_unique
  on public.report_definitions (organization_id, lower(name));

create index report_definitions_org_created_idx
  on public.report_definitions (organization_id, created_at desc);

alter table public.report_definitions enable row level security;
alter table public.report_definitions force row level security;

-- ---------------------------------------------------------------------------
-- Who it is for
-- ---------------------------------------------------------------------------

create table public.report_definition_roles (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  report_id       uuid        not null,
  role_id         uuid        not null,
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  constraint report_definition_roles_report_same_org
    foreign key (organization_id, report_id)
    references public.report_definitions (organization_id, id) on delete cascade,
  constraint report_definition_roles_role_same_org
    foreign key (organization_id, role_id)
    references public.roles (organization_id, id) on delete cascade
);

comment on table public.report_definition_roles is
  'Which roles a report is for. Readable by any member of the business on purpose: a policy on report_definitions consulting a table only its own audience could read would be circular. What this discloses is a pair of ids; what stays hidden is the report. See D36.';

create unique index report_definition_roles_unique
  on public.report_definition_roles (organization_id, report_id, role_id);

create index report_definition_roles_org_role_idx
  on public.report_definition_roles (organization_id, role_id);

alter table public.report_definition_roles enable row level security;
alter table public.report_definition_roles force row level security;

-- ---------------------------------------------------------------------------
-- The audience, as a policy rather than as a filter in a page
-- ---------------------------------------------------------------------------

-- **A report a role may not see returns no row.** That is what makes the dashboard built on this
-- render what each viewer can read with nothing in code deciding it, and it is why a filter in a
-- page must never be added beside this — it would be a second, weaker copy of the rule.
--
-- Three clauses, in the order they narrow. The business, because everything here is I1. The
-- capability, because a report is figures and D35 gates figures. Then the audience: a report you
-- wrote, a report shared with your role, or any report at all if you are the person who manages
-- them — the last deliberately, because somebody who can create and share reports can recreate
-- one in ten seconds, so hiding it protects nothing and would make a report undeletable by the
-- person meant to delete it.
create policy report_definitions_select on public.report_definitions
  for select to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'report.read')
    and (
      created_by = (select auth.uid())
      or app.has_capability(organization_id, 'report.manage')
      or exists (
        select 1
        from public.report_definition_roles r
        where r.organization_id = report_definitions.organization_id
          and r.report_id = report_definitions.id
          and r.role_id = app.current_role_id(report_definitions.organization_id)
      )
    )
  );

create policy report_definitions_insert on public.report_definitions
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'report.manage')
  );

create policy report_definitions_update on public.report_definitions
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'report.manage')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'report.manage')
  );

create policy report_definitions_delete on public.report_definitions
  for delete to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'report.manage')
  );

-- Any member of the business may read the sharing rows; see the table comment for why, and D36
-- for the trade. Writing one is authoring, exactly as writing the report is.
create policy report_definition_roles_select on public.report_definition_roles
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy report_definition_roles_insert on public.report_definition_roles
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'report.manage')
  );

create policy report_definition_roles_delete on public.report_definition_roles
  for delete to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'report.manage')
  );

-- **Column grants rather than a table-wide one.** `id`, `created_at` and `created_by` are the
-- platform's to write: `created_by` is what the insert policy pins to `auth.uid()`, and a
-- table-wide grant is a promise about every column these tables will ever have — which is how
-- `external_actors.customer_id` and `work_items.scheduled_during` both became writable by
-- accident.
grant select on public.report_definitions to authenticated;
grant insert (organization_id, name, grouping, period, customer_id, resource_id, location_id, created_by)
  on public.report_definitions to authenticated;
grant update (name, grouping, period, customer_id, resource_id, location_id)
  on public.report_definitions to authenticated;
grant delete on public.report_definitions to authenticated;

grant select on public.report_definition_roles to authenticated;
grant insert (organization_id, report_id, role_id, created_by)
  on public.report_definition_roles to authenticated;
grant delete on public.report_definition_roles to authenticated;

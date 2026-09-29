-- ---------------------------------------------------------------------------
-- A discovery snapshot is state about an existing customer, never a second entity
-- ---------------------------------------------------------------------------
-- The commercial funnel (lead -> discovery -> proposed configuration -> commercial proposal ->
-- accepted) needs somewhere durable to hold what GildOps has learned about a prospective
-- customer before that customer has their own organization. This is not a new identity: a
-- prospective GildOps customer is an ordinary `customers` row inside GildOps's own organization
-- (D42 -- GildOps dogfoods as an ordinary tenant), and lead/prospect is already represented by
-- the tenant-defined `customer_stages` a business names for itself (`20260905000001`'s "there is
-- no leads table here and there must never be one").
--
-- `customer_discovery_snapshots` hangs one durable, growing document off that existing customer
-- row. It never mutates or replaces `customers`, and it names no organization of its own --
-- "pre-tenant" describes a customer who does not yet have their own GildOps organization, never
-- a customer floating free of every organization.

create table public.customer_discovery_snapshots (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  customer_id     uuid        not null,
  -- A plain document, not tenant custom fields (D7 does not apply -- this is GildOps's own
  -- internal sales-process data, the same class of thing as `configuration_proposals.shape`).
  -- TypeScript types the shape; Postgres holds it opaque.
  answers         jsonb       not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id),

  unique (organization_id, id),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete cascade
);

-- One snapshot per customer -- `answers` grows in place the same way `customers.custom` does.
-- Nothing in this slice needs a version history.
create unique index customer_discovery_snapshots_org_customer_unique
  on public.customer_discovery_snapshots (organization_id, customer_id);

alter table public.customer_discovery_snapshots enable row level security;
alter table public.customer_discovery_snapshots force row level security;

create policy customer_discovery_snapshots_select on public.customer_discovery_snapshots
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- Reuses `customer.update` rather than a new capability: naming what this business knows about a
-- customer is one job, the same reasoning `customer_stages` already applies by reusing
-- `field.manage`.
create policy customer_discovery_snapshots_insert on public.customer_discovery_snapshots
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'customer.update')
    and created_by = (select auth.uid())
  );

create policy customer_discovery_snapshots_update on public.customer_discovery_snapshots
  for update to authenticated
  using (organization_id in (select app.current_tenant_ids()))
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'customer.update')
  );

grant select, insert on public.customer_discovery_snapshots to authenticated;
-- Only `answers` is caller-writable after insert -- the identity of the row (which customer,
-- which organization, who started it, when) is not a later caller's to change (I8).
grant update (answers) on public.customer_discovery_snapshots to authenticated;

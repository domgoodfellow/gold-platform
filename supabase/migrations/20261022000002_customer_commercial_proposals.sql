-- Slice 8 of the commercial-funnel plan: a commercial proposal for one prospective customer,
-- distinct from `configuration_proposals` (which runs only against an organization that already
-- exists) and distinct from `commercial_draft_scenarios` (GildOps' own internal margin-modeling
-- tool, staff-only, tied to no customer at all). This is the thing a salesperson builds for one
-- customer, from the real catalogue's real, approved prices — never a second price list, and
-- never a live join a later price change could silently reprice (I8): every amount here is a
-- snapshot taken at the moment this proposal was built.
--
-- A proposal is immutable once anything about its terms is fixed. Requesting a change creates a
-- new row (`supersedes_id`, `version`) rather than editing the old one — the only thing this
-- table's own update door ever moves is `status`, and only while a proposal is not yet terminal.

create table public.customer_commercial_proposals (
  id                uuid        primary key default gen_random_uuid(),
  organization_id   uuid        not null references public.organizations (id) on delete cascade,
  customer_id       uuid        not null,
  plan_id           uuid        not null references public.platform_plans (id),
  currency          text        not null check (currency ~ '^[A-Z]{3}$'),
  billing_interval  text        not null check (billing_interval in ('month', 'year', 'one_time')),
  -- Snapshots (I8): what the plan and its add-ons priced at the moment this proposal was built,
  -- never a join to `platform_plan_prices` that a later price change could reprice underneath it.
  plan_price_minor  bigint      not null check (plan_price_minor >= 0),
  addon_price_minor bigint      not null default 0 check (addon_price_minor >= 0),
  discount_minor    bigint      not null default 0 check (discount_minor >= 0),
  discount_reason   text,
  notes             text        not null default '',
  status            text        not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined')),
  version           integer     not null check (version > 0),
  supersedes_id     uuid        references public.customer_commercial_proposals (id),
  created_at        timestamptz not null default now(),
  created_by        uuid        not null references auth.users (id),

  unique (organization_id, id),
  unique (organization_id, customer_id, version),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete cascade,
  check (discount_minor = 0 or discount_reason is not null)
);

-- No extra index for the (organization_id, customer_id, version) lookup: the unique constraint
-- above already backs it, and a second index on the same key columns is exactly what
-- `function-surface.test.ts`'s index-hygiene check refuses.

alter table public.customer_commercial_proposals enable row level security;
alter table public.customer_commercial_proposals force row level security;

-- Somebody who cannot build a proposal still has to be able to see what was proposed — the same
-- reasoning `configuration_proposals_select` already carries.
create policy customer_commercial_proposals_select on public.customer_commercial_proposals
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- A commercial proposal commits GildOps to a price; building one takes the same trust as
-- configuring the price book itself.
create policy customer_commercial_proposals_insert on public.customer_commercial_proposals
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'price.manage')
    and created_by = (select auth.uid())
  );

-- Only while not yet terminal, and only `status` moves — a proposal whose terms need changing is
-- superseded by a new row, never edited in place.
create policy customer_commercial_proposals_update on public.customer_commercial_proposals
  for update to authenticated
  using (organization_id in (select app.current_tenant_ids()) and status in ('draft', 'sent'))
  with check (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'price.manage'));

grant select, insert on public.customer_commercial_proposals to authenticated;
grant update (status) on public.customer_commercial_proposals to authenticated;

-- One row per add-on a proposal includes, each its own price snapshot — a join table rather than
-- an array column, so every add-on reference is a real, checked foreign key (I18's reasoning
-- restated: a reference this schema can see is one it can enforce).
create table public.customer_commercial_proposal_addons (
  organization_id uuid   not null references public.organizations (id) on delete cascade,
  proposal_id     uuid   not null,
  addon_plan_id   uuid   not null references public.platform_plans (id),
  price_minor     bigint not null check (price_minor >= 0),

  primary key (organization_id, proposal_id, addon_plan_id),
  foreign key (organization_id, proposal_id) references public.customer_commercial_proposals (organization_id, id) on delete cascade
);

alter table public.customer_commercial_proposal_addons enable row level security;
alter table public.customer_commercial_proposal_addons force row level security;

create policy customer_commercial_proposal_addons_select on public.customer_commercial_proposal_addons
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- Written once, alongside the proposal row it belongs to — never edited or removed afterward,
-- the same immutability the parent proposal itself holds to.
create policy customer_commercial_proposal_addons_insert on public.customer_commercial_proposal_addons
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'price.manage')
  );

grant select, insert on public.customer_commercial_proposal_addons to authenticated;

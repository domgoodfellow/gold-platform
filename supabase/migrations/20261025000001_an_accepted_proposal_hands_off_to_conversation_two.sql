-- Slice 10, the terminal boundary of the commercial-funnel plan: "Create this business in
-- GildOps," from an accepted commercial proposal.
--
-- **This creates a new organization; it does not touch the one the prospect has been a customer
-- of.** The GildOps `customers` row this proposal and discovery snapshot belong to is untouched
-- by this migration and this door — it stays exactly what it always was, GildOps's own record of
-- having sold to them (the Slice 1 correction, restated at the point it finally matters).
--
-- **Provisioning itself is not a new door.** `provision_organization` (20260830000004) already is
-- "GOLD creates it, whoever configures it configures it" (D29) — staff-only, checked live against
-- `platform_staff`, wide grant/narrow body exactly as `20260915000001` made every such door. This
-- migration adds nowhere for a non-staff caller to reach it faster; it adds one record of having
-- called it, tied to the proposal that authorized the call.
--
-- **What this is not.** Owner membership and the organization's default modules are already
-- `provision_organization`'s own doing. Agreement, Entitlements, Initial configuration, Readiness
-- and Launch are Conversation 2's, not built here — this table hands off the four things Slice 10
-- was asked to hand off (business identity via the new organization, discovery snapshot,
-- accepted configuration, commercial terms) and stops.

create table public.customer_proposal_handoffs (
  id                      uuid        primary key default gen_random_uuid(),
  organization_id         uuid        not null references public.organizations (id) on delete cascade,
  customer_id             uuid        not null,
  proposal_id             uuid        not null,
  -- The business this handoff created. No FK-cascade back onto it: a business that exists is not
  -- deleted because the record of how it started was.
  created_organization_id uuid        not null references public.organizations (id),
  -- Snapshots (I8): what discovery held and what the proposal's terms were at the one moment
  -- this handoff happened, never a live join either could drift out from under afterward.
  discovery_snapshot      jsonb       not null,
  accepted_configuration  jsonb,
  commercial_terms        jsonb       not null,
  created_at              timestamptz not null default now(),
  created_by              uuid        not null references auth.users (id),

  unique (organization_id, id),
  -- One handoff per proposal, ever — a second provisioning from the same acceptance would be a
  -- second business for one "yes".
  unique (organization_id, proposal_id),
  foreign key (organization_id, customer_id) references public.customers (organization_id, id) on delete cascade,
  foreign key (organization_id, proposal_id) references public.customer_commercial_proposals (organization_id, id)
);

comment on table public.customer_proposal_handoffs is
  'The record of "create this business in GildOps" having happened once for an accepted proposal. Immutable: no update or delete grant exists.';

alter table public.customer_proposal_handoffs enable row level security;
alter table public.customer_proposal_handoffs force row level security;

create policy customer_proposal_handoffs_select on public.customer_proposal_handoffs
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- Defense in depth alongside `provision_organization`'s own gate: even though a non-staff caller
-- can never reach this insert with a real `created_organization_id` (the provisioning call before
-- it would already have failed), the row itself still requires the same platform authority a
-- caller would need to have gotten here honestly.
create policy customer_proposal_handoffs_insert on public.customer_proposal_handoffs
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and (select app.is_platform_staff())
    and created_by = (select auth.uid())
  );

grant select, insert on public.customer_proposal_handoffs to authenticated;

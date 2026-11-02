-- A commercial proposal says what it is priced from (ADR-051, second slice).
--
-- Until now every commercial proposal was a GildOps Platform Plan offer: a plan, its add-ons and
-- a price copied from `platform_plan_prices`. Ordinary businesses sell from their own Finance
-- catalog, so a proposal now carries a `basis`:
--
--   platform_plan  every proposal that exists today. Unchanged, still the only basis the
--                  technical hand-off (`hand_off_accepted_proposal`) will provision from.
--   catalog        priced from the seller's own `price_book_items`, one copied line per item.
--                  No plan, no add-ons, no discount, one-off terms only: a catalog item has no
--                  billing interval, so nothing recurring is offered that nothing could bill.
--
-- This is the expand half. It changes no existing row and adds nothing an older application
-- instance writes; the writer, `build_catalog_proposal`, arrives in `20261031000006` once every
-- instance reads `basis` (docs/deployment.md).

alter table public.customer_commercial_proposals
  add column basis text not null default 'platform_plan'
    check (basis in ('platform_plan', 'catalog')),
  add column catalog_total_minor bigint;

comment on column public.customer_commercial_proposals.basis is
  'What this proposal is priced from: platform_plan (a GildOps Platform Plan, the legacy shape and the only one the technical hand-off accepts) or catalog (the seller''s own price_book_items, copied into customer_commercial_proposal_lines). Written once, by the function that builds the proposal.';
comment on column public.customer_commercial_proposals.catalog_total_minor is
  'A catalog proposal''s total, the sum of its copied lines at the moment it was built. Null for a platform_plan proposal, whose total is plan + add-ons - discount.';

alter table public.customer_commercial_proposals
  alter column plan_id drop not null,
  alter column plan_label drop not null;

-- The two shapes, each complete and neither borrowing the other's columns.
alter table public.customer_commercial_proposals
  add constraint customer_commercial_proposals_basis_shape check (
    (basis = 'platform_plan'
      and plan_id is not null
      and plan_label is not null
      and catalog_total_minor is null)
    or
    (basis = 'catalog'
      and plan_id is null
      and plan_label is null
      and plan_price_minor = 0
      and addon_price_minor = 0
      and discount_minor = 0
      and discount_reason is null
      and billing_interval = 'one_time'
      and catalog_total_minor is not null
      and catalog_total_minor between 0 and 100000000000000)
  );

-- One copied line per catalog item on a catalog proposal. Copied, never joined: a later change
-- to the catalog (or the item's removal) must not reach a proposal the customer already holds,
-- so the item id is kept as provenance with no foreign key holding the catalog row in place.
create table public.customer_commercial_proposal_lines (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  proposal_id        uuid not null,
  position           integer not null check (position between 1 and 100),
  price_book_item_id uuid not null,
  name               text not null check (length(btrim(name)) between 1 and 200),
  unit               text not null check (length(btrim(unit)) between 1 and 40),
  currency           text not null check (currency ~ '^[A-Z]{3}$'),
  quantity           integer not null check (quantity between 1 and 1000000),
  unit_amount_minor  bigint not null check (unit_amount_minor between 0 and 100000000000),
  amount_minor       bigint not null,
  foreign key (organization_id, proposal_id)
    references public.customer_commercial_proposals(organization_id, id) on delete cascade,
  unique (organization_id, proposal_id, position),
  constraint customer_commercial_proposal_lines_amount check (amount_minor = quantity::bigint * unit_amount_minor)
);

create index customer_commercial_proposal_lines_proposal
  on public.customer_commercial_proposal_lines (organization_id, proposal_id);

comment on table public.customer_commercial_proposal_lines is
  'The priced lines of a catalog-basis commercial proposal, copied from price_book_items when the proposal was built. Never edited; written only by build_catalog_proposal.';

alter table public.customer_commercial_proposal_lines enable row level security;
alter table public.customer_commercial_proposal_lines force row level security;

create policy customer_commercial_proposal_lines_select
  on public.customer_commercial_proposal_lines for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

-- The recipient reads the lines of exactly the versions they may already read.
create policy customer_commercial_proposal_lines_select_external
  on public.customer_commercial_proposal_lines for select to authenticated
  using (
    organization_id = (select app.current_external_tenant())
    and proposal_id in (
      select p.id from public.customer_commercial_proposals p
       where p.organization_id = customer_commercial_proposal_lines.organization_id
         and p.customer_id = (select app.current_external_customer())
         and p.status <> 'draft'
    )
  );

revoke all on public.customer_commercial_proposal_lines from anon, authenticated;
grant select on public.customer_commercial_proposal_lines to authenticated;

-- The technical hand-off provisions a GildOps tenant and writes Platform Plan assignments
-- (`app.write_plan_assignment`). That is a GildOps platform act about a GildOps Plan; a catalog
-- proposal is one business selling its own services and must never reach it, whoever asks.
-- Everything else is the function as `20261022000079` left it.
create or replace function public.hand_off_accepted_proposal(p_proposal_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor          uuid := (select auth.uid());
  v_staff_name     text;
  v_proposal       public.customer_commercial_proposals;
  v_customer       public.contacts;
  v_snapshot       jsonb;
  v_addons         jsonb;
  v_addon          jsonb;
  v_terms          jsonb;
  v_org            uuid;
  v_constraint     text;
  v_capabilities   text[];
  v_note           text;
  v_total_minor    bigint;
begin
  perform app.require_platform_capability('platform.organizations');
  if v_actor is null then
    raise exception 'hand_off_accepted_proposal requires an authenticated caller'
      using errcode = '42501';
  end if;

  select s.name into v_staff_name from public.platform_staff s where s.user_id = v_actor;
  if v_staff_name is null then
    raise exception 'only platform staff may create a business from a proposal'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_proposal_id::text));

  select * into v_proposal from public.customer_commercial_proposals where id = p_proposal_id;
  if v_proposal.id is null then
    raise exception 'no such proposal'
      using errcode = '42501';
  end if;
  perform app.require_capability(v_proposal.organization_id, 'customer.update');
  if v_proposal.basis <> 'platform_plan' then
    raise exception 'only a Platform Plan proposal can create a business'
      using errcode = '42501';
  end if;
  if v_proposal.status <> 'accepted' then
    raise exception 'only an accepted proposal can be handed off'
      using errcode = '42501';
  end if;

  select created_organization_id into v_org
    from public.customer_proposal_handoffs
   where organization_id = v_proposal.organization_id and proposal_id = p_proposal_id;
  if v_org is not null then
    return v_org;
  end if;

  select * into v_customer
    from public.contacts
   where organization_id = v_proposal.organization_id and id = v_proposal.customer_id;
  if v_customer.id is null then
    raise exception 'no such customer'
      using errcode = '42501';
  end if;
  if v_customer.email is null then
    raise exception 'this customer has no email on file -- the owner needs an address to sign in with'
      using errcode = '23514';
  end if;

  select answers into v_snapshot
    from public.customer_discovery_snapshots
   where organization_id = v_proposal.organization_id and customer_id = v_proposal.customer_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'addonPlanId', addon_plan_id, 'label', label, 'priceMinor', price_minor
         )), '[]'::jsonb)
    into v_addons
    from public.customer_commercial_proposal_addons
   where organization_id = v_proposal.organization_id and proposal_id = p_proposal_id;

  v_terms := jsonb_build_object(
    'planId', v_proposal.plan_id,
    'planLabel', v_proposal.plan_label,
    'addons', v_addons,
    'currency', v_proposal.currency,
    'billingInterval', v_proposal.billing_interval,
    'planPriceMinor', v_proposal.plan_price_minor,
    'addonPriceMinor', v_proposal.addon_price_minor,
    'discountMinor', v_proposal.discount_minor,
    'discountReason', v_proposal.discount_reason,
    'version', v_proposal.version
  );

  select pg_get_constraintdef(c.oid) into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.roles'::regclass and c.conname = 'roles_capabilities_known';
  select coalesce(array_agg(distinct match[1] order by match[1]), '{}'::text[]) into v_capabilities
    from regexp_matches(v_constraint, '''([^'']+)''::text', 'g') as match;

  v_org := public.provision_organization(
    v_customer.email, v_customer.name, 'Admin', v_capabilities, 'Owner', null, v_proposal.currency
  );

  v_note := 'Accepted proposal ' || p_proposal_id::text || ', v' || v_proposal.version::text;

  perform app.write_plan_assignment(
    v_org, v_proposal.plan_id, current_date, date '9999-12-31', v_actor, v_note);

  for v_addon in select * from jsonb_array_elements(v_addons)
  loop
    perform app.write_plan_assignment(
      v_org, (v_addon ->> 'addonPlanId')::uuid, current_date, date '9999-12-31', v_actor, v_note
    );
  end loop;

  v_total_minor := greatest(0, v_proposal.plan_price_minor + v_proposal.addon_price_minor - v_proposal.discount_minor);
  perform app.write_plan_agreement(
    v_org, v_proposal.plan_id, v_proposal.currency, v_total_minor, now(), null, v_actor, v_note
  );

  insert into public.customer_proposal_handoffs
    (organization_id, customer_id, proposal_id, created_organization_id,
     discovery_snapshot, accepted_configuration, commercial_terms, created_by)
  values
    (v_proposal.organization_id, v_proposal.customer_id, p_proposal_id, v_org,
     coalesce(v_snapshot, '{}'::jsonb), v_proposal.accepted_configuration, v_terms, v_actor);

  return v_org;
end;
$function$;

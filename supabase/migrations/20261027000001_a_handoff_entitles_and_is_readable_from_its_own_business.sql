-- Two corrections to the handoff `20261026000001` just made atomic:
--
-- **1. A provisioned business got no entitlement.** `hand_off_accepted_proposal` snapshotted
-- `commercial_terms` as inert JSON and stopped -- the accepted Plan and Add-ons were never
-- recorded against the new organization in `organization_plan_assignments`, the canonical
-- Plan/Add-on entitlement model (`20260918000001`). A business created this way had an accepted,
-- paid-for Plan on paper and zero rows granting it anything; `organizationResolvedFeatureStates`
-- fell it back to the legacy wanted∩paid path, which was equally empty. Folded into the same
-- function and the same transaction the provisioning already commits with -- the discipline
-- `20261026000001` just established for this exact door, extended to what it left out. Assignment
-- uses the open-ended-period convention every other caller of `record_plan_assignment` already
-- uses (`'9999-12-31'`); the agreement records what was actually accepted -- plan plus add-ons
-- minus the proposal's own discount (`commercialProposalTotalMinor`'s own arithmetic) -- as the
-- one place a negotiated price is recorded. Add-ons carry no separate agreement: nothing here
-- itemizes a discount per add-on, and the schema has no place to put one.
--
-- **2. The handoff was write-only from the business it founded.** `customer_proposal_handoffs`
-- carries `created_organization_id`, but its one select policy scopes to the *selling*
-- organization. Nothing let a member of the *new* business read the record of how it started.
-- Additive: RLS policies are ORed, so the selling organization's own read is untouched.

create policy customer_proposal_handoffs_select_founded on public.customer_proposal_handoffs
  for select to authenticated
  using (created_organization_id in (select app.current_tenant_ids()));

create or replace function public.hand_off_accepted_proposal(p_proposal_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor          uuid := (select auth.uid());
  v_staff_name     text;
  v_proposal       public.customer_commercial_proposals;
  v_customer       public.customers;
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
    from public.customers
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

  -- What Sales sold, entitled -- never what discovery merely suggested (that stays advisory on
  -- `accepted_configuration`, read back for a person to act on, never applied here).
  v_note := 'Accepted proposal ' || p_proposal_id::text || ', v' || v_proposal.version::text;

  perform public.record_plan_assignment(v_org, v_proposal.plan_id, current_date, date '9999-12-31', v_note);

  for v_addon in select * from jsonb_array_elements(v_addons)
  loop
    perform public.record_plan_assignment(
      v_org, (v_addon ->> 'addonPlanId')::uuid, current_date, date '9999-12-31', v_note
    );
  end loop;

  v_total_minor := greatest(0, v_proposal.plan_price_minor + v_proposal.addon_price_minor - v_proposal.discount_minor);
  perform public.record_organization_plan_agreement(
    v_org, v_proposal.plan_id, v_proposal.currency, v_total_minor, now(), null, v_note
  );

  insert into public.customer_proposal_handoffs
    (organization_id, customer_id, proposal_id, created_organization_id,
     discovery_snapshot, accepted_configuration, commercial_terms, created_by)
  values
    (v_proposal.organization_id, v_proposal.customer_id, p_proposal_id, v_org,
     coalesce(v_snapshot, '{}'::jsonb), v_proposal.accepted_configuration, v_terms, v_actor);

  return v_org;
end;
$fn$;

comment on function public.hand_off_accepted_proposal(uuid) is
  'Create this business in GildOps, atomically: provisioning, entitling it to the accepted Plan and Add-ons, and recording the handoff either all happen or none do, and a repeat call is a no-op that returns the business already created. Staff-only, checked live, the same scope check provision_organization itself makes.';

revoke all on function public.hand_off_accepted_proposal(uuid) from public;
grant execute on function public.hand_off_accepted_proposal(uuid) to authenticated;

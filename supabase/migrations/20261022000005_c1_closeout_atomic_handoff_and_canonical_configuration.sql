-- C1 closeout: two corrections to what Slices 8-10 shipped.
--
-- **1. The acceptance payload was never canonical, and now isn't asked to be.**
-- `accept_commercial_proposal` took `p_accepted_configuration` as a caller-supplied parameter --
-- the UI always computed it correctly server-side, but the door itself trusted whatever JSON a
-- caller handed it, which is not what "accepted configuration" is supposed to mean. The
-- authoritative recommendation belongs on the proposal itself, snapshotted at build time (I8) —
-- the same discipline `plan_price_minor` already holds to, just not yet applied to configuration.
-- Acceptance now *copies* that snapshot onto `accepted_configuration` rather than accepting one.
--
-- **2. The handoff had a failure window.** `handoffAcceptedProposal` called
-- `provision_organization` and then, as a second step, inserted `customer_proposal_handoffs`. If
-- the second step failed, the business existed with nothing recording it, and a retry would call
-- `provision_organization` again -- a second business for one acceptance. `hand_off_accepted_proposal`
-- replaces both TypeScript-level steps with one function: PL/pgSQL function calls do not open a
-- new transaction, so provisioning and recording now either both happen or neither does. An
-- advisory lock keyed on the proposal id serializes even a genuine double-click; a repeat call
-- for a proposal already handed off returns the business already created rather than erroring or
-- duplicating it -- recoverable and idempotent, not merely retried.

-- ---------------------------------------------------------------------------
-- 1. Canonical configuration, snapshotted at build time
-- ---------------------------------------------------------------------------

alter table public.customer_commercial_proposals
  add column proposed_configuration jsonb;

comment on column public.customer_commercial_proposals.proposed_configuration is
  'What recommendConfiguration produced from the discovery snapshot at the moment this proposal was built -- a snapshot (I8), never a live recompute. Null only for a proposal built before this column existed. Written once, by buildCommercialProposal''s own insert; not part of the `status`-only update grant, so nothing may edit it afterward.';

drop function if exists public.accept_commercial_proposal(uuid, jsonb);

create function public.accept_commercial_proposal(p_proposal_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_customer uuid := app.current_external_customer();
  v_org      uuid := app.current_external_tenant();
  v_proposal public.customer_commercial_proposals;
begin
  if v_actor is null or v_customer is null or v_org is null then
    raise exception 'accept_commercial_proposal requires a recognized customer'
      using errcode = '42501';
  end if;

  select * into v_proposal
  from public.customer_commercial_proposals
  where id = p_proposal_id and organization_id = v_org and customer_id = v_customer;

  if v_proposal.id is null then
    raise exception 'no such proposal, or you may not act on it'
      using errcode = '42501';
  end if;

  if v_proposal.status <> 'sent' then
    raise exception 'this proposal is not open for a response'
      using errcode = '42501';
  end if;

  update public.customer_commercial_proposals
     set status = 'accepted',
         accepted_by = v_actor,
         accepted_at = now(),
         -- Copied from this proposal's own snapshot, never from the caller (correction above).
         accepted_configuration = v_proposal.proposed_configuration
   where id = p_proposal_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'customer', v_customer, 'commercial_proposal.accepted',
     jsonb_build_object('proposal_id', p_proposal_id, 'version', v_proposal.version));
end;
$fn$;

revoke all on function public.accept_commercial_proposal(uuid) from public;
grant execute on function public.accept_commercial_proposal(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. One atomic, idempotent handoff
-- ---------------------------------------------------------------------------

create function public.hand_off_accepted_proposal(p_proposal_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor        uuid := (select auth.uid());
  v_staff_name   text;
  v_proposal     public.customer_commercial_proposals;
  v_customer     public.customers;
  v_snapshot     jsonb;
  v_addons       jsonb;
  v_terms        jsonb;
  v_org          uuid;
  v_constraint   text;
  v_capabilities text[];
begin
  if v_actor is null then
    raise exception 'hand_off_accepted_proposal requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- The scope check is the first act, as it is in `provision_organization` itself -- everything
  -- below runs unpoliced by construction (SECURITY DEFINER), so the gate has to be here.
  select s.name into v_staff_name from public.platform_staff s where s.user_id = v_actor;
  if v_staff_name is null then
    raise exception 'only platform staff may create a business from a proposal'
      using errcode = '42501';
  end if;

  -- Serializes every call for this one proposal, including a genuine concurrent double-click --
  -- not just a sequential retry after failure. Released automatically at transaction end.
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

  -- Idempotent: a proposal already handed off returns the business already created for it,
  -- rather than erroring or provisioning a second one.
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

  -- The same capability list `provision_organization`'s own TypeScript caller passes
  -- (`ALL_CAPABILITIES`), read from the one place that already enumerates every known capability
  -- rather than a second, hand-kept copy of the list (the same extraction `20261016000001` uses).
  select pg_get_constraintdef(c.oid) into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.roles'::regclass and c.conname = 'roles_capabilities_known';
  select coalesce(array_agg(distinct match[1] order by match[1]), '{}'::text[]) into v_capabilities
    from regexp_matches(v_constraint, '''([^'']+)''::text', 'g') as match;

  -- Same transaction as the insert below -- a PL/pgSQL function call opens no transaction of its
  -- own, so if recording the handoff fails, this rolls back with it. No partial state, ever.
  v_org := public.provision_organization(
    v_customer.email, v_customer.name, 'Admin', v_capabilities, 'Owner', null, v_proposal.currency
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
  'Create this business in GildOps (Slice 10), atomically: provisioning and recording the handoff either both happen or neither does, and a repeat call is a no-op that returns the business already created. Staff-only, checked live, the same scope check provision_organization itself makes.';

revoke all on function public.hand_off_accepted_proposal(uuid) from public;
grant execute on function public.hand_off_accepted_proposal(uuid) to authenticated;

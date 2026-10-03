-- Platform authority stops being one boolean at the database door too.
--
-- `20260930000001` split platform authority into five named permissions and said so plainly in
-- its own header: the web runtime reads the caller's row and refuses a route, while "the
-- narrow-door functions still check `app.require_platform_staff()`, which is deliberately
-- unchanged". That left the commercial writes guarded by navigation alone -- a staff member
-- holding only `platform.organizations` could see an organization's commercial account, find the
-- write controls hidden, and still assign a Plan, record a negotiated price or widen an
-- allowance by posting the form. **Hiding a control is courtesy; a permission is the boundary.**
--
-- Two new helpers, mirroring the pair that already exists one axis up: a boolean for a predicate
-- and a raiser for a function body, both reading `platform_staff.capabilities` live under
-- whichever role the caller already wears (D45). Neither takes a table grant with it, so
-- `platform_staff` still holds none.
--
-- **Two doors over one core, not a bypass.** `hand_off_accepted_proposal` records the accepted
-- Plan and its negotiated price as part of founding a business from a proposal; that act is
-- already authorized by its own facts -- a live staff row and an *accepted* proposal -- and it is
-- a salesperson's job, not a pricing administrator's. Requiring `platform.commercial` there
-- would fuse two jobs the permission vocabulary exists to keep apart. So the write itself moves
-- into an `app` core with no grant and no authorization of its own, and the two callers each
-- prove what they are entitled to prove. That is the shape `begin_external_card_payment` and
-- `record_call_event` already use, not a new concession.

-- ---------------------------------------------------------------------------
-- The check, in both shapes
-- ---------------------------------------------------------------------------

create function app.has_platform_capability(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.platform_staff s
     where s.user_id = (select auth.uid())
       and p_capability = any (s.capabilities)
  );
$fn$;

comment on function app.has_platform_capability(text) is
  'Whether the caller''s own platform_staff row names this permission, for use inside an RLS policy or an invoker function. A live table read, not a role or a claim -- companion to app.require_platform_capability(), which raises instead of returning false.';

revoke all on function app.has_platform_capability(text) from public;
grant execute on function app.has_platform_capability(text) to authenticated;

create function app.require_platform_capability(p_capability text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_name  text;
  v_caps  text[];
begin
  if v_actor is null then
    raise exception 'this operation requires an authenticated caller' using errcode = '42501';
  end if;

  select s.name, s.capabilities into v_name, v_caps
    from public.platform_staff s where s.user_id = v_actor;

  if v_name is null then
    raise exception 'only platform staff may do this' using errcode = '42501';
  end if;

  -- Named rather than numbered, because the message is read by the person who has to ask
  -- somebody for the permission.
  if not (p_capability = any (v_caps)) then
    raise exception 'this needs the % platform permission', p_capability using errcode = '42501';
  end if;

  return v_name;
end;
$fn$;

comment on function app.require_platform_capability(text) is
  'The staff member''s own name if their platform_staff row names this permission; raises 42501 otherwise. The narrower sibling of app.require_platform_staff(), for a door whose job belongs to one part of the console rather than to platform staff in general.';

revoke all on function app.require_platform_capability(text) from public;
grant execute on function app.require_platform_capability(text) to authenticated;

-- ---------------------------------------------------------------------------
-- The two writes with a second, differently-authorized caller
-- ---------------------------------------------------------------------------
-- Neither core authorizes anything. Neither carries a grant. Each is exactly the body its
-- `public` door had, moved down one level so the door can decide who may open it.

create function app.write_plan_assignment(
  p_organization_id uuid,
  p_plan_id         uuid,
  p_period_start    date,
  p_period_end      date,
  p_actor           uuid,
  p_note            text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_kind text;
  v_id   uuid;
begin
  select kind into v_kind from public.platform_plans where id = p_plan_id;
  if v_kind is null then
    raise exception 'no such plan: %', p_plan_id using errcode = '23503';
  end if;

  insert into public.organization_plan_assignments
    (organization_id, plan_id, plan_kind, period_start, period_end, assigned_by, note)
  values
    (p_organization_id, p_plan_id, v_kind, p_period_start, p_period_end, p_actor, p_note)
  returning id into v_id;

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (
    p_organization_id, p_actor, 'organization', p_organization_id, 'plan_assignment.recorded',
    jsonb_build_object('assignment_id', v_id, 'plan_id', p_plan_id, 'plan_kind', v_kind,
                       'period_start', p_period_start, 'period_end', p_period_end)
  );

  return v_id;
end;
$fn$;

revoke all on function app.write_plan_assignment(uuid, uuid, date, date, uuid, text) from public;

create function app.write_plan_agreement(
  p_organization_id uuid,
  p_plan_id         uuid,
  p_currency        text,
  p_amount_minor    bigint,
  p_effective_from  timestamptz,
  p_effective_to    timestamptz,
  p_actor           uuid,
  p_note            text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_id uuid;
begin
  -- A negotiated price is a price *for a Plan this business holds*. The check predates this
  -- extraction (20261018000001) and stays with the write, not with either door.
  if not exists (
    select 1 from public.organization_plan_assignments a
     where a.organization_id = p_organization_id
       and a.plan_id = p_plan_id
       and a.period_start <= p_effective_from::date
       and a.period_end   >  p_effective_from::date
  ) then
    raise exception 'organization has no active assignment for this plan at agreement start'
      using errcode = '23503';
  end if;

  insert into public.organization_plan_agreements
    (organization_id, plan_id, currency, amount_minor, effective_from, effective_to, recorded_by, note)
  values
    (p_organization_id, p_plan_id, upper(btrim(p_currency)), p_amount_minor, p_effective_from,
     p_effective_to, p_actor, p_note)
  returning id into v_id;

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (
    p_organization_id, p_actor, 'organization', p_organization_id, 'plan_agreement.recorded',
    jsonb_build_object('agreement_id', v_id, 'plan_id', p_plan_id, 'amount_minor', p_amount_minor,
                       'currency', upper(btrim(p_currency)), 'effective_from', p_effective_from,
                       'effective_to', p_effective_to)
  );

  return v_id;
end;
$fn$;

revoke all on function app.write_plan_agreement(uuid, uuid, text, bigint, timestamptz, timestamptz, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- The operator doors, each needing the commercial permission
-- ---------------------------------------------------------------------------

create or replace function public.record_plan_assignment(
  p_organization_id uuid,
  p_plan_id         uuid,
  p_period_start    date,
  p_period_end      date,
  p_note            text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_capability('platform.commercial');
  return app.write_plan_assignment(
    p_organization_id, p_plan_id, p_period_start, p_period_end, (select auth.uid()), p_note);
end;
$fn$;

comment on function public.record_plan_assignment(uuid, uuid, date, date, text) is
  'Records which Plan/Add-on package an organization has for a period. Needs platform.commercial, not platform-staff membership in general. Writes no row to organization_modules or organization_commercial_terms -- see 20260918000001''s header for why.';

create or replace function public.record_organization_plan_agreement(
  p_organization_id uuid,
  p_plan_id         uuid,
  p_currency        text,
  p_amount_minor    bigint,
  p_effective_from  timestamptz,
  p_effective_to    timestamptz default null,
  p_note            text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_capability('platform.commercial');
  return app.write_plan_agreement(
    p_organization_id, p_plan_id, p_currency, p_amount_minor, p_effective_from, p_effective_to,
    (select auth.uid()), p_note);
end;
$fn$;

comment on function public.record_organization_plan_agreement(uuid, uuid, text, bigint, timestamptz, timestamptz, text) is
  'The negotiated price this organization pays for one Plan it holds. Needs platform.commercial.';

-- The five-argument predecessor (20260918000001) still carries a grant to `authenticated` and
-- no application caller. It is hardened rather than dropped: a signed-in role holding execute on
-- an unguarded commercial write is the defect, whether or not any screen uses it.
create or replace function public.record_plan_agreement(
  p_organization_id uuid,
  p_plan_id         uuid,
  p_currency        text,
  p_amount_minor    bigint,
  p_effective_from  timestamptz default now(),
  p_note            text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_capability('platform.commercial');
  return app.write_plan_agreement(
    p_organization_id, p_plan_id, p_currency, p_amount_minor, p_effective_from, null,
    (select auth.uid()), p_note);
end;
$fn$;

create or replace function public.record_plan_quota_override(
  p_organization_id   uuid,
  p_plan_id           uuid,
  p_allowance_key     text,
  p_included_quantity numeric,
  p_hard_limit        numeric default null,
  p_effective_from    timestamptz default now(),
  p_note              text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff uuid := (select auth.uid());
  v_id    uuid;
begin
  perform app.require_platform_capability('platform.commercial');

  insert into public.organization_plan_quota_overrides
    (organization_id, plan_id, allowance_key, included_quantity, hard_limit, effective_from, recorded_by, note)
  values
    (p_organization_id, p_plan_id, p_allowance_key, p_included_quantity, p_hard_limit,
     p_effective_from, v_staff, p_note)
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.record_plan_quota_override(uuid, uuid, text, numeric, numeric, timestamptz, text) is
  'What this organization''s allowance is, where it differs from its Plan''s. Append-only; needs platform.commercial.';

create or replace function public.record_commercial_term(
  p_organization_id uuid,
  p_product_key     text,
  p_period_start    date,
  p_period_end      date,
  p_price_minor     bigint,
  p_currency        text default null,
  p_quantity        integer default 1,
  p_note            text default ''
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff uuid := (select auth.uid());
  v_name  text;
  v_currency text := case when p_currency is null then null else upper(btrim(p_currency)) end;
  v_id    uuid;
begin
  v_name := app.require_platform_capability('platform.commercial');

  insert into public.organization_commercial_terms
    (organization_id, product_key, period_start, period_end, quantity, price_minor, currency, recorded_by, note)
  values
    (p_organization_id, p_product_key, p_period_start, p_period_end, coalesce(p_quantity, 1),
     p_price_minor, v_currency, v_staff, p_note)
  returning id into v_id;

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_staff, 'organization', p_organization_id, 'commercial_term.recorded',
     jsonb_build_object(
       'term_id', v_id, 'product_key', p_product_key,
       'period_start', p_period_start, 'period_end', p_period_end,
       'price_minor', p_price_minor, 'currency', v_currency, 'quantity', coalesce(p_quantity, 1),
       'recorded_by', v_name
     ));

  return v_id;
end;
$fn$;

comment on function public.record_commercial_term(uuid, text, date, date, bigint, text, integer, text) is
  'The only way to write a term. Needs platform.commercial, SECURITY DEFINER, no table grant behind it (I21''s shape). Writes one events row on the tenant it concerns.';

-- ---------------------------------------------------------------------------
-- The second caller, recreated in full (D15) against the cores
-- ---------------------------------------------------------------------------
-- Unchanged in every respect but two lines: the two `public.record_*` calls become their `app`
-- cores, so closing an accepted proposal no longer needs the pricing-administration permission.

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
$fn$;

comment on function public.hand_off_accepted_proposal(uuid) is
  'Create this business in GildOps, atomically: provisioning, entitling it to the accepted Plan and Add-ons, and recording the handoff either all happen or none do, and a repeat call is a no-op that returns the business already created. Staff-only, checked live -- closing a sale is a salesperson''s act and deliberately does not need platform.commercial, which guards the operator doors onto the same writes.';

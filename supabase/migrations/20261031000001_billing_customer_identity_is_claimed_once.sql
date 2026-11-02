-- A billing customer identity is claimed once, through commands, and found by its provider and
-- environment.
--
-- Before this migration an organization's billing manager could INSERT and UPDATE
-- `platform_billing_customers` directly, including `customer_reference`, `environment` and
-- `provider`. Nothing made a finalized reference unique, and the subscription webhook resolved the
-- organization by `customer_reference` alone. So a tenant could point its row at another
-- organization's processor customer (the lookup then raised on two rows and that customer's events
-- stopped applying) or at a customer no organization had registered (whose events then landed on
-- the tenant). The webhook also ignored which environment a signed event came from, and the portal
-- lookup returned an arbitrary row when an organization had both a sandbox and a live customer.
--
-- Forward only. Historical rows are neither deleted nor reassigned: a duplicate finalized reference
-- stops the migration for a person to resolve rather than being guessed at.
--
-- Additive by design: everything here is tolerated by the web and API code deployed before it.
-- The finalization command is the provisioner's alone from the start; what the deployed web can
-- still do, until 20261031000002, is write its own row directly, as it could before.
begin;

-- Legacy rows: refuse rather than repair. A duplicate finalized reference means two organizations
-- already claim one processor customer, and only a person can tell which one is real.
do $legacy$
declare
  v_duplicates text;
begin
  select string_agg(format('%s/%s/%s claimed by %s organizations', provider, environment, customer_reference, claims), '; ')
    into v_duplicates
    from (
      select provider, environment, customer_reference, count(*) as claims
        from public.platform_billing_customers
       where customer_reference not like 'pending:%'
       group by provider, environment, customer_reference
      having count(*) > 1
    ) duplicates;

  if v_duplicates is not null then
    raise exception 'resolve duplicate finalized billing customer references before applying this migration: %', v_duplicates
      using errcode = '23505';
  end if;
end;
$legacy$;

-- A finalized reference identifies one organization within its provider and environment. Pending
-- placeholders are excluded: they are not identities and are never matched by an event.
create unique index platform_billing_customers_finalized_reference
  on public.platform_billing_customers (provider, environment, customer_reference)
  where customer_reference not like 'pending:%';

-- The trusted provisioner: apps/api acting for GildOps' own billing account after it has asked the
-- processor itself. It is the only identity that may supply a processor-returned reference, because
-- a reference a person types proves nothing about who owns that processor customer. A fixed actor
-- nobody can sign in as, a role with one execute grant, and a token only apps/api can mint.
insert into auth.users (id)
values ('00000000-0000-4000-8000-0000000000b2')
on conflict (id) do nothing;

do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'platform_billing_provisioner') then
    create role platform_billing_provisioner nologin noinherit;
  end if;
end;
$role$;

grant platform_billing_provisioner to authenticator;
grant usage on schema public to platform_billing_provisioner;

-- The tenant's direct write grants are withdrawn by the next migration, 20261031000002, applied
-- only once apps/web provisions through apps/api: until then the deployed web still writes the
-- table directly, and withdrawing them here would break a first checkout mid-rollout.

-- Shared refusal for both commands: a signed-in billing manager of this organization, a known
-- environment and a named provider. Internal; no client grant.
create or replace function app.require_platform_billing_customer_manager(
  p_organization_id uuid,
  p_environment text,
  p_provider text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'this operation requires an authenticated caller' using errcode = '42501';
  end if;
  if p_organization_id is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'billing.manage') then
    raise exception 'insufficient capability' using errcode = '42501';
  end if;
  if p_environment is null or p_environment not in ('sandbox', 'live') then
    raise exception 'unknown billing environment' using errcode = '22023';
  end if;
  -- Only a provider GildOps actually bills through. A reservation names no processor account and
  -- either environment is one a deployment can legitimately bill in; which one is used is decided
  -- by the provisioner's own key at finalization, never by this caller.
  if p_provider is distinct from 'stripe' then
    raise exception 'unknown billing provider' using errcode = '22023';
  end if;
  return v_actor;
end;
$fn$;

revoke all on function app.require_platform_billing_customer_manager(uuid, text, text) from public, anon, authenticated;

-- Step one of provisioning: reserve this organization's row for one provider and environment with a
-- pending placeholder, or return the row already there. Idempotent and safe under concurrency: the
-- unique (organization_id, environment) row decides the winner and every caller reads it back.
create or replace function public.begin_platform_billing_customer(
  p_organization_id uuid,
  p_environment text,
  p_provider text
)
returns table (customer_reference text, finalized boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := app.require_platform_billing_customer_manager(p_organization_id, p_environment, p_provider);
  v_row public.platform_billing_customers%rowtype;
begin
  insert into public.platform_billing_customers (organization_id, environment, provider, customer_reference, created_by)
  values (p_organization_id, p_environment, p_provider, 'pending:' || gen_random_uuid()::text, v_actor)
  on conflict (organization_id, environment) do nothing;

  select * into strict v_row
    from public.platform_billing_customers c
   where c.organization_id = p_organization_id
     and c.environment = p_environment;

  if v_row.provider <> p_provider then
    raise exception 'this organization''s % billing customer belongs to another provider', p_environment
      using errcode = '23514';
  end if;

  return query select v_row.customer_reference, v_row.customer_reference not like 'pending:%';
end;
$fn$;

comment on function public.begin_platform_billing_customer(uuid, text, text) is
  'Billing manager command: reserve this organization''s billing customer for one provider and environment with a pending placeholder, or return the existing row. Returns whether it is finalized. Never accepts a processor reference.';

revoke all on function public.begin_platform_billing_customer(uuid, text, text) from public, anon;
grant execute on function public.begin_platform_billing_customer(uuid, text, text) to authenticated;

-- Step two, trusted: apps/api, having asked the processor itself with GildOps' own key, replaces
-- exactly the pending placeholder it reserved with the reference the processor returned, once.
-- Executable by `platform_billing_provisioner` alone, and refused to any other caller identity even
-- if a grant were ever widened by mistake. The person the request is for must still be a billing
-- manager of this organization at this moment. Repeating the same finalization is a no-op; a
-- different reference for an already-finalized row, a stale placeholder, a placeholder-shaped
-- reference, or a reference another organization already holds (the unique index) is refused.
create or replace function public.finalize_platform_billing_customer(
  p_organization_id uuid,
  p_environment text,
  p_provider text,
  p_pending_reference text,
  p_customer_reference text,
  p_requested_by uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_row public.platform_billing_customers%rowtype;
begin
  if (select auth.uid()) is distinct from '00000000-0000-4000-8000-0000000000b2'::uuid then
    raise exception 'only the billing provisioner may finalize a billing customer' using errcode = '42501';
  end if;
  if p_environment is null or p_environment not in ('sandbox', 'live') then
    raise exception 'unknown billing environment' using errcode = '22023';
  end if;
  if p_provider is distinct from 'stripe' then
    raise exception 'unknown billing provider' using errcode = '22023';
  end if;
  if p_requested_by is null or not exists (
    select 1
      from public.memberships m
      join public.roles r on r.id = m.role_id
     where m.user_id = p_requested_by
       and m.organization_id = p_organization_id
       and 'billing.manage' = any (r.capabilities)
  ) then
    raise exception 'insufficient capability' using errcode = '42501';
  end if;

  if p_pending_reference is null or p_pending_reference not like 'pending:%' then
    raise exception 'finalization needs the pending placeholder it replaces' using errcode = '22023';
  end if;
  if p_customer_reference is null
     or p_customer_reference like 'pending:%'
     or p_customer_reference !~ '^[A-Za-z0-9_]{1,200}$'
     or (p_provider = 'stripe' and p_customer_reference !~ '^cus_[A-Za-z0-9_]+$') then
    raise exception 'that is not a % customer reference', p_provider using errcode = '22023';
  end if;

  select * into v_row
    from public.platform_billing_customers c
   where c.organization_id = p_organization_id
     and c.environment = p_environment
     for update;

  if not found then
    raise exception 'no billing customer is being provisioned here' using errcode = '55000';
  end if;
  if v_row.provider <> p_provider then
    raise exception 'this organization''s % billing customer belongs to another provider', p_environment
      using errcode = '23514';
  end if;
  if v_row.customer_reference = p_customer_reference then
    return v_row.customer_reference;
  end if;
  if v_row.customer_reference not like 'pending:%' then
    raise exception 'this billing customer is already finalized' using errcode = '55000';
  end if;
  if v_row.customer_reference <> p_pending_reference then
    raise exception 'that pending placeholder is no longer current' using errcode = '55000';
  end if;

  update public.platform_billing_customers
     set customer_reference = p_customer_reference
   where id = v_row.id;

  return p_customer_reference;
end;
$fn$;

comment on function public.finalize_platform_billing_customer(uuid, text, text, text, text, uuid) is
  'Trusted provisioner command (platform_billing_provisioner only): replace this organization''s current pending placeholder with the reference the processor returned to apps/api, once, for a person who is still a billing manager here. Idempotent for the same reference; refuses an overwrite, a stale placeholder and a reference already claimed in the same provider and environment. No human session may call it.';

revoke all on function public.finalize_platform_billing_customer(uuid, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.finalize_platform_billing_customer(uuid, text, text, text, text, uuid) to platform_billing_provisioner;

-- Which organization a signed processor event is about. Only finalized references in the event's
-- own provider match, and only in its environment when the event states one. No row is unknown
-- (no rows returned); more than one is ambiguity, which raises rather than choosing. Internal.
create or replace function app.platform_billing_customer_for_event(
  p_provider text,
  p_environment text,
  p_customer_reference text
)
returns table (organization_id uuid, environment text)
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_matches integer;
begin
  if p_environment is not null and p_environment not in ('sandbox', 'live') then
    raise exception 'unknown billing environment' using errcode = '22023';
  end if;

  select count(*) into v_matches
    from public.platform_billing_customers c
   where c.provider = p_provider
     and c.customer_reference = p_customer_reference
     and c.customer_reference not like 'pending:%'
     and (p_environment is null or c.environment = p_environment);

  if v_matches > 1 then
    raise exception 'billing customer reference % matches more than one organization', p_customer_reference
      using errcode = '21000';
  end if;

  return query
    select c.organization_id, c.environment
      from public.platform_billing_customers c
     where c.provider = p_provider
       and c.customer_reference = p_customer_reference
       and c.customer_reference not like 'pending:%'
       and (p_environment is null or c.environment = p_environment);
end;
$fn$;

revoke all on function app.platform_billing_customer_for_event(text, text, text) from public, anon, authenticated;

-- The webhook functions gain the event's own environment. It defaults to null only so the webhook
-- already deployed, which does not send one yet, keeps working once this migration is applied; with
-- null, a reference held in both environments is ambiguous and refused.
drop function public.apply_platform_subscription_event(text, text, text, text, text, text, bigint, bigint, boolean, bigint, bigint, jsonb, text, text);

CREATE OR REPLACE FUNCTION public.apply_platform_subscription_event(p_event_reference text, p_event_type text, p_customer_reference text, p_subscription_reference text, p_status text, p_currency text, p_current_period_start bigint, p_current_period_end bigint, p_cancel_at_period_end boolean, p_canceled_at bigint, p_provider_event_created_at bigint, p_items jsonb, p_checkout_correlation text, p_provider text DEFAULT 'stripe'::text, p_environment text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor constant uuid := '00000000-0000-4000-8000-0000000000a3';
  v_org            uuid;
  v_env            text;
  v_event_at       timestamptz;
  v_deleted        boolean := p_event_type = 'customer.subscription.deleted';
  v_event_id       uuid;
  v_parent         public.organization_platform_subscriptions%rowtype;
  v_has_parent     boolean;
  v_same_sub       boolean;
  v_held           jsonb;
  v_incoming       jsonb;
  v_item           record;
  v_domain         text;
  v_source         uuid;
  v_plan           uuid;
  v_kind           text;
  v_base_count     integer := 0;
  v_base_ref       text;
  v_base_price     text;
  v_base_plan      uuid;
  v_base_start     timestamptz;
  v_base_end       timestamptz;
  v_refs           text[] := '{}';
  v_period_start   timestamptz;
  v_period_end     timestamptz;
  v_legacy_price   text;
  v_issues         jsonb := '[]'::jsonb;
  v_ambiguous      boolean := false;
  v_corr           text := 'absent';
  v_corr_why       text;
  v_corr_uuid      uuid;
  v_session        public.platform_billing_checkout_sessions%rowtype;
  v_state          text;
  v_row            record;
  v_recurring_n    integer;
begin
  if p_provider_event_created_at is null then
    raise exception 'a subscription event needs the provider''s own occurrence time' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'a subscription event needs between 1 and 50 items' using errcode = '22023';
  end if;
  for v_item in select i.item from jsonb_array_elements(p_items) as i(item) loop
    if coalesce(btrim(v_item.item->>'item_reference'), '') = ''
       or coalesce(btrim(v_item.item->>'price_reference'), '') = '' then
      raise exception 'every subscription item needs its own reference and a price' using errcode = '22023';
    end if;
  end loop;

  v_event_at := to_timestamp(p_provider_event_created_at);

  -- Derived, never passed: which organization this event is about comes from our own record of
  -- whose finalized customer this is, in the provider and environment the signed event came from --
  -- never from the correlation id or anything else in the payload. Unknown is null; ambiguous raises.
  select c.organization_id, c.environment into v_org, v_env
    from app.platform_billing_customer_for_event(p_provider, p_environment, p_customer_reference) c;
  if v_org is null then
    return null;
  end if;

  -- One writer at a time per organization and environment: ordering is a comparison against
  -- state, and two concurrent events would otherwise both compare against the same old state.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || v_env, 0));

  insert into public.platform_billing_webhook_events
    (provider, event_reference, event_type, environment, organization_id, provider_event_created_at)
  values (p_provider, p_event_reference, p_event_type, v_env, v_org, v_event_at)
  on conflict (organization_id, event_reference) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return null;
  end if;

  select * into v_parent
    from public.organization_platform_subscriptions
   where organization_id = v_org and environment = v_env
   for update;
  v_has_parent := found;
  v_same_sub := v_has_parent and v_parent.subscription_reference = p_subscription_reference;

  -- ---- ordering -----------------------------------------------------------------------------
  if v_has_parent and v_parent.last_provider_event_created_at is not null then
    if v_event_at < v_parent.last_provider_event_created_at then
      update public.platform_billing_webhook_events set application = 'stale' where id = v_event_id;
      return v_org;
    end if;

    if v_event_at = v_parent.last_provider_event_created_at then
      -- The provider's clock has finite resolution, so two events can share an instant. If this
      -- one says what we already hold there is nothing to decide; if it says something else we
      -- cannot know which came first, and receipt order would be a guess presented as a fact.
      v_incoming := (select coalesce(jsonb_agg(jsonb_build_object(
                        'i', i.item->>'item_reference', 'p', i.item->>'price_reference',
                        'q', (i.item->>'quantity')::integer) order by i.item->>'item_reference'), '[]'::jsonb)
                       from jsonb_array_elements(p_items) as i(item));
      v_held := (select coalesce(jsonb_agg(jsonb_build_object(
                        'i', s.provider_item_reference, 'p', s.provider_price_reference, 'q', s.quantity)
                        order by s.provider_item_reference), '[]'::jsonb)
                   from public.organization_platform_subscription_items s
                  where s.organization_id = v_org and s.environment = v_env
                    and s.subscription_reference = v_parent.subscription_reference and s.active);

      if v_same_sub and v_parent.status = p_status
         and (v_deleted or (v_parent.cancel_at_period_end = p_cancel_at_period_end and v_incoming = v_held)) then
        update public.platform_billing_webhook_events set application = 'applied' where id = v_event_id;
        return v_org;
      end if;

      update public.organization_platform_subscriptions
         set reconciliation_state = 'ambiguous',
             reconciliation_detail = v_parent.reconciliation_detail || jsonb_build_array(jsonb_build_object(
               'code', 'equal_provider_timestamp_conflict',
               'event_reference', p_event_reference,
               'held_event_reference', v_parent.last_provider_event_reference)),
             reconciled_at = now()
       where id = v_parent.id;
      update public.platform_billing_webhook_events
         set application = 'ambiguous', reconciliation_state = 'ambiguous' where id = v_event_id;
      return v_org;
    end if;
  end if;

  -- ---- apply: a different subscription replaces the held one --------------------------------
  if v_has_parent and not v_same_sub then
    if v_parent.status not in ('canceled', 'incomplete_expired') then
      v_ambiguous := true;
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'replaced_live_subscription', 'replaced_subscription_reference', v_parent.subscription_reference));
    end if;
    update public.organization_platform_subscription_items
       set active = false, removed_at = v_event_at, last_observed_at = now(),
           last_provider_event_reference = p_event_reference, last_provider_event_created_at = v_event_at
     where organization_id = v_org and environment = v_env
       and subscription_reference = v_parent.subscription_reference and active;
  end if;

  -- ---- items --------------------------------------------------------------------------------
  -- In reference order, so nothing below depends on the order the provider listed them in.
  for v_item in
    select i.item from jsonb_array_elements(p_items) as i(item) order by i.item->>'item_reference'
  loop
    v_domain := null; v_source := null; v_plan := null; v_kind := null;

    -- An agreement's own provider price first, scoped to THIS organization: a negotiated Price is
    -- never matched across organizations, and never inferred from an amount or a Plan label.
    select 'catalogue.plan_agreement', m.agreement_id, a.plan_id
      into v_domain, v_source, v_plan
      from public.organization_plan_agreement_provider_prices m
      join public.organization_plan_agreements a
        on a.organization_id = m.organization_id and a.id = m.agreement_id
     where m.organization_id = v_org and m.environment = v_env
       and m.price_reference = v_item.item->>'price_reference'
     order by m.provisioned_at desc
     limit 1;

    if v_domain is null then
      select 'catalogue.plan_price', pv.plan_price_id, pp.plan_id
        into v_domain, v_source, v_plan
        from public.platform_plan_provider_prices pv
        join public.platform_plan_prices pp on pp.id = pv.plan_price_id
       where pv.environment = v_env and pv.price_reference = v_item.item->>'price_reference'
       limit 1;
    end if;

    if v_domain is null then
      -- Unknown provider truth is not zero and not nonexistent: the item is kept, unmapped.
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'unmapped_provider_price', 'price_reference', v_item.item->>'price_reference'));
    else
      select kind into v_kind from public.platform_plans where id = v_plan;
      if v_kind = 'plan' then
        v_base_count := v_base_count + 1;
        if v_base_count = 1 then
          v_base_ref   := v_item.item->>'item_reference';
          v_base_price := v_item.item->>'price_reference';
          v_base_plan  := v_plan;
          v_base_start := case when v_item.item->>'current_period_start' is null then null
                               else to_timestamp((v_item.item->>'current_period_start')::bigint) end;
          v_base_end   := case when v_item.item->>'current_period_end' is null then null
                               else to_timestamp((v_item.item->>'current_period_end')::bigint) end;
        end if;
      end if;
    end if;

    v_refs := v_refs || (v_item.item->>'item_reference');

    insert into public.organization_platform_subscription_items (
      organization_id, environment, provider, subscription_reference, provider_item_reference,
      provider_price_reference, quantity, current_period_start, current_period_end,
      canonical_source_domain, canonical_source_record_id, plan_id, active, removed_at,
      last_provider_event_reference, last_provider_event_created_at
    )
    values (
      v_org, v_env, p_provider, p_subscription_reference, v_item.item->>'item_reference',
      v_item.item->>'price_reference',
      (v_item.item->>'quantity')::integer,
      case when v_item.item->>'current_period_start' is null then null
           else to_timestamp((v_item.item->>'current_period_start')::bigint) end,
      case when v_item.item->>'current_period_end' is null then null
           else to_timestamp((v_item.item->>'current_period_end')::bigint) end,
      v_domain, v_source, v_plan,
      not v_deleted, case when v_deleted then v_event_at else null end,
      p_event_reference, v_event_at
    )
    on conflict (organization_id, environment, subscription_reference, provider_item_reference) do update
      set provider_price_reference       = excluded.provider_price_reference,
          quantity                       = excluded.quantity,
          current_period_start           = excluded.current_period_start,
          current_period_end             = excluded.current_period_end,
          canonical_source_domain        = excluded.canonical_source_domain,
          canonical_source_record_id     = excluded.canonical_source_record_id,
          plan_id                        = excluded.plan_id,
          active                         = excluded.active,
          removed_at                     = excluded.removed_at,
          last_observed_at               = now(),
          last_provider_event_reference  = excluded.last_provider_event_reference,
          last_provider_event_created_at = excluded.last_provider_event_created_at;
  end loop;

  -- An item the provider no longer lists is removed, not deleted: the row is the evidence, and
  -- its timestamp is what a delayed older event is refused against.
  update public.organization_platform_subscription_items
     set active = false, removed_at = v_event_at, last_observed_at = now(),
         last_provider_event_reference = p_event_reference, last_provider_event_created_at = v_event_at
   where organization_id = v_org and environment = v_env
     and subscription_reference = p_subscription_reference and active
     and (v_deleted or provider_item_reference <> all (v_refs));

  -- ---- the parent's period follows the base Plan item ---------------------------------------
  if v_base_count > 1 then
    v_ambiguous := true;
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'multiple_base_plan_items'));
  elsif v_base_count = 0 then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'base_plan_item_unidentified'));
  end if;

  if v_base_ref is not null and v_base_start is not null and v_base_end is not null then
    v_period_start := v_base_start; v_period_end := v_base_end;
  elsif p_current_period_start is not null and p_current_period_end is not null then
    v_period_start := to_timestamp(p_current_period_start); v_period_end := to_timestamp(p_current_period_end);
  else
    -- Deterministic fallback, flagged above when no base item was found: the soonest-ending item
    -- period, ties broken by start and then reference -- never "whichever item came first".
    select to_timestamp((i.item->>'current_period_start')::bigint),
           to_timestamp((i.item->>'current_period_end')::bigint)
      into v_period_start, v_period_end
      from jsonb_array_elements(p_items) as i(item)
     where i.item->>'current_period_start' is not null and i.item->>'current_period_end' is not null
     order by (i.item->>'current_period_end')::bigint, (i.item->>'current_period_start')::bigint,
              i.item->>'item_reference'
     limit 1;
  end if;

  v_legacy_price := coalesce(v_base_price,
    (select min(i.item->>'price_reference') from jsonb_array_elements(p_items) as i(item)));

  -- ---- correlation: a token we put on the subscription, never an authority ------------------
  if coalesce(btrim(p_checkout_correlation), '') <> '' then
    begin
      v_corr_uuid := p_checkout_correlation::uuid;
    exception when invalid_text_representation then
      v_corr_uuid := null;
    end;

    if v_corr_uuid is null then
      v_corr := 'invalid'; v_corr_why := 'malformed';
    else
      select * into v_session from public.platform_billing_checkout_sessions where id = v_corr_uuid;
      if not found then
        v_corr := 'invalid'; v_corr_why := 'unknown_checkout';
      elsif v_session.organization_id <> v_org then
        v_corr := 'invalid'; v_corr_why := 'other_organization';
      elsif v_session.environment <> v_env then
        v_corr := 'invalid'; v_corr_why := 'other_environment';
      else
        v_corr := 'linked';
      end if;
    end if;
  end if;

  if v_corr = 'invalid' then
    v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'checkout_correlation_invalid', 'reason', v_corr_why));
  end if;

  -- ---- reconcile the recurring items against what the checkout reviewed ---------------------
  -- Only the snapshot's recurring lines: its providerLines are the recurring lines followed by
  -- the due-now ones, in the order checkout.ts built them. A one-time line is legitimately not a
  -- subscription item. Compared as price -> total quantity, so item order never matters.
  if v_corr = 'linked' then
    if v_session.quote_snapshot is null or jsonb_typeof(v_session.quote_snapshot->'providerLines') <> 'array' then
      v_issues := v_issues || jsonb_build_array(jsonb_build_object('code', 'checkout_snapshot_missing'));
    else
      v_recurring_n := jsonb_array_length(coalesce(v_session.quote_snapshot->'recurring', '[]'::jsonb));
      for v_row in
        select coalesce(e.price, a.price) as price, e.qty as expected, a.qty as actual
          from (select l.line->>'providerPriceReference' as price, sum((l.line->>'quantity')::integer) as qty
                  from jsonb_array_elements(v_session.quote_snapshot->'providerLines') with ordinality as l(line, ord)
                 where l.ord <= v_recurring_n
                 group by 1) e
          full join (select i.item->>'price_reference' as price, sum((i.item->>'quantity')::integer) as qty
                       from jsonb_array_elements(p_items) as i(item)
                      group by 1) a on a.price = e.price
         where e.qty is distinct from a.qty
         order by 1
      loop
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'code', case when v_row.expected is null then 'unexpected_recurring_price'
                       when v_row.actual   is null then 'missing_recurring_price'
                       else 'quantity_mismatch' end,
          'price_reference', v_row.price, 'expected_quantity', v_row.expected, 'actual_quantity', v_row.actual));
      end loop;
    end if;
  end if;

  v_state := case
    when v_ambiguous then 'ambiguous'
    when v_corr = 'absent' then 'legacy_unlinked'
    when v_corr = 'invalid' then 'mismatch'
    when v_issues @> '[{"code": "checkout_snapshot_missing"}]'::jsonb then 'legacy_unlinked'
    when jsonb_array_length(v_issues) > 0 then 'mismatch'
    else 'matched'
  end;

  -- ---- the parent ---------------------------------------------------------------------------
  insert into public.organization_platform_subscriptions
    (organization_id, environment, provider, subscription_reference, price_reference, plan_id,
     status, currency, current_period_start, current_period_end, cancel_at_period_end,
     canceled_at, updated_at, last_provider_event_reference, last_provider_event_created_at,
     base_item_reference, checkout_session_id, reconciliation_state, reconciliation_detail, reconciled_at)
  values
    (v_org, v_env, p_provider, p_subscription_reference, v_legacy_price, v_base_plan,
     p_status, p_currency, v_period_start, v_period_end, p_cancel_at_period_end,
     case when p_canceled_at is not null then to_timestamp(p_canceled_at)
          when v_deleted then v_event_at else null end,
     now(), p_event_reference, v_event_at,
     v_base_ref, case when v_corr = 'linked' then v_session.id else null end,
     v_state, v_issues, now())
  on conflict (organization_id, environment) do update
    set provider                        = excluded.provider,
        subscription_reference          = excluded.subscription_reference,
        price_reference                 = excluded.price_reference,
        plan_id                         = excluded.plan_id,
        status                          = excluded.status,
        currency                        = excluded.currency,
        current_period_start            = excluded.current_period_start,
        current_period_end              = excluded.current_period_end,
        cancel_at_period_end            = excluded.cancel_at_period_end,
        canceled_at                     = excluded.canceled_at,
        updated_at                      = now(),
        last_provider_event_reference   = excluded.last_provider_event_reference,
        last_provider_event_created_at  = excluded.last_provider_event_created_at,
        base_item_reference             = excluded.base_item_reference,
        checkout_session_id             = excluded.checkout_session_id,
        reconciliation_state            = excluded.reconciliation_state,
        reconciliation_detail           = excluded.reconciliation_detail,
        reconciled_at                   = excluded.reconciled_at;

  if v_corr = 'linked' then
    update public.platform_billing_checkout_sessions
       set provider_subscription_reference = p_subscription_reference,
           provider_confirmed_at = coalesce(provider_confirmed_at, v_event_at),
           provider_confirmed_event_reference = coalesce(provider_confirmed_event_reference, p_event_reference),
           reconciliation_state = v_state,
           reconciliation_detail = v_issues
     where id = v_session.id and organization_id = v_org;
  end if;

  update public.platform_billing_webhook_events
     set application = 'applied', reconciliation_state = v_state where id = v_event_id;

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (v_org, v_actor, 'organization', v_org,
          case when v_deleted then 'platform_subscription.canceled' else 'platform_subscription.updated' end,
          jsonb_build_object('subscription_reference', p_subscription_reference, 'status', p_status,
                             'reconciliation_state', v_state));

  return v_org;
end;
$function$;

comment on function public.apply_platform_subscription_event(text, text, text, text, text, text, bigint, bigint, boolean, bigint, bigint, jsonb, text, text, text) is
  'The only thing platform_billing_webhook may do for a subscription-lifecycle event. Derives the organization from a finalized platform_billing_customers reference in the event''s own provider and environment rather than trusting the event; an unknown or pending reference is ignored and an ambiguous one is refused. Idempotent by the processor''s own event reference; ordered by the processor''s own occurrence time, so an older event is recorded and changes nothing. Caches every recurring item, resolves each to its canonical price record, and reconciles them to the correlated checkout snapshot. Never assigns, removes or entitles anything -- a mismatch is evidence for staff.';

revoke all on function public.apply_platform_subscription_event(text, text, text, text, text, text, bigint, bigint, boolean, bigint, bigint, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.apply_platform_subscription_event(text, text, text, text, text, text, bigint, bigint, boolean, bigint, bigint, jsonb, text, text, text) to platform_billing_webhook;

drop function public.record_platform_billing_notice(text, text, text, text);

create or replace function public.record_platform_billing_notice(
  p_event_reference text,
  p_event_type text,
  p_customer_reference text,
  p_provider text default 'stripe',
  p_environment text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_org uuid;
  v_env text;
begin
  select c.organization_id, c.environment into v_org, v_env
    from app.platform_billing_customer_for_event(p_provider, p_environment, p_customer_reference) c;
  if v_org is null then
    return null;
  end if;

  insert into public.platform_billing_webhook_events
    (provider, event_reference, event_type, environment, organization_id)
  values (p_provider, p_event_reference, p_event_type, v_env, v_org)
  on conflict (organization_id, event_reference) do nothing;

  if not found then
    return null;
  end if;

  return v_org;
end;
$fn$;

comment on function public.record_platform_billing_notice(text, text, text, text, text) is
  'invoice.paid and invoice.payment_failed: logged for the idempotency ledger and platform diagnostics against the finalized customer in the event''s own provider and environment, never a subscription-status writer -- the processor already sends a subscription-updated event alongside the status transition either causes (docs.stripe.com/billing/subscriptions/webhooks, "Catch subscription status changes"), and apply_platform_subscription_event is the one place that column is ever written.';

revoke all on function public.record_platform_billing_notice(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.record_platform_billing_notice(text, text, text, text, text) to platform_billing_webhook;

drop function public.begin_platform_billing_portal_session(uuid);

create or replace function public.begin_platform_billing_portal_session(
  p_organization_id uuid,
  p_environment text default null
)
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_customer text;
  v_matches integer;
begin
  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'billing.manage') then
    raise exception 'insufficient capability' using errcode = '42501';
  end if;
  if p_environment is not null and p_environment not in ('sandbox', 'live') then
    raise exception 'unknown billing environment' using errcode = '22023';
  end if;

  -- security invoker: the select policy already lets a member read its own row. A pending
  -- placeholder is not a customer, and without an environment a sandbox and a live customer are
  -- two answers, which is refused rather than one chosen.
  select count(*), min(c.customer_reference) into v_matches, v_customer
    from public.platform_billing_customers c
   where c.organization_id = p_organization_id
     and c.customer_reference not like 'pending:%'
     and (p_environment is null or c.environment = p_environment);

  if v_matches > 1 then
    raise exception 'this organization has billing customers in more than one environment' using errcode = '21000';
  end if;

  return v_customer;
end;
$fn$;

comment on function public.begin_platform_billing_portal_session(uuid, text) is
  'Checks billing.manage and hands back this organization''s own finalized customer reference for the deployment''s environment, or null if none has been finalized. Read-only: opening a Customer Portal session is a processor call apps/web makes with the reference this returns, never a database write.';

revoke all on function public.begin_platform_billing_portal_session(uuid, text) from public, anon;
grant execute on function public.begin_platform_billing_portal_session(uuid, text) to authenticated;

commit;

-- C3. A provider subscription is its items, correlated to the checkout that bought it, and an
-- older event never overwrites a newer one.
--
-- Three gaps the single-line design (20260922000004) left once checkout began buying a base Plan,
-- recurring Add-ons and a one-time fee in one session (20261108000001/2/3):
--
-- 1. `organization_platform_subscriptions` carried ONE `price_reference` and ONE `plan_id`, as though a
--    subscription meant one Plan price. The provider's recurring state is a set of subscription
--    items; `organization_platform_subscription_items` caches that set, one row per item, and is
--    only ever *what the provider currently says is on its subscription* -- never what GildOps
--    sold (assignments), never what is granted (entitlements), never what is owed (charges).
--
-- 2. Nothing connected a provider subscription back to the checkout snapshot that bought it, so
--    "does the provider bill what the customer reviewed?" had no answer. The checkout session id
--    now rides on the provider subscription's own metadata; the webhook reads it as a
--    *correlation*, never as authorization -- the organization is still derived from the provider
--    Customer already on file, and a correlation naming another business's checkout is refused.
--
-- 3. Idempotency stopped one event arriving twice, not an older event arriving after a newer one.
--    The provider's own occurrence time (`event.created`) now orders lifecycle truth; receipt time
--    describes GildOps and decides nothing.
--
-- **What this does not do.** It never assigns an Add-on because a provider item exists, never
-- removes an assignment because one disappears, and never touches service access or entitlement:
-- a mismatch is evidence for staff. Package change is C6, invoices/payments are C4, settlement is C5.
--
-- **Legacy columns.** `price_reference` and `plan_id` on the parent stay, populated from the base
-- Plan item where one is identified, so existing rows and readers remain valid. They are the
-- single-item compatibility shape; new logic reads the items table.

-- ---------------------------------------------------------------------------
-- 1. Checkout sessions: a composite key target, and what the provider confirmed
-- ---------------------------------------------------------------------------

alter table public.platform_billing_checkout_sessions
  add constraint platform_billing_checkout_sessions_org_id_unique unique (organization_id, id);

alter table public.platform_billing_checkout_sessions
  add column provider_subscription_reference text,
  add column provider_confirmed_at timestamptz,
  add column provider_confirmed_event_reference text,
  add column reconciliation_state text
    check (reconciliation_state in ('matched', 'mismatch', 'legacy_unlinked', 'ambiguous')),
  add column reconciliation_detail jsonb;

comment on column public.platform_billing_checkout_sessions.provider_confirmed_at is
  'The provider''s own occurrence time of the first subscription event that correlated to this '
  'checkout. "Provider subscription confirmed" -- never "paid": invoices and payments are C4.';

comment on column public.platform_billing_checkout_sessions.reconciliation_state is
  'Whether the provider''s recurring items matched this session''s quote_snapshot, as of the latest '
  'applied subscription event. Null until a provider subscription correlated to this session. Written '
  'only by apply_platform_subscription_event; quote_snapshot itself is never touched.';

-- A table-wide `grant insert`/`grant update` is a promise about every column the table will ever
-- have. The provider's confirmation is the webhook's fact, not the billing manager's, so the
-- tenant's grants become explicit column lists: what checkout.ts writes today, and nothing newer.
revoke insert, update on public.platform_billing_checkout_sessions from authenticated;

grant insert (
  id, organization_id, environment, plan_price_id, provider_reference, requested_at, requested_by,
  quote_snapshot, quote_version, expires_at
) on public.platform_billing_checkout_sessions to authenticated;

grant update (provider_reference) on public.platform_billing_checkout_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The parent: provider-state ordering, correlation and reconciliation
-- ---------------------------------------------------------------------------

alter table public.organization_platform_subscriptions
  add column last_provider_event_reference  text,
  add column last_provider_event_created_at timestamptz,
  add column base_item_reference            text,
  add column checkout_session_id            uuid,
  add column reconciliation_state           text not null default 'legacy_unlinked'
    check (reconciliation_state in ('matched', 'mismatch', 'legacy_unlinked', 'ambiguous')),
  add column reconciliation_detail          jsonb not null default '[]'::jsonb,
  add column reconciled_at                  timestamptz,
  add constraint organization_platform_subscriptions_checkout_fk
    foreign key (organization_id, checkout_session_id)
    references public.platform_billing_checkout_sessions (organization_id, id);

comment on column public.organization_platform_subscriptions.price_reference is
  'LEGACY single-item compatibility: the base Plan item''s provider price where one is identified, '
  'otherwise the lowest price reference on the subscription. Nothing new reads it -- the items are '
  'organization_platform_subscription_items.';

comment on column public.organization_platform_subscriptions.plan_id is
  'LEGACY single-item compatibility: the base Plan item''s Plan where one is identified, otherwise null.';

comment on column public.organization_platform_subscriptions.last_provider_event_created_at is
  'The provider''s own occurrence time of the newest event applied to this row. An event older than '
  'this is recorded in diagnostics and changes nothing. Receipt time (updated_at) is GildOps''s clock '
  'and orders nothing.';

comment on column public.organization_platform_subscriptions.base_item_reference is
  'The provider item identified as the base Plan -- the one whose canonical Plan has kind ''plan''. '
  'Null when none (or more than one, which reconciliation_state records as ambiguous).';

comment on column public.organization_platform_subscriptions.reconciliation_state is
  'matched: the provider''s recurring items equal the correlated checkout snapshot''s recurring lines. '
  'mismatch: they do not, an item is unknown to GildOps, or the correlation was invalid. '
  'legacy_unlinked: no checkout correlation (or no snapshot to compare) -- cached honestly, never '
  'claimed as reconciled. ambiguous: the provider''s own ordering or identity cannot decide. '
  'Operator attention only: service access never reads it.';

-- ---------------------------------------------------------------------------
-- 3. The item cache
-- ---------------------------------------------------------------------------

create table public.organization_platform_subscription_items (
  id                            uuid        primary key default gen_random_uuid(),
  organization_id               uuid        not null references public.organizations (id) on delete cascade,
  environment                   text        not null check (environment in ('sandbox', 'live')),
  provider                      text        not null default 'stripe' check (length(btrim(provider)) between 1 and 40),
  subscription_reference        text        not null check (length(btrim(subscription_reference)) between 1 and 200),
  provider_item_reference       text        not null check (length(btrim(provider_item_reference)) between 1 and 200),
  provider_price_reference      text        not null check (length(btrim(provider_price_reference)) between 1 and 200),
  -- What the provider reports. Null is "the provider reported none" (a metered item), never 1.
  quantity                      integer     check (quantity is null or quantity >= 0),
  current_period_start          timestamptz,
  current_period_end            timestamptz,
  -- Which canonical price record this provider Price maps to, resolved at write time from the
  -- provider-price mapping tables; null is "unknown to GildOps", not "none".
  canonical_source_domain       text        check (canonical_source_domain in ('catalogue.plan_price', 'catalogue.plan_agreement')),
  canonical_source_record_id    uuid,
  plan_id                       uuid        references public.platform_plans (id),
  active                        boolean     not null default true,
  removed_at                    timestamptz,
  first_observed_at             timestamptz not null default now(),
  last_observed_at              timestamptz not null default now(),
  last_provider_event_reference text        not null,
  last_provider_event_created_at timestamptz not null,

  -- I2: leads with organization_id. The provider's item id is opaque and unique in practice; the
  -- database does not lean on that.
  constraint organization_platform_subscription_items_unique
    unique (organization_id, environment, subscription_reference, provider_item_reference),
  constraint organization_platform_subscription_items_source_pair
    check ((canonical_source_domain is null) = (canonical_source_record_id is null)),
  constraint organization_platform_subscription_items_active_removed
    check (active = (removed_at is null))
);

comment on table public.organization_platform_subscription_items is
  'What the provider currently says is on one subscription, one row per recurring item -- a '
  'maintained cache written only by apply_platform_subscription_event. NOT what GildOps sold '
  '(organization_plan_assignments), NOT what is granted (entitlements), NOT what is owed (charges). '
  'A removed item stays as an inactive row so a delayed older event cannot resurrect it and staff '
  'keep the evidence. One-time checkout lines are not subscription items and never appear here.';

create index organization_platform_subscription_items_subscription_idx
  on public.organization_platform_subscription_items (organization_id, environment, subscription_reference, active);

alter table public.organization_platform_subscription_items enable row level security;
alter table public.organization_platform_subscription_items force row level security;

create policy organization_platform_subscription_items_select on public.organization_platform_subscription_items
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) or app.is_platform_staff());

grant select on public.organization_platform_subscription_items to authenticated;
-- No insert/update/delete grant to anyone: apply_platform_subscription_event is the only door.

-- ---------------------------------------------------------------------------
-- 4. Webhook diagnostics: when the provider says it happened, and what GildOps did with it
-- ---------------------------------------------------------------------------

alter table public.platform_billing_webhook_events
  add column provider_event_created_at timestamptz,
  add column application text check (application in ('applied', 'stale', 'ambiguous')),
  add column reconciliation_state text
    check (reconciliation_state in ('matched', 'mismatch', 'legacy_unlinked', 'ambiguous'));

comment on column public.platform_billing_webhook_events.application is
  'applied: changed (or confirmed) current state. stale: older than the state already held, recorded '
  'and ignored. ambiguous: same provider instant as the state held but saying something different -- '
  'recorded, not applied, and the subscription is flagged for staff. Null for invoice notices.';

-- ---------------------------------------------------------------------------
-- 5. An ended subscription is not a billing period
-- ---------------------------------------------------------------------------
-- Deleting the parent row on `customer.subscription.deleted` used to be what made the allowance
-- window fall back to the Plan assignment's anchor. The row is now kept (its event clock is what
-- stops a delayed older event resurrecting it), so the window must ignore an ended subscription
-- itself. Otherwise unchanged from 20261105000002.

create or replace function app.allowance_window(
  p_organization_id uuid,
  p_reset_semantics text,
  p_period          text,
  p_at              timestamptz default now()
)
returns table (starts_at timestamptz, ends_at timestamptz, basis text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_tz        text;
  v_step      interval;
  v_anchor    timestamptz;
  v_start     timestamptz;
  v_steps     bigint;
  v_sub_start timestamptz;
  v_sub_end   timestamptz;
  v_local     timestamp;
begin
  v_step := case p_period
              when 'day'   then interval '1 day'
              when 'week'  then interval '7 days'
              when 'month' then interval '1 month'
              when 'year'  then interval '1 year'
            end;

  if p_reset_semantics = 'none' or v_step is null then
    return query select null::timestamptz, null::timestamptz, 'none'::text;
    return;
  end if;

  select o.timezone into v_tz from public.organizations o where o.id = p_organization_id;
  v_tz := coalesce(nullif(btrim(v_tz), ''), 'UTC');

  if p_reset_semantics = 'calendar_period' then
    v_local := date_trunc(p_period, p_at at time zone v_tz);
    return query select (v_local at time zone v_tz), ((v_local + v_step) at time zone v_tz), 'calendar'::text;
    return;
  end if;

  select s.current_period_start, s.current_period_end
    into v_sub_start, v_sub_end
    from public.organization_platform_subscriptions s
   where s.organization_id = p_organization_id
     and s.status not in ('canceled', 'incomplete_expired')
     and s.current_period_start is not null
     and s.current_period_end   is not null
     and s.current_period_start <= p_at
     and s.current_period_end   >  p_at
   order by (s.environment = 'live') desc, s.current_period_start desc
   limit 1;

  if v_sub_start is not null then
    return query select v_sub_start, v_sub_end, 'subscription'::text;
    return;
  end if;

  select (a.period_start::timestamp at time zone v_tz) into v_anchor
    from public.organization_plan_assignments a
   where a.organization_id = p_organization_id
     and a.period_start <= p_at::date
     and a.period_end   >  p_at::date
   order by (a.plan_kind = 'plan') desc, a.period_start asc
   limit 1;

  if v_anchor is null then
    return query select null::timestamptz, null::timestamptz, 'unknown'::text;
    return;
  end if;

  if p_at < v_anchor then
    return query select v_anchor, v_anchor + v_step, 'assignment'::text;
    return;
  end if;

  if p_period in ('day', 'week') then
    v_steps := floor(extract(epoch from (p_at - v_anchor)) / extract(epoch from v_step));
  elsif p_period = 'month' then
    v_steps := (extract(year  from (p_at at time zone v_tz))::bigint
                - extract(year  from (v_anchor at time zone v_tz))::bigint) * 12
             + (extract(month from (p_at at time zone v_tz))::bigint
                - extract(month from (v_anchor at time zone v_tz))::bigint);
  else
    v_steps := extract(year from (p_at at time zone v_tz))::bigint
             - extract(year from (v_anchor at time zone v_tz))::bigint;
  end if;

  v_start := v_anchor + (greatest(v_steps, 0) * v_step);
  while v_start > p_at loop v_start := v_start - v_step; end loop;
  while v_start + v_step <= p_at loop v_start := v_start + v_step; end loop;

  return query select v_start, v_start + v_step, 'assignment'::text;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 6. The one door: apply one provider subscription event
-- ---------------------------------------------------------------------------

drop function public.apply_platform_subscription_event(text, text, text, text, text, text, text, bigint, bigint, boolean, bigint, text);

create function public.apply_platform_subscription_event(
  p_event_reference          text,
  p_event_type               text,
  p_customer_reference       text,
  p_subscription_reference   text,
  p_status                   text,
  p_currency                 text,
  p_current_period_start     bigint,
  p_current_period_end       bigint,
  p_cancel_at_period_end     boolean,
  p_canceled_at              bigint,
  p_provider_event_created_at bigint,
  p_items                    jsonb,
  p_checkout_correlation     text,
  p_provider                 text default 'stripe'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
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
  -- whose customer this is -- never from the correlation id or anything else in the payload.
  begin
    select organization_id, environment into strict v_org, v_env
    from public.platform_billing_customers
    where customer_reference = p_customer_reference;
  exception
    when no_data_found then
      return null;
  end;

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
$fn$;

comment on function public.apply_platform_subscription_event(text, text, text, text, text, text, bigint, bigint, boolean, bigint, bigint, jsonb, text, text) is
  'The only thing platform_billing_webhook may do for a subscription-lifecycle event. Derives the '
  'organization from platform_billing_customers rather than trusting the event; idempotent by the '
  'processor''s own event reference; ordered by the processor''s own occurrence time, so an older '
  'event is recorded and changes nothing. Caches every recurring item, resolves each to its canonical '
  'price record, and reconciles them to the correlated checkout snapshot. Never assigns, removes or '
  'entitles anything -- a mismatch is evidence for staff.';

revoke all on function public.apply_platform_subscription_event(text, text, text, text, text, text, bigint, bigint, boolean, bigint, bigint, jsonb, text, text) from public;
grant execute on function public.apply_platform_subscription_event(text, text, text, text, text, text, bigint, bigint, boolean, bigint, bigint, jsonb, text, text) to platform_billing_webhook;

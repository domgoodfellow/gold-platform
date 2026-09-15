-- GOLD Platform Billing: the organization pays GOLD, on GOLD's own processor account.
--
-- **The money direction this migration adds has no processor behind it yet.** Everything the
-- canonical catalogue/Plans migration (20260918000001) built -- Products, Modules, Features,
-- Plans, Add-ons, Subscription provenance, resolved entitlements -- stays exactly as it was.
-- What was missing, named explicitly in `domain-model.md`'s two-plane table, is "GOLD invoices/
-- payments": a Customer for the organization on GOLD's own account, a Subscription against a
-- Plan's price, and a webhook that makes the processor's own state authoritative rather than a
-- browser redirect. This migration adds exactly that, and nothing about
-- `organization_commercial_terms`, `platform_products`, `platform_provider_rates` or
-- `platform_retail_rates` changes.
--
-- **Never confused with tenant commerce.** `payment_accounts`/`payment_requests` (20260829000008,
-- 20260829000011) are a *customer paying a tenant*, through the tenant's own connected processor
-- account (D27). This migration is the opposite direction -- an *organization paying GOLD* -- on
-- GOLD's own processor account, using GOLD's own Customer and Subscription objects. Nothing here
-- reads or writes `payment_accounts`, `payment_requests` or `payments`; nothing there references
-- anything added here. Two money directions, two ledgers, two webhook roles, two signing secrets
-- (`constraints.md`, "Commercial").
--
-- **Vendor-neutral columns, the same discipline `payment_accounts.account_id` and
-- `payment_requests.provider_reference` already hold (I15).** Every identifier this migration's
-- tables carry is `..._reference` plus a `provider` column naming who issued it, never a
-- column named after today's one processor -- so a domain file that reads one never has to say
-- the vendor's name to do it, and `adapters.test.ts`'s scan for a vendor's vocabulary in
-- `lib/domain/**` stays meaningful rather than needing an exception carved out for this feature.
--
-- **Why a fresh Postgres role rather than reusing `payment_webhook`.** Same reasoning as
-- `payment_webhook` vs `voice_webhook`: one processor destination, one signing secret, one narrow
-- role holding exactly the executes it needs and no table grant at all (D14, D26). Reusing
-- `payment_webhook` would mean a leaked platform-billing signing secret could mint a token that
-- also writes tenant-commerce payments, and the other way round.
--
-- **Why price provisioning is a staff action that calls the processor, recorded here rather than
-- done here.** Creating a Product/Price with the processor is an ordinary operator write with a
-- human behind it (D2: TypeScript owns transactional processor calls; Python owns only being
-- called back). This migration adds the table the created ids land in and the one narrow door
-- that writes it -- `record_plan_provider_price` -- not a way to create those objects from SQL.
--
-- **Why `environment` rather than trusting a single processor key at a time forever.** A GOLD
-- deployment's own processor secret is sandbox today and will be live later; every row this
-- migration's tables can hold is tagged with which, so a sandbox customer id can never be read
-- back as though it were a live one, and the unique constraints below are per-environment.
--
-- **billing.manage, not a repurposed `organization.manage`.** Starting a subscription or opening
-- the billing portal moves real money later; D40's rule for tenant-Commerce capabilities applies
-- unchanged one plane over -- a narrow capability, not the general "can administer this business"
-- one, exactly as `payment.record` stayed its own capability rather than folding into
-- `organization.manage`.

-- ---------------------------------------------------------------------------
-- billing.manage
-- ---------------------------------------------------------------------------

alter table public.roles drop constraint roles_capabilities_known;

alter table public.roles
  add constraint roles_capabilities_known
  check (capabilities <@ array[
    'customer.create',
    'customer.update',
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
    'report.manage',
    'call.place',
    'integration.manage',
    'feature.manage',
    'billing.manage'
  ]::text[]);

-- Same backfill `feature.manage` and `integration.manage` each received: whoever already
-- administers the business starts holding this too, and a business that wants it split apart
-- from `organization.manage` grants the two separately from here on.
update public.roles
   set capabilities = capabilities || array['billing.manage']::text[]
 where 'organization.manage' = any (capabilities)
   and not ('billing.manage' = any (capabilities));

-- ---------------------------------------------------------------------------
-- platform_billing_customers -- an organization's Customer on GOLD's own processor account
-- ---------------------------------------------------------------------------

create table public.platform_billing_customers (
  id                  uuid        primary key default gen_random_uuid(),
  organization_id     uuid        not null references public.organizations (id) on delete cascade,
  environment         text        not null check (environment in ('sandbox', 'live')),
  provider            text        not null default 'stripe' check (length(btrim(provider)) between 1 and 40),
  customer_reference  text        not null check (length(btrim(customer_reference)) between 1 and 200),
  created_at          timestamptz not null default now(),
  created_by          uuid        not null references auth.users (id),

  -- I2: leads with organization_id. One Customer per organization per environment.
  constraint platform_billing_customers_one_per_environment unique (organization_id, environment)
);

comment on table public.platform_billing_customers is
  'The organization''s own Customer on GOLD''s own processor account -- never a tenant''s connected '
  'account (payment_accounts) and never joined to it. GOLD is authoritative for which organization '
  'a customer reference belongs to; the processor is authoritative for everything about the '
  'customer itself. Written by the organization''s own billing manager as a placeholder row, '
  'corrected once the processor answers -- see the insert/update policies below. The same "ask, '
  'then correct" shape payment_requests uses, restated for provisioning rather than a one-off '
  'request: the row proves authorization before the processor is ever asked for anything, rather '
  'than after. A genuinely different processor account for an organization thereafter is an '
  'operational event rare enough to be a staff SQL snippet, not a product feature.';

-- **Deliberately no global unique index on `(environment, customer_reference)`, and that is the
-- same call `payment_requests_org_provider_reference_unique`'s own comment already made (I2): a
-- value the processor hands back is not one this table may let a caller uniquely claim across
-- tenants, because a unique index leading with anything but `organization_id` is exactly the
-- shape that would let one organization capture -- or block -- another's real customer
-- reference. The two webhook functions below resolve `select ... into strict` on this column
-- instead, so a collision (which would require an attacker to both hold `billing.manage`
-- somewhere and already know another organization's real, processor-generated reference) fails
-- loudly rather than silently misattributing a subscription event to the wrong organization.

alter table public.platform_billing_customers enable row level security;
alter table public.platform_billing_customers force row level security;

create policy platform_billing_customers_select on public.platform_billing_customers
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) or app.is_platform_staff());

-- The one write door, and it is an ordinary RLS-gated insert (the same shape payment_accounts
-- uses for a tenant recording its own connected account) rather than a SECURITY DEFINER function
-- -- there is no staff-vs-tenant asymmetry here to enforce, only "this organization's own billing
-- manager, about this organization". `billing.manage` is what checks that; the unique constraint
-- above is what makes a race between two concurrent first-time provisions land on one row rather
-- than two (I6).
create policy platform_billing_customers_insert on public.platform_billing_customers
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'billing.manage')
  );

-- Correcting the placeholder with the processor's own reference once it answers -- the same
-- "ask, then correct" shape platform_billing_checkout_sessions uses, and gated by the same
-- capability rather than a second one. No delete grant: once corrected, the row is never removed
-- by this door (see the table comment for what a genuine replacement looks like).
create policy platform_billing_customers_update on public.platform_billing_customers
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'billing.manage')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'billing.manage')
  );

grant select, insert, update on public.platform_billing_customers to authenticated;

-- ---------------------------------------------------------------------------
-- organization_platform_subscriptions -- the processor's own facts, cached for fast reads
-- ---------------------------------------------------------------------------

create table public.organization_platform_subscriptions (
  id                     uuid        primary key default gen_random_uuid(),
  organization_id        uuid        not null references public.organizations (id) on delete cascade,
  environment            text        not null check (environment in ('sandbox', 'live')),
  provider               text        not null default 'stripe' check (length(btrim(provider)) between 1 and 40),
  subscription_reference text        not null check (length(btrim(subscription_reference)) between 1 and 200),
  price_reference        text        not null check (length(btrim(price_reference)) between 1 and 200),
  -- Resolved via platform_plan_provider_prices at write time; nullable because a price this
  -- deployment provisioned outside the mapping table (or a retired one) must not block recording
  -- what the processor itself says is true.
  plan_id                uuid        references public.platform_plans (id),
  status                 text        not null check (status in (
                             'trialing', 'active', 'past_due', 'unpaid', 'canceled',
                             'incomplete', 'incomplete_expired', 'paused'
                           )),
  currency               text        not null check (currency ~ '^[A-Z]{3}$'),
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean     not null default false,
  canceled_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- One GOLD subscription per organization per environment (I2). Add-ons stacking as several
  -- processor Subscriptions is deliberately out of scope for this slice -- the processor's own
  -- recommended shape for "a base plan plus add-ons" is several *items* on one Subscription, and
  -- this table carries only the shape this slice actually writes.
  constraint organization_platform_subscriptions_one_per_environment unique (organization_id, environment)
);

comment on table public.organization_platform_subscriptions is
  'The processor is authoritative for every column here (D-restated for this plane): this table '
  'is a maintained cache, upserted only by apply_platform_subscription_event in response to the '
  'processor''s own subscription-lifecycle events -- never written from a browser redirect '
  '(Phase 7''s own rule: the return URL is not proof of payment). Deliberately no global unique '
  'index on (environment, subscription_reference) -- the same I2 reasoning '
  'platform_billing_customers'' comment gives for customer_reference, one table over.';

alter table public.organization_platform_subscriptions enable row level security;
alter table public.organization_platform_subscriptions force row level security;

create policy organization_platform_subscriptions_select on public.organization_platform_subscriptions
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) or app.is_platform_staff());

grant select on public.organization_platform_subscriptions to authenticated;
-- No insert/update/delete grant to anyone -- apply_platform_subscription_event, granted only to
-- platform_billing_webhook below, is the only door.

-- ---------------------------------------------------------------------------
-- platform_billing_webhook_events -- idempotency ledger for GOLD's own billing destination
-- ---------------------------------------------------------------------------

create table public.platform_billing_webhook_events (
  id               uuid        primary key default gen_random_uuid(),
  provider         text        not null default 'stripe' check (length(btrim(provider)) between 1 and 40),
  event_reference  text        not null check (length(btrim(event_reference)) between 1 and 200),
  event_type       text        not null,
  environment      text        not null check (environment in ('sandbox', 'live')),
  -- Not null in practice -- both writer functions resolve and require an organization before
  -- this table is ever inserted into -- but the column stays nullable rather than adding a
  -- fourth "this can never actually happen" NOT NULL nobody can prove from the schema alone.
  organization_id  uuid        references public.organizations (id),
  received_at      timestamptz not null default now(),

  -- I2: leads with organization_id. The processor's own event reference is already globally
  -- unique by its own guarantee, and every insert here resolves organization_id
  -- deterministically from the event's customer before this constraint is ever tested -- so
  -- scoping the constraint by organization_id loses no protection it would otherwise have, and
  -- gains conformance with the rule every other tenant-referencing table in this schema follows.
  constraint platform_billing_webhook_events_org_event_unique unique (organization_id, event_reference)
);

comment on table public.platform_billing_webhook_events is
  'Every GOLD-platform-billing event this deployment has acted on, by the processor''s own event '
  'reference -- a second delivery of the same reference is a no-op rather than a duplicate write, '
  'tolerating at-least-once retries without a payload-hash comparison (unlike call_events, an '
  'event reference is never reused for a different payload).';

alter table public.platform_billing_webhook_events enable row level security;
alter table public.platform_billing_webhook_events force row level security;

-- Staff diagnostic only -- never a tenant's to read, and never inserted to except by the
-- function below.
create policy platform_billing_webhook_events_select on public.platform_billing_webhook_events
  for select to authenticated
  using (app.is_platform_staff());

grant select on public.platform_billing_webhook_events to authenticated;

-- ---------------------------------------------------------------------------
-- platform_plan_provider_prices -- a Plan's standard price, provisioned with the processor
-- ---------------------------------------------------------------------------

create table public.platform_plan_provider_prices (
  id                  uuid        primary key default gen_random_uuid(),
  plan_price_id       uuid        not null references public.platform_plan_prices (id) on delete cascade,
  environment         text        not null check (environment in ('sandbox', 'live')),
  provider            text        not null default 'stripe' check (length(btrim(provider)) between 1 and 40),
  product_reference   text        not null check (length(btrim(product_reference)) between 1 and 200),
  price_reference     text        not null check (length(btrim(price_reference)) between 1 and 200),
  provisioned_at      timestamptz not null default now(),
  provisioned_by      uuid        not null references auth.users (id),

  constraint platform_plan_provider_prices_unique_moment unique (plan_price_id, environment)
);

comment on table public.platform_plan_provider_prices is
  'Which processor Product/Price backs one platform_plan_prices row, per environment -- staff-'
  'provisioned (Phase 4: GOLD provisions Products/Prices through its own admin, never a Price '
  'invented at checkout time) and append-only, the same shape platform_plan_prices itself already '
  'uses. Readable by any signed-in caller, the same as platform_plan_prices itself (D43''s existing '
  'pattern for pricing vocabulary) -- a price reference is not a secret, and Checkout resolves a '
  'Plan key to one entirely server-side regardless (Phase 7''s "no arbitrary browser-supplied '
  'Price id" is about who *decides* the reference, never about who may read the mapping row; '
  'checkout.ts runs under the caller''s own RLS-scoped session, not a service-role client (D14), '
  'so a staff-only policy here would have made every tenant checkout fail rather than made '
  'anything safer).';

create unique index platform_plan_provider_prices_reference_unique
  on public.platform_plan_provider_prices (environment, price_reference);

alter table public.platform_plan_provider_prices enable row level security;
alter table public.platform_plan_provider_prices force row level security;

create policy platform_plan_provider_prices_select on public.platform_plan_provider_prices
  for select to authenticated using (true);

grant select on public.platform_plan_provider_prices to authenticated;
-- No insert/update/delete grant to anyone -- record_plan_provider_price, below, is the only door.

-- ---------------------------------------------------------------------------
-- platform_billing_checkout_sessions -- the authorization gate and idempotency anchor
-- ---------------------------------------------------------------------------

create table public.platform_billing_checkout_sessions (
  id                 uuid        primary key default gen_random_uuid(),
  organization_id    uuid        not null references public.organizations (id) on delete cascade,
  environment        text        not null check (environment in ('sandbox', 'live')),
  plan_price_id      uuid        not null references public.platform_plan_prices (id),
  provider_reference text,
  requested_at       timestamptz not null default now(),
  requested_by       uuid        not null references auth.users (id)
);

comment on table public.platform_billing_checkout_sessions is
  'Our own correlation token, written before the processor is asked for anything -- the same '
  'shape payment_requests already uses for tenant commerce. Two jobs at once: the RLS insert '
  'below is the actual `billing.manage` enforcement point for starting a subscription (there is '
  'no other write to gate it on, unlike payment_requests which the tenant-commerce flow already '
  'had), and this row''s id is the Idempotency-Key handed to the processor, so a retried request '
  'reuses one Checkout Session rather than creating two.';

create index platform_billing_checkout_sessions_org_idx
  on public.platform_billing_checkout_sessions (organization_id, requested_at desc);

alter table public.platform_billing_checkout_sessions enable row level security;
alter table public.platform_billing_checkout_sessions force row level security;

create policy platform_billing_checkout_sessions_select on public.platform_billing_checkout_sessions
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) or app.is_platform_staff());

create policy platform_billing_checkout_sessions_insert on public.platform_billing_checkout_sessions
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and requested_by = (select auth.uid())
    and app.has_capability(organization_id, 'billing.manage')
  );

-- Correcting the row with the processor's own reference once it answers -- the same "ask, then
-- correct" shape payment_requests.provider_reference uses, and gated by the same capability
-- rather than a second one.
create policy platform_billing_checkout_sessions_update on public.platform_billing_checkout_sessions
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'billing.manage')
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'billing.manage')
  );

grant select, insert, update on public.platform_billing_checkout_sessions to authenticated;

-- ---------------------------------------------------------------------------
-- Staff-only: provisioning a Plan's price with the processor
-- ---------------------------------------------------------------------------

create function public.record_plan_provider_price(
  p_plan_price_id     uuid,
  p_environment       text,
  p_product_reference text,
  p_price_reference   text,
  p_provider          text default 'stripe'
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
  perform app.require_platform_staff();

  insert into public.platform_plan_provider_prices
    (plan_price_id, environment, provider, product_reference, price_reference, provisioned_by)
  values
    (p_plan_price_id, p_environment, p_provider, p_product_reference, p_price_reference, v_staff)
  on conflict (plan_price_id, environment) do update
    set product_reference = excluded.product_reference,
        price_reference = excluded.price_reference,
        provider = excluded.provider
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.record_plan_provider_price(uuid, text, text, text, text) is
  'Records the processor Product/Price a staff member just created for one platform_plan_prices '
  'row (Phase 4: GOLD provisions Products/Prices via the processor''s API from its own admin). '
  'The processor write itself happens in apps/web (D2); this is only where the resulting '
  'references land. Upserts on (plan_price_id, environment) so a retried provisioning attempt '
  'corrects the same row rather than erroring -- the append-only discipline is carried by '
  'platform_plan_prices itself, one table up, never rewritten here.';

revoke all on function public.record_plan_provider_price(uuid, text, text, text, text) from public;
grant execute on function public.record_plan_provider_price(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The Customer Portal's one door: check billing.manage, resolve the customer reference server-side
-- ---------------------------------------------------------------------------

create function public.begin_platform_billing_portal_session(p_organization_id uuid)
returns text
language plpgsql
stable
security invoker
set search_path = ''
as $fn$
declare
  v_customer text;
begin
  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'billing.manage') then
    raise exception 'insufficient capability' using errcode = '42501';
  end if;

  -- security invoker: the select policy above already lets any member of this organization read
  -- its own platform_billing_customers row, so this needs no elevated privilege -- its only job
  -- is the explicit capability check and one clean call site (Phase 8: "resolve the customer
  -- reference from the signed-in organization's server-side billing record", never from client
  -- input).
  select customer_reference into v_customer
  from public.platform_billing_customers
  where organization_id = p_organization_id
    -- A placeholder from a provisioning attempt whose processor call is still in flight or
    -- failed (apps/web's ensurePlatformBillingCustomer) is not a customer reference -- the
    -- portal has nothing to open yet, the same as if no row existed at all.
    and customer_reference not like 'pending:%';

  return v_customer;
end;
$fn$;

comment on function public.begin_platform_billing_portal_session(uuid) is
  'Checks billing.manage and hands back this organization''s own customer reference, or null if '
  'none has been provisioned yet. Read-only: opening a Customer Portal session is a processor call '
  'apps/web makes with the reference this returns, never a database write.';

revoke all on function public.begin_platform_billing_portal_session(uuid) from public;
grant execute on function public.begin_platform_billing_portal_session(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The webhook role -- GOLD's own processor account calling in, no human behind it
-- ---------------------------------------------------------------------------

-- A fixed uuid distinct from the payment (…a1) and voice (…a2) integrations -- a third vendor
-- touchpoint, a third identity that nothing can ever sign in as.
insert into auth.users (id)
values ('00000000-0000-4000-8000-0000000000a3')
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'platform_billing_webhook') then
    create role platform_billing_webhook nologin noinherit;
  end if;
end
$$;

grant platform_billing_webhook to authenticator;
grant usage on schema public to platform_billing_webhook;

-- Nothing else. No select, no insert, on any table -- everything this role may do is the two
-- functions granted to it below, and every value either writes is derived inside the function
-- from platform_billing_customers, never taken from its own caller (a webhook that could name an
-- organization could name somebody else's, restated for this plane).

create function public.apply_platform_subscription_event(
  p_event_reference        text,
  p_event_type             text,
  p_customer_reference     text,
  p_subscription_reference text,
  p_price_reference        text,
  p_status                 text,
  p_currency               text,
  p_current_period_start   bigint,
  p_current_period_end     bigint,
  p_cancel_at_period_end   boolean,
  p_canceled_at            bigint,
  p_provider               text default 'stripe'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor constant uuid := '00000000-0000-4000-8000-0000000000a3';
  v_org   uuid;
  v_env   text;
  v_plan  uuid;
begin
  -- Derived, never passed: which organization this event is about comes from our own record of
  -- whose customer this is. An event naming a customer reference this platform never
  -- provisioned is not an error -- it is not ours, and there is nothing to guess at. `strict`
  -- rather than a plain select: platform_billing_customers deliberately carries no unique index
  -- over customer_reference alone (I2, see its own table comment), so more than one row matching
  -- is a possibility this function must fail loudly on rather than silently pick a winner from.
  begin
    select organization_id, environment into strict v_org, v_env
    from public.platform_billing_customers
    where customer_reference = p_customer_reference;
  exception
    when no_data_found then
      return null;
  end;

  -- Idempotent by the processor's own event reference, scoped by the organization it resolved
  -- to. A second delivery of the same event conflicts here and this returns early rather than
  -- applying the same transition twice.
  insert into public.platform_billing_webhook_events
    (provider, event_reference, event_type, environment, organization_id)
  values (p_provider, p_event_reference, p_event_type, v_env, v_org)
  on conflict (organization_id, event_reference) do nothing;

  if not found then
    return null;
  end if;

  if p_event_type = 'customer.subscription.deleted' then
    delete from public.organization_platform_subscriptions
     where organization_id = v_org
       and subscription_reference = p_subscription_reference;

    insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
    values (v_org, v_actor, 'organization', v_org, 'platform_subscription.canceled',
            jsonb_build_object('subscription_reference', p_subscription_reference));

    return v_org;
  end if;

  select pp.plan_id into v_plan
  from public.platform_plan_provider_prices pv
  join public.platform_plan_prices pp on pp.id = pv.plan_price_id
  where pv.price_reference = p_price_reference
    and pv.environment = v_env;

  insert into public.organization_platform_subscriptions
    (organization_id, environment, provider, subscription_reference, price_reference, plan_id,
     status, currency, current_period_start, current_period_end, cancel_at_period_end,
     canceled_at, updated_at)
  values
    (v_org, v_env, p_provider, p_subscription_reference, p_price_reference, v_plan, p_status,
     p_currency,
     case when p_current_period_start is null then null else to_timestamp(p_current_period_start) end,
     case when p_current_period_end   is null then null else to_timestamp(p_current_period_end)   end,
     p_cancel_at_period_end,
     case when p_canceled_at is null then null else to_timestamp(p_canceled_at) end,
     now())
  on conflict (organization_id, environment) do update
    set provider               = excluded.provider,
        subscription_reference = excluded.subscription_reference,
        price_reference        = excluded.price_reference,
        plan_id                = excluded.plan_id,
        status                 = excluded.status,
        currency               = excluded.currency,
        current_period_start   = excluded.current_period_start,
        current_period_end     = excluded.current_period_end,
        cancel_at_period_end   = excluded.cancel_at_period_end,
        canceled_at            = excluded.canceled_at,
        updated_at             = now();

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (v_org, v_actor, 'organization', v_org, 'platform_subscription.updated',
          jsonb_build_object('subscription_reference', p_subscription_reference, 'status', p_status));

  return v_org;
end;
$fn$;

comment on function public.apply_platform_subscription_event(text, text, text, text, text, text, text, bigint, bigint, boolean, bigint, text) is
  'The only thing platform_billing_webhook may do for a subscription-lifecycle event. Derives '
  'the organization from platform_billing_customers rather than trusting the event; idempotent by '
  'the processor''s own event reference.';

revoke all on function public.apply_platform_subscription_event(text, text, text, text, text, text, text, bigint, bigint, boolean, bigint, text) from public;
grant execute on function public.apply_platform_subscription_event(text, text, text, text, text, text, text, bigint, bigint, boolean, bigint, text) to platform_billing_webhook;

create function public.record_platform_billing_notice(
  p_event_reference    text,
  p_event_type         text,
  p_customer_reference text,
  p_provider           text default 'stripe'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_org uuid;
  v_env text;
begin
  begin
    select organization_id, environment into strict v_org, v_env
    from public.platform_billing_customers
    where customer_reference = p_customer_reference;
  exception
    when no_data_found then
      return null;
  end;

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

comment on function public.record_platform_billing_notice(text, text, text, text) is
  'invoice.paid and invoice.payment_failed: logged for the idempotency ledger and platform '
  'diagnostics, never a subscription-status writer -- the processor already sends a subscription-'
  'updated event alongside the status transition either causes (docs.stripe.com/billing/'
  'subscriptions/webhooks, "Catch subscription status changes"), and '
  'apply_platform_subscription_event is the one place that column is ever written, so there is '
  'exactly one writer of status rather than two independently-derived opinions about it.';

revoke all on function public.record_platform_billing_notice(text, text, text, text) from public;
grant execute on function public.record_platform_billing_notice(text, text, text, text) to platform_billing_webhook;

-- One subscription model, one usage-price model, and GildOps' billing-provider invoices in Finance
-- (completion of ADR-057, 2026-11-22).
--
-- 1. A subscription is a Finance record any business keeps: the seller's customer, the recurring
--    items it subscribes to (one primary item and any add-ons, each a line with its own dates),
--    the billing terms (currency and interval) and, per line, an agreed price where the list price
--    does not apply. Nothing in this model names GildOps.
-- 2. GildOps sells its plans with exactly this model. The one GildOps-specific piece is an
--    integration: when a line of the operating organization's subscription sells a platform plan
--    and the customer is linked to a provisioned business, the line becomes that business's plan
--    assignment (its entitlement), and follows the line's dates.
-- 3. The plan agreements GildOps recorded per business become agreed prices on those subscription
--    lines, keeping their ids, so the billing provider's price references recorded against them
--    stay valid. `organization_plan_agreements` and its writers are dropped.
-- 4. Usage prices belong to a recurring item (`price_book_item_usage_prices`, formerly
--    `platform_retail_rates`), or to one subscription line where a usage price was agreed. There
--    is no global fallback any more: the platform-wide defaults are carried onto every base plan,
--    where Finance shows and changes them, and then ended. Usage is priced by its subscription line
--    first, then an add-on's item, then the base plan's item; anything else is not priced.
-- 5. Invoices gain the subscription source: a period issued from Finance, or an invoice the
--    billing provider reports for a GildOps subscription, kept with its external id. Payments and
--    refunds the provider reports become ordinary payment rows; a voided provider invoice is marked
--    void. A buying business reads the invoices addressed to it through a buyer-only projection.

-- ---------------------------------------------------------------------------------------------
-- 1. Subscriptions
-- ---------------------------------------------------------------------------------------------

create table public.subscriptions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  customer_id      uuid not null,
  currency         text not null check (currency ~ '^[A-Z]{3}$'),
  billing_interval text not null check (billing_interval in ('month', 'year')),
  collection       text not null default 'manual' check (collection in ('manual', 'provider')),
  starts_on        date not null,
  ends_on          date,
  canceled_at      timestamptz,
  canceled_by      uuid references auth.users (id),
  cancel_reason    text not null default '' check (length(cancel_reason) <= 500),
  note             text not null default '' check (length(note) <= 1000),
  created_by       uuid not null references auth.users (id),
  created_at       timestamptz not null default now(),
  constraint subscriptions_org_id_unique unique (organization_id, id),
  constraint subscriptions_customer_same_org foreign key (organization_id, customer_id)
    references public.contacts (organization_id, id) on delete restrict,
  constraint subscriptions_ends_after_start check (ends_on is null or ends_on > starts_on),
  constraint subscriptions_canceled_together check ((canceled_at is null) = (canceled_by is null))
);
create index subscriptions_org_customer_idx on public.subscriptions (organization_id, customer_id);

comment on table public.subscriptions is
  'A recurring agreement between a business and one of its customers (ADR-057). Status is derived from the dates: scheduled before starts_on, ended from ends_on (exclusive). collection says who invoices it: Finance (manual) or a billing provider.';

create table public.subscription_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  subscription_id uuid not null,
  item_id         uuid not null,
  role            text not null check (role in ('primary', 'addon')),
  quantity        integer not null default 1 check (quantity between 1 and 1000000),
  starts_on       date not null,
  ends_on         date,
  recorded_by     uuid not null references auth.users (id),
  recorded_at     timestamptz not null default now(),
  note            text not null default '' check (length(note) <= 1000),
  constraint subscription_lines_org_id_unique unique (organization_id, id),
  constraint subscription_lines_subscription_same_org foreign key (organization_id, subscription_id)
    references public.subscriptions (organization_id, id) on delete cascade,
  constraint subscription_lines_item_same_org foreign key (organization_id, item_id)
    references public.price_book_items (organization_id, id) on delete restrict,
  constraint subscription_lines_ends_after_start check (ends_on is null or ends_on > starts_on),
  constraint subscription_lines_one_primary exclude using gist (
    organization_id with =, subscription_id with =, daterange(starts_on, ends_on) with &&) where (role = 'primary'),
  constraint subscription_lines_one_copy_of_addon exclude using gist (
    organization_id with =, subscription_id with =, item_id with =, daterange(starts_on, ends_on) with &&) where (role = 'addon')
);
create index subscription_lines_org_subscription_idx on public.subscription_lines (organization_id, subscription_id, starts_on);
create index subscription_lines_org_item_idx on public.subscription_lines (organization_id, item_id);

comment on table public.subscription_lines is
  'What a subscription is for: one recurring item each, primary or add-on, over its own dates. A line is history: only its end may move, and only earlier. A price change is an agreed price, never a new line.';

create table public.subscription_agreed_prices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  line_id         uuid not null,
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor    bigint not null check (amount_minor >= 0),
  effective_from  timestamptz not null default now(),
  effective_to    timestamptz,
  recorded_by     uuid not null references auth.users (id),
  recorded_at     timestamptz not null default now(),
  note            text not null default '',
  constraint subscription_agreed_prices_org_id_unique unique (organization_id, id),
  constraint subscription_agreed_prices_line_same_org foreign key (organization_id, line_id)
    references public.subscription_lines (organization_id, id) on delete cascade,
  constraint subscription_agreed_prices_ordered check (effective_to is null or effective_to > effective_from)
);
create index subscription_agreed_prices_org_line_idx on public.subscription_agreed_prices (organization_id, line_id, effective_from desc);

comment on table public.subscription_agreed_prices is
  'A price agreed for one subscription line, effective-dated. Where none is in force the line pays its item''s list price in the subscription''s currency and interval.';

alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;
alter table public.subscription_lines enable row level security;
alter table public.subscription_lines force row level security;
alter table public.subscription_agreed_prices enable row level security;
alter table public.subscription_agreed_prices force row level security;

create policy subscriptions_select on public.subscriptions as permissive for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'subscription.read'));
create policy subscription_lines_select on public.subscription_lines as permissive for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'subscription.read'));
create policy subscription_agreed_prices_select on public.subscription_agreed_prices as permissive for select to authenticated
  using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'subscription.read'));

revoke all on public.subscriptions, public.subscription_lines, public.subscription_agreed_prices from anon, authenticated;
grant select on public.subscriptions, public.subscription_lines, public.subscription_agreed_prices to authenticated;

-- A line is history: everything but its end is fixed, and the end only moves earlier.
create function app.subscription_line_is_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- The one sanctioned rewrite: a plan item leaving for a newly designated seller (see
  -- app.sync_plan_catalog_items), when the previous seller's lines move to its archived copy.
  if current_setting('app.moving_plan_items', true) = 'on'
     and (new.organization_id, new.subscription_id, new.role, new.quantity, new.starts_on, new.ends_on, new.recorded_by, new.recorded_at, new.note)
         is not distinct from (old.organization_id, old.subscription_id, old.role, old.quantity, old.starts_on, old.ends_on, old.recorded_by, old.recorded_at, old.note) then
    return new;
  end if;
  if (new.organization_id, new.subscription_id, new.item_id, new.role, new.quantity, new.starts_on, new.recorded_by, new.recorded_at, new.note)
     is distinct from (old.organization_id, old.subscription_id, old.item_id, old.role, old.quantity, old.starts_on, old.recorded_by, old.recorded_at, old.note) then
    raise exception 'A subscription line is history: only its end may change.' using errcode = '22023';
  end if;
  if old.ends_on is not null and (new.ends_on is null or new.ends_on > old.ends_on) then
    raise exception 'A subscription line''s end only moves earlier.' using errcode = '22023';
  end if;
  return new;
end $$;

create trigger subscription_lines_history before update on public.subscription_lines
  for each row execute function app.subscription_line_is_history();

-- An agreed price is history too: only an open end may be set.
create function app.subscription_agreed_price_is_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.organization_id, new.line_id, new.currency, new.amount_minor, new.effective_from, new.recorded_by, new.recorded_at, new.note)
     is distinct from (old.organization_id, old.line_id, old.currency, old.amount_minor, old.effective_from, old.recorded_by, old.recorded_at, old.note)
     or (old.effective_to is not null and new.effective_to is distinct from old.effective_to) then
    raise exception 'An agreed price is history: only an open end may be set.' using errcode = '22023';
  end if;
  return new;
end $$;
create trigger subscription_agreed_prices_history before update on public.subscription_agreed_prices
  for each row execute function app.subscription_agreed_price_is_history();

-- ---------------------------------------------------------------------------------------------
-- 2. Internal writers and the one price rule
-- ---------------------------------------------------------------------------------------------

create function app.write_subscription(
  p_organization_id uuid, p_customer_id uuid, p_currency text, p_billing_interval text,
  p_starts_on date, p_ends_on date, p_actor uuid, p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  insert into public.subscriptions
    (organization_id, customer_id, currency, billing_interval, starts_on, ends_on, created_by, note)
  values (p_organization_id, p_customer_id, upper(btrim(p_currency)), p_billing_interval, p_starts_on, p_ends_on,
          p_actor, coalesce(p_note, ''))
  returning id into v_id;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, p_actor, 'subscription', v_id, 'subscription.created',
          jsonb_build_object('subscriptionId', v_id, 'customerId', p_customer_id, 'currency', upper(btrim(p_currency)),
                             'billingInterval', p_billing_interval, 'startsOn', p_starts_on, 'endsOn', p_ends_on));
  return v_id;
end $$;

create function app.write_subscription_line(
  p_organization_id uuid, p_subscription_id uuid, p_item_id uuid, p_role text, p_quantity integer,
  p_starts_on date, p_ends_on date, p_actor uuid, p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions;
  v_id  uuid;
begin
  select * into v_sub from public.subscriptions where organization_id = p_organization_id and id = p_subscription_id;
  if v_sub.id is null then
    raise exception 'No such subscription in this business.' using errcode = '23503';
  end if;
  if p_starts_on < v_sub.starts_on or (v_sub.ends_on is not null and p_starts_on >= v_sub.ends_on) then
    raise exception 'A line starts within its subscription.' using errcode = 'GD040';
  end if;
  insert into public.subscription_lines
    (organization_id, subscription_id, item_id, role, quantity, starts_on, ends_on, recorded_by, note)
  values (p_organization_id, p_subscription_id, p_item_id, p_role, coalesce(p_quantity, 1), p_starts_on,
          case when v_sub.ends_on is null then p_ends_on
               when p_ends_on is null then v_sub.ends_on
               else least(p_ends_on, v_sub.ends_on) end,
          p_actor, coalesce(p_note, ''))
  returning id into v_id;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, p_actor, 'subscription', p_subscription_id, 'subscription.line_added',
          jsonb_build_object('lineId', v_id, 'itemId', p_item_id, 'role', p_role, 'startsOn', p_starts_on));
  return v_id;
end $$;

-- Appends an agreed price from p_effective_from, ending the one in force; a null amount only ends it
-- (the line returns to its list price).
create function app.write_subscription_agreed_price(
  p_organization_id uuid, p_line_id uuid, p_amount_minor bigint, p_effective_from timestamptz,
  p_actor uuid, p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_currency text;
  v_sub      uuid;
  v_id       uuid;
begin
  select s.currency, s.id into v_currency, v_sub
    from public.subscription_lines l
    join public.subscriptions s on s.organization_id = l.organization_id and s.id = l.subscription_id
   where l.organization_id = p_organization_id and l.id = p_line_id;
  if v_currency is null then
    raise exception 'No such subscription line in this business.' using errcode = '23503';
  end if;
  if p_amount_minor is not null and p_amount_minor < 0 then
    raise exception 'An agreed price is zero or more.' using errcode = '22023';
  end if;
  if exists (select 1 from public.subscription_agreed_prices g
              where g.organization_id = p_organization_id and g.line_id = p_line_id and g.effective_from >= p_effective_from) then
    raise exception 'An agreed price is appended after the last one, never before it.' using errcode = 'GD041';
  end if;

  update public.subscription_agreed_prices g
     set effective_to = p_effective_from
   where g.organization_id = p_organization_id and g.line_id = p_line_id
     and g.effective_to is null;

  if p_amount_minor is not null then
    insert into public.subscription_agreed_prices
      (organization_id, line_id, currency, amount_minor, effective_from, recorded_by, note)
    values (p_organization_id, p_line_id, v_currency, p_amount_minor, p_effective_from, p_actor, coalesce(p_note, ''))
    returning id into v_id;
  end if;

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, p_actor, 'subscription', v_sub,
          case when p_amount_minor is null then 'subscription.list_price_restored' else 'subscription.price_agreed' end,
          jsonb_build_object('lineId', p_line_id, 'agreedPriceId', v_id, 'amountMinor', p_amount_minor,
                             'currency', v_currency, 'effectiveFrom', p_effective_from));
  return v_id;
end $$;

-- The one price rule for a subscription line at a moment: its agreed price in force, else its
-- item's approved list price in the subscription's currency, for the subscription's interval or,
-- for an item sold once, one time. Null when neither exists: the line is not priced.
create function app.subscription_line_price(p_line_id uuid, p_at timestamptz default now())
returns table (amount_minor bigint, currency text, billing_interval text, source text, source_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with line as (
    select l.id, l.organization_id, l.item_id, s.currency, s.billing_interval as subscription_interval,
           coalesce((select case when bool_or(p.billing_interval = s.billing_interval) then s.billing_interval
                                 when bool_or(p.billing_interval = 'one_time') then 'one_time' end
                       from public.price_book_item_prices p
                      where p.organization_id = l.organization_id and p.item_id = l.item_id), s.billing_interval) as price_interval
      from public.subscription_lines l
      join public.subscriptions s on s.organization_id = l.organization_id and s.id = l.subscription_id
     where l.id = p_line_id
  ), agreed as (
    select g.amount_minor, g.currency, line.price_interval, 'agreed'::text as source, g.id
      from line
      join public.subscription_agreed_prices g on g.organization_id = line.organization_id and g.line_id = line.id
     where g.effective_from <= p_at and (g.effective_to is null or g.effective_to > p_at)
     order by g.effective_from desc
     limit 1
  )
  select * from agreed
  union all
  (select p.amount_minor, p.currency, p.billing_interval, 'list'::text, p.id
     from line
     join public.price_book_item_prices p
       on p.organization_id = line.organization_id and p.item_id = line.item_id
    where not exists (select 1 from agreed)
      and p.currency = line.currency
      and p.billing_interval in (line.subscription_interval, 'one_time')
      and p.approval_state = 'approved'
      and p.effective_from <= p_at and (p.effective_to is null or p.effective_to > p_at)
    order by (p.billing_interval = line.subscription_interval) desc, p.effective_from desc
    limit 1);
$$;
revoke all on function app.subscription_line_price(uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. GildOps' plan agreements become agreed prices on its subscriptions
-- ---------------------------------------------------------------------------------------------

-- Which subscription line a plan assignment carries out. Null for an assignment no sale made
-- (GildOps' own operating plan). One assignment per line.
alter table public.organization_plan_assignments
  add column subscription_line_id uuid references public.subscription_lines (id) on delete set null;
create unique index organization_plan_assignments_line_unique
  on public.organization_plan_assignments (subscription_line_id) where subscription_line_id is not null;
comment on column public.organization_plan_assignments.subscription_line_id is
  'The operating organization''s subscription line this entitlement carries out (ADR-057). The line is the commercial record; this row is what the business may use.';

do $$
declare
  v_seller   uuid := app.platform_seller_id();
  v_tenant   record;
  v_customer uuid;
  v_sub      uuid;
  v_line     uuid;
  v_item     uuid;
  v_a        record;
  v_g        record;
  v_left     integer;
begin
  if v_seller is null then
    if exists (select 1 from public.organization_plan_agreements) then
      raise exception 'Plan agreements exist but no operating organization is designated to own them.';
    end if;
    return;
  end if;

  perform app.link_platform_customers();

  for v_tenant in
    select a.organization_id, min(a.period_start) as starts_on, max(a.period_end) as ends_on,
           (array_agg(a.assigned_by order by a.assigned_at, a.id))[1] as actor,
           coalesce(upper(btrim(o.currency)), upper(btrim(so.currency))) as currency
      from public.organization_plan_assignments a
      join public.organizations o on o.id = a.organization_id
      join public.organizations so on so.id = v_seller
     where a.organization_id <> v_seller and a.subscription_line_id is null
     group by a.organization_id, o.currency, so.currency
  loop
    select r.customer_id into v_customer
      from public.client_tenant_relationships r
     where r.organization_id = v_seller and r.tenant_organization_id = v_tenant.organization_id and r.status = 'active'
     order by r.created_at desc limit 1;
    if v_customer is null then
      raise exception 'Business % holds a plan but is no GildOps customer.', v_tenant.organization_id;
    end if;
    if v_tenant.currency is null then
      raise exception 'Neither business % nor GildOps trades in a currency, so its subscription has none.', v_tenant.organization_id;
    end if;

    insert into public.subscriptions
      (organization_id, customer_id, currency, billing_interval, starts_on, ends_on, created_by, created_at, note)
    values (v_seller, v_customer, v_tenant.currency, 'month', v_tenant.starts_on,
            nullif(v_tenant.ends_on, date '9999-12-31'), v_tenant.actor, now(),
            'Recorded from the plans this business held before Finance kept GildOps subscriptions.')
    returning id into v_sub;

    for v_a in
      select a.* from public.organization_plan_assignments a
       where a.organization_id = v_tenant.organization_id and a.subscription_line_id is null
       order by a.period_start, a.plan_kind desc, a.id
    loop
      select p.price_book_item_id into v_item from public.platform_plans p where p.id = v_a.plan_id;
      if v_item is null then
        raise exception 'Plan % has no catalog item, so its assignment cannot become a subscription line.', v_a.plan_id;
      end if;
      insert into public.subscription_lines
        (organization_id, subscription_id, item_id, role, quantity, starts_on, ends_on, recorded_by, recorded_at, note)
      values (v_seller, v_sub, v_item, case when v_a.plan_kind = 'plan' then 'primary' else 'addon' end, 1,
              v_a.period_start, nullif(v_a.period_end, date '9999-12-31'), v_a.assigned_by, v_a.assigned_at, v_a.note)
      returning id into v_line;
      update public.organization_plan_assignments set subscription_line_id = v_line where id = v_a.id;
    end loop;
  end loop;

  -- Each agreement keeps its id, so the billing provider's prices recorded against it still match.
  for v_g in select * from public.organization_plan_agreements order by effective_from, id loop
    select a.subscription_line_id into v_line
      from public.organization_plan_assignments a
     where a.organization_id = v_g.organization_id and a.plan_id = v_g.plan_id and a.subscription_line_id is not null
     order by (a.period_start <= v_g.effective_from::date and a.period_end > v_g.effective_from::date) desc, a.period_start desc
     limit 1;
    if v_line is null then
      raise exception 'Agreement % names a plan its business never held through a subscription.', v_g.id;
    end if;
    insert into public.subscription_agreed_prices
      (id, organization_id, line_id, currency, amount_minor, effective_from, effective_to, recorded_by, recorded_at, note)
    values (v_g.id, v_seller, v_line, v_g.currency, v_g.amount_minor, v_g.effective_from, v_g.effective_to,
            v_g.recorded_by, v_g.recorded_at, v_g.note);
  end loop;

  select count(*) into v_left from public.organization_plan_assignments
   where organization_id <> v_seller and subscription_line_id is null;
  if v_left > 0 then raise exception '% plan assignments carry out no subscription line', v_left; end if;
end $$;

-- The internal view the platform's billing functions read where they read agreements: an agreed
-- price, keyed by the business it is billed to and the plan it prices. Only definer functions read it.
create view app.plan_agreed_prices as
select g.id, a.organization_id, a.plan_id, g.currency, g.amount_minor, g.effective_from, g.effective_to,
       g.recorded_by, g.recorded_at, g.note
  from public.subscription_agreed_prices g
  join public.organization_plan_assignments a on a.subscription_line_id = g.line_id;
revoke all on app.plan_agreed_prices from public, anon, authenticated;
comment on view app.plan_agreed_prices is
  'Agreed subscription prices of the operating organization, keyed by the business billed and the plan priced. Read only by the platform''s definer billing functions.';

alter table public.organization_plan_agreement_provider_prices
  drop constraint if exists organization_plan_agreement_provider_prices_agreement_fk;
do $$
declare v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'public.organization_plan_agreement_provider_prices'::regclass and c.contype = 'f'
       and c.confrelid = 'public.organization_plan_agreements'::regclass
  loop
    execute format('alter table public.organization_plan_agreement_provider_prices drop constraint %I', v_name);
  end loop;
end $$;
alter table public.organization_plan_agreement_provider_prices
  add constraint organization_plan_agreement_provider_prices_agreed_price_fkey
  foreign key (agreement_id) references public.subscription_agreed_prices (id) on delete restrict;
comment on column public.organization_plan_agreement_provider_prices.agreement_id is
  'The agreed subscription price (subscription_agreed_prices.id) this billing-provider price charges. organization_id is the business billed.';

-- Every function that read agreements reads the agreed subscription prices instead.
do $$
declare
  v_fn   record;
  v_def  text;
  v_done integer := 0;
begin
  for v_fn in
    select p.oid, n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('app', 'public') and p.prokind = 'f'
       and p.proname in ('apply_platform_subscription_event', 'compose_organization_charges',
                         'organization_plan_agreement_provider_price_reference', 'record_agreement_provider_price')
  loop
    v_def := pg_get_functiondef(v_fn.oid);
    if position('public.organization_plan_agreements' in v_def) > 0 then
      execute replace(v_def, 'public.organization_plan_agreements', 'app.plan_agreed_prices');
      v_done := v_done + 1;
    end if;
  end loop;
  if v_done <> 4 then
    raise exception 'expected four billing functions reading agreements, found %; this migration is out of date', v_done;
  end if;
end $$;

drop function public.organization_plan_price(uuid, uuid, timestamptz);
drop function public.organization_plan_price(uuid, uuid, timestamptz, text);

-- What a business pays for a plan it holds: its agreed subscription price in force, else the plan's
-- approved list price. Readable by a member of that business and by the seller's subscription readers.
create function public.organization_plan_price(p_organization_id uuid, p_plan_id uuid, p_at timestamptz, p_billing_interval text)
returns table (amount_minor bigint, currency text, source text, source_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organization_id not in (select app.current_tenant_ids()) and not app.platform_seller_has('subscription.read') then
    return;
  end if;
  return query
    (select a.amount_minor, a.currency, 'agreement'::text, a.id
       from app.plan_agreed_prices a
      where a.organization_id = p_organization_id and a.plan_id = p_plan_id
        and a.effective_from <= p_at and (a.effective_to is null or a.effective_to > p_at)
      order by a.effective_from desc limit 1)
    union all
    (select p.amount_minor, p.currency, 'standard'::text, p.id
       from public.price_book_item_prices p
      where p.plan_id = p_plan_id and p.billing_interval = p_billing_interval
        and p.approval_state = 'approved' and p.effective_from <= p_at
        and (p.effective_to is null or p.effective_to > p_at)
        and not exists (
          select 1 from app.plan_agreed_prices a
           where a.organization_id = p_organization_id and a.plan_id = p_plan_id
             and a.effective_from <= p_at and (a.effective_to is null or a.effective_to > p_at))
      order by p.effective_from desc limit 1);
end $$;

create function public.organization_plan_price(p_organization_id uuid, p_plan_id uuid, p_at timestamptz default now())
returns table (amount_minor bigint, currency text, source text, source_id uuid)
language sql
stable
set search_path = ''
as $$
  select * from public.organization_plan_price(p_organization_id, p_plan_id, p_at, 'month');
$$;
revoke all on function public.organization_plan_price(uuid, uuid, timestamptz, text) from public, anon;
revoke all on function public.organization_plan_price(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.organization_plan_price(uuid, uuid, timestamptz, text) to authenticated;
grant execute on function public.organization_plan_price(uuid, uuid, timestamptz) to authenticated;

-- The retired doors: a plan is now subscribed to, and a price agreed, in Finance → Subscriptions.
drop function public.record_organization_plan_agreement(uuid, uuid, text, bigint, timestamptz, timestamptz, text);
drop function app.write_plan_agreement(uuid, uuid, text, bigint, timestamptz, timestamptz, uuid, text);
drop function public.record_plan_assignment(uuid, uuid, date, date, text);

do $$
declare v_old integer; v_new integer;
begin
  select count(*) into v_old from public.organization_plan_agreements;
  select count(*) into v_new from public.subscription_agreed_prices
   where id in (select id from public.organization_plan_agreements);
  if v_old <> v_new then raise exception 'only % of % plan agreements became agreed prices', v_new, v_old; end if;
end $$;
drop table public.organization_plan_agreements;

-- ---------------------------------------------------------------------------------------------
-- 4. The platform integration: a sold plan line is the buying business's entitlement
-- ---------------------------------------------------------------------------------------------

-- Carries one line of the operating organization's subscription onto the business its customer
-- is linked to. A line that sells no plan, a customer linked to no business, or a seller other
-- than the operating organization leaves entitlements alone.
create function app.provision_platform_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line   record;
  v_plan   uuid;
  v_tenant uuid;
  v_held   public.organization_plan_assignments;
  v_id     uuid;
  v_end    date;
begin
  select l.*, s.customer_id into v_line
    from public.subscription_lines l
    join public.subscriptions s on s.organization_id = l.organization_id and s.id = l.subscription_id
   where l.id = p_line_id;
  if v_line.id is null or v_line.organization_id is distinct from app.platform_seller_id() then
    return;
  end if;
  select p.id into v_plan from public.platform_plans p where p.price_book_item_id = v_line.item_id;
  if v_plan is null then
    return;
  end if;
  v_end := coalesce(v_line.ends_on, date '9999-12-31');

  select * into v_held from public.organization_plan_assignments where subscription_line_id = p_line_id;
  if v_held.id is not null then
    if v_held.period_end is distinct from v_end then
      update public.organization_plan_assignments set period_end = v_end where id = v_held.id;
      insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
      values (v_held.organization_id, v_line.recorded_by, 'organization', v_held.organization_id, 'plan_assignment.ended',
              jsonb_build_object('assignment_id', v_held.id, 'plan_id', v_held.plan_id, 'period_end', v_end));
    end if;
    return;
  end if;

  select r.tenant_organization_id into v_tenant
    from public.client_tenant_relationships r
   where r.organization_id = v_line.organization_id and r.customer_id = v_line.customer_id and r.status = 'active'
   order by r.created_at desc limit 1;
  if v_tenant is null then
    return;
  end if;

  v_id := app.write_plan_assignment(v_tenant, v_plan, v_line.starts_on, v_end, v_line.recorded_by,
                                    'Subscription line ' || p_line_id::text);
  update public.organization_plan_assignments set subscription_line_id = p_line_id where id = v_id;
end $$;
revoke all on function app.provision_platform_line(uuid) from public, anon, authenticated;

create function app.subscription_line_entitlements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.organization_plan_assignments where subscription_line_id = old.id;
    return old;
  end if;
  perform app.provision_platform_line(new.id);
  return new;
end $$;
create trigger subscription_lines_entitlements after insert or update of ends_on or delete on public.subscription_lines
  for each row execute function app.subscription_line_entitlements();

-- A customer linked to a business after it subscribed: its plan lines provision then.
create function app.client_tenant_entitlements()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_line uuid;
begin
  if new.status <> 'active' or new.organization_id is distinct from app.platform_seller_id() then
    return new;
  end if;
  for v_line in
    select l.id from public.subscription_lines l
      join public.subscriptions s on s.organization_id = l.organization_id and s.id = l.subscription_id
     where s.organization_id = new.organization_id and s.customer_id = new.customer_id
     order by l.starts_on, l.role desc, l.id
  loop
    perform app.provision_platform_line(v_line);
  end loop;
  return new;
end $$;
create trigger client_tenant_relationships_entitlements after insert on public.client_tenant_relationships
  for each row execute function app.client_tenant_entitlements();

-- Who invoices a GildOps subscription follows the billing provider's copy: while the provider holds
-- a live subscription for the business, it does, and Finance issues no period invoice.
create function app.platform_subscription_collection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seller uuid := app.platform_seller_id();
  v_mode   text := case when new.status in ('canceled', 'incomplete_expired') then 'manual' else 'provider' end;
begin
  if v_seller is null then return new; end if;
  update public.subscriptions s
     set collection = v_mode
   where s.organization_id = v_seller
     and s.collection is distinct from v_mode
     and s.customer_id in (select r.customer_id from public.client_tenant_relationships r
                            where r.organization_id = v_seller and r.tenant_organization_id = new.organization_id
                              and r.status = 'active')
     and (s.ends_on is null or s.ends_on > current_date);
  return new;
end $$;
create trigger organization_platform_subscriptions_collection
  after insert or update of status on public.organization_platform_subscriptions
  for each row execute function app.platform_subscription_collection();

update public.subscriptions s
   set collection = 'provider'
 where s.organization_id = app.platform_seller_id()
   and exists (select 1 from public.organization_platform_subscriptions p
                 join public.client_tenant_relationships r
                   on r.tenant_organization_id = p.organization_id and r.organization_id = s.organization_id
                  and r.customer_id = s.customer_id and r.status = 'active'
                where p.status not in ('canceled', 'incomplete_expired'));

-- An accepted proposal becomes the customer's subscription; the hand-off's client link provisions it.
do $$
declare
  v_def text := pg_get_functiondef('public.hand_off_accepted_proposal(uuid)'::regprocedure);
  v_old text := $old$  perform app.write_plan_assignment(
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
$old$;
  v_new text := $new$  -- What the customer accepted is its subscription in the seller's Finance: the plan at the
  -- accepted price (the total less what each add-on was accepted at), each add-on at its own. The
  -- client link the hand-off records below provisions the plan lines onto the new business.
  v_total_minor := greatest(0, v_proposal.plan_price_minor + v_proposal.addon_price_minor - v_proposal.discount_minor);
  v_subscription := app.write_subscription(
    v_proposal.organization_id, v_proposal.customer_id, v_proposal.currency,
    case when v_proposal.billing_interval = 'year' then 'year' else 'month' end,
    current_date, null, v_actor, v_note);
  select price_book_item_id into v_item from public.platform_plans where id = v_proposal.plan_id;
  if v_item is null then
    raise exception 'the accepted plan has no catalog item to subscribe to' using errcode = '23503';
  end if;
  -- Only the business that sells the plan subscribes a customer to it: GildOps' operating organization.
  if not exists (select 1 from public.price_book_items i where i.organization_id = v_proposal.organization_id and i.id = v_item) then
    raise exception 'only the business that sells this plan can create a business from its proposal' using errcode = '42501';
  end if;
  v_line := app.write_subscription_line(
    v_proposal.organization_id, v_subscription, v_item, 'primary', 1, current_date, null, v_actor, v_note);
  perform app.write_subscription_agreed_price(
    v_proposal.organization_id, v_line,
    greatest(0, v_total_minor - coalesce((select sum((a ->> 'priceMinor')::bigint) from jsonb_array_elements(v_addons) a), 0))::bigint,
    current_date::timestamptz, v_actor, v_note);

  for v_addon in select * from jsonb_array_elements(v_addons)
  loop
    select price_book_item_id into v_item from public.platform_plans where id = (v_addon ->> 'addonPlanId')::uuid;
    if v_item is null then
      raise exception 'an accepted add-on has no catalog item to subscribe to' using errcode = '23503';
    end if;
    v_line := app.write_subscription_line(
      v_proposal.organization_id, v_subscription, v_item, 'addon', 1, current_date, null, v_actor, v_note);
    perform app.write_subscription_agreed_price(
      v_proposal.organization_id, v_line, greatest(0, coalesce((v_addon ->> 'priceMinor')::bigint, 0)),
      current_date::timestamptz, v_actor, v_note);
  end loop;
$new$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'hand_off_accepted_proposal changed; this migration is out of date';
  end if;
  v_def := replace(v_def, v_old, v_new);
  v_def := replace(v_def, E'  v_template       jsonb;\n',
                   E'  v_template       jsonb;\n  v_subscription   uuid;\n  v_line           uuid;\n  v_item           uuid;\n');
  execute v_def;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Subscriptions belong to Gild Finance, for every business
-- ---------------------------------------------------------------------------------------------

update public.platform_catalog_features f
   set module_id = m.id, packaging_default = 'core', sale_status = 'active', implementation_state = 'available'
  from public.platform_catalog_modules m
  join public.platform_catalog_products p on p.id = m.product_id and p.key = 'finance'
 where m.key = 'subscriptions' and f.key = 'subscriptions';
update public.platform_catalog_modules m
   set label = 'Subscriptions'
  from public.platform_catalog_products p
 where p.id = m.product_id and p.key = 'finance' and m.key = 'subscriptions';
delete from public.platform_plan_module_grants g
 using public.platform_catalog_modules m, public.platform_catalog_products p
 where g.module_id = m.id and p.id = m.product_id and p.key = 'operator' and m.key = 'platform_subscriptions'
   and not exists (select 1 from public.platform_catalog_features f where f.module_id = m.id);
delete from public.platform_catalog_modules m
 using public.platform_catalog_products p
 where p.id = m.product_id and p.key = 'operator' and m.key = 'platform_subscriptions'
   and not exists (select 1 from public.platform_catalog_features f where f.module_id = m.id);

-- ---------------------------------------------------------------------------------------------
-- 6. Usage prices belong to an item or to one subscription line
-- ---------------------------------------------------------------------------------------------

alter table public.platform_retail_rates rename to price_book_item_usage_prices;
alter table public.price_book_item_usage_prices rename column organization_id to buyer_organization_id;
alter table public.price_book_item_usage_prices
  add column organization_id uuid references public.organizations (id) on delete cascade,
  add column item_id uuid,
  add column subscription_line_id uuid;
drop index public.platform_retail_rates_scoped_unique_moment;

do $$
declare
  v_seller uuid := app.platform_seller_id();
  v_g      record;
  v_plan   record;
  v_first  timestamptz;
  v_line   uuid;
  v_r      record;
begin
  -- A plan's own usage prices file under its item.
  update public.price_book_item_usage_prices r
     set organization_id = i.organization_id, item_id = i.id
    from public.platform_plans p
    join public.price_book_items i on i.id = p.price_book_item_id
   where r.plan_id = p.id and r.buyer_organization_id is null;

  -- A business's own negotiated usage price becomes an agreed usage price on its subscription line.
  for v_r in select * from public.price_book_item_usage_prices where buyer_organization_id is not null loop
    select a.subscription_line_id into v_line
      from public.organization_plan_assignments a
     where a.organization_id = v_r.buyer_organization_id and a.subscription_line_id is not null
       and (v_r.plan_id is null and a.plan_kind = 'plan' or a.plan_id = v_r.plan_id)
     order by (a.period_start <= v_r.effective_from::date and a.period_end > v_r.effective_from::date) desc, a.period_start desc
     limit 1;
    if v_line is not null then
      update public.price_book_item_usage_prices r
         set organization_id = l.organization_id, item_id = l.item_id, subscription_line_id = l.id
        from public.subscription_lines l
       where r.id = v_r.id and l.id = v_line;
    end if;
  end loop;

  -- A platform-wide default is carried onto every base plan that does not price that meter itself
  -- from then on, where Finance shows it and can change it.
  for v_g in select * from public.price_book_item_usage_prices
              where buyer_organization_id is null and plan_id is null and approval_state = 'approved' loop
    for v_plan in
      select p.id, i.id as item_id, i.organization_id
        from public.platform_plans p join public.price_book_items i on i.id = p.price_book_item_id
       where p.kind = 'plan'
    loop
      select min(r.effective_from) into v_first
        from public.price_book_item_usage_prices r
       where r.item_id = v_plan.item_id and r.subscription_line_id is null
         and r.meter_id = v_g.meter_id and r.currency = v_g.currency and r.source <> 'Platform default carried onto this plan';
      if v_first is not null and v_first <= v_g.effective_from then
        continue;
      end if;
      insert into public.price_book_item_usage_prices
        (meter_id, currency, unit_amount_micros, effective_from, effective_to, approval_state, source, source_url,
         captured_at, recorded_by, note, organization_id, item_id)
      values (v_g.meter_id, v_g.currency, v_g.unit_amount_micros, v_g.effective_from,
              case when v_first is null then v_g.effective_to else least(coalesce(v_g.effective_to, v_first), v_first) end,
              'approved', 'Platform default carried onto this plan', v_g.source_url, v_g.captured_at, v_g.recorded_by,
              v_g.note, v_plan.organization_id, v_plan.item_id);
    end loop;
  end loop;

  -- What is left priced nothing in particular: it stays as the history usage already recorded
  -- against it, ended, and owned by the seller it was GildOps' price for.
  delete from public.price_book_item_usage_prices r
   where r.item_id is null and r.effective_from > now()
     and not exists (select 1 from public.usage_events u where u.retail_rate_id = r.id);
  update public.price_book_item_usage_prices
     set effective_to = coalesce(least(effective_to, now()), now()),
         organization_id = coalesce(organization_id, v_seller)
   where item_id is null;
end $$;

drop policy platform_retail_rates_select on public.price_book_item_usage_prices;
alter table public.price_book_item_usage_prices drop column plan_id;
alter table public.price_book_item_usage_prices drop column buyer_organization_id;
alter table public.price_book_item_usage_prices drop column billing_interval;
alter index public.platform_retail_rates_pkey rename to price_book_item_usage_prices_pkey;
alter index public.platform_retail_rates_id_meter_currency_unique rename to price_book_item_usage_prices_id_meter_currency_unique;
do $$
declare v_c record;
begin
  for v_c in select conname from pg_constraint
              where conrelid = 'public.price_book_item_usage_prices'::regclass and conname like 'platform_retail_rates%' loop
    execute format('alter table public.price_book_item_usage_prices rename constraint %I to %I',
                   v_c.conname, replace(v_c.conname, 'platform_retail_rates', 'price_book_item_usage_prices'));
  end loop;
end $$;
alter table public.price_book_item_usage_prices
  add constraint price_book_item_usage_prices_item_same_org foreign key (organization_id, item_id)
    references public.price_book_items (organization_id, id) on delete cascade,
  add constraint price_book_item_usage_prices_line_same_org foreign key (organization_id, subscription_line_id)
    references public.subscription_lines (organization_id, id) on delete cascade,
  add constraint price_book_item_usage_prices_prices_an_item check (item_id is not null or effective_to is not null),
  add constraint price_book_item_usage_prices_line_has_item check (subscription_line_id is null or item_id is not null);
create unique index price_book_item_usage_prices_unique_moment
  on public.price_book_item_usage_prices (organization_id, item_id, subscription_line_id, meter_id, currency, effective_from) nulls not distinct;
comment on table public.price_book_item_usage_prices is
  'What metered usage costs a buyer: a recurring item''s usage price, or one agreed for a subscription line. Appended, never rewritten. A row with no item is a retired platform-wide default kept only because recorded usage names it.';

create policy price_book_item_usage_prices_select on public.price_book_item_usage_prices as permissive for select to authenticated
  using (
    (organization_id in (select app.current_tenant_ids()) and (subscription_line_id is null or app.has_capability(organization_id, 'subscription.read')))
    or (subscription_line_id is null and item_id is not null and (select app.is_organization_member())
        and exists (select 1 from public.platform_plans p where p.price_book_item_id = price_book_item_usage_prices.item_id))
  );

-- The one usage-price rule: for the business that used it, at the moment it happened, among the
-- plans it held — an agreed price on that subscription line first, then an add-on's own item, then
-- the base plan's item, latest first. No plan, or no price on any of them: not priced.
create function app.usage_price_at(p_meter_id text, p_currency text, p_organization_id uuid, p_at timestamptz default now())
returns table (id uuid, unit_amount_micros bigint, source_scope text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.unit_amount_micros,
         case when r.subscription_line_id is not null then 'agreement' when a.plan_kind = 'addon' then 'addon' else 'plan' end
    from public.organization_plan_assignments a
    join public.platform_plans p on p.id = a.plan_id
    join public.price_book_item_usage_prices r on r.item_id = p.price_book_item_id
   where a.organization_id = p_organization_id
     and a.period_start <= p_at::date and a.period_end > p_at::date
     and (r.subscription_line_id is null or r.subscription_line_id = a.subscription_line_id)
     and r.meter_id = p_meter_id
     and r.currency = upper(btrim(p_currency))
     and r.approval_state = 'approved'
     and r.effective_from <= p_at
     and (r.effective_to is null or r.effective_to > p_at)
   order by (r.subscription_line_id is not null) desc, (a.plan_kind = 'addon') desc, r.effective_from desc
   limit 1;
$$;
revoke all on function app.usage_price_at(text, text, uuid, timestamptz) from public, anon, authenticated;

do $$
declare v_fn record; v_def text;
begin
  for v_fn in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'app' and p.proname in ('record_usage', 'spend_decision') loop
    v_def := pg_get_functiondef(v_fn.oid);
    if position('app.retail_rate_at(' in v_def) = 0 then
      raise exception 'app.% no longer reads retail_rate_at; this migration is out of date', v_fn.proname;
    end if;
    execute replace(v_def, 'app.retail_rate_at(', 'app.usage_price_at(');
  end loop;
  v_def := pg_get_functiondef('public.platform_health_summary'::regproc);
  execute replace(v_def, 'public.platform_retail_rates', 'public.price_book_item_usage_prices');
end $$;

drop function public.effective_retail_rates(text, uuid, timestamptz);
drop function public.resolve_commercial_retail_rate(text, text, timestamptz, uuid, uuid, text);
drop function app.retail_rate_at(text, text, uuid, timestamptz);

-- What each meter costs a business now, by the one rule. Its own members, and the seller's
-- subscription readers, may ask.
create function public.effective_usage_prices(p_currency text, p_organization_id uuid, p_at timestamptz default now())
returns table (meter_id text, unit_amount_micros bigint, currency text, source_scope text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_organization_id not in (select app.current_tenant_ids()) and not app.platform_seller_has('subscription.read') then
    return;
  end if;
  return query
    select m.id, r.unit_amount_micros, upper(btrim(p_currency)), r.source_scope
      from public.platform_meters m
      cross join lateral app.usage_price_at(m.id, p_currency, p_organization_id, p_at) r
     order by m.id;
end $$;
revoke all on function public.effective_usage_prices(text, uuid, timestamptz) from public, anon;
grant execute on function public.effective_usage_prices(text, uuid, timestamptz) to authenticated;

drop function public.record_item_usage_price(uuid, uuid, text, text, bigint, timestamptz, text);

-- A plan item's usage price for a meter, from now on. Appended, never rewritten backwards.
create function public.record_item_usage_price(
  p_organization_id uuid, p_item_id uuid, p_meter_id text, p_currency text, p_unit_amount_micros bigint,
  p_effective_from timestamptz default now(), p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := app.require_price_manager(p_organization_id); v_id uuid;
begin
  perform app.require_recurring_item(p_organization_id, p_item_id);
  if not exists (select 1 from public.platform_plans where price_book_item_id = p_item_id) then
    raise exception 'This item sells no plan, so it has no metered usage.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.platform_meters where id = p_meter_id) then
    raise exception 'No such meter.' using errcode = '23503';
  end if;
  if p_unit_amount_micros is null or p_unit_amount_micros < 0 then
    raise exception 'A usage price is zero or more.' using errcode = '22023';
  end if;
  if coalesce(p_effective_from, now()) < now() - interval '1 minute' then
    raise exception 'A usage price cannot start in the past: a price is appended, never rewritten backwards.' using errcode = '22023';
  end if;
  insert into public.price_book_item_usage_prices
    (organization_id, item_id, meter_id, currency, unit_amount_micros, effective_from, approval_state, source, recorded_by, note)
  values (p_organization_id, p_item_id, p_meter_id, upper(btrim(p_currency)), p_unit_amount_micros,
          coalesce(p_effective_from, now()), 'approved', 'finance', v_actor, coalesce(p_note, ''))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.record_item_usage_price(uuid, uuid, text, text, bigint, timestamptz, text) from public, anon;
grant execute on function public.record_item_usage_price(uuid, uuid, text, text, bigint, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 6b. Designating an operating organization moves plan items with their usage prices
-- ---------------------------------------------------------------------------------------------

-- A plan's item moves to a newly designated operating organization with its prices, add-on links
-- and, now, its usage prices. Subscriptions the previous seller sold stay that seller's records:
-- before the item moves, the previous seller keeps an archived copy of it, with copies of its
-- prices, and its subscription lines (and any usage price agreed on them) name the copy instead.
-- Only a database that sets the designation aside and designates again -- development and test
-- databases -- ever moves items, so this is the only time a line's item is rewritten.
alter table public.price_book_item_usage_prices
  drop constraint price_book_item_usage_prices_item_same_org,
  add constraint price_book_item_usage_prices_item_same_org foreign key (organization_id, item_id)
    references public.price_book_items (organization_id, id) on delete cascade deferrable initially immediate;

-- Gives the previous seller of each plan item that is about to move an archived copy for the
-- subscriptions it sold. Called by app.sync_plan_catalog_items before it moves items.
create function app.archive_sold_plan_items(p_seller uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item   record;
  v_copy   uuid;
  v_name   text;
  v_count  integer := 0;
begin
  for v_item in
    select distinct i.*
      from public.platform_plans p
      join public.price_book_items i on i.id = p.price_book_item_id
      join public.subscription_lines l on l.organization_id = i.organization_id and l.item_id = i.id
     where i.organization_id <> p_seller
  loop
    v_name := left(v_item.name || ' (earlier sales)', 200);
    if exists (select 1 from public.price_book_items x where x.organization_id = v_item.organization_id and lower(btrim(x.name)) = lower(btrim(v_name))) then
      v_name := left(v_item.name || ' (earlier sales ' || left(v_item.id::text, 8) || ')', 200);
    end if;
    insert into public.price_book_items
      (organization_id, name, unit, pricing_model, description, sale_status, created_by, created_at, delivery_type_id)
    values (v_item.organization_id, v_name, v_item.unit, 'recurring', v_item.description, 'archived', v_item.created_by,
            v_item.created_at, v_item.delivery_type_id)
    returning id into v_copy;
    insert into public.price_book_item_prices
      (organization_id, item_id, currency, amount_minor, billing_interval, effective_from, effective_to, approval_state,
       source, source_url, captured_at, recorded_by, note)
    select organization_id, v_copy, currency, amount_minor, billing_interval, effective_from, effective_to, approval_state,
           source, source_url, captured_at, recorded_by, note
      from public.price_book_item_prices where item_id = v_item.id and organization_id = v_item.organization_id;
    perform set_config('app.moving_plan_items', 'on', true);
    update public.subscription_lines set item_id = v_copy
     where organization_id = v_item.organization_id and item_id = v_item.id;
    perform set_config('app.moving_plan_items', 'off', true);
    update public.price_book_item_usage_prices set item_id = v_copy
     where organization_id = v_item.organization_id and item_id = v_item.id and subscription_line_id is not null;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
revoke all on function app.archive_sold_plan_items(uuid) from public, anon, authenticated;

do $$
declare
  v_def text := pg_get_functiondef('app.sync_plan_catalog_items()'::regprocedure);
  v_old_head text := $o$  -- Items that belong to another organization move to the seller with their prices and add-on links.$o$;
  v_new_head text := $n$  -- Subscriptions another organization sold keep an archived copy of what they were for.
  perform app.archive_sold_plan_items(v_seller);

  -- Items that belong to another organization move to the seller with their prices, add-on links
  -- and usage prices.$n$;
  v_old_addons text := $o$  update public.price_book_item_addons a set organization_id = v_seller
   where a.organization_id is distinct from v_seller and a.item_id is not null;$o$;
  -- Only a plan's own add-on links move: any business may now link add-ons to its own items.
  v_new_addons text := $n$  update public.price_book_item_addons a set organization_id = v_seller
   where a.organization_id is distinct from v_seller and a.item_id is not null
     and a.item_id in (select p.price_book_item_id from public.platform_plans p where p.price_book_item_id is not null);$n$;
  v_old_move text := $o$    update public.price_book_item_prices set organization_id = v_seller where item_id = v_plan.item_id;$o$;
  v_new_move text := $n$    update public.price_book_item_prices set organization_id = v_seller where item_id = v_plan.item_id;
    update public.price_book_item_usage_prices set organization_id = v_seller
     where item_id = v_plan.item_id and subscription_line_id is null;$n$;
begin
  if position(v_old_head in v_def) = 0 or position(v_old_move in v_def) = 0 or position(v_old_addons in v_def) = 0 then
    raise exception 'app.sync_plan_catalog_items changed; this migration is out of date';
  end if;
  v_def := replace(v_def, v_old_head, v_new_head);
  v_def := replace(v_def, v_old_move, v_new_move);
  v_def := replace(v_def, v_old_addons, v_new_addons);
  execute v_def;
end $$;

-- A customer with a subscription is a customer with Finance records: it is kept, like one with invoices.
do $$
declare
  v_def text := pg_get_functiondef('app.contact_retained_records(uuid, uuid)'::regprocedure);
  v_old text := $o$    case when exists (select 1 from public.invoices x where x.organization_id = p_organization_id and x.customer_id = p_contact_id)$o$;
  v_new text := $n$    case when exists (select 1 from public.invoices x where x.organization_id = p_organization_id and x.customer_id = p_contact_id)
           or exists (select 1 from public.subscriptions x where x.organization_id = p_organization_id and x.customer_id = p_contact_id)$n$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'app.contact_retained_records changed; this migration is out of date';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. The doors
-- ---------------------------------------------------------------------------------------------

create function app.require_subscription_manager(p_organization_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null or p_organization_id is null
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'subscription.manage') then
    raise exception 'You cannot change this business''s subscriptions.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.usable_modules(p_organization_id) m where m = 'billing') then
    raise exception 'Billing is not available for this business.' using errcode = '42501';
  end if;
  return v_actor;
end $$;
revoke all on function app.require_subscription_manager(uuid) from public, anon, authenticated;

-- A line at its list price needs one: an item with no list price in the subscription's terms is
-- subscribed to only at an agreed price.
create function app.require_priced_line(p_line_id uuid, p_at timestamptz)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from app.subscription_line_price(p_line_id, p_at)) then
    raise exception 'This item has no list price in the subscription''s currency and interval; agree a price for it.'
      using errcode = 'GD042';
  end if;
end $$;
revoke all on function app.require_priced_line(uuid, timestamptz) from public, anon, authenticated;

create function public.create_subscription(
  p_organization_id uuid, p_customer_id uuid, p_item_id uuid, p_currency text, p_billing_interval text,
  p_starts_on date, p_ends_on date default null, p_quantity integer default 1,
  p_agreed_amount_minor bigint default null, p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := app.require_subscription_manager(p_organization_id);
  v_currency text;
  v_sub      uuid;
  v_line     uuid;
begin
  perform app.require_recurring_item(p_organization_id, p_item_id);
  if not exists (select 1 from public.contacts c where c.organization_id = p_organization_id and c.id = p_customer_id) then
    raise exception 'That customer is not in this business.' using errcode = 'GD011';
  end if;
  v_currency := upper(btrim(coalesce(nullif(btrim(p_currency), ''),
                                     (select o.currency from public.organizations o where o.id = p_organization_id))));
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'A subscription is in one currency.' using errcode = '22023';
  end if;
  if p_billing_interval not in ('month', 'year') or p_starts_on is null
     or (p_ends_on is not null and p_ends_on <= p_starts_on)
     or coalesce(p_quantity, 1) not between 1 and 1000000 then
    raise exception 'A subscription bills monthly or yearly, from a start date, ending after it if at all.' using errcode = '22023';
  end if;

  v_sub := app.write_subscription(p_organization_id, p_customer_id, v_currency, p_billing_interval,
                                  p_starts_on, p_ends_on, v_actor, p_note);
  v_line := app.write_subscription_line(p_organization_id, v_sub, p_item_id, 'primary', p_quantity,
                                        p_starts_on, p_ends_on, v_actor, p_note);
  if p_agreed_amount_minor is not null then
    perform app.write_subscription_agreed_price(p_organization_id, v_line, p_agreed_amount_minor,
                                                p_starts_on::timestamptz, v_actor, p_note);
  end if;
  perform app.require_priced_line(v_line, greatest(p_starts_on::timestamptz, least(now(), coalesce(p_ends_on::timestamptz, now()))));
  return v_sub;
end $$;

create function public.add_subscription_addon(
  p_subscription_id uuid, p_item_id uuid, p_starts_on date, p_quantity integer default 1,
  p_agreed_amount_minor bigint default null, p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub     public.subscriptions;
  v_actor   uuid;
  v_primary uuid;
  v_line    uuid;
begin
  select * into v_sub from public.subscriptions where id = p_subscription_id;
  v_actor := app.require_subscription_manager(v_sub.organization_id);
  perform app.require_recurring_item(v_sub.organization_id, p_item_id);
  if p_starts_on is null or coalesce(p_quantity, 1) not between 1 and 1000000 then
    raise exception 'An add-on starts on a date, in a whole quantity.' using errcode = '22023';
  end if;
  select l.item_id into v_primary from public.subscription_lines l
   where l.organization_id = v_sub.organization_id and l.subscription_id = v_sub.id and l.role = 'primary'
     and l.starts_on <= p_starts_on and (l.ends_on is null or l.ends_on > p_starts_on);
  if v_primary is null or not exists (
       select 1 from public.price_book_item_addons x
        where x.organization_id = v_sub.organization_id and x.item_id = v_primary and x.addon_item_id = p_item_id) then
    raise exception 'That item is not an add-on of what this subscription is for on that date.' using errcode = 'GD043';
  end if;
  v_line := app.write_subscription_line(v_sub.organization_id, v_sub.id, p_item_id, 'addon', p_quantity,
                                        p_starts_on, null, v_actor, p_note);
  if p_agreed_amount_minor is not null then
    perform app.write_subscription_agreed_price(v_sub.organization_id, v_line, p_agreed_amount_minor,
                                                p_starts_on::timestamptz, v_actor, p_note);
  end if;
  perform app.require_priced_line(v_line, greatest(p_starts_on::timestamptz, now()));
  return v_line;
end $$;

-- A different primary item from a date: the current one ends there and the new one starts.
create function public.change_subscription_item(
  p_subscription_id uuid, p_item_id uuid, p_effective_on date, p_agreed_amount_minor bigint default null,
  p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub     public.subscriptions;
  v_actor   uuid;
  v_current public.subscription_lines;
  v_line    uuid;
begin
  select * into v_sub from public.subscriptions where id = p_subscription_id;
  v_actor := app.require_subscription_manager(v_sub.organization_id);
  perform app.require_recurring_item(v_sub.organization_id, p_item_id);
  select * into v_current from public.subscription_lines l
   where l.organization_id = v_sub.organization_id and l.subscription_id = v_sub.id and l.role = 'primary'
     and l.starts_on < p_effective_on and (l.ends_on is null or l.ends_on > p_effective_on);
  if v_current.id is null then
    raise exception 'Nothing this subscription is for is in force before that date to change.' using errcode = 'GD044';
  end if;
  if v_current.item_id = p_item_id then
    raise exception 'The subscription is already for that item; agree a price to change what it pays.' using errcode = 'GD044';
  end if;
  update public.subscription_lines set ends_on = p_effective_on where id = v_current.id;
  v_line := app.write_subscription_line(v_sub.organization_id, v_sub.id, p_item_id, 'primary', v_current.quantity,
                                        p_effective_on, null, v_actor, p_note);
  if p_agreed_amount_minor is not null then
    perform app.write_subscription_agreed_price(v_sub.organization_id, v_line, p_agreed_amount_minor,
                                                p_effective_on::timestamptz, v_actor, p_note);
  end if;
  perform app.require_priced_line(v_line, greatest(p_effective_on::timestamptz, now()));
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (v_sub.organization_id, v_actor, 'subscription', v_sub.id, 'subscription.item_changed',
          jsonb_build_object('fromLineId', v_current.id, 'toLineId', v_line, 'itemId', p_item_id, 'effectiveOn', p_effective_on));
  return v_line;
end $$;

-- An agreed price for one line from a moment on; a null amount returns the line to its list price.
create function public.set_subscription_price(
  p_line_id uuid, p_amount_minor bigint, p_effective_from timestamptz default now(), p_note text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_actor uuid;
  v_id    uuid;
  v_at    timestamptz := coalesce(p_effective_from, now());
begin
  select organization_id into v_org from public.subscription_lines where id = p_line_id;
  v_actor := app.require_subscription_manager(v_org);
  if v_at < now() - interval '1 minute' then
    raise exception 'A price change starts now or later, never in the past.' using errcode = '22023';
  end if;
  v_id := app.write_subscription_agreed_price(v_org, p_line_id, p_amount_minor, v_at, v_actor, p_note);
  perform app.require_priced_line(p_line_id, v_at);
  return v_id;
end $$;

create function public.end_subscription_addon(p_line_id uuid, p_ends_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line  public.subscription_lines;
  v_actor uuid;
begin
  select * into v_line from public.subscription_lines where id = p_line_id;
  v_actor := app.require_subscription_manager(v_line.organization_id);
  if v_line.role <> 'addon' then
    raise exception 'Only an add-on ends on its own; end the subscription to end what it is for.' using errcode = 'GD045';
  end if;
  if p_ends_on is null or p_ends_on <= v_line.starts_on or (v_line.ends_on is not null and p_ends_on > v_line.ends_on) then
    raise exception 'An add-on ends after it starts, and no later than it already does.' using errcode = '22023';
  end if;
  update public.subscription_lines set ends_on = p_ends_on where id = p_line_id;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (v_line.organization_id, v_actor, 'subscription', v_line.subscription_id, 'subscription.line_ended',
          jsonb_build_object('lineId', p_line_id, 'endsOn', p_ends_on));
end $$;

-- Ends a subscription on a date (exclusive): every line ends with it; a line that had not started
-- by then never takes effect.
create function public.cancel_subscription(p_subscription_id uuid, p_ends_on date, p_reason text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub   public.subscriptions;
  v_actor uuid;
begin
  select * into v_sub from public.subscriptions where id = p_subscription_id;
  v_actor := app.require_subscription_manager(v_sub.organization_id);
  if p_ends_on is null or p_ends_on <= v_sub.starts_on or (v_sub.ends_on is not null and p_ends_on > v_sub.ends_on) then
    raise exception 'A subscription ends after it starts, and no later than it already does.' using errcode = '22023';
  end if;
  delete from public.subscription_lines
   where organization_id = v_sub.organization_id and subscription_id = v_sub.id and starts_on >= p_ends_on;
  update public.subscription_lines set ends_on = p_ends_on
   where organization_id = v_sub.organization_id and subscription_id = v_sub.id and (ends_on is null or ends_on > p_ends_on);
  update public.subscriptions
     set ends_on = p_ends_on, canceled_at = now(), canceled_by = v_actor, cancel_reason = left(coalesce(p_reason, ''), 500)
   where id = v_sub.id;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (v_sub.organization_id, v_actor, 'subscription', v_sub.id, 'subscription.canceled',
          jsonb_build_object('endsOn', p_ends_on, 'reason', coalesce(p_reason, '')));
end $$;

-- An agreed usage price for one subscription line, from a moment on; a null amount returns the line
-- to its item's usage price.
create function public.set_subscription_usage_price(
  p_line_id uuid, p_meter_id text, p_unit_amount_micros bigint, p_effective_from timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line  record;
  v_actor uuid;
  v_at    timestamptz := coalesce(p_effective_from, now());
  v_id    uuid;
begin
  select l.*, s.currency into v_line
    from public.subscription_lines l join public.subscriptions s on s.organization_id = l.organization_id and s.id = l.subscription_id
   where l.id = p_line_id;
  v_actor := app.require_subscription_manager(v_line.organization_id);
  if not exists (select 1 from public.platform_plans where price_book_item_id = v_line.item_id) then
    raise exception 'This line sells no plan, so it has no metered usage.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.platform_meters where id = p_meter_id) then
    raise exception 'No such meter.' using errcode = '23503';
  end if;
  if p_unit_amount_micros is not null and p_unit_amount_micros < 0 then
    raise exception 'A usage price is zero or more.' using errcode = '22023';
  end if;
  if v_at < now() - interval '1 minute' then
    raise exception 'A usage price cannot start in the past.' using errcode = '22023';
  end if;
  update public.price_book_item_usage_prices
     set effective_to = v_at
   where subscription_line_id = p_line_id and meter_id = p_meter_id and currency = v_line.currency
     and effective_from <= v_at and (effective_to is null or effective_to > v_at);
  if p_unit_amount_micros is not null then
    insert into public.price_book_item_usage_prices
      (organization_id, item_id, subscription_line_id, meter_id, currency, unit_amount_micros, effective_from,
       approval_state, source, recorded_by)
    values (v_line.organization_id, v_line.item_id, p_line_id, p_meter_id, v_line.currency, p_unit_amount_micros, v_at,
            'approved', 'agreement', v_actor)
    returning id into v_id;
  end if;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (v_line.organization_id, v_actor, 'subscription', v_line.subscription_id, 'subscription.usage_price_agreed',
          jsonb_build_object('lineId', p_line_id, 'meterId', p_meter_id, 'unitAmountMicros', p_unit_amount_micros, 'effectiveFrom', v_at));
  return v_id;
end $$;

-- Each line's price at a moment, by the one rule, for the seller's subscription readers.
create function public.subscription_line_prices(p_subscription_id uuid, p_at timestamptz default now())
returns table (line_id uuid, amount_minor bigint, currency text, billing_interval text, source text, source_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.subscriptions where id = p_subscription_id;
  if v_org is null or v_org not in (select app.current_tenant_ids()) or not app.has_capability(v_org, 'subscription.read') then
    return;
  end if;
  return query
    select l.id, p.amount_minor, p.currency, p.billing_interval, p.source, p.source_id
      from public.subscription_lines l
      cross join lateral app.subscription_line_price(l.id, p_at) p
     where l.organization_id = v_org and l.subscription_id = p_subscription_id;
end $$;

revoke all on function public.create_subscription(uuid, uuid, uuid, text, text, date, date, integer, bigint, text) from public, anon;
revoke all on function public.add_subscription_addon(uuid, uuid, date, integer, bigint, text) from public, anon;
revoke all on function public.change_subscription_item(uuid, uuid, date, bigint, text) from public, anon;
revoke all on function public.set_subscription_price(uuid, bigint, timestamptz, text) from public, anon;
revoke all on function public.end_subscription_addon(uuid, date) from public, anon;
revoke all on function public.cancel_subscription(uuid, date, text) from public, anon;
revoke all on function public.set_subscription_usage_price(uuid, text, bigint, timestamptz) from public, anon;
revoke all on function public.subscription_line_prices(uuid, timestamptz) from public, anon;
grant execute on function public.create_subscription(uuid, uuid, uuid, text, text, date, date, integer, bigint, text) to authenticated;
grant execute on function public.add_subscription_addon(uuid, uuid, date, integer, bigint, text) to authenticated;
grant execute on function public.change_subscription_item(uuid, uuid, date, bigint, text) to authenticated;
grant execute on function public.set_subscription_price(uuid, bigint, timestamptz, text) to authenticated;
grant execute on function public.end_subscription_addon(uuid, date) to authenticated;
grant execute on function public.cancel_subscription(uuid, date, text) to authenticated;
grant execute on function public.set_subscription_usage_price(uuid, text, bigint, timestamptz) to authenticated;
grant execute on function public.subscription_line_prices(uuid, timestamptz) to authenticated;
revoke all on function app.write_subscription(uuid, uuid, text, text, date, date, uuid, text) from public, anon, authenticated;
revoke all on function app.write_subscription_line(uuid, uuid, uuid, text, integer, date, date, uuid, text) from public, anon, authenticated;
revoke all on function app.write_subscription_agreed_price(uuid, uuid, bigint, timestamptz, uuid, text) from public, anon, authenticated;
revoke all on function app.subscription_line_is_history() from public, anon, authenticated;
revoke all on function app.subscription_agreed_price_is_history() from public, anon, authenticated;
revoke all on function app.subscription_line_entitlements() from public, anon, authenticated;
revoke all on function app.client_tenant_entitlements() from public, anon, authenticated;
revoke all on function app.platform_subscription_collection() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 8. Invoices of a subscription: issued from Finance, or reported by the billing provider
-- ---------------------------------------------------------------------------------------------

alter table public.invoices
  add column subscription_id uuid,
  add column period_start date,
  add column period_end date,
  add column provider text,
  add column provider_environment text,
  add column provider_reference text,
  add column provider_number text,
  add column provider_url text,
  add column voided_at timestamptz;
alter table public.invoices drop constraint invoices_source_known;
alter table public.invoices drop constraint invoices_source_reference;
alter table public.invoices
  add constraint invoices_source_known check (source in ('work_item', 'direct', 'proposal', 'subscription')),
  add constraint invoices_subscription_same_org foreign key (organization_id, subscription_id)
    references public.subscriptions (organization_id, id) on delete restrict,
  add constraint invoices_provider_environment_known check (provider_environment is null or provider_environment in ('sandbox', 'live')),
  add constraint invoices_provider_together check (
    (provider is null) = (provider_reference is null) and (provider is null) = (provider_environment is null)
    and (provider is not null or (provider_number is null and provider_url is null))),
  add constraint invoices_provider_url_https check (provider_url is null or provider_url ~ '^https://'),
  add constraint invoices_source_reference check (
    (source = 'work_item' and work_item_id is not null and proposal_id is null and subscription_id is null
       and issuance_key is null and issuance_fingerprint is null and provider is null)
    or (source = 'direct' and work_item_id is null and proposal_id is null and subscription_id is null
       and issuance_key is not null and issuance_fingerprint is not null and provider is null)
    or (source = 'proposal' and work_item_id is null and proposal_id is not null and subscription_id is null
       and issuance_key is not null and issuance_fingerprint is not null and provider is null)
    or (source = 'subscription' and work_item_id is null and proposal_id is null and subscription_id is not null
       and period_start is not null and period_end > period_start
       and ((provider is null and issuance_key is not null and issuance_fingerprint is not null)
            or (provider is not null and issuance_key is null and issuance_fingerprint is null))));
create unique index invoices_org_provider_reference_unique
  on public.invoices (organization_id, provider, provider_reference) where provider is not null;
create unique index invoices_org_subscription_period_unique
  on public.invoices (organization_id, subscription_id, period_start) where source = 'subscription' and provider is null;
comment on column public.invoices.provider_reference is
  'The billing provider''s own id for an invoice it issued and reported (its external invoice id). Unique per business and provider.';
comment on column public.invoices.voided_at is
  'When the billing provider voided an invoice it issued. A voided invoice is owed by no one.';

-- Finance's invoice list: a voided invoice is owed by no one, so it is neither outstanding nor
-- overdue; the subscription and the provider's own number come with it.
create or replace view public.finance_invoice_records with (security_invoker = true) as
 select i.id, i.organization_id, i.work_item_id, i.customer_id, i.billed_to, i.number, i.currency, i.issued_at, i.due_at,
        i.created_by, t.total_minor,
        coalesce(p.paid_minor, 0::bigint) as paid_minor,
        case when i.voided_at is not null then 0::bigint else t.total_minor - coalesce(p.paid_minor, 0::bigint) end as outstanding_minor,
        (i.voided_at is not null or t.total_minor <= coalesce(p.paid_minor, 0::bigint)) as settled,
        (i.voided_at is null and t.total_minor > coalesce(p.paid_minor, 0::bigint) and i.due_at < now()) as overdue,
        i.source, i.proposal_id, i.subscription_id, i.provider, i.provider_number, i.voided_at
   from public.invoices i
   join lateral (select sum(l.unit_amount_minor * l.quantity)::bigint as total_minor
                   from public.invoice_lines l
                  where l.organization_id = i.organization_id and l.invoice_id = i.id) t on true
   left join lateral (select sum(p_1.amount_minor)::bigint as paid_minor
                        from public.payments p_1
                       where p_1.organization_id = i.organization_id and p_1.invoice_id = i.id) p on true;

-- Finance invoices the next period of a subscription it collects itself: every line in force when
-- the period starts, at its price then (or when the subscription was recorded, if that was later:
-- it was recorded on the terms that existed then); an item sold once only in the period its line
-- starts. No proration: a line added mid-period is billed from the next period.
create function public.issue_subscription_invoice(p_subscription_id uuid, p_due_at timestamptz, p_issuance_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_sub      public.subscriptions;
  v_customer public.contacts;
  v_start    date;
  v_end      date;
  v_number   integer;
  v_existing public.invoices;
  v_fp       text;
  v_invoice  uuid;
  v_line     record;
  v_position integer := 0;
  v_unpriced integer;
begin
  select * into v_sub from public.subscriptions where id = p_subscription_id;
  if v_actor is null or v_sub.id is null
     or v_sub.organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(v_sub.organization_id, 'invoice.issue') then
    raise exception 'You cannot issue invoices for this subscription.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.usable_modules(v_sub.organization_id) m where m = 'billing') then
    raise exception 'Billing is not available for this business.' using errcode = '42501';
  end if;
  if p_issuance_key is null then
    raise exception 'An issuance needs its own key, so a retry is the same request.' using errcode = '22023';
  end if;
  if v_sub.collection = 'provider' then
    raise exception 'The billing provider invoices this subscription.' using errcode = 'GD046';
  end if;

  v_number := app.allocate_invoice_number(v_sub.organization_id);

  select * into v_existing from public.invoices
   where organization_id = v_sub.organization_id and issuance_key = p_issuance_key;
  if v_existing.id is not null then
    if v_existing.subscription_id = v_sub.id then return v_existing.id; end if;
    raise exception 'That issuance key was already used for a different invoice.' using errcode = 'GD014';
  end if;

  v_start := coalesce((select max(i.period_end) from public.invoices i
                        where i.organization_id = v_sub.organization_id and i.subscription_id = v_sub.id
                          and i.provider is null),
                      v_sub.starts_on);
  if v_sub.ends_on is not null and v_start >= v_sub.ends_on then
    raise exception 'Every period of this subscription is already invoiced.' using errcode = 'GD047';
  end if;
  if v_start > current_date then
    raise exception 'The next period starts on %; invoice it then.', v_start using errcode = 'GD048';
  end if;
  v_end := (v_start + case when v_sub.billing_interval = 'year' then interval '1 year' else interval '1 month' end)::date;
  if v_sub.ends_on is not null then v_end := least(v_end, v_sub.ends_on); end if;
  if p_due_at is not null and p_due_at < now() - interval '1 minute' then
    raise exception 'The due date is before the invoice date.' using errcode = '22023';
  end if;

  select count(*) into v_unpriced
    from public.subscription_lines l
   where l.organization_id = v_sub.organization_id and l.subscription_id = v_sub.id
     and l.starts_on <= v_start and (l.ends_on is null or l.ends_on > v_start)
     and not exists (select 1 from app.subscription_line_price(l.id, greatest(v_start::timestamptz, v_sub.created_at)));
  if v_unpriced > 0 then
    raise exception 'A line of this subscription has no price for this period.' using errcode = 'GD042';
  end if;

  select * into v_customer from public.contacts where organization_id = v_sub.organization_id and id = v_sub.customer_id;
  v_fp := md5(jsonb_build_object('subscription', v_sub.id, 'period_start', v_start)::text);

  insert into public.invoices
    (organization_id, source, subscription_id, period_start, period_end, customer_id, billed_to, number, currency,
     issued_at, due_at, created_by, issuance_key, issuance_fingerprint)
  values (v_sub.organization_id, 'subscription', v_sub.id, v_start, v_end, v_sub.customer_id,
          left(coalesce(nullif(btrim(v_customer.name), ''), 'Customer'), 200), v_number, v_sub.currency,
          now(), p_due_at, v_actor, p_issuance_key, v_fp)
  returning id into v_invoice;

  for v_line in
    select l.id, l.quantity, l.starts_on, b.name, b.unit, p.amount_minor, p.currency, p.billing_interval
      from public.subscription_lines l
      join public.price_book_items b on b.organization_id = l.organization_id and b.id = l.item_id
      cross join lateral app.subscription_line_price(l.id, greatest(greatest(l.starts_on, v_start)::timestamptz, v_sub.created_at)) p
     where l.organization_id = v_sub.organization_id and l.subscription_id = v_sub.id
       and ((p.billing_interval <> 'one_time' and l.starts_on <= v_start and (l.ends_on is null or l.ends_on > v_start))
            or (p.billing_interval = 'one_time' and l.starts_on >= v_start and l.starts_on < v_end
                and not exists (select 1 from public.invoices i where i.organization_id = v_sub.organization_id
                                   and i.subscription_id = v_sub.id and i.id <> v_invoice and i.provider is null
                                   and l.starts_on >= i.period_start and l.starts_on < i.period_end)))
     order by l.role desc, l.starts_on, l.id
  loop
    v_position := v_position + 1;
    insert into public.invoice_lines
      (organization_id, invoice_id, description, unit, unit_amount_minor, currency, quantity, position)
    values (v_sub.organization_id, v_invoice,
            left(v_line.name || case when v_line.billing_interval = 'one_time' then '' else
                   ' (' || to_char(v_start, 'YYYY-MM-DD') || ' to ' || to_char(v_end - 1, 'YYYY-MM-DD') || ')' end, 500),
            v_line.unit, v_line.amount_minor, v_line.currency, v_line.quantity, v_position);
  end loop;
  if v_position = 0 then
    raise exception 'Nothing on this subscription is billed for this period.' using errcode = 'GD002';
  end if;

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (v_sub.organization_id, v_actor, 'invoice', v_invoice, 'invoice.issued',
          jsonb_build_object('invoice_id', v_invoice, 'number', v_number, 'currency', v_sub.currency, 'source', 'subscription',
                             'subscription_id', v_sub.id, 'customer_id', v_sub.customer_id,
                             'period_start', v_start, 'period_end', v_end));
  return v_invoice;
end $$;
revoke all on function public.issue_subscription_invoice(uuid, timestamptz, uuid) from public, anon;
grant execute on function public.issue_subscription_invoice(uuid, timestamptz, uuid) to authenticated;

alter table public.platform_billing_webhook_events drop constraint platform_billing_webhook_events_application_check;
alter table public.platform_billing_webhook_events add constraint platform_billing_webhook_events_application_check
  check (application = any (array['applied', 'stale', 'ambiguous', 'unmatched']));

-- An invoice GildOps' billing provider issued, paid, voided or refunded, for a business it serves.
-- Which business comes from the provider customer GildOps provisioned, in the environment the
-- signed event came from; which customer and subscription from GildOps' own records. Idempotent by
-- the provider's event id, and by its invoice, payment and refund ids. Becomes an ordinary invoice
-- of GildOps' Finance: its lines are what the provider charged, so it totals what the provider
-- says is due.
create function public.apply_platform_invoice_event(
  p_event_reference text, p_event_type text, p_customer_reference text, p_invoice jsonb,
  p_provider text default 'stripe', p_environment text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  constant uuid := '00000000-0000-4000-8000-0000000000a3';
  v_seller uuid := app.platform_seller_id();
  v_org    uuid;
  v_env    text;
  v_event  uuid;
  v_ref    text := p_invoice ->> 'id';
  v_cust   uuid;
  v_sub    public.subscriptions;
  v_inv    public.invoices;
  v_name   text;
  v_line   jsonb;
  v_pos    integer := 0;
  v_sum    bigint := 0;
  v_total  bigint;
  v_qty    integer;
  v_amount bigint;
  v_refund jsonb;
  v_paid   bigint;
  v_cur    text := upper(btrim(coalesce(p_invoice ->> 'currency', '')));
  v_issued timestamptz;
begin
  if coalesce(btrim(v_ref), '') = '' or v_cur !~ '^[A-Z]{3}$' then
    raise exception 'an invoice event needs the provider''s invoice id and currency' using errcode = '22023';
  end if;
  select c.organization_id, c.environment into v_org, v_env
    from app.platform_billing_customer_for_event(p_provider, p_environment, p_customer_reference) c;
  if v_org is null or v_seller is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':' || v_env, 0));

  insert into public.platform_billing_webhook_events
    (provider, event_reference, event_type, environment, organization_id, provider_event_created_at)
  values (p_provider, p_event_reference, p_event_type, v_env, v_org,
          to_timestamp(nullif(p_invoice ->> 'event_created', '')::bigint))
  on conflict (organization_id, event_reference) do nothing
  returning id into v_event;
  if v_event is null then
    return null;
  end if;

  select * into v_inv from public.invoices
   where organization_id = v_seller and provider = p_provider and provider_reference = v_ref;

  if v_inv.id is null then
    if coalesce(p_invoice ->> 'status', '') not in ('open', 'paid', 'void', 'uncollectible') then
      update public.platform_billing_webhook_events set application = 'applied' where id = v_event;
      return v_org;
    end if;
    select r.customer_id into v_cust from public.client_tenant_relationships r
     where r.organization_id = v_seller and r.tenant_organization_id = v_org and r.status = 'active'
     order by r.created_at desc limit 1;
    select * into v_sub from public.subscriptions s
     where s.organization_id = v_seller and s.customer_id = v_cust
     order by (s.starts_on <= current_date and (s.ends_on is null or s.ends_on > current_date)) desc, s.starts_on desc
     limit 1;
    if v_sub.id is null then
      update public.platform_billing_webhook_events set application = 'unmatched' where id = v_event;
      return v_org;
    end if;
    select left(coalesce(nullif(btrim(c.name), ''), 'Customer'), 200) into v_name
      from public.contacts c where c.organization_id = v_seller and c.id = v_cust;
    v_issued := coalesce(to_timestamp(nullif(p_invoice ->> 'finalized_at', '')::bigint),
                         to_timestamp(nullif(p_invoice ->> 'created', '')::bigint), now());

    insert into public.invoices
      (organization_id, source, subscription_id, period_start, period_end, customer_id, billed_to, number, currency,
       issued_at, due_at, created_by, provider, provider_environment, provider_reference, provider_number, provider_url)
    values (v_seller, 'subscription', v_sub.id,
            coalesce(to_timestamp(nullif(p_invoice ->> 'period_start', '')::bigint)::date, v_issued::date),
            greatest(coalesce(to_timestamp(nullif(p_invoice ->> 'period_end', '')::bigint)::date, v_issued::date),
                     coalesce(to_timestamp(nullif(p_invoice ->> 'period_start', '')::bigint)::date, v_issued::date) + 1),
            v_cust, v_name, app.allocate_invoice_number(v_seller), v_cur, v_issued,
            to_timestamp(nullif(p_invoice ->> 'due_date', '')::bigint), v_actor, p_provider, v_env, v_ref,
            nullif(left(btrim(coalesce(p_invoice ->> 'number', '')), 100), ''),
            case when (p_invoice ->> 'hosted_invoice_url') ~ '^https://' then left(p_invoice ->> 'hosted_invoice_url', 1000) end)
    returning * into v_inv;

    for v_line in select value from jsonb_array_elements(coalesce(p_invoice -> 'lines', '[]'::jsonb)) loop
      v_amount := (v_line ->> 'amount')::bigint;
      v_qty := greatest(coalesce((v_line ->> 'quantity')::integer, 1), 1);
      if v_amount % v_qty <> 0 then v_qty := 1; end if;
      v_pos := v_pos + 1;
      v_sum := v_sum + v_amount;
      insert into public.invoice_lines (organization_id, invoice_id, description, unit, unit_amount_minor, currency, quantity, position)
      values (v_seller, v_inv.id, left(coalesce(nullif(btrim(v_line ->> 'description'), ''), 'Subscription'), 500), 'each',
              v_amount / v_qty, v_cur, v_qty, v_pos);
    end loop;
    if coalesce((p_invoice ->> 'tax')::bigint, 0) <> 0 then
      v_pos := v_pos + 1;
      v_sum := v_sum + (p_invoice ->> 'tax')::bigint;
      insert into public.invoice_lines (organization_id, invoice_id, description, unit, unit_amount_minor, currency, quantity, position)
      values (v_seller, v_inv.id, 'Tax', 'each', (p_invoice ->> 'tax')::bigint, v_cur, 1, v_pos);
    end if;
    v_total := coalesce((p_invoice ->> 'total')::bigint, v_sum);
    if v_total <> v_sum or v_pos = 0 then
      v_pos := v_pos + 1;
      insert into public.invoice_lines (organization_id, invoice_id, description, unit, unit_amount_minor, currency, quantity, position)
      values (v_seller, v_inv.id, 'Discounts and other provider adjustments', 'each', v_total - v_sum, v_cur, 1, v_pos);
    end if;
    insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
    values (v_seller, v_actor, 'invoice', v_inv.id, 'invoice.issued',
            jsonb_build_object('invoice_id', v_inv.id, 'number', v_inv.number, 'currency', v_cur, 'source', 'subscription',
                               'subscription_id', v_sub.id, 'customer_id', v_cust, 'provider', p_provider,
                               'provider_reference', v_ref));
  end if;

  -- What the provider collected, once, under the provider's own payment id.
  v_paid := coalesce((p_invoice ->> 'amount_paid')::bigint, 0);
  if (p_invoice ->> 'status') = 'paid' and v_paid > 0 then
    insert into public.payments (organization_id, invoice_id, amount_minor, currency, received_at, provider, provider_reference, note, created_by)
    values (v_seller, v_inv.id, v_paid, v_inv.currency,
            coalesce(to_timestamp(nullif(p_invoice ->> 'paid_at', '')::bigint), now()), p_provider,
            coalesce(nullif(btrim(p_invoice ->> 'payment_reference'), ''), 'invoice:' || v_ref), null, v_actor)
    on conflict do nothing;
  end if;

  for v_refund in select value from jsonb_array_elements(coalesce(p_invoice -> 'refunds', '[]'::jsonb)) loop
    if coalesce(btrim(v_refund ->> 'id'), '') <> '' and coalesce((v_refund ->> 'amount')::bigint, 0) > 0 then
      insert into public.payments (organization_id, invoice_id, amount_minor, currency, received_at, provider, provider_reference, note, created_by)
      values (v_seller, v_inv.id, -(v_refund ->> 'amount')::bigint, v_inv.currency,
              coalesce(to_timestamp(nullif(v_refund ->> 'created', '')::bigint), now()), p_provider, v_refund ->> 'id', 'Refund', v_actor)
      on conflict do nothing;
    end if;
  end loop;

  if (p_invoice ->> 'status') = 'void' and v_inv.voided_at is null then
    update public.invoices set voided_at = now() where id = v_inv.id;
  end if;

  update public.platform_billing_webhook_events set application = 'applied' where id = v_event;
  return v_org;
end $$;
revoke all on function public.apply_platform_invoice_event(text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.apply_platform_invoice_event(text, text, text, jsonb, text, text) to platform_billing_webhook;

-- Invoice events are applied now, not only logged: the notice writer has no caller.
drop function public.record_platform_billing_notice(text, text, text, text, text);

-- The invoices GildOps addressed to this business, for its own billing managers: what is owed and
-- paid, and the provider's page to pay it — never GildOps' costs, lines of other customers or
-- anything about the seller beyond the invoice itself.
create function public.platform_invoices_for_buyer(p_organization_id uuid)
returns table (id uuid, number text, issued_at timestamptz, due_at timestamptz, period_start date, period_end date,
               currency text, total_minor bigint, paid_minor bigint, voided boolean, pay_url text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_seller uuid := app.platform_seller_id();
begin
  if v_seller is null or p_organization_id is null or p_organization_id = v_seller
     or p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'billing.manage') then
    return;
  end if;
  return query
    select i.id, coalesce(i.provider_number, i.number::text), i.issued_at, i.due_at, i.period_start, i.period_end, i.currency,
           (select coalesce(sum(l.unit_amount_minor * l.quantity), 0)::bigint from public.invoice_lines l
             where l.organization_id = i.organization_id and l.invoice_id = i.id),
           (select coalesce(sum(p.amount_minor), 0)::bigint from public.payments p
             where p.organization_id = i.organization_id and p.invoice_id = i.id),
           i.voided_at is not null, i.provider_url
      from public.invoices i
     where i.organization_id = v_seller
       and i.customer_id in (select r.customer_id from public.client_tenant_relationships r
                              where r.organization_id = v_seller and r.tenant_organization_id = p_organization_id)
     order by i.issued_at desc, i.number desc
     limit 100;
end $$;
revoke all on function public.platform_invoices_for_buyer(uuid) from public, anon;
grant execute on function public.platform_invoices_for_buyer(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 9. Verification
-- ---------------------------------------------------------------------------------------------

do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('app', 'public') and p.prokind = 'f'
     and (pg_get_functiondef(p.oid) ~ 'organization_plan_agreements\M' or pg_get_functiondef(p.oid) ~ 'platform_retail_rates'
          or pg_get_functiondef(p.oid) ~ 'retail_rate_at\(' or pg_get_functiondef(p.oid) ~ 'write_plan_agreement');
  if v_n > 0 then raise exception '% functions still read retired commercial records', v_n; end if;

  select count(*) into v_n from public.price_book_item_usage_prices
   where item_id is null and (effective_to is null or effective_to > now());
  if v_n > 0 then raise exception '% usage prices still apply to no item', v_n; end if;

  select count(*) into v_n from public.platform_catalog_features f
    join public.platform_catalog_modules m on m.id = f.module_id
    join public.platform_catalog_products p on p.id = m.product_id
   where f.key = 'subscriptions' and (p.key <> 'finance' or m.key <> 'subscriptions');
  if v_n > 0 then raise exception 'Subscriptions is not a Gild Finance feature'; end if;
end $$;

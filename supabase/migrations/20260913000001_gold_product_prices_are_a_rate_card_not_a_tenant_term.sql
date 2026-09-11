-- GOLD's recurring list price is a platform fact.  It must never be inferred from, or update,
-- organization_commercial_terms: the former is an effective-dated rate card, the latter is an
-- agreed historical term for one customer.

create table public.platform_product_prices (
  id uuid primary key default gen_random_uuid(),
  product_key text not null references public.platform_products (key),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_minor bigint not null check (amount_minor >= 0),
  billing_interval text not null check (billing_interval in ('month', 'year', 'one_time')) default 'month',
  effective_from timestamptz not null default now(),
  approval_state text not null check (approval_state in ('draft', 'approved')) default 'approved',
  source text not null check (length(btrim(source)) between 1 and 200),
  note text not null default '',
  recorded_by uuid not null references auth.users (id),
  recorded_at timestamptz not null default now(),
  unique (product_key, currency, billing_interval, effective_from)
);

comment on table public.platform_product_prices is
  'GOLD''s own default/list recurring prices. Append-only and effective-dated. These are never a substitute for organization_commercial_terms, which preserve each tenant''s separately agreed price.';

create index platform_product_prices_current_idx on public.platform_product_prices (product_key, currency, billing_interval, effective_from desc);
alter table public.platform_product_prices enable row level security;
alter table public.platform_product_prices force row level security;
create policy platform_product_prices_platform_select on public.platform_product_prices for select to platform_staff using (true);
grant select on public.platform_product_prices to platform_staff;

create function public.record_product_price(
  p_product_key text,
  p_currency text,
  p_amount_minor bigint,
  p_billing_interval text default 'month',
  p_effective_from timestamptz default now(),
  p_approval_state text default 'approved',
  p_source text default 'staff rate card',
  p_note text default ''
) returns uuid language plpgsql volatile security definer set search_path = '' as $fn$
declare v_id uuid;
begin
  perform app.require_platform_staff();
  if p_billing_interval not in ('month', 'year', 'one_time') then raise exception 'unknown billing interval' using errcode = '22023'; end if;
  if p_approval_state not in ('draft', 'approved') then raise exception 'unknown approval state' using errcode = '22023'; end if;
  insert into public.platform_product_prices (product_key, currency, amount_minor, billing_interval, effective_from, approval_state, source, note, recorded_by)
  values (p_product_key, upper(btrim(p_currency)), p_amount_minor, p_billing_interval, p_effective_from, p_approval_state, p_source, p_note, auth.uid())
  returning id into v_id;
  return v_id;
end;
$fn$;

comment on function public.record_product_price(text, text, bigint, text, timestamptz, text, text, text) is
  'The narrow, staff-only writer for an append-only global product-price rate card. It never writes organization_commercial_terms.';
revoke all on function public.record_product_price(text, text, bigint, text, timestamptz, text, text, text) from public;
grant execute on function public.record_product_price(text, text, bigint, text, timestamptz, text, text, text) to platform_staff;

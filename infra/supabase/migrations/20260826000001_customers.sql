-- Customer: the first genuinely tenant-owned entity.
--
-- `organizations` is the tenant and `memberships`/`events` reference it. This is the first
-- table that is *owned by* a tenant in the ordinary way, so it is the first real exercise of
-- I1 and I2 — and of the specific failure constraints.md names:
--
--   > Its `customers_email_unique` is global too, so two tenants could never share a
--   > customer email address.
--
-- Hence customers_org_email_unique below leads with organization_id. Two tenants serving the
-- same person is normal, not a conflict.

create table public.customers (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  -- One name column, not first/last. "Individual or company" is the domain model's wording,
  -- and a company has no surname. A tenant that wants the split gets it as configured
  -- custom fields (D7), not as columns every other tenant carries.
  name            text        not null check (length(btrim(name)) between 1 and 200),
  email           text        check (email is null or length(btrim(email)) between 3 and 320),
  phone           text        check (phone is null or length(btrim(phone)) between 3 and 50),
  created_at      timestamptz not null default now(),
  created_by      uuid        not null references auth.users (id)
);

-- I2. Partial, because email is optional and Postgres treats each NULL as distinct anyway —
-- being explicit says the omission is intended rather than overlooked. lower() because
-- addresses are not case-sensitive in practice and two rows differing only in case are the
-- same customer entered twice.
create unique index customers_org_email_unique
  on public.customers (organization_id, lower(email))
  where email is not null;

create index customers_org_created_at_idx
  on public.customers (organization_id, created_at desc);

alter table public.customers enable row level security;
alter table public.customers force row level security;

create policy customers_select on public.customers
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy customers_insert on public.customers
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
  );

-- No update or delete policy. Editing and removing customers have no caller in this change,
-- and RLS default-denies what has no policy.

grant select, insert on public.customers to authenticated;

-- ---------------------------------------------------------------------------
-- Creation as one transaction
-- ---------------------------------------------------------------------------

-- SECURITY INVOKER (the default) — deliberately NOT definer. The caller is already a member
-- of the organization, so RLS can do its job on both inserts and this function needs no
-- privilege of its own. Like public.create_organization it is a TRANSACTION BOUNDARY and
-- nothing more: a customer that exists with no event in the timeline is a customer whose
-- history begins with a hole, and `events` cannot be backfilled.
create function public.create_customer(
  p_organization_id uuid,
  p_name            text,
  p_email           text,
  p_phone           text
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'create_customer requires an authenticated caller'
      using errcode = '42501';
  end if;

  insert into public.customers (organization_id, name, email, phone, created_by)
  values (p_organization_id, p_name, p_email, p_phone, v_actor)
  returning id into v_id;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'customer', v_id, 'customer.created',
     jsonb_build_object('name', p_name));

  return v_id;
end;
$fn$;

revoke all on function public.create_customer(uuid, text, text, text) from public;
grant execute on function public.create_customer(uuid, text, text, text) to authenticated;

-- D41, built: what a business wants and what it has paid for are two rows, and what it may use
-- is their intersection.
--
-- `organization_modules` keeps answering exactly one question, unchanged: does this business
-- want this module. This migration adds the second table D41 already specified in full --
-- `organization_commercial_terms`, append-only, never updated, only superseded -- and the
-- functions that compute the intersection rather than storing it.
--
-- **Existing tenants must not go read-only the day this ships.** Every business currently using
-- a module gets backfilled a zero-price, open-ended term for it, mirroring exactly how
-- `20260829000009_modules.sql` backfilled `organization_modules` itself when that table first
-- shipped. Nothing already working stops working. What changes is only what happens *next*: a
-- business enabling a module beyond the founding four from this point on sits in "wanted, not
-- yet paid" until GOLD records a term for it -- see `apps/web/scripts/demo/` for the one caller
-- that needed updating so `pnpm demo` keeps showing a fully-usable business.

-- ---------------------------------------------------------------------------
-- The term
-- ---------------------------------------------------------------------------

create table public.organization_commercial_terms (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null references public.organizations (id) on delete cascade,
  product_key     text        not null references public.platform_products (key),

  -- Half-open, like every other date range this schema compares (I9's convention, one level up
  -- from timestamptz).
  period_start    date        not null,
  period_end      date        not null,

  quantity        integer     not null default 1 check (quantity > 0),
  price_minor     bigint      not null check (price_minor >= 0),

  -- Nullable, mirroring organizations.currency (I10, `20260904000001`): a founding term at zero
  -- price makes no claim about what a business trades in. A term that actually charges something
  -- must say in what.
  currency        text        check (currency ~ '^[A-Z]{3}$'),
  constraint organization_commercial_terms_currency_or_free
    check (currency is not null or price_minor = 0),

  recorded_by     uuid        not null references auth.users (id),
  recorded_at     timestamptz not null default now(),
  note            text        not null default '',

  constraint organization_commercial_terms_period_ordered check (period_end > period_start),

  -- I2: leads with organization_id. Two terms for one product on one business must not cover
  -- the same day twice -- selling a subscription two ways at once is a question nobody asked,
  -- and a gist exclusion refuses it outright rather than racing a pre-insert check (I6's
  -- reasoning, one ledger over from work_item_priced_lines).
  constraint organization_commercial_terms_no_overlap
    exclude using gist (
      organization_id with =,
      product_key with =,
      daterange(period_start, period_end) with &&
    )
);

comment on table public.organization_commercial_terms is
  'D41''s term: what has been sold, snapshotted (I8), never updated -- only superseded by a later row covering a different period. Nobody signed in writes one; public.record_commercial_term is the only door.';

create index organization_commercial_terms_org_idx
  on public.organization_commercial_terms (organization_id, product_key, period_start desc);

alter table public.organization_commercial_terms enable row level security;
alter table public.organization_commercial_terms force row level security;

-- What a business bought is not a secret from itself.
create policy organization_commercial_terms_select on public.organization_commercial_terms
  for select to authenticated
  using (organization_id in (select app.current_tenant_ids()));

create policy organization_commercial_terms_platform_select on public.organization_commercial_terms
  for select to platform_staff using (true);

grant select on public.organization_commercial_terms to authenticated;
grant select on public.organization_commercial_terms to platform_staff;
-- No insert/update/delete grant to anyone, staff included (D41's own rule, restated): the only
-- writer is public.record_commercial_term, below.

create function public.record_commercial_term(
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
  v_name := app.require_platform_staff();

  insert into public.organization_commercial_terms
    (organization_id, product_key, period_start, period_end, quantity, price_minor, currency, recorded_by, note)
  values
    (p_organization_id, p_product_key, p_period_start, p_period_end, coalesce(p_quantity, 1),
     p_price_minor, v_currency, v_staff, p_note)
  returning id into v_id;

  -- Scoped to this tenant, unlike a rate: "GOLD sold this business a subscription" is a fact
  -- about that business's own history (I11), the same way `organization.created` records who
  -- provisioned it.
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
  'The only way to write a term. Staff-checked, SECURITY DEFINER, no table grant behind it (I21''s shape, the provision_organization precedent). Writes one events row on the tenant it concerns.';

revoke all on function public.record_commercial_term(uuid, text, date, date, bigint, text, integer, text) from public;
grant execute on function public.record_commercial_term(uuid, text, date, date, bigint, text, integer, text) to platform_staff;

-- ---------------------------------------------------------------------------
-- The intersection, computed, never stored
-- ---------------------------------------------------------------------------

create function app.module_paid(p_organization_id uuid, p_module_key text, p_at date default current_date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1
      from public.organization_commercial_terms t
     where t.organization_id = p_organization_id
       and t.product_key = 'module:' || p_module_key
       and t.period_start <= p_at
       and t.period_end   >  p_at
  );
$fn$;

comment on function app.module_paid(uuid, text, date) is
  'Whether a module is currently covered by a term. SECURITY DEFINER because app.check_module_entitlement (next migration) calls it from inside a trigger, where the caller''s own grants do not apply.';

revoke all on function app.module_paid(uuid, text, date) from public;

-- The wanted (organization_modules) times paid (organization_commercial_terms) intersection --
-- D41's own words. security invoker: both source tables already carry the caller's own RLS, so
-- this reads exactly what the caller could read by hand, the same shape `invoiced_and_incurred`
-- uses one engine over.
create function public.usable_modules(p_organization_id uuid)
returns setof text
language sql
stable
security invoker
set search_path = ''
as $fn$
  select m.module_key
    from public.organization_modules m
    join public.organization_commercial_terms t
      on t.organization_id = m.organization_id
     and t.product_key = 'module:' || m.module_key
     and t.period_start <= current_date
     and t.period_end   >  current_date
   where m.organization_id = p_organization_id;
$fn$;

comment on function public.usable_modules(uuid) is
  'Wanted and paid, together -- what listEnabledModules now calls instead of reading organization_modules alone. Never consulted by any RLS policy (D25, D41''s own rule, unchanged).';

revoke all on function public.usable_modules(uuid) from public;
grant execute on function public.usable_modules(uuid) to authenticated, platform_staff;

-- The full four-state read, for a settings screen or the platform console to render in words --
-- "on," "switched on but nothing is paying for it," "paid for but switched off," and the fourth
-- state, absent, which is simply a module key that appears in neither side and so never appears
-- in this result at all (D25: nothing to explain about a module that isn't part of this
-- business).
create function public.module_commercial_state(p_organization_id uuid)
returns table (module_key text, wanted boolean, paid boolean, period_end date)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select coalesce(w.module_key, p.module_key) as module_key,
         w.module_key is not null as wanted,
         p.module_key is not null as paid,
         p.period_end
    from (
      select m.module_key from public.organization_modules m
       where m.organization_id = p_organization_id
    ) w
    full outer join (
      select t.product_key, substr(t.product_key, 8) as module_key, t.period_end
        from public.organization_commercial_terms t
       where t.organization_id = p_organization_id
         and t.product_key like 'module:%'
         and t.period_start <= current_date
         and t.period_end   >  current_date
    ) p
      on p.module_key = w.module_key;
$fn$;

comment on function public.module_commercial_state(uuid) is
  'All four D41 states for one business, except the absent one -- a module in neither set produces no row, since there is nothing to explain about it.';

revoke all on function public.module_commercial_state(uuid) from public;
grant execute on function public.module_commercial_state(uuid) to authenticated, platform_staff;

-- ---------------------------------------------------------------------------
-- Founding: a trial is a term, not a special case (D41's own line)
-- ---------------------------------------------------------------------------

-- Replaces app.enable_default_modules -- D41 names this substitution outright. Still switches on
-- the same four rows in organization_modules; now also grants a zero-price, open-ended term for
-- the one of them that is a real product (`billing` -- `work`, `scheduling` and `customers` are
-- kernel rows organization_modules has always carried with no MODULES entry, so there is nothing
-- for a term to cover).
-- **`billing` and `drafting`, not the four `20260829000009` first shipped.** The kernel --
-- `work`, `scheduling`, `customers` -- was removed from this set entirely by
-- `20260829000012_kernel_is_not_a_module.sql`, and `20260904000001` added `drafting`. This
-- reads the founding set as it stands today rather than re-deriving it from the first version,
-- which would resurrect three rows that migration deliberately deleted.
create function app.grant_founding_terms(p_organization_id uuid, p_actor uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  insert into public.organization_modules (organization_id, module_key, enabled_by)
  select p_organization_id, key, p_actor
    from unnest(array['billing', 'drafting']) as key
  on conflict do nothing;

  insert into public.organization_commercial_terms
    (organization_id, product_key, period_start, period_end, price_minor, currency, recorded_by, note)
  select p_organization_id, 'module:' || key, current_date, date '9999-12-31', 0, null, p_actor,
         'Founding: included with every business, at no charge.'
    from unnest(array['billing', 'drafting']) as key
  on conflict do nothing;
end;
$fn$;

comment on function app.grant_founding_terms(uuid, uuid) is
  'What a founding business gets, switched on and paid for at zero price -- D41''s "a trial stops being a special case" rule. Supersedes app.enable_default_modules rather than editing it (D15).';

revoke all on function app.grant_founding_terms(uuid, uuid) from public;

-- Both doors onto the one creation path (D29) now grant terms rather than only switching modules
-- on. Recreated in full because a migration that has been applied is never modified (D15) --
-- the only change from `20260904000001`'s body, the latest before this one, is the one
-- `perform` line below.
create or replace function public.create_organization(
  p_name         text,
  p_role         text,
  p_capabilities text[],
  p_display_name text,
  p_timezone     text,
  p_currency     text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
  v_org   uuid;
  v_role  uuid;
begin
  if v_actor is null then
    raise exception 'create_organization requires an authenticated caller'
      using errcode = '42501';
  end if;

  -- Anonymous is a real session and a real `auth.uid()` (D22) -- still not a person who may
  -- found a business.
  if coalesce((select u.is_anonymous from auth.users u where u.id = v_actor), true) then
    raise exception 'an anonymous session may not create an organization'
      using errcode = '42501';
  end if;

  -- No raise on a null currency here -- `20260904000001` moved that refusal to the write that
  -- actually needs one (`create_price_book_item`, `record_work_item_cost`). Nothing here invents
  -- one either.
  insert into public.organizations (name, timezone, currency, created_by)
  values (p_name, coalesce(p_timezone, 'UTC'), p_currency, v_actor)
  returning id into v_org;

  insert into public.roles (organization_id, name, capabilities, created_by)
  values (v_org, p_role, p_capabilities, v_actor)
  returning id into v_role;

  insert into public.memberships
    (organization_id, user_id, role_id, display_name, created_by)
  values (v_org, v_actor, v_role, p_display_name, v_actor);

  perform app.grant_founding_terms(v_org, v_actor);

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_actor, 'organization', v_org, 'organization.created',
     jsonb_build_object(
       'name', p_name, 'role', p_role, 'timezone', p_timezone, 'currency', p_currency
     ));

  return v_org;
end;
$fn$;

revoke all on function public.create_organization(text, text, text[], text, text, text) from public;
grant execute on function public.create_organization(text, text, text[], text, text, text) to authenticated;

create or replace function public.provision_organization(
  p_owner_email  text,
  p_name         text,
  p_role         text,
  p_capabilities text[],
  p_display_name text,
  p_timezone     text,
  p_currency     text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff       uuid := (select auth.uid());
  v_staff_name  text;
  v_owner       uuid;
  v_owner_email text := lower(btrim(p_owner_email));
  v_org         uuid;
  v_role        uuid;
begin
  if v_staff is null then
    raise exception 'provision_organization requires an authenticated caller'
      using errcode = '42501';
  end if;

  select s.name into v_staff_name
    from public.platform_staff s
   where s.user_id = v_staff;

  if v_staff_name is null then
    raise exception 'only platform staff may provision a business'
      using errcode = '42501';
  end if;

  select u.id into v_owner
    from auth.users u
   where lower(u.email) = v_owner_email;

  if v_owner is null then
    raise exception 'Nobody with the address % has an account yet. They have to sign up before a business can be handed to them.', v_owner_email
      using errcode = '23503';
  end if;

  if coalesce((select u.is_anonymous from auth.users u where u.id = v_owner), true) then
    raise exception 'that account cannot own a business'
      using errcode = '42501';
  end if;

  if p_currency is null then
    raise exception 'an organization must say what currency it trades in'
      using errcode = '23514';
  end if;

  insert into public.organizations (name, timezone, currency, created_by)
  values (p_name, coalesce(p_timezone, 'UTC'), p_currency, v_owner)
  returning id into v_org;

  insert into public.roles (organization_id, name, capabilities, created_by)
  values (v_org, p_role, p_capabilities, v_owner)
  returning id into v_role;

  insert into public.memberships
    (organization_id, user_id, role_id, display_name, created_by)
  values (v_org, v_owner, v_role, p_display_name, v_owner);

  perform app.grant_founding_terms(v_org, v_owner);

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (v_org, v_staff, 'organization', v_org, 'organization.created',
     jsonb_build_object(
       'name', p_name, 'role', p_role, 'timezone', p_timezone, 'currency', p_currency,
       'provisioned', true,
       'provisioned_by', v_staff_name,
       'owner_email', v_owner_email
     ));

  return v_org;
end;
$fn$;

comment on function public.provision_organization(text, text, text, text[], text, text, text) is
  'The operator door (D29): GOLD creates a business and hands it to an owner who already has an account. Staff do not become members of it. Grants founding terms rather than only switching founding modules on, as of D41.';

revoke all on function public.provision_organization(text, text, text, text[], text, text, text) from public, anon, authenticated;
grant execute on function public.provision_organization(text, text, text, text[], text, text, text) to platform_staff;

-- ---------------------------------------------------------------------------
-- The backfill: nothing already working stops working today
-- ---------------------------------------------------------------------------

-- Every (organization, module) row organization_modules already holds, for a module that is a
-- real product, gets a zero-price open-ended term -- the exact shape of the migration that
-- first backfilled organization_modules for pre-existing tenants. `enabled_at` is kept as the
-- term's own start, so an honest reading of history survives ("free since it was switched on,"
-- not "free since today").
insert into public.organization_commercial_terms
  (organization_id, product_key, period_start, period_end, price_minor, currency, recorded_by, note)
select m.organization_id,
       'module:' || m.module_key,
       least(m.enabled_at::date, current_date),
       date '9999-12-31',
       0,
       null,
       m.enabled_by,
       'Backfilled when the commercial layer was introduced: already enabled, so free until a real term replaces this row.'
  from public.organization_modules m
  join public.platform_products p on p.key = 'module:' || m.module_key
 where not exists (
   select 1 from public.organization_commercial_terms t
    where t.organization_id = m.organization_id
      and t.product_key = 'module:' || m.module_key
      and t.period_start <= current_date
      and t.period_end   >  current_date
 )
on conflict do nothing;

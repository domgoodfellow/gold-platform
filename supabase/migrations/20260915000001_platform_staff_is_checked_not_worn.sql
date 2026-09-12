-- Platform authority stops being a Postgres role a session wears instead of `authenticated`,
-- and becomes a fact checked the same way every other authorization question in this schema is
-- checked -- a table read, from inside a policy or a function (D45).
--
-- **What this corrects.** `custom_access_token_hook` (20260830000002) rewrote the JWT `role`
-- claim to `platform_staff` for anyone listed in that table. PostgREST then ran their session as
-- a different Postgres role entirely, which is why that migration's own comment states plainly:
-- "somebody who is both staff and a member of an organization loses the membership half while
-- signed in ... one human who both runs GOLD and operates a tenant needs two sign-ins." That was
-- D28 working exactly as designed at the time, and it is also the thing the owner has now said
-- explicitly not to want: one identity, capable of holding platform authority and organization
-- membership at once, switching between them without a second account.
--
-- **What does not change.** Staff still read across every tenant and write nothing belonging to
-- one that already exists (I21, restated rather than weakened -- see the doc update alongside
-- this migration). `public.platform_staff` is still the one table naming who staff are, still
-- writable by nobody through this API. The "narrow door" functions this migration re-grants
-- already check `app.require_platform_staff()` internally, in addition to their privilege grant
-- -- that dual enforcement is *why* widening their grant to `authenticated` is safe: the function
-- body still refuses a non-staff caller on its own, independent of which Postgres role reached it.
--
-- **The one place that needed more than a guard.** `organization_commercial_summary` and
-- `organization_usage_detail` were `security invoker`, reading `usage_events`'s withheld columns
-- (`provider_key`, `provider_currency`, `provider_cost_micros`) under whichever role called them --
-- their own comments say plainly that the grant, not the body, was what withheld this from a
-- tenant (I29). That depended on `platform_staff` being a Postgres role with a full-table grant
-- distinct from `authenticated`'s column-restricted one; once staff are `authenticated` too, an
-- invoker-rights call to either function hits `authenticated`'s own column privileges and is
-- refused the withheld columns regardless of who is actually calling -- a column grant is not
-- row- or caller-conditional, so no guard inside an invoker function can get past it. Both are
-- recreated here as `security definer`, running with the owner's own full access to
-- `usage_events`, with `app.require_platform_staff()` as their first statement standing in for
-- the column grant that used to do this work -- the same shape every other narrow-door function
-- in this schema already uses, applied here to a read instead of a write.
--
-- **What is deliberately left alone.** `usage_events` itself keeps its asymmetric column grant --
-- `authenticated` still cannot select `provider_key`/`provider_currency`/`provider_cost_micros`
-- directly, for any row, staff included. Staff reach those columns only through the two guarded
-- functions above, exactly as before. `usage_cost_reconciliations`, `platform_provider_rates` and
-- `platform_product_prices` stay staff-only reads (no tenant policy exists for any of them to
-- interact with) -- widening their grant target to `authenticated` changes nothing about who can
-- actually see a row, since `app.is_platform_staff()` is the only policy admitting one.

-- ---------------------------------------------------------------------------
-- The check, for a policy predicate
-- ---------------------------------------------------------------------------

-- The boolean sibling of `app.require_platform_staff()` (20260910000001), which raises rather
-- than returning false -- correct for guarding a write, wrong for a `using (...)` clause, where a
-- non-staff caller must see zero rows rather than an error. Both read the same table live, not a
-- JWT claim, so removing somebody from `platform_staff` takes effect on their very next request.
create function app.is_platform_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select exists (
    select 1 from public.platform_staff s where s.user_id = (select auth.uid())
  );
$fn$;

comment on function app.is_platform_staff() is
  'Whether the caller is listed in platform_staff, for use inside an RLS policy. A live table read, not a role or a claim -- companion to app.require_platform_staff(), which raises instead of returning false and belongs inside a function body, never a policy.';

revoke all on function app.is_platform_staff() from public;
grant execute on function app.is_platform_staff() to authenticated;

-- `app.require_platform_staff()` (20260910000001) never carried a grant to any client role --
-- every caller until now was `security definer`, executing as the function's owner, for whom
-- ownership implies privilege regardless of any explicit grant. `organization_commercial_summary`
-- and `organization_usage_detail` below are deliberately `security invoker` (I29/I31 need them to
-- run under the caller's own RLS against `usage_events`), so they execute as `authenticated` once
-- staff stop wearing a separate role -- and `authenticated` needs its own grant to call an `app.*`
-- helper from inside an invoker-rights function, the same as `app.is_platform_staff()` just
-- above. Neither grant makes either function directly callable through PostgREST: `app` is not an
-- exposed schema, so this only ever matters to a call made from inside another function's body.
grant execute on function app.require_platform_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- Reads: drop the role-scoped policy, add an authenticated one gated by the check
-- ---------------------------------------------------------------------------

-- Kernel tables (20260830000002) -- no authenticated grant existed on any of these for the
-- platform axis before now; the member-scoped grant these five tables already carry elsewhere is
-- untouched.
drop policy organizations_platform_select on public.organizations;
create policy organizations_platform_select on public.organizations
  for select to authenticated using (app.is_platform_staff());
grant select on public.organizations to authenticated;

drop policy memberships_platform_select on public.memberships;
create policy memberships_platform_select on public.memberships
  for select to authenticated using (app.is_platform_staff());
grant select on public.memberships to authenticated;

drop policy organization_modules_platform_select on public.organization_modules;
create policy organization_modules_platform_select on public.organization_modules
  for select to authenticated using (app.is_platform_staff());
grant select on public.organization_modules to authenticated;

drop policy events_platform_select on public.events;
create policy events_platform_select on public.events
  for select to authenticated using (app.is_platform_staff());
grant select on public.events to authenticated;

drop policy platform_staff_self_select on public.platform_staff;
create policy platform_staff_self_select on public.platform_staff
  for select to authenticated using (app.is_platform_staff());
grant select on public.platform_staff to authenticated;

-- The hook's own read of this table is retired below along with the hook itself.
drop policy if exists platform_staff_auth_admin_select on public.platform_staff;
revoke select on public.platform_staff from supabase_auth_admin;

-- `platform_tenants` (20260830000003, re-granted unchanged by 20260913000003) is a
-- security_invoker view whose own comment claimed "RLS on the underlying tables is the
-- boundary" -- true only because no role but `platform_staff` could ever reach it before now.
-- `organizations` already carries a *member*-facing policy admitting a caller their own row, so
-- opening this view's grant to `authenticated` without anything else would let an ordinary
-- member read their own organization back through what is meant to be a staff-only console view
-- -- not a cross-tenant leak, but a real leak of a view no tenant screen is meant to use at all.
-- Unlike `platform_failures` (whose underlying tables tenants already have a legitimate reason
-- to read their own rows of), this view has no tenant-facing purpose, so the fix is a guard in
-- the view body itself, the same shape `organization_commercial_summary` just gained above,
-- rather than trusting the grant alone a second time.
create or replace view public.platform_tenants
with (security_invoker = true) as
select o.id,
       o.name,
       o.created_at,
       o.timezone,
       o.currency,
       o.slug,
       coalesce(
         (select array_agg(m.module_key order by m.module_key)
            from public.organization_modules m
           where m.organization_id = o.id),
         array[]::text[]
       ) as module_keys,
       (select max(e.occurred_at)
          from public.events e
         where e.organization_id = o.id) as last_activity_at,
       o.operational_state
  from public.organizations o
 where app.is_platform_staff();

comment on view public.platform_tenants is
  'One row per tenant for the platform console: existence, arrival, lifecycle state, modules, last activity. Runs security_invoker; the where clause is the real boundary since 20260915000001 -- RLS on organizations alone would let a member read their own row back through a view meant only for staff.';

grant select on public.platform_tenants to authenticated;

-- `platform_failures` (20260831000007) already grants `authenticated` and `platform_staff`
-- identically; the three tables underneath it did not carry a staff policy of their own before
-- now, only the view's grant. Give them the same real per-row check the kernel tables just got.
drop policy automation_rules_platform_select on public.automation_rules;
create policy automation_rules_platform_select on public.automation_rules
  for select to authenticated using (app.is_platform_staff());

drop policy automation_runs_platform_select on public.automation_runs;
create policy automation_runs_platform_select on public.automation_runs
  for select to authenticated using (app.is_platform_staff());

drop policy message_deliveries_platform_select on public.message_deliveries;
create policy message_deliveries_platform_select on public.message_deliveries
  for select to authenticated using (app.is_platform_staff());

-- `brand_settings` (20260904000002) -- already symmetric grants; only the policy moves.
drop policy brand_settings_select_staff on public.brand_settings;
create policy brand_settings_select_staff on public.brand_settings
  for select to authenticated using (app.is_platform_staff());

-- Catalogue and commercial tables that already grant `authenticated` in full
-- (20260910000001, 20260910000002, 20260911000001, 20260912000001, 20260910000005) -- only the
-- staff-facing policy moves; no grant changes, and none of these carry a withheld column.
drop policy platform_retail_rates_platform_select on public.platform_retail_rates;
create policy platform_retail_rates_platform_select on public.platform_retail_rates
  for select to authenticated using (app.is_platform_staff());

drop policy organization_commercial_terms_platform_select on public.organization_commercial_terms;
create policy organization_commercial_terms_platform_select on public.organization_commercial_terms
  for select to authenticated using (app.is_platform_staff());

drop policy platform_meters_platform_select on public.platform_meters;
create policy platform_meters_platform_select on public.platform_meters
  for select to authenticated using (app.is_platform_staff());

drop policy platform_products_platform_select on public.platform_products;
create policy platform_products_platform_select on public.platform_products
  for select to authenticated using (app.is_platform_staff());

drop policy platform_providers_platform_select on public.platform_providers;
create policy platform_providers_platform_select on public.platform_providers
  for select to authenticated using (app.is_platform_staff());

drop policy organization_provider_bindings_select_staff on public.organization_provider_bindings;
create policy organization_provider_bindings_select_staff on public.organization_provider_bindings
  for select to authenticated using (app.is_platform_staff());

drop policy organization_provider_resources_select_staff on public.organization_provider_resources;
create policy organization_provider_resources_select_staff on public.organization_provider_resources
  for select to authenticated using (app.is_platform_staff());

drop policy communication_credits_platform_select on public.communication_credits;
create policy communication_credits_platform_select on public.communication_credits
  for select to authenticated using (app.is_platform_staff());

drop policy communication_rates_platform_select on public.communication_rates;
create policy communication_rates_platform_select on public.communication_rates
  for select to authenticated using (app.is_platform_staff());

-- Staff-only tables with no competing tenant policy (20260910000001, 20260911000003,
-- 20260913000001, 20260910000005) -- widening the grant target changes nothing about who can see
-- a row, since `app.is_platform_staff()` remains the only policy admitting one.
drop policy platform_provider_rates_platform_select on public.platform_provider_rates;
create policy platform_provider_rates_platform_select on public.platform_provider_rates
  for select to authenticated using (app.is_platform_staff());
grant select on public.platform_provider_rates to authenticated;

-- Unlike platform_provider_rates and platform_product_prices below, nothing in the domain layer
-- reads this table directly -- `organization_usage_detail` is its one door, and that function is
-- `security definer` (see below), so it never runs under `authenticated`'s own privileges at all.
-- Leaving this table with no grant to `authenticated` keeps a raw query against it a genuine
-- missing-privilege refusal for a tenant, which is a tighter and equally correct outcome than
-- granting the table and relying on the policy alone -- so it is left exactly as it was, and its
-- old platform_staff-only policy is simply dropped along with the role at the end of this file.
drop policy usage_cost_reconciliations_platform_select on public.usage_cost_reconciliations;

drop policy platform_product_prices_platform_select on public.platform_product_prices;
create policy platform_product_prices_platform_select on public.platform_product_prices
  for select to authenticated using (app.is_platform_staff());
grant select on public.platform_product_prices to authenticated;

drop policy platform_provider_sync_failures_select on public.platform_provider_sync_failures;
create policy platform_provider_sync_failures_select on public.platform_provider_sync_failures
  for select to authenticated using (app.is_platform_staff());
grant select on public.platform_provider_sync_failures to authenticated;

-- `usage_events` itself is deliberately untouched: its column grant to `authenticated` still
-- excludes `provider_key`, `provider_currency` and `provider_cost_micros`, for every row,
-- staff included. That withholding is a column privilege, not a row policy, so it cannot be made
-- conditional on `app.is_platform_staff()` -- which is exactly why the two functions below exist.

-- ---------------------------------------------------------------------------
-- The two reads that were enforced by grant alone, not by a check
-- ---------------------------------------------------------------------------

drop function if exists public.organization_commercial_summary(uuid, date, date);

create function public.organization_commercial_summary(
  p_organization_id uuid,
  p_from            date default null,
  p_to              date default null
)
returns table (
  meter_id               text,
  customer_currency      text,
  customer_charge_minor  bigint,
  provider_currency      text,
  provider_cost_minor    bigint,
  quantity               bigint,
  margin_minor           bigint
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select app.require_platform_staff();

  with effective as (
    select u.meter_id,
           u.customer_currency,
           u.customer_charge_micros,
           u.quantity,
           coalesce(r.reconciled_provider_cost_micros, u.provider_cost_micros) as provider_cost_micros,
           coalesce(r.provider_currency, u.provider_currency)                 as provider_currency
      from public.usage_events u
      left join lateral (
        select rec.reconciled_provider_cost_micros, rec.provider_currency
          from public.usage_cost_reconciliations rec
         where rec.organization_id = u.organization_id
           and rec.usage_event_id = u.id
         order by rec.reconciled_at desc
         limit 1
      ) r on true
     where u.organization_id = p_organization_id
       and (p_from is null or u.occurred_at >= p_from::timestamptz)
       and (p_to   is null or u.occurred_at <  p_to::timestamptz)
  )
  select e.meter_id,
         e.customer_currency,
         round(sum(e.customer_charge_micros) / 1000000.0)::bigint,
         e.provider_currency,
         round(sum(e.provider_cost_micros) / 1000000.0)::bigint,
         sum(e.quantity)::bigint,
         case
           when sum(e.provider_cost_micros) = 0
             then round(sum(e.customer_charge_micros) / 1000000.0)::bigint
           when e.customer_currency = e.provider_currency
             then round((sum(e.customer_charge_micros) - sum(e.provider_cost_micros)) / 1000000.0)::bigint
           else null
         end as margin_minor
    from effective e
   group by e.meter_id, e.customer_currency, e.provider_currency
   order by e.meter_id, e.customer_currency, e.provider_currency;
$fn$;

comment on function public.organization_commercial_summary(uuid, date, date) is
  'Usage, GOLD''s own effective cost, the customer''s charge, and the margin between them -- null whenever cost and charge disagree on currency and the cost is not exactly zero. security definer as of 20260915000001, guarded by app.require_platform_staff() as its first statement: invoker mode stopped being enough to withhold usage_events''s cost columns once platform_staff stopped being a Postgres role with its own full-table grant.';

revoke all on function public.organization_commercial_summary(uuid, date, date) from public;
grant execute on function public.organization_commercial_summary(uuid, date, date) to authenticated;

drop function if exists public.organization_usage_detail(uuid);

create function public.organization_usage_detail(p_organization_id uuid)
returns table (
  usage_event_id            uuid,
  meter_id                  text,
  quantity                  bigint,
  occurred_at               timestamptz,
  provider_key              text,
  estimated_cost_micros     bigint,
  estimated_currency        text,
  reconciled_cost_micros    bigint,
  reconciled_currency       text,
  reconciled_at             timestamptz,
  customer_currency         text,
  customer_charge_micros    bigint
)
language sql
stable
security definer
set search_path = ''
as $fn$
  select app.require_platform_staff();

  select u.id,
         u.meter_id,
         u.quantity,
         u.occurred_at,
         u.provider_key,
         u.provider_cost_micros,
         u.provider_currency,
         r.reconciled_provider_cost_micros,
         r.provider_currency,
         r.reconciled_at,
         u.customer_currency,
         u.customer_charge_micros
    from public.usage_events u
    left join lateral (
      select rec.reconciled_provider_cost_micros, rec.provider_currency, rec.reconciled_at
        from public.usage_cost_reconciliations rec
       where rec.organization_id = u.organization_id
         and rec.usage_event_id = u.id
       order by rec.reconciled_at desc
       limit 1
    ) r on true
   where u.organization_id = p_organization_id
   order by u.occurred_at desc;
$fn$;

comment on function public.organization_usage_detail(uuid) is
  'Every usage event next to its latest reconciliation, if any. security definer as of 20260915000001, guarded by app.require_platform_staff() as its first statement, for the same reason as organization_commercial_summary above.';

revoke all on function public.organization_usage_detail(uuid) from public;
grant execute on function public.organization_usage_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Writes: already guarded inside the body; only the grant target widens
-- ---------------------------------------------------------------------------

-- Every one of these already calls app.require_platform_staff() (or, for provision_organization,
-- its own equivalent inline lookup predating that helper) as the first thing it does. Widening
-- the grant to `authenticated` does not change who can succeed -- it changes who is even allowed
-- to attempt the call, which used to be nobody outside the platform_staff role and is now anybody
-- the function's own body will still refuse if they are not staff.
grant execute on function public.provision_organization(text, text, text, text[], text, text, text) to authenticated;
grant execute on function public.record_provider_rate(text, text, text, bigint, text, text, text, text) to authenticated;
grant execute on function public.record_retail_rate(text, text, bigint, text, text, text, text) to authenticated;
grant execute on function public.record_commercial_term(uuid, text, date, date, bigint, text, integer, text) to authenticated;
grant execute on function public.record_usage_reconciliation(uuid, bigint, text, text, text, text) to authenticated;
grant execute on function public.record_product_price(text, text, bigint, text, timestamptz, text, text, text) to authenticated;
grant execute on function public.update_platform_product(text, text, text, text, integer) to authenticated;
grant execute on function public.platform_meter_observations() to authenticated;
grant execute on function public.begin_provider_binding(uuid, text) to authenticated;
grant execute on function public.set_provider_binding_status(uuid, text, text, text, text) to authenticated;
grant execute on function public.record_provider_resource(uuid, text, text, text, jsonb, text) to authenticated;
grant execute on function public.set_provider_resource_status(uuid, uuid, text, text) to authenticated;
grant execute on function public.store_provider_secret(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Retire the role-swap itself
-- ---------------------------------------------------------------------------

-- Nothing reads the `role` claim for authorization anymore -- every check above reads
-- `platform_staff` live. The hook is dead code the moment this migration lands; a companion
-- change removes its `[auth.hook.custom_access_token]` registration from supabase/config.toml
-- (that file needs the stack restarted, not reset, to pick the change up).
drop function if exists public.custom_access_token_hook(jsonb);

-- No privilege or membership grant to platform_staff survives past this point: DROP OWNED
-- revokes every grant made TO this role (the select/execute grants above and every one this
-- migration did not explicitly touch), and the explicit REVOKE below removes the role
-- membership that let authenticator switch into it in the first place.
--
-- DROP OWNED BY requires the privileges of the role being cleaned up (superuser is not enough on
-- its own) -- granted to the migration's own role for the duration of this statement, then
-- dropped along with the role itself, so nothing is left holding it afterwards.
grant platform_staff to current_user;
revoke platform_staff from authenticator;
drop owned by platform_staff;
drop role platform_staff;

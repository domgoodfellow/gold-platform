-- `app.is_platform_staff()` does not depend on the row it is being checked against — it is one
-- table lookup keyed to `auth.uid()`, true or false for the whole statement. Written as
-- `using (app.is_platform_staff())`, Postgres has no reason to know that, and can re-evaluate it
-- once per row scanned; wrapped as `using ((select app.is_platform_staff()))`, the planner can
-- fold it into an initPlan and evaluate it exactly once per statement instead. Correctness is
-- unchanged either way — this is the same fix Supabase's own RLS performance guidance names for
-- any `security definer` helper used in a policy, applied here while every one of these policies
-- is still new enough that a second migration to touch them all costs nothing.
--
-- Every policy this migration touches was created by 20260915000001 or 20260915000004; this
-- changes only their `using` expression, by name, so nothing about who may read what moves.

alter policy organizations_platform_select on public.organizations
  using ((select app.is_platform_staff()));

alter policy memberships_platform_select on public.memberships
  using ((select app.is_platform_staff()));

alter policy organization_modules_platform_select on public.organization_modules
  using ((select app.is_platform_staff()));

alter policy events_platform_select on public.events
  using ((select app.is_platform_staff()));

alter policy platform_staff_self_select on public.platform_staff
  using ((select app.is_platform_staff()));

alter policy automation_rules_platform_select on public.automation_rules
  using ((select app.is_platform_staff()));

alter policy automation_runs_platform_select on public.automation_runs
  using ((select app.is_platform_staff()));

alter policy message_deliveries_platform_select on public.message_deliveries
  using ((select app.is_platform_staff()));

alter policy brand_settings_select_staff on public.brand_settings
  using ((select app.is_platform_staff()));

alter policy platform_retail_rates_platform_select on public.platform_retail_rates
  using ((select app.is_platform_staff()));

alter policy organization_commercial_terms_platform_select on public.organization_commercial_terms
  using ((select app.is_platform_staff()));

alter policy platform_meters_platform_select on public.platform_meters
  using ((select app.is_platform_staff()));

alter policy platform_products_platform_select on public.platform_products
  using ((select app.is_platform_staff()));

alter policy platform_providers_platform_select on public.platform_providers
  using ((select app.is_platform_staff()));

alter policy organization_provider_bindings_select_staff on public.organization_provider_bindings
  using ((select app.is_platform_staff()));

alter policy organization_provider_resources_select_staff on public.organization_provider_resources
  using ((select app.is_platform_staff()));

alter policy communication_credits_platform_select on public.communication_credits
  using ((select app.is_platform_staff()));

alter policy communication_rates_platform_select on public.communication_rates
  using ((select app.is_platform_staff()));

alter policy platform_provider_rates_platform_select on public.platform_provider_rates
  using ((select app.is_platform_staff()));

alter policy platform_product_prices_platform_select on public.platform_product_prices
  using ((select app.is_platform_staff()));

alter policy platform_provider_sync_failures_select on public.platform_provider_sync_failures
  using ((select app.is_platform_staff()));

alter policy platform_support_sessions_select on public.platform_support_sessions
  using ((select app.is_platform_staff()));

-- `platform_tenants`' own guard is a view WHERE clause, not a policy, but the same planning
-- benefit applies to it for the same reason. `create or replace view` cannot patch one clause in
-- isolation, so the whole definition is restated — unchanged except that one line.
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
 where (select app.is_platform_staff());

comment on view public.platform_tenants is
  'One row per tenant for the platform console: existence, arrival, lifecycle state, modules, last activity. Runs security_invoker; the where clause is the real boundary since 20260915000001 -- RLS on organizations alone would let a member read their own row back through a view meant only for staff. Wrapped in a select (20260915000006) so the planner evaluates it once per statement, not once per row.';

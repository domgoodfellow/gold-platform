-- Keep package entitlement authority with commercial operations and health reads aggregate-only.
begin;

-- Health needs exact counts, not raw commercial rates or provider credentials/identifiers.
create function public.platform_health_summary(p_recent_limit integer default 8)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $fn$
begin
  perform app.require_platform_capability('platform.health');
  return jsonb_build_object(
    'organizations', jsonb_build_object(
      'total', (select count(*) from public.organizations),
      'live', (select count(*) from public.organizations where operational_state = 'live'),
      'settingUp', (select count(*) from public.organizations where operational_state = 'setup'),
      'recent', coalesce((select jsonb_agg(r.body order by r.created_at desc, r.id) from (
        select o.created_at, o.id, jsonb_build_object(
          'id', o.id, 'name', o.name, 'createdAt', o.created_at, 'timezone', o.timezone,
          'currency', o.currency, 'slug', o.slug, 'operationalState', o.operational_state,
          'moduleKeys', coalesce((select jsonb_agg(m.module_key order by m.module_key)
            from public.organization_modules m where m.organization_id = o.id), '[]'::jsonb),
          'lastActivityAt', (select max(e.occurred_at) from public.events e where e.organization_id = o.id)
        ) as body from public.organizations o order by o.created_at desc, o.id
        limit greatest(0, least(coalesce(p_recent_limit, 8), 200))
      ) r), '[]'::jsonb)
    ),
    'failures', jsonb_build_object(
      'operational', (select count(*) from public.platform_failures),
      'providerReconciliation', (select count(*) from public.platform_provider_sync_failures)
    ),
    'catalogue', jsonb_build_object(
      'products', (select count(*) from public.platform_products where sale_status <> 'archived'),
      'meters', (select count(*) from public.platform_meters)
    ),
    'rates', jsonb_build_object(
      'retail', (select count(*) from public.platform_retail_rates),
      'provider', (select count(*) from public.platform_provider_rates)
    )
  );
end;
$fn$;
revoke all on function public.platform_health_summary(integer) from public, anon;
grant execute on function public.platform_health_summary(integer) to authenticated;

CREATE OR REPLACE FUNCTION public.grant_plan_product(p_plan_id uuid, p_product_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.commercial');

  insert into public.platform_plan_product_grants (plan_id, product_id)
  select p_plan_id, p.id from public.platform_catalog_products p where p.key = p_product_key
  on conflict do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_plan_product(p_plan_id uuid, p_product_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.commercial');

  delete from public.platform_plan_product_grants
   where plan_id = p_plan_id
     and product_id = (select p.id from public.platform_catalog_products p where p.key = p_product_key);
end;
$function$;

CREATE OR REPLACE FUNCTION public.grant_plan_module(p_plan_id uuid, p_module_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.commercial');

  insert into public.platform_plan_module_grants (plan_id, module_id)
  values (p_plan_id, p_module_id)
  on conflict do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_plan_module(p_plan_id uuid, p_module_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.commercial');

  delete from public.platform_plan_module_grants where plan_id = p_plan_id and module_id = p_module_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_plan_feature_override(p_plan_id uuid, p_feature_id uuid, p_included boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.commercial');

  insert into public.platform_plan_feature_grants (plan_id, feature_id, included)
  values (p_plan_id, p_feature_id, p_included)
  on conflict (plan_id, feature_id) do update set included = excluded.included;
end;
$function$;

CREATE OR REPLACE FUNCTION public.clear_plan_feature_override(p_plan_id uuid, p_feature_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.commercial');

  delete from public.platform_plan_feature_grants where plan_id = p_plan_id and feature_id = p_feature_id;
end;
$function$;

notify pgrst, 'reload schema';
commit;

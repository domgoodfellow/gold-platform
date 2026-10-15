-- Organization support can inspect tenant allowances and credit without commercial write authority.
begin;

CREATE OR REPLACE FUNCTION public.credit_balance(p_organization_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (p_organization_id in (select app.current_tenant_ids()) or (app.has_platform_capability('platform.organizations') or app.has_platform_capability('platform.commercial'))) then
    return 0;
  end if;

  return floor(coalesce(app.credit_balance_micros(p_organization_id), 0) / 1000000.0)::bigint;
end;
$function$;

CREATE OR REPLACE FUNCTION public.organization_allowance_state(p_organization_id uuid, p_allowance_key text DEFAULT NULL::text, p_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(allowance_key text, label text, unit text, allowance_type text, period text, reset_semantics text, window_starts_at timestamp with time zone, window_ends_at timestamp with time zone, window_basis text, included numeric, consumed numeric, reserved numeric, remaining numeric, overage_quantity numeric, hard_limit numeric, overage_policy text, overage_behavior text, meter_id text, service_class text, contributions jsonb, enforcement text, state text, configuration_error text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (p_organization_id in (select app.current_tenant_ids()) or (app.has_platform_capability('platform.organizations') or app.has_platform_capability('platform.commercial'))) then
    raise exception 'you cannot read this business''s allowances' using errcode = '42501';
  end if;

  return query select * from app.allowance_states(p_organization_id, p_allowance_key, p_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.allowance_decision(p_organization_id uuid, p_allowance_key text, p_requested_quantity numeric DEFAULT 1, p_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(result text, permitted boolean, governed boolean, allowance_key text, label text, unit text, included numeric, consumed numeric, remaining numeric, included_applied numeric, overage_applied numeric, hard_limit numeric, overage_behavior text, enforcement text, window_starts_at timestamp with time zone, window_ends_at timestamp with time zone, window_basis text, detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (p_organization_id in (select app.current_tenant_ids()) or (app.has_platform_capability('platform.organizations') or app.has_platform_capability('platform.commercial'))) then
    raise exception 'you cannot read this business''s allowances' using errcode = '42501';
  end if;

  return query select * from app.allowance_decision(
    p_organization_id, p_allowance_key, p_requested_quantity, p_at);
end;
$function$;
notify pgrst, 'reload schema';
commit;

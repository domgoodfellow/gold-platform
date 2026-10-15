-- Enforce live granular platform capabilities at privileged database boundaries.
-- Forward from the reconciled 20261219000001 baseline; applied migrations are immutable.
begin;

CREATE OR REPLACE FUNCTION app.require_platform_capability(p_capability text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_name  text;
  v_caps  text[];
begin
  if v_actor is null then
    raise exception 'this operation requires an authenticated caller' using errcode = '42501';
  end if;

  select s.name, s.capabilities into v_name, v_caps
    from public.platform_staff s where s.user_id = v_actor;

  if v_name is null then
    raise exception 'only platform staff may do this' using errcode = '42501';
  end if;

  -- Named rather than numbered, because the message is read by the person who has to ask
  -- somebody for the permission.
  if coalesce(p_capability = any (v_caps), false) is not true then
    raise exception 'this needs the % platform permission', p_capability using errcode = '42501';
  end if;

  return v_name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.grant_plan_product(p_plan_id uuid, p_product_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.catalogue');

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
  perform app.require_platform_capability('platform.catalogue');

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
  perform app.require_platform_capability('platform.catalogue');

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
  perform app.require_platform_capability('platform.catalogue');

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
  perform app.require_platform_capability('platform.catalogue');

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
  perform app.require_platform_capability('platform.catalogue');

  delete from public.platform_plan_feature_grants where plan_id = p_plan_id and feature_id = p_feature_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.organization_launch_blockers(p_id uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if (select auth.uid()) is null then
    raise exception 'this operation requires an authenticated caller' using errcode = '42501';
  end if;

  -- One refusal for "not yours" and "does not exist", so the answer is no oracle for either.
  if not (p_id in (select app.current_tenant_ids()) or app.has_platform_capability('platform.organizations')) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;

  return app.organization_launch_blockers_unchecked(p_id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.provision_organization(p_owner_email text, p_name text, p_role text, p_capabilities text[], p_display_name text, p_timezone text, p_currency text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff       uuid := (select auth.uid());
  v_staff_name  text;
  v_owner       uuid;
  v_owner_email text := lower(btrim(p_owner_email));
  v_org         uuid;
  v_role        uuid;
begin
  perform app.require_platform_capability('platform.organizations');
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
$function$;

CREATE OR REPLACE FUNCTION public.record_provider_rate(p_provider_key text, p_meter_id text, p_currency text, p_unit_amount_micros bigint, p_source text, p_source_url text DEFAULT NULL::text, p_approval_state text DEFAULT 'approved'::text, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff uuid := (select auth.uid());
  v_name  text;
  v_id    uuid;
begin
  v_name := app.require_platform_capability('platform.commercial');

  if p_approval_state not in ('draft', 'approved') then
    raise exception 'unknown approval state: %', p_approval_state using errcode = '22023';
  end if;

  insert into public.platform_provider_rates
    (provider_key, meter_id, currency, unit_amount_micros, approval_state, source, source_url, recorded_by, note)
  values
    (p_provider_key, p_meter_id, upper(btrim(p_currency)), p_unit_amount_micros, p_approval_state, p_source, p_source_url, v_staff, p_note)
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_provider_binding_status(p_organization_id uuid, p_provider_key text, p_status text, p_external_account_id text DEFAULT NULL::text, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff text := app.require_platform_capability('platform.providers');
begin
  if p_status not in ('provisioning', 'active', 'failed', 'suspended') then
    raise exception 'unknown binding status: %', p_status using errcode = '22023';
  end if;

  update public.organization_provider_bindings
     set status              = p_status,
         external_account_id = coalesce(p_external_account_id, external_account_id),
         last_verified_at    = case when p_status = 'active' then now() else last_verified_at end,
         last_error          = case when p_status = 'failed' then p_error else last_error end,
         updated_at          = now()
   where organization_id = p_organization_id
     and provider_key    = p_provider_key;

  if not found then
    raise exception 'no binding for that organization and provider — call begin_provider_binding first'
      using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_provider_resource(p_organization_id uuid, p_provider_key text, p_resource_type text, p_external_id text, p_config jsonb DEFAULT '{}'::jsonb, p_status text DEFAULT 'active'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff      text := app.require_platform_capability('platform.providers');
  v_binding_id uuid;
  v_id         uuid;
begin
  if p_status not in ('pending', 'active', 'failed', 'disabled') then
    raise exception 'unknown resource status: %', p_status using errcode = '22023';
  end if;

  if jsonb_typeof(p_config) is distinct from 'object' then
    raise exception 'resource config must be a JSON object' using errcode = '22023';
  end if;

  select id into v_binding_id
  from public.organization_provider_bindings
  where organization_id = p_organization_id
    and provider_key    = p_provider_key;

  if v_binding_id is null then
    -- A resource cannot precede its binding — that would be recording something for a provider
    -- scope this organization has never been given.
    raise exception 'no binding for that organization and provider — call begin_provider_binding first'
      using errcode = '22023';
  end if;

  insert into public.organization_provider_resources
    (organization_id, binding_id, resource_type, external_id, config, status)
  values
    (p_organization_id, v_binding_id, p_resource_type, p_external_id, p_config, p_status)
  on conflict (organization_id, resource_type, external_id) do update
    set config     = excluded.config,
        status     = excluded.status,
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.store_provider_secret(p_organization_id uuid, p_resource_id uuid, p_secret text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff     text := app.require_platform_capability('platform.providers');
  v_existing  uuid;
  v_secret_id uuid;
begin
  if btrim(coalesce(p_secret, '')) = '' then
    raise exception 'a secret must not be empty' using errcode = '22023';
  end if;

  select secret_id into v_existing
  from public.organization_provider_resources
  where id = p_resource_id
    and organization_id = p_organization_id;

  if not found then
    raise exception 'no such resource for that organization' using errcode = '22023';
  end if;

  if v_existing is null then
    v_secret_id := vault.create_secret(
      p_secret,
      p_resource_id::text,
      'Generated credential for organization_provider_resources.' || p_resource_id::text
    );

    update public.organization_provider_resources
       set secret_id  = v_secret_id,
           updated_at = now()
     where id = p_resource_id;
  else
    -- Rotation: the same vault row, a new value. `vault.update_secret` re-encrypts in place, so
    -- there is never a moment with two live secrets for one resource.
    perform vault.update_secret(v_existing, p_secret);
    v_secret_id := v_existing;
  end if;

  -- Not `v_secret_id`: a vault row's own id is exactly as sensitive as its content would be
  -- to hand back, and nothing in this repository selects `secret_id` back out either. The
  -- resource id is the one thing already known to whoever is calling.
  return p_resource_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_product_price(p_product_key text, p_currency text, p_amount_minor bigint, p_billing_interval text DEFAULT 'month'::text, p_effective_from timestamp with time zone DEFAULT now(), p_approval_state text DEFAULT 'approved'::text, p_source text DEFAULT 'staff rate card'::text, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  perform app.require_platform_capability('platform.commercial');
  if p_billing_interval not in ('month', 'year', 'one_time') then raise exception 'unknown billing interval' using errcode = '22023'; end if;
  if p_approval_state not in ('draft', 'approved') then raise exception 'unknown approval state' using errcode = '22023'; end if;
  insert into public.platform_product_prices (product_key, currency, amount_minor, billing_interval, effective_from, approval_state, source, note, recorded_by)
  values (p_product_key, upper(btrim(p_currency)), p_amount_minor, p_billing_interval, p_effective_from, p_approval_state, p_source, p_note, auth.uid())
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.platform_meter_observations()
 RETURNS TABLE(meter_id text, usage_event_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.catalogue');
  return query
    select u.meter_id, count(*)::bigint
      from public.usage_events u
     group by u.meter_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_usage_reconciliation(p_usage_event_id uuid, p_reconciled_provider_cost_micros bigint, p_provider_currency text, p_source text, p_provider_reference text DEFAULT ''::text, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff uuid := (select auth.uid());
  v_org   uuid;
  v_id    uuid;
begin
  perform app.require_platform_capability('platform.commercial');

  select u.organization_id into v_org
    from public.usage_events u
   where u.id = p_usage_event_id;

  if v_org is null then
    raise exception 'no such usage event' using errcode = '23503';
  end if;

  insert into public.usage_cost_reconciliations
    (organization_id, usage_event_id, reconciled_provider_cost_micros, provider_currency,
     provider_reference, source, recorded_by, note)
  values
    (v_org, p_usage_event_id, p_reconciled_provider_cost_micros, upper(btrim(p_provider_currency)),
     p_provider_reference, p_source, v_staff, p_note)
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_provider_resource_status(p_organization_id uuid, p_resource_id uuid, p_status text, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff text := app.require_platform_capability('platform.providers');
begin
  if p_status not in ('pending', 'active', 'failed', 'disabled') then
    raise exception 'unknown resource status: %', p_status using errcode = '22023';
  end if;

  update public.organization_provider_resources
     set status     = p_status,
         config     = case when p_error is not null
                           then config || jsonb_build_object('last_error', p_error)
                           else config
                      end,
         last_verified_at = case when p_status = 'active' then now() else last_verified_at end,
         updated_at = now()
   where id = p_resource_id
     and organization_id = p_organization_id;

  if not found then
    raise exception 'no such resource for that organization' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_platform_product(p_product_key text, p_label text, p_description text, p_sale_status text, p_display_order integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.catalogue');
  if length(btrim(p_label)) not between 1 and 120 then
    raise exception 'product label must be between 1 and 120 characters' using errcode = '22023';
  end if;
  if length(p_description) > 500 then
    raise exception 'product description must be at most 500 characters' using errcode = '22023';
  end if;
  if p_sale_status not in ('active', 'unlisted', 'archived') then
    raise exception 'unknown product sale status' using errcode = '22023';
  end if;
  if p_display_order < 0 then
    raise exception 'product display order must be non-negative' using errcode = '22023';
  end if;

  update public.platform_products
     set label = btrim(p_label),
         description = btrim(p_description),
         sale_status = p_sale_status,
         display_order = p_display_order
   where key = p_product_key;
  if not found then raise exception 'unknown product' using errcode = '22023'; end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.end_support_session(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.organizations');

  update public.platform_support_sessions
     set ended_at = now()
   where id = p_id
     and staff_user_id = (select auth.uid())
     and ended_at is null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_catalog_feature(p_feature_id uuid, p_label text, p_description text, p_lifecycle text, p_implementation_state text, p_packaging_default text, p_sale_status text, p_metered boolean, p_ai_powered boolean, p_meter_ids text[], p_provider_capabilities text[], p_display_order integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.catalogue');

  update public.platform_catalog_features
     set label = p_label,
         description = p_description,
         lifecycle = p_lifecycle,
         implementation_state = p_implementation_state,
         packaging_default = p_packaging_default,
         sale_status = p_sale_status,
         metered = p_metered,
         ai_powered = p_ai_powered,
         meter_ids = p_meter_ids,
         provider_capabilities = p_provider_capabilities,
         display_order = p_display_order
   where id = p_feature_id;

  if not found then
    raise exception 'no such catalog feature: %', p_feature_id using errcode = '23503';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.start_support_session(p_organization_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff uuid := (select auth.uid());
  v_id    uuid;
begin
  perform app.require_platform_capability('platform.organizations');

  -- Serializes concurrent starts for this exact (staff, organization) pair. hashtextextended is
  -- a core builtin, same as the sha256 this schema already leans on elsewhere for the same
  -- no-extension reason. The lock is transaction-scoped, so it releases the moment this call's
  -- own request finishes -- a second call blocks only until the first one actually commits.
  perform pg_advisory_xact_lock(
    hashtextextended(v_staff::text || ':' || p_organization_id::text, 0)
  );

  -- Retire a session that has lapsed on its own, so it does not occupy the one open slot the
  -- unique index allows -- the same shape invite_member already uses for a stale pending
  -- invitation.
  update public.platform_support_sessions
     set ended_at = now()
   where staff_user_id = v_staff
     and organization_id = p_organization_id
     and ended_at is null
     and expires_at <= now();

  -- Idempotent: a staff member opening an organization they are already actively supporting
  -- gets the same session back rather than a second row naming the same click twice.
  select id into v_id
    from public.platform_support_sessions
   where staff_user_id = v_staff
     and organization_id = p_organization_id
     and ended_at is null;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.platform_support_sessions (organization_id, staff_user_id, reason)
  values (p_organization_id, v_staff, nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_plan(p_key text, p_kind text, p_label text, p_description text, p_billable boolean, p_sale_status text, p_display_order integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff uuid := (select auth.uid());
  v_id    uuid;
begin
  perform app.require_platform_capability('platform.commercial');

  insert into public.platform_plans (key, kind, label, description, billable, sale_status, display_order, created_by)
  values (p_key, p_kind, p_label, p_description, p_billable, p_sale_status, p_display_order, v_staff)
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_plan(p_plan_id uuid, p_label text, p_description text, p_billable boolean, p_sale_status text, p_display_order integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.commercial');

  update public.platform_plans
     set label = p_label,
         description = p_description,
         billable = p_billable,
         sale_status = p_sale_status,
         display_order = p_display_order
   where id = p_plan_id;

  if not found then
    raise exception 'no such plan: %', p_plan_id using errcode = '23503';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_catalog_product(p_key text, p_label text, p_description text, p_lifecycle text, p_sale_status text, p_display_order integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.catalogue');

  update public.platform_catalog_products
     set label = p_label,
         description = p_description,
         lifecycle = p_lifecycle,
         sale_status = p_sale_status,
         display_order = p_display_order
   where key = p_key;

  if not found then
    raise exception 'no such catalog product: %', p_key using errcode = '23503';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_catalog_module(p_module_id uuid, p_label text, p_description text, p_display_order integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.catalogue');

  update public.platform_catalog_modules
     set label = p_label,
         description = p_description,
         display_order = p_display_order
   where id = p_module_id;

  if not found then
    raise exception 'no such catalog module: %', p_module_id using errcode = '23503';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_plan_quota(p_plan_id uuid, p_allowance_key text, p_label text, p_unit text, p_included_quantity numeric, p_period text DEFAULT 'month'::text, p_hard_limit numeric DEFAULT NULL::numeric, p_overage_policy text DEFAULT 'not_applicable'::text, p_service_class text DEFAULT NULL::text, p_meter_id text DEFAULT NULL::text, p_display_order integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  perform app.require_platform_capability('platform.commercial');

  insert into public.platform_plan_quotas
    (plan_id, allowance_key, label, unit, included_quantity, period, hard_limit, overage_policy, service_class, meter_id, display_order)
  values
    (p_plan_id, p_allowance_key, p_label, p_unit, p_included_quantity, p_period, p_hard_limit, p_overage_policy, p_service_class, p_meter_id, p_display_order)
  on conflict (plan_id, allowance_key) do update
    set label = excluded.label,
        unit = excluded.unit,
        included_quantity = excluded.included_quantity,
        period = excluded.period,
        hard_limit = excluded.hard_limit,
        overage_policy = excluded.overage_policy,
        service_class = excluded.service_class,
        meter_id = excluded.meter_id,
        display_order = excluded.display_order
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_plan_quota(p_plan_id uuid, p_allowance_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.commercial');
  delete from public.platform_plan_quotas where plan_id = p_plan_id and allowance_key = p_allowance_key;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_plan_price(p_plan_id uuid, p_currency text, p_amount_minor bigint, p_billing_interval text, p_effective_from timestamp with time zone DEFAULT now(), p_source text DEFAULT ''::text, p_source_url text DEFAULT NULL::text, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff uuid := (select auth.uid());
  v_id    uuid;
begin
  perform app.require_platform_capability('platform.commercial');

  insert into public.platform_plan_prices
    (plan_id, currency, amount_minor, billing_interval, effective_from, source, source_url, recorded_by, note)
  values
    (p_plan_id, upper(btrim(p_currency)), p_amount_minor, p_billing_interval, p_effective_from, p_source, p_source_url, v_staff, p_note)
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_plan_provider_price(p_plan_price_id uuid, p_environment text, p_product_reference text, p_price_reference text, p_provider text DEFAULT 'stripe'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff uuid := (select auth.uid());
  v_id    uuid;
begin
  perform app.require_platform_capability('platform.commercial');

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
$function$;

CREATE OR REPLACE FUNCTION public.set_default_provider_account(p_account_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff text := app.require_platform_capability('platform.providers');
  v_key   text;
begin
  select provider_key into v_key
  from public.platform_provider_accounts
  where id = p_account_id and status = 'active';

  if v_key is null then
    raise exception 'only an active provider account can be the default' using errcode = '22023';
  end if;

  update public.platform_provider_accounts
     set is_default = false, updated_at = now()
   where provider_key = v_key and is_default and id <> p_account_id;

  update public.platform_provider_accounts
     set is_default = true, updated_at = now()
   where id = p_account_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.bootstrap_gold_internal_workspace(p_organization_id uuid, p_role text, p_capabilities text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor uuid := (select auth.uid());
  v_plan uuid;
  v_existing_gold_org uuid;
  v_current_plan uuid;
  v_role uuid;
  v_membership uuid;
  v_display_name text;
  v_role_name text := coalesce(nullif(btrim(p_role), ''), 'Admin');
  v_capabilities text[];
  v_existing_named_role uuid;
  v_existing_internal_role uuid;
begin
  perform app.require_platform_capability('platform.organizations');
  perform app.require_platform_capability('platform.commercial');

  if v_actor is null then
    raise exception 'bootstrap_gold_internal_workspace requires an authenticated caller'
      using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct capability order by capability), '{}'::text[])
    into v_capabilities
    from unnest(coalesce(p_capabilities, '{}'::text[])) as capability;

  if cardinality(v_capabilities) = 0 then
    raise exception 'bootstrap_gold_internal_workspace requires canonical capabilities'
      using errcode = '23514';
  end if;

  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'no such organization: %', p_organization_id
      using errcode = '23503';
  end if;

  select id into v_plan
    from public.platform_plans
   where key = 'gold_internal'
     and kind = 'plan';

  if v_plan is null then
    raise exception 'gold_internal plan is not installed'
      using errcode = '23503';
  end if;

  select opa.organization_id into v_existing_gold_org
    from public.organization_plan_assignments opa
   where opa.plan_id = v_plan
     and opa.plan_kind = 'plan'
     and opa.period_start <= current_date
     and opa.period_end > current_date
     and opa.organization_id <> p_organization_id
   limit 1;

  if v_existing_gold_org is not null then
    raise exception 'another organization already has the current GOLD Internal plan: %', v_existing_gold_org
      using errcode = '23505';
  end if;

  select opa.plan_id into v_current_plan
    from public.organization_plan_assignments opa
   where opa.organization_id = p_organization_id
     and opa.plan_kind = 'plan'
     and opa.period_start <= current_date
     and opa.period_end > current_date
   order by opa.period_start desc
   limit 1;

  if v_current_plan is not null and v_current_plan <> v_plan then
    raise exception 'target organization already has a conflicting current base Plan'
      using errcode = '23P01';
  end if;

  if v_current_plan is null then
    insert into public.organization_plan_assignments
      (organization_id, plan_id, plan_kind, period_start, period_end, assigned_by, note)
    values
      (p_organization_id, v_plan, 'plan', current_date, '9999-12-31'::date, v_actor,
       'GOLD Internal workspace bootstrap');
  end if;

  select id into v_role
    from public.roles
   where organization_id = p_organization_id
     and capabilities @> v_capabilities
     and v_capabilities @> capabilities
   order by created_at
   limit 1;

  if v_role is null then
    select id into v_existing_named_role
      from public.roles
     where organization_id = p_organization_id
       and lower(name) = lower(v_role_name)
     limit 1;

    if v_existing_named_role is null then
      insert into public.roles (organization_id, name, capabilities, created_by)
      values (p_organization_id, v_role_name, v_capabilities, v_actor)
      returning id into v_role;
    else
      select id into v_existing_internal_role
        from public.roles
       where organization_id = p_organization_id
         and lower(name) = lower('GOLD Internal Admin')
       limit 1;

      if v_existing_internal_role is not null then
        raise exception 'GOLD Internal Admin role already exists without canonical capabilities'
          using errcode = '23505';
      end if;

      insert into public.roles (organization_id, name, capabilities, created_by)
      values (p_organization_id, 'GOLD Internal Admin', v_capabilities, v_actor)
      returning id into v_role;
    end if;
  end if;

  select coalesce(nullif(btrim(u.email), ''), 'GOLD staff') into v_display_name
    from auth.users u
   where u.id = v_actor;

  insert into public.memberships
    (organization_id, user_id, role_id, display_name, created_by)
  values
    (p_organization_id, v_actor, v_role, left(v_display_name, 120), v_actor)
  on conflict (organization_id, user_id) do update
    set role_id = excluded.role_id,
        display_name = excluded.display_name
  returning id into v_membership;

  insert into public.events
    (organization_id, actor_id, entity_type, entity_id, action, payload)
  values
    (p_organization_id, v_actor, 'organization', p_organization_id, 'gold_internal.bootstrap',
     jsonb_build_object('membership_id', v_membership, 'plan_id', v_plan, 'role_id', v_role));

  return v_membership;
end;
$function$;

CREATE OR REPLACE FUNCTION public.organization_integration_connections(p_organization_id uuid)
 RETURNS TABLE(id uuid, connector_key text, connector_name text, account_label text, status text, scopes text[], has_credential boolean, resource_count bigint, last_verified_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.catalogue');

  return query
  select c.id, c.connector_key, coalesce(k.name, c.connector_key), c.account_label, c.status, c.scopes,
         c.secret_id is not null,
         (select count(*) from public.integration_resources r where r.connection_id = c.id),
         c.last_verified_at, c.created_at
    from public.integration_connections c
    left join public.platform_connectors k on k.key = c.connector_key
   where c.organization_id = p_organization_id
   order by c.created_at desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_provider_account(p_provider_key text, p_label text, p_external_account_id text, p_credential_kind text, p_credential_identifier text, p_account_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff text := app.require_platform_capability('platform.providers');
  v_id    uuid;
  v_first boolean;
begin
  if p_account_id is null then
    select not exists (
      select 1 from public.platform_provider_accounts where provider_key = p_provider_key and status = 'active'
    ) into v_first;

    insert into public.platform_provider_accounts
      (provider_key, label, external_account_id, credential_kind, credential_identifier, created_by, is_default)
    values
      (p_provider_key, p_label, nullif(btrim(p_external_account_id), ''), p_credential_kind,
       nullif(btrim(p_credential_identifier), ''), auth.uid(), v_first)
    returning id into v_id;
  else
    -- A changed identity means the stored credential no longer describes this account, so the
    -- last verification stops being evidence. It must be run again.
    update public.platform_provider_accounts a
       set label                 = p_label,
           credential_kind       = p_credential_kind,
           verification_state    = case when a.external_account_id is distinct from nullif(btrim(p_external_account_id), '')
                                          or a.credential_identifier is distinct from nullif(btrim(p_credential_identifier), '')
                                          or a.credential_kind <> p_credential_kind
                                        then 'unverified' else a.verification_state end,
           external_account_id   = nullif(btrim(p_external_account_id), ''),
           credential_identifier = nullif(btrim(p_credential_identifier), ''),
           updated_at            = now()
     where a.id = p_account_id and a.provider_key = p_provider_key
    returning a.id into v_id;

    if v_id is null then
      raise exception 'no such provider account' using errcode = '22023';
    end if;
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.store_provider_account_credential(p_account_id uuid, p_secret text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff     text := app.require_platform_capability('platform.providers');
  v_existing  uuid;
  v_secret_id uuid;
begin
  if btrim(coalesce(p_secret, '')) = '' then
    raise exception 'a secret must not be empty' using errcode = '22023';
  end if;

  select secret_id into v_existing from public.platform_provider_accounts where id = p_account_id;
  if not found then
    raise exception 'no such provider account' using errcode = '22023';
  end if;

  if v_existing is null then
    v_secret_id := vault.create_secret(
      p_secret,
      'provider_account:' || p_account_id::text,
      'Credential for platform_provider_accounts.' || p_account_id::text
    );
  else
    perform vault.update_secret(v_existing, p_secret);
    v_secret_id := v_existing;
  end if;

  -- A new credential is unproven until the provider says otherwise.
  update public.platform_provider_accounts
     set secret_id          = v_secret_id,
         credential_set_at  = now(),
         verification_state = 'unverified',
         verification_error = null,
         updated_at         = now()
   where id = p_account_id;

  -- The account id, never the secret and never the vault row's own id.
  return p_account_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_provider_account_status(p_account_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff text := app.require_platform_capability('platform.providers');
begin
  if p_status not in ('active', 'disabled') then
    raise exception 'unknown account status: %', p_status using errcode = '22023';
  end if;

  -- Disabling stops *new* provisioning under this account. It never reaches an existing binding,
  -- resource or the upstream account itself — that infrastructure is not this function's to end.
  update public.platform_provider_accounts
     set status     = p_status,
         is_default = case when p_status = 'disabled' then false else is_default end,
         updated_at = now()
   where id = p_account_id;

  if not found then
    raise exception 'no such provider account' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.begin_provider_binding(p_organization_id uuid, p_provider_key text, p_provider_account_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff   text := app.require_platform_capability('platform.providers');
  v_id      uuid;
  v_account uuid := p_provider_account_id;
begin
  if v_account is not null then
    perform 1 from public.platform_provider_accounts
     where id = v_account and provider_key = p_provider_key and status = 'active';
    if not found then
      raise exception 'that provider account is not an active account for this provider' using errcode = '22023';
    end if;
  end if;

  insert into public.organization_provider_bindings
    (organization_id, provider_key, status, provider_account_id)
  values
    (p_organization_id, p_provider_key, 'provisioning', v_account)
  on conflict (organization_id, provider_key) do update
    -- A resume, never a downgrade — and never a move: a binding that already has an account keeps
    -- it, so a retry cannot strand resources under one account while pointing at another.
    set status = case when public.organization_provider_bindings.status = 'failed'
                       then 'provisioning'
                       else public.organization_provider_bindings.status
                  end,
        provider_account_id = coalesce(public.organization_provider_bindings.provider_account_id, excluded.provider_account_id),
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_provider_binding_reconciliation(p_organization_id uuid, p_provider_key text, p_state text, p_detail text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff text := app.require_platform_capability('platform.providers');
begin
  if p_state not in ('in_sync', 'remote_missing', 'remote_changed') then
    raise exception 'unknown reconciliation state: %', p_state using errcode = '22023';
  end if;

  -- Records what was found. It changes no status and touches nothing upstream: a finding is an
  -- operator's to act on, never something reconciliation repairs or deletes by itself.
  update public.organization_provider_bindings
     set reconciliation_state  = p_state,
         reconciliation_detail = left(p_detail, 500),
         last_reconciled_at    = now()
   where organization_id = p_organization_id and provider_key = p_provider_key;

  if not found then
    raise exception 'no binding for that organization and provider' using errcode = '22023';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.platform_provider_organization_overview(p_provider_key text, p_organization_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(organization_id uuid, organization_name text, binding_id uuid, binding_status text, external_account_id text, provider_account_id uuid, last_verified_at timestamp with time zone, last_error text, reconciliation_state text, reconciliation_detail text, last_reconciled_at timestamp with time zone, resource_count bigint, bound_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff text := app.require_platform_capability('platform.providers');
begin
  return query
  select o.id, o.name, b.id, b.status, b.external_account_id, b.provider_account_id,
         b.last_verified_at, b.last_error, b.reconciliation_state, b.reconciliation_detail,
         b.last_reconciled_at,
         (select count(*) from public.organization_provider_resources r where r.binding_id = b.id),
         b.created_at
    from public.organizations o
    left join public.organization_provider_bindings b
      on b.organization_id = o.id and b.provider_key = p_provider_key
   where p_organization_id is null or o.id = p_organization_id
   order by o.name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_platform_connector(p_key text, p_name text, p_description text, p_category text, p_suite text, p_status text, p_auth_method text, p_connection_method text, p_is_public boolean, p_display_order integer, p_icon_ref text, p_marketing_slug text, p_marketing_summary text, p_marketing_description text, p_capabilities text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  perform app.require_platform_capability('platform.catalogue');

  insert into public.platform_connectors as c (
    key, name, description, category, suite, status, auth_method, connection_method,
    is_public, display_order, icon_ref, marketing_slug, marketing_summary, marketing_description, capabilities
  ) values (
    p_key, btrim(p_name), coalesce(p_description, ''), btrim(p_category), nullif(btrim(coalesce(p_suite, '')), ''),
    p_status, p_auth_method, p_connection_method, p_is_public, p_display_order,
    nullif(btrim(coalesce(p_icon_ref, '')), ''), nullif(btrim(coalesce(p_marketing_slug, '')), ''),
    coalesce(p_marketing_summary, ''), coalesce(p_marketing_description, ''), coalesce(p_capabilities, '{}')
  )
  on conflict (key) do update set
    name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    suite = excluded.suite,
    status = excluded.status,
    auth_method = excluded.auth_method,
    connection_method = excluded.connection_method,
    is_public = excluded.is_public,
    display_order = excluded.display_order,
    icon_ref = excluded.icon_ref,
    marketing_slug = excluded.marketing_slug,
    marketing_summary = excluded.marketing_summary,
    marketing_description = excluded.marketing_description,
    capabilities = excluded.capabilities,
    updated_at = now()
  returning c.id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_platform_connector_app(p_connector_key text, p_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.catalogue');

  delete from public.platform_connector_apps a
   using public.platform_connectors c
   where a.connector_id = c.id and c.key = p_connector_key and a.key = p_key;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_connector_app_feature(p_connector_app_id uuid, p_feature_id uuid, p_relationship text DEFAULT 'supports'::text, p_note text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.catalogue');

  insert into public.platform_connector_app_features (connector_app_id, feature_id, relationship, note)
  values (p_connector_app_id, p_feature_id, p_relationship, coalesce(p_note, ''))
  on conflict (connector_app_id, feature_id) do update set
    relationship = excluded.relationship, note = excluded.note;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_connector_app_feature(p_connector_app_id uuid, p_feature_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.catalogue');

  delete from public.platform_connector_app_features
   where connector_app_id = p_connector_app_id and feature_id = p_feature_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.platform_connector_usage()
 RETURNS TABLE(connector_key text, active_connections bigint, attention_connections bigint, organizations bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.catalogue');

  return query
  select c.connector_key,
         count(*) filter (where c.status = 'active'),
         count(*) filter (where c.status = 'needs_attention'),
         count(distinct c.organization_id) filter (where c.status <> 'disconnected')
    from public.integration_connections c
   group by c.connector_key;
end;
$function$;

CREATE OR REPLACE FUNCTION public.upsert_platform_provider_service(p_provider_key text, p_key text, p_label text, p_description text, p_family text, p_kind text, p_implementation_state text, p_vendor_status text, p_auth_mode text, p_docs_url text, p_display_order integer, p_metadata jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  perform app.require_platform_capability('platform.providers');

  insert into public.platform_provider_services as s (
    provider_key, key, label, description, family, kind,
    implementation_state, vendor_status, auth_mode, docs_url, display_order, metadata
  ) values (
    p_provider_key, p_key, btrim(p_label), coalesce(p_description, ''), btrim(p_family), p_kind,
    p_implementation_state, p_vendor_status, p_auth_mode,
    nullif(btrim(coalesce(p_docs_url, '')), ''), p_display_order, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (provider_key, key) do update set
    label = excluded.label,
    description = excluded.description,
    family = excluded.family,
    kind = excluded.kind,
    implementation_state = excluded.implementation_state,
    vendor_status = excluded.vendor_status,
    auth_mode = excluded.auth_mode,
    docs_url = excluded.docs_url,
    display_order = excluded.display_order,
    metadata = excluded.metadata,
    updated_at = now()
  returning s.id into v_id;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_provider_service_feature(p_provider_service_id uuid, p_feature_id uuid, p_relationship text DEFAULT 'supports'::text, p_note text DEFAULT ''::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.providers');

  insert into public.platform_provider_service_features (provider_service_id, feature_id, relationship, note)
  values (p_provider_service_id, p_feature_id, p_relationship, coalesce(p_note, ''))
  on conflict (provider_service_id, feature_id) do update set
    relationship = excluded.relationship, note = excluded.note;
end;
$function$;

CREATE OR REPLACE FUNCTION public.remove_provider_service_feature(p_provider_service_id uuid, p_feature_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.providers');

  delete from public.platform_provider_service_features
   where provider_service_id = p_provider_service_id and feature_id = p_feature_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_platform_connector_app(p_connector_key text, p_key text, p_name text, p_description text, p_display_order integer, p_implementation_state text DEFAULT 'planned'::text, p_vendor_status text DEFAULT NULL::text, p_docs_url text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_connector uuid;
begin
  perform app.require_platform_capability('platform.catalogue');

  select id into v_connector from public.platform_connectors where key = p_connector_key;
  if v_connector is null then
    raise exception 'no such connector: %', p_connector_key using errcode = '23503';
  end if;

  insert into public.platform_connector_apps (
    connector_id, key, name, description, display_order, implementation_state, vendor_status, docs_url
  )
  values (
    v_connector, p_key, btrim(p_name), coalesce(p_description, ''), p_display_order,
    coalesce(p_implementation_state, 'planned'), p_vendor_status, nullif(btrim(coalesce(p_docs_url, '')), '')
  )
  on conflict (connector_id, key) do update set
    name = excluded.name,
    description = excluded.description,
    display_order = excluded.display_order,
    implementation_state = excluded.implementation_state,
    vendor_status = excluded.vendor_status,
    docs_url = excluded.docs_url;
end;
$function$;

CREATE OR REPLACE FUNCTION public.platform_ai_runtime_assignment_overview()
 RETURNS TABLE(capability text, provider_service_id uuid, provider_key text, provider_service_key text, provider_service_label text, provider_account_id uuid, provider_account_label text, model text, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff text := app.require_platform_capability('platform.providers');
begin
  return query
  select a.capability, a.provider_service_id, s.provider_key, s.key, s.label,
         a.provider_account_id, act.label, a.model, a.updated_at
    from public.platform_ai_runtime_assignments a
    join public.platform_provider_services s on s.id = a.provider_service_id
    join public.platform_provider_accounts act on act.id = a.provider_account_id
   order by a.capability;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_ai_runtime_assignment(p_capability text, p_provider_service_id uuid, p_provider_account_id uuid, p_model text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_staff        text := app.require_platform_capability('platform.providers');
  v_service_key  text;
  v_service_provider  text;
  v_implemented  text;
  v_account_provider  text;
  v_account_status    text;
  v_account_secret    uuid;
begin
  if not (p_capability = any (app.ai_capabilities())) then
    raise exception 'unknown AI capability: %', p_capability using errcode = '22023';
  end if;

  if btrim(coalesce(p_model, '')) = '' or length(p_model) > 200 then
    raise exception 'a model is required' using errcode = '22023';
  end if;

  select key, provider_key, implementation_state
    into v_service_key, v_service_provider, v_implemented
    from public.platform_provider_services
   where id = p_provider_service_id;

  if v_service_key is null then
    raise exception 'no such provider service' using errcode = '22023';
  end if;
  if v_implemented <> 'available' then
    raise exception 'that provider service has no runtime implementation yet' using errcode = '22023';
  end if;

  select provider_key, status, secret_id
    into v_account_provider, v_account_status, v_account_secret
    from public.platform_provider_accounts
   where id = p_provider_account_id;

  if v_account_provider is null then
    raise exception 'no such provider account' using errcode = '22023';
  end if;
  if v_account_provider <> v_service_provider then
    raise exception 'that provider account belongs to a different provider than the service' using errcode = '22023';
  end if;
  if v_account_status <> 'active' then
    raise exception 'that provider account is not active' using errcode = '22023';
  end if;
  if v_account_secret is null then
    raise exception 'that provider account has no credential stored' using errcode = '22023';
  end if;

  insert into public.platform_ai_runtime_assignments
    (capability, provider_service_id, provider_account_id, model, updated_at, updated_by)
  values
    (p_capability, p_provider_service_id, p_provider_account_id, btrim(p_model), now(), auth.uid())
  on conflict (capability) do update
    set provider_service_id = excluded.provider_service_id,
        provider_account_id = excluded.provider_account_id,
        model                = excluded.model,
        updated_at           = now(),
        updated_by           = auth.uid();
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_retail_rate(p_meter_id text, p_currency text, p_unit_amount_micros bigint, p_source text, p_source_url text DEFAULT NULL::text, p_approval_state text DEFAULT 'approved'::text, p_note text DEFAULT ''::text, p_effective_from timestamp with time zone DEFAULT now())
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare

  v_id uuid;

begin

  perform app.require_platform_capability('platform.commercial');



  if p_approval_state not in ('draft', 'approved') then

    raise exception 'unknown approval state: %', p_approval_state using errcode = '22023';

  end if;



  if p_effective_from < now() - interval '1 minute' then

    raise exception 'a price cannot start in the past: a rate is appended, never rewritten backwards'

      using errcode = '22023';

  end if;



  insert into public.platform_retail_rates

    (meter_id, currency, unit_amount_micros, effective_from, approval_state, source, source_url,

     recorded_by, note)

  values

    (p_meter_id, upper(btrim(p_currency)), p_unit_amount_micros, p_effective_from, p_approval_state,

     p_source, p_source_url, (select auth.uid()), p_note)

  returning id into v_id;



  return v_id;

end;

$function$;

CREATE OR REPLACE FUNCTION public.credit_balance(p_organization_id uuid)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

begin

  if not (p_organization_id in (select app.current_tenant_ids()) or app.has_platform_capability('platform.commercial')) then

    return 0;

  end if;



  return floor(coalesce(app.credit_balance_micros(p_organization_id), 0) / 1000000.0)::bigint;

end;

$function$;

CREATE OR REPLACE FUNCTION public.organization_commercial_summary(p_organization_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(meter_id text, customer_currency text, customer_charge_minor bigint, provider_currency text, provider_cost_minor bigint, quantity bigint, margin_minor bigint, unpriced_quantity bigint, uncosted_quantity bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$

  select app.require_platform_capability('platform.commercial');



  with effective as (

    select u.meter_id,

           u.customer_currency,

           u.customer_charge_micros,

           u.quantity,

           coalesce(r.reconciled_provider_cost_micros, u.provider_cost_micros) as provider_cost_micros,

           coalesce(r.provider_currency, u.provider_currency)                 as provider_currency,

           u.customer_charge_micros is null                                   as unpriced,

           (u.provider_cost_applicable

            and coalesce(r.reconciled_provider_cost_micros, u.provider_cost_micros) is null) as uncosted

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

         coalesce(round(sum(e.customer_charge_micros) / 1000000.0), 0)::bigint,

         e.provider_currency,

         coalesce(round(sum(e.provider_cost_micros) / 1000000.0), 0)::bigint,

         sum(e.quantity)::bigint,

         case

           when bool_or(e.unpriced) or bool_or(e.uncosted) then null

           when coalesce(sum(e.provider_cost_micros), 0) = 0

             then round(sum(e.customer_charge_micros) / 1000000.0)::bigint

           when e.customer_currency = e.provider_currency

             then round((sum(e.customer_charge_micros) - sum(e.provider_cost_micros)) / 1000000.0)::bigint

           else null

         end as margin_minor,

         coalesce(sum(e.quantity) filter (where e.unpriced), 0)::bigint,

         coalesce(sum(e.quantity) filter (where e.uncosted), 0)::bigint

    from effective e

   group by e.meter_id, e.customer_currency, e.provider_currency

   order by e.meter_id, e.customer_currency, e.provider_currency;

$function$;

CREATE OR REPLACE FUNCTION public.sync_phone_number(p_organization_id uuid, p_provider_resource_id uuid, p_e164 text, p_label text DEFAULT NULL::text, p_status text DEFAULT 'active'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare v_id uuid; v_actor uuid := auth.uid();

begin

  perform app.require_platform_capability('platform.providers');

  if not exists (

    select 1 from public.organization_provider_resources

     where organization_id = p_organization_id and id = p_provider_resource_id and resource_type = 'twilio_phone_number'

  ) then

    raise exception 'provider resource is not a phone number in this organization' using errcode = '23503';

  end if;

  insert into public.phone_numbers (organization_id, provider_resource_id, e164, label, lifecycle, created_by)

    values (p_organization_id, p_provider_resource_id, p_e164, nullif(btrim(p_label), ''), p_status, v_actor)

    on conflict (organization_id, e164) do update

      set provider_resource_id = excluded.provider_resource_id,

          label = coalesce(excluded.label, public.phone_numbers.label),

          lifecycle = excluded.lifecycle,

          updated_at = now()

    returning id into v_id;

  return v_id;

end $function$;

CREATE OR REPLACE FUNCTION public.record_plan_margin_policy(p_plan_id uuid, p_currency text, p_target_margin numeric, p_warning_margin numeric, p_hard_floor_margin numeric, p_effective_from timestamp with time zone, p_source text, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  perform app.require_platform_capability('platform.commercial');
  insert into public.platform_plan_margin_policies
    (plan_id,currency,target_margin,warning_margin,hard_floor_margin,effective_from,source,note,recorded_by)
  values
    (p_plan_id,upper(btrim(p_currency)),p_target_margin,p_warning_margin,p_hard_floor_margin,p_effective_from,p_source,p_note,(select auth.uid()))
  returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.record_phone_number_month(p_phone_number_id uuid, p_billing_period date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_number public.phone_numbers;
  v_binding uuid;
  v_usage uuid;
  v_period date := date_trunc('month', p_billing_period)::date;
  v_cost_meter text;
begin
  perform app.require_platform_capability('platform.commercial');
  select * into v_number from public.phone_numbers where id = p_phone_number_id;
  if not found then raise exception 'no such phone number' using errcode = '23503'; end if;
  if v_number.lifecycle <> 'active' then return null; end if;
  select binding_id into v_binding from public.organization_provider_resources
   where organization_id = v_number.organization_id and id = v_number.provider_resource_id;
  v_cost_meter := case when v_number.e164 like '+18%' then 'phone_number.toll_free.month' else 'phone_number.local.month' end;
  v_usage := app.record_usage(v_number.organization_id, 'phone_numbers', 1, 'twilio',
    v_period::timestamptz, null, v_binding, v_number.provider_resource_id,
    format('%s:%s', v_number.id, to_char(v_period, 'YYYY-MM')), format('number %s for %s', v_number.id, to_char(v_period, 'YYYY-MM')));
  perform app.identify_usage_source(v_usage, 'communications.phone_number', v_number.id::text, v_period);
  perform app.record_usage_cost_component(v_usage, 'rental', 'twilio', v_cost_meter, 1,
    'number_month', v_binding, v_number.provider_resource_id, 'CA', null, 'twilio_phone_number', 'CAD');
  return v_usage;
end $function$;

CREATE OR REPLACE FUNCTION public.record_provider_cost_rate(p_provider_key text, p_commercial_meter_id text, p_cost_meter_key text, p_currency text, p_unit_amount_micros bigint, p_effective_from timestamp with time zone, p_source text, p_region text DEFAULT NULL::text, p_direction text DEFAULT NULL::text, p_resource_type text DEFAULT NULL::text, p_effective_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_provider_account_id uuid DEFAULT NULL::uuid, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  perform app.require_platform_capability('platform.commercial');
  if p_effective_from < now() - interval '5 minutes' then
    raise exception 'a new provider rate cannot rewrite the past' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.platform_provider_rates r
     where r.provider_key = p_provider_key and r.cost_meter_key = p_cost_meter_key
       and r.currency = upper(btrim(p_currency))
       and coalesce(r.region, '') = coalesce(nullif(btrim(p_region), ''), '')
       and coalesce(r.direction, '') = coalesce(p_direction, '')
       and coalesce(r.resource_type, '') = coalesce(nullif(btrim(p_resource_type), ''), '')
       and r.provider_account_id is not distinct from p_provider_account_id
       and r.effective_from = p_effective_from
       and r.unit_amount_micros = p_unit_amount_micros
  ) then
    select r.id into v_id from public.platform_provider_rates r
     where r.provider_key = p_provider_key and r.cost_meter_key = p_cost_meter_key
       and r.currency = upper(btrim(p_currency)) and r.effective_from = p_effective_from
     limit 1;
    return v_id;
  end if;
  insert into public.platform_provider_rates (
    provider_key, meter_id, cost_meter_key, currency, unit_amount_micros, effective_from,
    effective_to, approval_state, source, recorded_by, note, region, direction,
    resource_type, provider_account_id)
  values (p_provider_key, p_commercial_meter_id, p_cost_meter_key, upper(btrim(p_currency)),
    p_unit_amount_micros, p_effective_from, p_effective_to, 'approved', p_source,
    auth.uid(), coalesce(p_note, ''), nullif(btrim(p_region), ''), p_direction,
    nullif(btrim(p_resource_type), ''), p_provider_account_id)
  returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.attach_plan_addon(p_plan_id uuid, p_addon_plan_id uuid, p_included_by_default boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.commercial');
  if not exists (select 1 from public.platform_plans where id=p_plan_id and kind='plan')
     or not exists (select 1 from public.platform_plans where id=p_addon_plan_id and kind='addon') then
    raise exception 'plan/add-on reference is invalid' using errcode='23503';
  end if;
  insert into public.platform_plan_addons(plan_id,addon_plan_id,included_by_default,created_by)
  values (p_plan_id,p_addon_plan_id,p_included_by_default,(select auth.uid()))
  on conflict (plan_id,addon_plan_id) do update set included_by_default=excluded.included_by_default;
end $function$;

CREATE OR REPLACE FUNCTION public.detach_plan_addon(p_plan_id uuid, p_addon_plan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.commercial');
  delete from public.platform_plan_addons where plan_id=p_plan_id and addon_plan_id=p_addon_plan_id;
end $function$;

CREATE OR REPLACE FUNCTION public.platform_usage_cost_components(p_usage_event_id uuid)
 RETURNS TABLE(id uuid, component_key text, provider_key text, cost_meter_key text, quantity numeric, unit text, provider_rate_id uuid, native_cost_micros bigint, native_currency text, reporting_cost_micros bigint, reporting_currency text, cost_state text, unknown_reason text, effective_state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app.require_platform_capability('platform.commercial');
  select c.id, c.component_key, c.provider_key, c.cost_meter_key, c.quantity, c.unit,
         c.provider_rate_id, coalesce(a.native_cost_micros, c.native_cost_micros),
         coalesce(a.native_currency, c.native_currency), c.reporting_cost_micros,
         c.reporting_currency, c.cost_state, c.unknown_reason,
         coalesce(a.state, c.cost_state)
    from public.usage_cost_components c
    left join lateral (
      select x.native_cost_micros, x.native_currency, x.state
        from public.usage_cost_component_adjustments x
       where x.organization_id = c.organization_id and x.cost_component_id = c.id
       order by x.recorded_at desc limit 1
    ) a on true
   where c.usage_event_id = p_usage_event_id
   order by c.component_key
$function$;

CREATE OR REPLACE FUNCTION public.set_plan_allowance(p_plan_id uuid, p_allowance_key text, p_label text, p_unit text, p_included_quantity numeric, p_period text, p_hard_limit numeric, p_overage_behavior text, p_allowance_type text, p_reset_semantics text, p_service_class text DEFAULT NULL::text, p_meter_id text DEFAULT NULL::text, p_display_order integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_policy text;
begin
  perform app.require_platform_capability('platform.commercial');
  v_policy := case p_overage_behavior when 'metered' then 'allowed' when 'hard_limit' then 'blocked' else 'not_applicable' end;
  insert into public.platform_plan_quotas
    (plan_id, allowance_key, label, unit, included_quantity, period, hard_limit, overage_policy,
     service_class, meter_id, display_order, allowance_type, reset_semantics, overage_behavior)
  values
    (p_plan_id, p_allowance_key, p_label, p_unit, p_included_quantity, p_period, p_hard_limit, v_policy,
     p_service_class, p_meter_id, p_display_order, p_allowance_type, p_reset_semantics, p_overage_behavior)
  on conflict (plan_id, allowance_key) do update set
    label=excluded.label, unit=excluded.unit, included_quantity=excluded.included_quantity,
    period=excluded.period, hard_limit=excluded.hard_limit, overage_policy=excluded.overage_policy,
    service_class=excluded.service_class, meter_id=excluded.meter_id, display_order=excluded.display_order,
    allowance_type=excluded.allowance_type, reset_semantics=excluded.reset_semantics,
    overage_behavior=excluded.overage_behavior, created_at=public.platform_plan_quotas.created_at
  returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.record_plan_utilization_assumption(p_plan_id uuid, p_scenario text, p_allowance_key text, p_utilization numeric, p_effective_from timestamp with time zone, p_source text, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  perform app.require_platform_capability('platform.commercial');
  if not exists (select 1 from public.platform_plan_quotas where plan_id=p_plan_id and allowance_key=p_allowance_key) then
    raise exception 'allowance does not belong to plan' using errcode='23503';
  end if;
  insert into public.platform_plan_utilization_assumptions
    (plan_id,scenario,allowance_key,utilization,effective_from,source,note,recorded_by)
  values
    (p_plan_id,p_scenario,p_allowance_key,p_utilization,p_effective_from,p_source,p_note,(select auth.uid()))
  returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.set_meter_cost_model_component(p_meter_id text, p_component_key text, p_provider_key text, p_cost_meter_key text, p_quantity_multiplier numeric, p_region text DEFAULT NULL::text, p_direction text DEFAULT NULL::text, p_resource_type text DEFAULT NULL::text, p_required boolean DEFAULT true, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  perform app.require_platform_capability('platform.commercial');
  insert into public.platform_meter_cost_model_components
    (meter_id,component_key,provider_key,cost_meter_key,quantity_multiplier,region,direction,resource_type,required,note,updated_by)
  values
    (p_meter_id,p_component_key,p_provider_key,p_cost_meter_key,p_quantity_multiplier,nullif(btrim(p_region),''),p_direction,nullif(btrim(p_resource_type),''),p_required,p_note,(select auth.uid()))
  on conflict (meter_id,component_key) do update set
    provider_key=excluded.provider_key,cost_meter_key=excluded.cost_meter_key,
    quantity_multiplier=excluded.quantity_multiplier,region=excluded.region,direction=excluded.direction,
    resource_type=excluded.resource_type,required=excluded.required,note=excluded.note,
    updated_at=now(),updated_by=excluded.updated_by
  returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.record_commercial_retail_rate(p_meter_id text, p_currency text, p_unit_amount_micros bigint, p_effective_from timestamp with time zone, p_source text, p_plan_id uuid DEFAULT NULL::uuid, p_organization_id uuid DEFAULT NULL::uuid, p_billing_interval text DEFAULT NULL::text, p_effective_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_approval_state text DEFAULT 'approved'::text, p_note text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  perform app.require_platform_capability('platform.commercial');
  if p_organization_id is not null and not exists (
    select 1 from public.organization_plan_assignments
     where organization_id=p_organization_id and plan_id=p_plan_id
  ) then raise exception 'organization has no assignment for this plan' using errcode='23503'; end if;
  insert into public.platform_retail_rates
    (meter_id,currency,unit_amount_micros,effective_from,effective_to,approval_state,source,
     recorded_by,note,plan_id,organization_id,billing_interval)
  values
    (p_meter_id,upper(btrim(p_currency)),p_unit_amount_micros,p_effective_from,p_effective_to,
     p_approval_state,p_source,(select auth.uid()),p_note,p_plan_id,p_organization_id,p_billing_interval)
  returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.save_commercial_draft_scenario(p_scenario_id uuid, p_name text, p_notes text, p_plan_id uuid, p_currency text, p_candidate_prices_minor bigint[], p_expected_seats numeric, p_expected_resource_count numeric, p_inputs jsonb DEFAULT '[]'::jsonb, p_addon_plan_ids uuid[] DEFAULT '{}'::uuid[], p_direct_costs jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_scenario uuid; v_version uuid; v_revision integer; v_item jsonb; v_addon uuid;
begin
  perform app.require_platform_capability('platform.commercial');
  if not exists (select 1 from public.platform_plans where id=p_plan_id and kind='plan') then
    raise exception 'draft scenario requires a canonical base Plan' using errcode='23503';
  end if;
  if p_scenario_id is null then
    insert into public.commercial_draft_scenarios(name,notes,created_by)
    values (btrim(p_name),coalesce(p_notes,''),(select auth.uid())) returning id into v_scenario;
  else
    update public.commercial_draft_scenarios set name=btrim(p_name),notes=coalesce(p_notes,'')
     where id=p_scenario_id and archived_at is null returning id into v_scenario;
    if v_scenario is null then raise exception 'no active draft scenario' using errcode='P0002'; end if;
  end if;
  select coalesce(max(revision),0)+1 into v_revision from public.commercial_draft_scenario_versions where scenario_id=v_scenario;
  insert into public.commercial_draft_scenario_versions
    (scenario_id,revision,plan_id,currency,candidate_prices_minor,expected_seats,expected_resource_count,recorded_by)
  values
    (v_scenario,v_revision,p_plan_id,upper(btrim(p_currency)),p_candidate_prices_minor,p_expected_seats,p_expected_resource_count,(select auth.uid()))
  returning id into v_version;
  for v_item in select value from jsonb_array_elements(coalesce(p_inputs,'[]'::jsonb)) loop
    insert into public.commercial_draft_scenario_inputs(version_id,allowance_key,meter_id,expected_quantity,utilization)
    values (v_version,v_item->>'allowanceKey',nullif(v_item->>'meterId',''),
            nullif(v_item->>'expectedQuantity','')::numeric,nullif(v_item->>'utilization','')::numeric);
  end loop;
  foreach v_addon in array coalesce(p_addon_plan_ids,'{}'::uuid[]) loop
    if not exists (select 1 from public.platform_plans where id=v_addon and kind='addon') then
      raise exception 'selected add-on is not canonical' using errcode='23503';
    end if;
    insert into public.commercial_draft_scenario_addons(version_id,addon_plan_id) values(v_version,v_addon);
  end loop;
  for v_item in select value from jsonb_array_elements(coalesce(p_direct_costs,'[]'::jsonb)) loop
    insert into public.commercial_draft_scenario_direct_costs(version_id,label,amount_minor,currency,note)
    values(v_version,v_item->>'label',(v_item->>'amountMinor')::bigint,upper(v_item->>'currency'),coalesce(v_item->>'note',''));
  end loop;
  return v_scenario;
end $function$;

CREATE OR REPLACE FUNCTION public.hand_off_accepted_proposal(p_proposal_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor          uuid := (select auth.uid());
  v_staff_name     text;
  v_proposal       public.customer_commercial_proposals;
  v_customer       public.customers;
  v_snapshot       jsonb;
  v_addons         jsonb;
  v_addon          jsonb;
  v_terms          jsonb;
  v_org            uuid;
  v_constraint     text;
  v_capabilities   text[];
  v_note           text;
  v_total_minor    bigint;
begin
  perform app.require_platform_capability('platform.organizations');
  if v_actor is null then
    raise exception 'hand_off_accepted_proposal requires an authenticated caller'
      using errcode = '42501';
  end if;

  select s.name into v_staff_name from public.platform_staff s where s.user_id = v_actor;
  if v_staff_name is null then
    raise exception 'only platform staff may create a business from a proposal'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_proposal_id::text));

  select * into v_proposal from public.customer_commercial_proposals where id = p_proposal_id;
  if v_proposal.id is null then
    raise exception 'no such proposal'
      using errcode = '42501';
  end if;
  perform app.require_capability(v_proposal.organization_id, 'customer.update');
  if v_proposal.status <> 'accepted' then
    raise exception 'only an accepted proposal can be handed off'
      using errcode = '42501';
  end if;

  select created_organization_id into v_org
    from public.customer_proposal_handoffs
   where organization_id = v_proposal.organization_id and proposal_id = p_proposal_id;
  if v_org is not null then
    return v_org;
  end if;

  select * into v_customer
    from public.customers
   where organization_id = v_proposal.organization_id and id = v_proposal.customer_id;
  if v_customer.id is null then
    raise exception 'no such customer'
      using errcode = '42501';
  end if;
  if v_customer.email is null then
    raise exception 'this customer has no email on file -- the owner needs an address to sign in with'
      using errcode = '23514';
  end if;

  select answers into v_snapshot
    from public.customer_discovery_snapshots
   where organization_id = v_proposal.organization_id and customer_id = v_proposal.customer_id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'addonPlanId', addon_plan_id, 'label', label, 'priceMinor', price_minor
         )), '[]'::jsonb)
    into v_addons
    from public.customer_commercial_proposal_addons
   where organization_id = v_proposal.organization_id and proposal_id = p_proposal_id;

  v_terms := jsonb_build_object(
    'planId', v_proposal.plan_id,
    'planLabel', v_proposal.plan_label,
    'addons', v_addons,
    'currency', v_proposal.currency,
    'billingInterval', v_proposal.billing_interval,
    'planPriceMinor', v_proposal.plan_price_minor,
    'addonPriceMinor', v_proposal.addon_price_minor,
    'discountMinor', v_proposal.discount_minor,
    'discountReason', v_proposal.discount_reason,
    'version', v_proposal.version
  );

  select pg_get_constraintdef(c.oid) into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.roles'::regclass and c.conname = 'roles_capabilities_known';
  select coalesce(array_agg(distinct match[1] order by match[1]), '{}'::text[]) into v_capabilities
    from regexp_matches(v_constraint, '''([^'']+)''::text', 'g') as match;

  v_org := public.provision_organization(
    v_customer.email, v_customer.name, 'Admin', v_capabilities, 'Owner', null, v_proposal.currency
  );

  v_note := 'Accepted proposal ' || p_proposal_id::text || ', v' || v_proposal.version::text;

  perform app.write_plan_assignment(
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

  insert into public.customer_proposal_handoffs
    (organization_id, customer_id, proposal_id, created_organization_id,
     discovery_snapshot, accepted_configuration, commercial_terms, created_by)
  values
    (v_proposal.organization_id, v_proposal.customer_id, p_proposal_id, v_org,
     coalesce(v_snapshot, '{}'::jsonb), v_proposal.accepted_configuration, v_terms, v_actor);

  return v_org;
end;
$function$;

CREATE OR REPLACE FUNCTION public.organization_allowance_state(p_organization_id uuid, p_allowance_key text DEFAULT NULL::text, p_at timestamp with time zone DEFAULT now())
 RETURNS TABLE(allowance_key text, label text, unit text, allowance_type text, period text, reset_semantics text, window_starts_at timestamp with time zone, window_ends_at timestamp with time zone, window_basis text, included numeric, consumed numeric, reserved numeric, remaining numeric, overage_quantity numeric, hard_limit numeric, overage_policy text, overage_behavior text, meter_id text, service_class text, contributions jsonb, enforcement text, state text, configuration_error text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not (p_organization_id in (select app.current_tenant_ids()) or app.has_platform_capability('platform.commercial')) then
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
  if not (p_organization_id in (select app.current_tenant_ids()) or app.has_platform_capability('platform.commercial')) then
    raise exception 'you cannot read this business''s allowances' using errcode = '42501';
  end if;

  return query select * from app.allowance_decision(
    p_organization_id, p_allowance_key, p_requested_quantity, p_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.organization_usage_detail(p_organization_id uuid)
 RETURNS TABLE(usage_event_id uuid, meter_id text, quantity bigint, occurred_at timestamp with time zone, provider_key text, estimated_cost_micros bigint, estimated_currency text, reconciled_cost_micros bigint, reconciled_currency text, reconciled_at timestamp with time zone, customer_currency text, customer_charge_micros bigint, retail_state text, provider_state text, fulfilled_through text, awaiting_reconciliation boolean, allowance_key text, allowance_included_total numeric, allowance_consumed_before numeric, allowance_included_applied numeric, allowance_overage_quantity numeric, allowance_window_start timestamp with time zone, allowance_window_end timestamp with time zone, allowance_window_basis text, allowance_state text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app.require_platform_capability('platform.commercial');

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
         u.customer_charge_micros,
         -- The rate axis, unchanged: priced (a price of nothing is still priced), or why it is not.
         case when u.customer_charge_micros is not null then 'priced'
              when u.customer_currency is null then 'no_currency'
              else 'no_rate' end,
         -- costed by a rate, not costed yet, or carrying no provider cost at all
         case when not u.provider_cost_applicable then 'not_applicable'
              when u.provider_cost_micros is null and r.reconciled_at is null then 'uncosted'
              else 'costed' end,
         u.fulfilled_through,
         -- an applicable provider cost that no provider statement has confirmed yet
         (u.provider_cost_applicable and r.reconciled_at is null),
         u.allowance_key,
         u.allowance_included_total,
         u.allowance_consumed_before,
         u.allowance_included_applied,
         u.allowance_overage_quantity,
         u.allowance_window_start,
         u.allowance_window_end,
         u.allowance_window_basis,
         -- The allowance axis, orthogonal to the rate one. Read together they tell *included*
         -- (covered, so nothing to charge), *zero-priced* (rated at nothing) and *unpriced*
         -- (no rate at all) apart -- three financial facts, never one zero.
         case when u.allowance_key is null then 'ungoverned'
              when u.allowance_overage_quantity = 0 then 'included'
              when u.allowance_included_applied = 0 then 'overage'
              else 'partly_included' end
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
$function$;

CREATE OR REPLACE FUNCTION public.platform_usage_economics(p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_organization_id uuid DEFAULT NULL::uuid, p_meter_id text DEFAULT NULL::text, p_provider_key text DEFAULT NULL::text, p_cost_state text DEFAULT NULL::text)
 RETURNS TABLE(usage_event_id uuid, organization_id uuid, organization_name text, meter_id text, quantity bigint, occurred_at timestamp with time zone, source_domain text, source_record_id text, customer_currency text, customer_charge_micros bigint, component_count bigint, known_cost_micros bigint, reporting_currency text, cost_state text, allowance_key text, allowance_included_total numeric, allowance_included_applied numeric, allowance_overage_quantity numeric, allowance_window_start timestamp with time zone, allowance_window_end timestamp with time zone, allowance_window_basis text, allowance_state text, retail_state text, retail_rate_id uuid)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select app.require_platform_capability('platform.commercial');
  select u.id, u.organization_id, o.name, u.meter_id, u.quantity, u.occurred_at,
         u.source_domain, u.source_record_id, u.customer_currency, u.customer_charge_micros,
         count(c.id), coalesce(sum(
           case when a.id is not null and a.native_currency = c.reporting_currency then a.native_cost_micros
                when a.id is null then c.reporting_cost_micros end
         ), 0)::bigint,
         max(c.reporting_currency),
         case when count(c.id) = 0 or count(*) filter (
                where c.cost_state = 'unknown'
                   or (c.native_cost_micros is not null and c.reporting_cost_micros is null)
                   or (a.id is not null and (c.reporting_currency is null or a.native_currency <> c.reporting_currency))
              ) > 0 then 'unknown'
              when count(a.id) = count(c.id) and count(c.id) > 0 then 'reconciled'
              else 'estimated' end,
         u.allowance_key, u.allowance_included_total, u.allowance_included_applied,
         u.allowance_overage_quantity, u.allowance_window_start, u.allowance_window_end,
         u.allowance_window_basis,
         case when u.allowance_key is null then 'ungoverned'
              when u.allowance_overage_quantity = 0 then 'included'
              when u.allowance_included_applied = 0 then 'overage'
              else 'partly_included' end,
         case when u.customer_charge_micros is not null then 'priced'
              when u.customer_currency is null then 'no_currency'
              else 'no_rate' end,
         u.retail_rate_id
    from public.usage_events u
    join public.organizations o on o.id = u.organization_id
    left join public.usage_cost_components c on c.organization_id = u.organization_id and c.usage_event_id = u.id
    left join lateral (
      select x.id, x.native_cost_micros, x.native_currency from public.usage_cost_component_adjustments x
       where x.organization_id = c.organization_id and x.cost_component_id = c.id
       order by x.recorded_at desc limit 1
    ) a on true
   where (p_from is null or u.occurred_at >= p_from)
     and (p_to is null or u.occurred_at < p_to)
     and (p_organization_id is null or u.organization_id = p_organization_id)
     and (p_meter_id is null or u.meter_id = p_meter_id)
     and (p_provider_key is null or c.provider_key = p_provider_key)
   group by u.id, o.name
  having p_cost_state is null or
    (case when count(c.id) = 0 or count(*) filter (
             where c.cost_state = 'unknown'
                or (c.native_cost_micros is not null and c.reporting_cost_micros is null)
                or (a.id is not null and (c.reporting_currency is null or a.native_currency <> c.reporting_currency))
           ) > 0 then 'unknown'
          when count(a.id) = count(c.id) and count(c.id) > 0 then 'reconciled' else 'estimated' end) = p_cost_state
   order by u.occurred_at desc
   limit 250
$function$;

CREATE OR REPLACE FUNCTION public.organization_cost_to_serve(p_organization_id uuid, p_period_start timestamp with time zone, p_period_end timestamp with time zone, p_reporting_currency text DEFAULT 'CAD'::text)
 RETURNS TABLE(reporting_currency text, direct_usage_cogs_micros bigint, direct_usage_has_unknown boolean, resource_cogs_micros bigint, infrastructure_attributable_cogs_micros bigint, manual_direct_cogs_micros bigint, attributable_known_cogs_micros bigint, attributable_has_unallocated_peer boolean, shared_platform_cost_micros bigint, unallocated_cost_micros bigint, component_count bigint, known_component_count bigint, cost_coverage numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.commercial');
  return query select * from app.organization_cost_to_serve(p_organization_id, p_period_start, p_period_end, p_reporting_currency);
end;
$function$;

CREATE OR REPLACE FUNCTION public.organization_revenue_summary(p_organization_id uuid, p_billing_period_start timestamp with time zone, p_billing_period_end timestamp with time zone, p_reporting_currency text DEFAULT 'CAD'::text)
 RETURNS TABLE(reporting_currency text, base_plan_minor bigint, addon_minor bigint, recurring_resource_minor bigint, usage_overage_minor bigint, one_time_service_minor bigint, debit_adjustment_minor bigint, credit_adjustment_minor bigint, customer_obligation_minor bigint, has_mixed_currency boolean, known_cost_to_serve_minor bigint, known_contribution_minor bigint, known_margin numeric, cost_coverage numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_mixed boolean;
begin
  perform app.require_platform_capability('platform.commercial');

  select bool_or(currency <> p_reporting_currency) into v_mixed
    from public.organization_charge_components
   where organization_id = p_organization_id
     and billing_period_start = p_billing_period_start
     and billing_period_end = p_billing_period_end;

  return query
  with rev as (
    select
      coalesce(sum(amount_minor) filter (where component_type = 'base_plan' and currency = p_reporting_currency), 0)::bigint as base_plan,
      coalesce(sum(amount_minor) filter (where component_type = 'addon' and currency = p_reporting_currency), 0)::bigint as addon,
      coalesce(sum(amount_minor) filter (where component_type = 'recurring_resource' and currency = p_reporting_currency), 0)::bigint as resource,
      coalesce(sum(amount_minor) filter (where component_type = 'usage_overage' and currency = p_reporting_currency), 0)::bigint as overage,
      coalesce(sum(amount_minor) filter (where component_type = 'one_time_service' and currency = p_reporting_currency), 0)::bigint as service,
      coalesce(sum(amount_minor) filter (where component_type = 'debit_adjustment' and currency = p_reporting_currency), 0)::bigint as debit,
      coalesce(sum(amount_minor) filter (where component_type = 'credit_adjustment' and currency = p_reporting_currency), 0)::bigint as credit
    from public.organization_charge_components
   where organization_id = p_organization_id
     and billing_period_start = p_billing_period_start
     and billing_period_end = p_billing_period_end
  ),
  cost as (
    select * from app.organization_cost_to_serve(p_organization_id, p_billing_period_start, p_billing_period_end, p_reporting_currency)
  )
  select
    p_reporting_currency,
    rev.base_plan, rev.addon, rev.resource, rev.overage, rev.service, rev.debit, rev.credit,
    (rev.base_plan + rev.addon + rev.resource + rev.overage + rev.service + rev.debit - rev.credit),
    coalesce(v_mixed, false),
    cost.attributable_known_cogs_micros / 1000000,
    (rev.base_plan + rev.addon + rev.resource + rev.overage + rev.service + rev.debit - rev.credit) - (cost.attributable_known_cogs_micros / 1000000),
    case when (rev.base_plan + rev.addon + rev.resource + rev.overage + rev.service + rev.debit - rev.credit) = 0 then null
         else round((((rev.base_plan + rev.addon + rev.resource + rev.overage + rev.service + rev.debit - rev.credit) - (cost.attributable_known_cogs_micros / 1000000))::numeric
              / (rev.base_plan + rev.addon + rev.resource + rev.overage + rev.service + rev.debit - rev.credit)), 4) end,
    cost.cost_coverage
  from rev, cost;
end;
$function$;

CREATE OR REPLACE FUNCTION public.platform_revenue_portfolio(p_billing_period_start timestamp with time zone, p_billing_period_end timestamp with time zone, p_reporting_currency text DEFAULT 'CAD'::text)
 RETURNS TABLE(organization_id uuid, organization_name text, customer_obligation_minor bigint, known_cost_to_serve_minor bigint, known_contribution_minor bigint, known_margin numeric, cost_coverage numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.commercial');

  return query
  select o.id, o.name, r.customer_obligation_minor, r.known_cost_to_serve_minor, r.known_contribution_minor, r.known_margin, r.cost_coverage
    from public.organizations o
    cross join lateral public.organization_revenue_summary(o.id, p_billing_period_start, p_billing_period_end, p_reporting_currency) r
   where exists (
     select 1 from public.organization_charge_components c
      where c.organization_id = o.id and c.billing_period_start = p_billing_period_start and c.billing_period_end = p_billing_period_end
   )
   order by r.customer_obligation_minor desc;
end;
$function$;

CREATE OR REPLACE FUNCTION public.existing_client_tenant_options(p_organization_id uuid, p_customer_id uuid, p_search text DEFAULT ''::text)
 RETURNS TABLE(id uuid, name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select o.id,o.name from public.organizations o
  where o.id<>p_organization_id and o.id in(select app.current_tenant_ids())
    and app.has_platform_capability('platform.organizations') and app.has_capability(p_organization_id,'customer.update')
    and app.has_capability(o.id,'organization.manage')
    and exists(select 1 from public.customers c where c.organization_id=p_organization_id and c.id=p_customer_id)
    and o.name ilike '%' || left(p_search,100) || '%'
  order by o.created_at desc,o.id limit 100;
$function$;

CREATE OR REPLACE FUNCTION public.link_existing_client_tenant(p_organization_id uuid, p_customer_id uuid, p_tenant_id uuid, p_authority_basis text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  if auth.uid() is null or not app.has_capability(p_organization_id,'customer.update') or
    not exists(select 1 from public.customers where organization_id=p_organization_id and id=p_customer_id) then
    raise exception 'Customer management permission required' using errcode='42501';
  end if;
  -- The signed action approves both sides: staff authority alone cannot assert tenant consent.
  if not app.has_platform_capability('platform.organizations') or not app.has_capability(p_tenant_id,'organization.manage') or
    not exists(select 1 from public.organizations where id=p_tenant_id) then
    raise exception 'Platform staff and receiving-tenant management authority required' using errcode='42501';
  end if;
  if p_authority_basis is null or length(btrim(p_authority_basis)) not between 10 and 460 then
    raise exception 'Record the verified basis for this association' using errcode='22023';
  end if;
  insert into public.client_tenant_relationships(organization_id,customer_id,tenant_organization_id,origin,authority_basis,created_by)
  values(p_organization_id,p_customer_id,p_tenant_id,'existing_tenant_link','Authenticated tenant-manager approval: ' || btrim(p_authority_basis),auth.uid()) returning id into v_id;
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
  values(p_organization_id,auth.uid(),'customer',p_customer_id,'client_tenant.linked',jsonb_build_object('relationshipId',v_id,'tenantId',p_tenant_id));
  return v_id;
end $function$;

alter policy "automation_rules_platform_select" on "public"."automation_rules" using (( SELECT ((select app.has_platform_capability('platform.organizations')) or (select app.has_platform_capability('platform.health'))) AS is_platform_staff));

alter policy "automation_runs_platform_select" on "public"."automation_runs" using (( SELECT ((select app.has_platform_capability('platform.organizations')) or (select app.has_platform_capability('platform.health'))) AS is_platform_staff));

alter policy "brand_settings_select_staff" on "public"."brand_settings" using (( SELECT ((select app.has_platform_capability('platform.organizations'))) AS is_platform_staff));

alter policy "commercial_draft_scenario_addons_staff_select" on "public"."commercial_draft_scenario_addons" using (( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff));

alter policy "commercial_draft_scenario_direct_costs_staff_select" on "public"."commercial_draft_scenario_direct_costs" using (( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff));

alter policy "commercial_draft_scenario_inputs_staff_select" on "public"."commercial_draft_scenario_inputs" using (( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff));

alter policy "commercial_draft_scenario_versions_staff_select" on "public"."commercial_draft_scenario_versions" using (( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff));

alter policy "commercial_draft_scenarios_staff_select" on "public"."commercial_draft_scenarios" using (( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff));

alter policy "events_platform_select" on "public"."events" using (( SELECT ((select app.has_platform_capability('platform.organizations')) or (select app.has_platform_capability('platform.health'))) AS is_platform_staff));

alter policy "memberships_platform_select" on "public"."memberships" using (( SELECT ((select app.has_platform_capability('platform.organizations'))) AS is_platform_staff));

alter policy "message_deliveries_platform_select" on "public"."message_deliveries" using (( SELECT ((select app.has_platform_capability('platform.organizations')) or (select app.has_platform_capability('platform.health'))) AS is_platform_staff));

alter policy "organization_charge_components_select" on "public"."organization_charge_components" using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ((select app.has_platform_capability('platform.commercial')))));

alter policy "organization_commercial_adjustments_select" on "public"."organization_commercial_adjustments" using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ((select app.has_platform_capability('platform.commercial')))));

alter policy "organization_commercial_terms_platform_select" on "public"."organization_commercial_terms" using (( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff));

alter policy "organization_credits_platform_select" on "public"."organization_credits" using (( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff));

alter policy "organization_domains_select_staff" on "public"."organization_domains" using (( SELECT ((select app.has_platform_capability('platform.organizations')) or (select app.has_platform_capability('platform.providers'))) AS is_platform_staff));

alter policy "organization_modules_platform_select" on "public"."organization_modules" using (( SELECT ((select app.has_platform_capability('platform.organizations'))) AS is_platform_staff));

alter policy "organization_plan_agreement_provider_prices_select" on "public"."organization_plan_agreement_provider_prices" using (((select app.has_platform_capability('platform.commercial'))));

alter policy "organization_plan_agreements_select" on "public"."organization_plan_agreements" using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ((select app.has_platform_capability('platform.commercial')))));

alter policy "organization_plan_assignments_select" on "public"."organization_plan_assignments" using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ((select app.has_platform_capability('platform.commercial')))));

alter policy "organization_plan_quota_overrides_select" on "public"."organization_plan_quota_overrides" using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ((select app.has_platform_capability('platform.commercial')))));

alter policy "organization_platform_subscription_items_select" on "public"."organization_platform_subscription_items" using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ((select app.has_platform_capability('platform.commercial')))));

alter policy "organization_platform_subscriptions_select" on "public"."organization_platform_subscriptions" using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ((select app.has_platform_capability('platform.commercial')))));

alter policy "organization_provider_bindings_select_staff" on "public"."organization_provider_bindings" using (( SELECT ((select app.has_platform_capability('platform.providers'))) AS is_platform_staff));

alter policy "organization_provider_resources_select_staff" on "public"."organization_provider_resources" using (( SELECT ((select app.has_platform_capability('platform.providers'))) AS is_platform_staff));

alter policy "organizations_platform_select" on "public"."organizations" using (( SELECT ((select app.has_platform_capability('platform.organizations')) or (select app.has_platform_capability('platform.providers')) or (select app.has_platform_capability('platform.commercial')) or (select app.has_platform_capability('platform.health'))) AS is_platform_staff));

alter policy "phone_assignments_platform_select" on "public"."phone_number_assignments" using (( SELECT ((select app.has_platform_capability('platform.organizations')) or (select app.has_platform_capability('platform.providers'))) AS is_platform_staff));

alter policy "phone_numbers_platform_select" on "public"."phone_numbers" using (( SELECT ((select app.has_platform_capability('platform.organizations')) or (select app.has_platform_capability('platform.providers'))) AS is_platform_staff));

alter policy "platform_billing_checkout_sessions_select" on "public"."platform_billing_checkout_sessions" using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ((select app.has_platform_capability('platform.commercial')))));

alter policy "platform_billing_customers_select" on "public"."platform_billing_customers" using (((organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids)) OR ((select app.has_platform_capability('platform.commercial')))));

alter policy "platform_billing_webhook_events_select" on "public"."platform_billing_webhook_events" using (((select app.has_platform_capability('platform.commercial'))));

alter policy "platform_catalog_runtime_mappings_select" on "public"."platform_catalog_runtime_mappings" using (((mapping_kind <> 'provider_key'::text) OR ( SELECT ((select app.has_platform_capability('platform.catalogue')) or (select app.has_platform_capability('platform.providers'))) AS is_platform_staff)));

alter policy "platform_connector_app_features_select" on "public"."platform_connector_app_features" using (( SELECT ((select app.has_platform_capability('platform.catalogue'))) AS is_platform_staff));

alter policy "platform_connectors_select" on "public"."platform_connectors" using ((is_public OR ((select app.has_platform_capability('platform.catalogue')))));

alter policy "platform_fx_rates_staff_select" on "public"."platform_fx_rates" using (((select app.has_platform_capability('platform.commercial'))));

alter policy "platform_infrastructure_cost_components_staff_select" on "public"."platform_infrastructure_cost_components" using (((select app.has_platform_capability('platform.commercial'))));

alter policy "platform_meter_cost_model_components_staff_select" on "public"."platform_meter_cost_model_components" using (( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff));

alter policy "platform_plan_addons_select" on "public"."platform_plan_addons" using ((( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff) OR ( SELECT app.is_organization_member() AS is_organization_member)));

alter policy "platform_plan_cost_assumptions_staff_select" on "public"."platform_plan_cost_assumptions" using (( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff));

alter policy "platform_plan_feature_grants_select" on "public"."platform_plan_feature_grants" using ((( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff) OR ( SELECT app.is_organization_member() AS is_organization_member)));

alter policy "platform_plan_margin_policies_staff_select" on "public"."platform_plan_margin_policies" using (( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff));

alter policy "platform_plan_module_grants_select" on "public"."platform_plan_module_grants" using ((( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff) OR ( SELECT app.is_organization_member() AS is_organization_member)));

alter policy "platform_plan_prices_select" on "public"."platform_plan_prices" using ((( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff) OR ( SELECT app.is_organization_member() AS is_organization_member)));

alter policy "platform_plan_product_grants_select" on "public"."platform_plan_product_grants" using ((( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff) OR ( SELECT app.is_organization_member() AS is_organization_member)));

alter policy "platform_plan_provider_prices_select" on "public"."platform_plan_provider_prices" using (( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff));

alter policy "platform_plan_quotas_select" on "public"."platform_plan_quotas" using ((( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff) OR ( SELECT app.is_organization_member() AS is_organization_member)));

alter policy "platform_plan_utilization_assumptions_staff_select" on "public"."platform_plan_utilization_assumptions" using (( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff));

alter policy "platform_plans_select" on "public"."platform_plans" using ((( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff) OR ( SELECT app.is_organization_member() AS is_organization_member)));

alter policy "platform_product_prices_platform_select" on "public"."platform_product_prices" using (( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff));

alter policy "platform_provider_accounts_select" on "public"."platform_provider_accounts" using (((select app.has_platform_capability('platform.providers'))));

alter policy "platform_provider_cost_meters_staff_select" on "public"."platform_provider_cost_meters" using (((select app.has_platform_capability('platform.commercial'))));

alter policy "platform_provider_rates_platform_select" on "public"."platform_provider_rates" using (( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff));

alter policy "platform_provider_service_features_select" on "public"."platform_provider_service_features" using (( SELECT ((select app.has_platform_capability('platform.providers')) or (select app.has_platform_capability('platform.catalogue'))) AS is_platform_staff));

alter policy "platform_provider_services_select" on "public"."platform_provider_services" using (( SELECT ((select app.has_platform_capability('platform.providers')) or (select app.has_platform_capability('platform.catalogue'))) AS is_platform_staff));

alter policy "platform_provider_sync_failures_select" on "public"."platform_provider_sync_failures" using (( SELECT ((select app.has_platform_capability('platform.health'))) AS is_platform_staff));

alter policy "platform_providers_platform_select" on "public"."platform_providers" using (( SELECT ((select app.has_platform_capability('platform.providers')) or (select app.has_platform_capability('platform.catalogue')) or (select app.has_platform_capability('platform.commercial'))) AS is_platform_staff));

alter policy "platform_retail_rates_select" on "public"."platform_retail_rates" using ((( SELECT ((select app.has_platform_capability('platform.commercial'))) AS is_platform_staff) OR (( SELECT app.is_organization_member() AS is_organization_member) AND ((organization_id IS NULL) OR (organization_id IN ( SELECT app.current_tenant_ids() AS current_tenant_ids))))));

alter policy "platform_staff_self_select" on "public"."platform_staff" using (( SELECT (user_id = (select auth.uid())) AS is_platform_staff));

alter policy "platform_support_requests_select_staff" on "public"."platform_support_requests" using (((select app.has_platform_capability('platform.organizations'))));

alter policy "platform_support_sessions_select" on "public"."platform_support_sessions" using (( SELECT ((select app.has_platform_capability('platform.organizations'))) AS is_platform_staff));

alter policy "usage_cost_component_adjustments_staff_select" on "public"."usage_cost_component_adjustments" using (((select app.has_platform_capability('platform.commercial'))));

alter policy "usage_cost_components_staff_select" on "public"."usage_cost_components" using (((select app.has_platform_capability('platform.commercial'))));

alter policy "user_phone_number_preferences_platform_select" on "public"."user_phone_number_preferences" using (( SELECT ((select app.has_platform_capability('platform.organizations'))) AS is_platform_staff));

alter policy "connector_logos_update" on "storage"."objects" using (((bucket_id = 'connector-logos'::text) AND ((select app.has_platform_capability('platform.catalogue'))))) with check (((bucket_id = 'connector-logos'::text) AND ((select app.has_platform_capability('platform.catalogue')))));

alter policy "connector_logos_delete" on "storage"."objects" using (((bucket_id = 'connector-logos'::text) AND ((select app.has_platform_capability('platform.catalogue')))));

alter policy "connector_logos_insert" on "storage"."objects" with check (((bucket_id = 'connector-logos'::text) AND ((select app.has_platform_capability('platform.catalogue')))));

create or replace view public.platform_tenants with (security_invoker = true) as
 SELECT id,
    name,
    created_at,
    timezone,
    currency,
    slug,
    COALESCE(( SELECT array_agg(m.module_key ORDER BY m.module_key) AS array_agg
           FROM organization_modules m
          WHERE (m.organization_id = o.id)), ARRAY[]::text[]) AS module_keys,
    ( SELECT max(e.occurred_at) AS max
           FROM events e
          WHERE (e.organization_id = o.id)) AS last_activity_at,
    operational_state
   FROM organizations o
  WHERE ( SELECT ((select app.has_platform_capability('platform.organizations')) or (select app.has_platform_capability('platform.providers')) or (select app.has_platform_capability('platform.commercial')) or (select app.has_platform_capability('platform.health'))) AS is_platform_staff);

-- Only the accepted-proposal command may persist handoff evidence.
revoke insert on public.customer_proposal_handoffs from authenticated;
drop policy customer_proposal_handoffs_insert on public.customer_proposal_handoffs;
revoke all on function public.sync_phone_number(uuid,uuid,text,text,text) from public, anon;
grant execute on function public.sync_phone_number(uuid,uuid,text,text,text) to authenticated;
comment on column public.platform_staff.capabilities is
  'Live permissions enforced by RPC commands, privileged RLS branches and application routes. Staff membership implies no capability.';
notify pgrst, 'reload schema';
commit;

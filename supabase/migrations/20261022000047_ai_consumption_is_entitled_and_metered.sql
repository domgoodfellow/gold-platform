-- AI consumption is entitled before it is spent, and metered after it is known.
--
-- Three gaps C8-WO1 found, closed here with the machinery that already exists:
--
--   **Nothing recorded what a model consumed.** `ai_tokens_input` and `ai_tokens_output` were
--     defined meters with `writer = null`, because no code read a token count off a provider's
--     answer. `public.record_ai_usage` is that writer: a thin door over `app.record_usage`, so the
--     allowance split, the retail and provider rates and the provenance checks are the ones every
--     other meter already goes through. There is no second ledger.
--   **Nothing asked whether the business had the capability.** `assistant.ask` is a permission;
--     whether the business holds the Agent at all is a separate question (D25), and only
--     `card_payments` had ever been enforced. `app.module_entitled` answers it for a module key.
--   **A third capability had no assignment.** Configuration drafting hard-coded its own model and
--     read its own key in `apps/web`. It is now `configuration_drafting`, assigned like the other
--     two.

-- ---------------------------------------------------------------------------
-- 1. The capability list, written once
-- ---------------------------------------------------------------------------
-- The list was a literal in the table's check, again in `record_ai_runtime_assignment`, again in
-- Python and again in TypeScript. The two SQL copies become one function; adding a capability is
-- an edit here and in the two runtimes' own constants, no longer four places.

create function app.ai_capabilities()
returns text[]
language sql
immutable
set search_path = ''
as $fn$
  select array['operator_assistant', 'public_assistant', 'configuration_drafting']::text[];
$fn$;

comment on function app.ai_capabilities() is
  'The AI capabilities a runtime may be assigned to. One list for the table check and the one write door; apps/api and apps/web hold their own constants, pinned to this by tests.';

revoke all on function app.ai_capabilities() from public;
grant execute on function app.ai_capabilities() to authenticated;

alter table public.platform_ai_runtime_assignments
  drop constraint platform_ai_runtime_assignments_capability_check;
alter table public.platform_ai_runtime_assignments
  add constraint platform_ai_runtime_assignments_capability_check
  check (capability = any (app.ai_capabilities()));

create or replace function public.record_ai_runtime_assignment(
  p_capability          text,
  p_provider_service_id uuid,
  p_provider_account_id uuid,
  p_model               text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_staff        text := app.require_platform_staff();
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
$fn$;

-- ---------------------------------------------------------------------------
-- 2. Whether a business holds a module, resolved the way the shell resolves it
-- ---------------------------------------------------------------------------
-- `organizationResolvedFeatureStates` (apps/web) is the authoritative resolver and this is its
-- answer for one module key, written where the spend happens. It exists because the two callers
-- that matter -- the Python endpoint a person's token reaches directly, and a public visitor's --
-- cannot ask a TypeScript function. `ai-entitlement.test.ts` holds the two to the same answer.
--
--   * A module with Features mapped to it (`platform_catalog_runtime_mappings`) is entitled when
--     any of them is: by the current Plan and Add-ons when the business holds a base Plan, else by
--     the legacy wanted-and-paid term; and not switched off by the business itself.
--   * A module no Feature maps to (`drafting`) has only the legacy answer. It is never reported
--     active by the shell either; whether a business holds it is still wanted-and-paid.
--
-- Permission is not in here and must not be: `assistant.ask` is `app.has_capability`'s question.

create function app.module_entitled(
  p_organization_id uuid,
  p_module_key      text,
  p_at              timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_day      date := p_at::date;
  v_features uuid[];
  v_has_plan boolean;
  v_legacy   boolean;
begin
  v_legacy :=
    exists (
      select 1 from public.organization_modules m
       where m.organization_id = p_organization_id and m.module_key = p_module_key
    )
    and app.module_paid(p_organization_id, p_module_key, v_day);

  select coalesce(array_agg(rm.feature_id), '{}'::uuid[]) into v_features
    from public.platform_catalog_runtime_mappings rm
   where rm.mapping_kind = 'module_key' and rm.mapping_value = p_module_key;

  if cardinality(v_features) = 0 then
    return v_legacy;
  end if;

  select exists (
    select 1 from public.organization_plan_assignments a
     where a.organization_id = p_organization_id
       and a.plan_kind = 'plan'
       and a.period_start <= v_day and a.period_end > v_day
  ) into v_has_plan;

  return exists (
    select 1
      from unnest(v_features) as f (id)
     where (
             case when v_has_plan
                  then exists (
                         select 1 from public.organization_plan_assignments a
                          where a.organization_id = p_organization_id
                            and a.period_start <= v_day and a.period_end > v_day
                            and coalesce(app.plan_grants_feature(a.plan_id, f.id), false)
                       )
                  else v_legacy
             end
           )
       and not exists (
             select 1 from public.organization_feature_activation_overrides o
              where o.organization_id = p_organization_id and o.feature_id = f.id
           )
  );
end;
$fn$;

comment on function app.module_entitled(uuid, text, timestamptz) is
  'Whether an organization currently holds a module -- Plan and Add-ons if it has a base Plan, else a paid legacy term -- and has not switched it off. Not permission. No grant to any signed-in role: reached only through public.organization_module_entitled and public.resolve_public_assistant.';

revoke all on function app.module_entitled(uuid, text, timestamptz) from public;

-- The signed-in door. A caller asking about a business that is not theirs is told *no*, the
-- same answer as a business that does not hold the module: nothing here confirms which.
create function public.organization_module_entitled(p_organization_id uuid, p_module_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if p_organization_id not in (select app.current_tenant_ids()) then
    return false;
  end if;
  return app.module_entitled(p_organization_id, p_module_key);
end;
$fn$;

comment on function public.organization_module_entitled(uuid, text) is
  'Whether the caller''s own business holds a module. False for a business the caller is not a member of. The commercial half of "may this person use the Agent"; the permission half is assistant.ask.';

revoke all on function public.organization_module_entitled(uuid, text) from public, anon;
grant execute on function public.organization_module_entitled(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A public deployment, resolved from its own id
-- ---------------------------------------------------------------------------
-- The public chat request used to name its organization and carry the tenant's instructions,
-- both of which this runtime then trusted because a shared secret came with them (D17, D22). The
-- request now names only a deployment; the business, the instructions and the entitlement all
-- come from the database. The existing projection decides whether the deployment is live, so
-- "enabled, active assistant, published page" is still written once.

create function public.resolve_public_assistant(p_deployment_id uuid)
returns table (organization_id uuid, instructions text, entitled boolean)
language sql
stable
security definer
set search_path = ''
as $fn$
  select (x.live ->> 'organizationId')::uuid,
         x.live ->> 'instructions',
         app.module_entitled((x.live ->> 'organizationId')::uuid, 'assistant')
    from public.ai_assistant_deployments d
   cross join lateral (select public.public_assistant_deployment(d.public_site_id) as live) x
   where d.id = p_deployment_id
     and d.surface = 'website_chat'
     and x.live is not null
     and (x.live ->> 'deploymentId')::uuid = d.id;
$fn$;

comment on function public.resolve_public_assistant(uuid) is
  'The business, the instructions its owner wrote and whether it holds the Agent, for one live website-chat deployment. No row for a deployment that is not live. Granted to provider_operator alone: the public chat endpoint proves its caller with a shared secret, and this is how it learns which business that is.';

revoke all on function public.resolve_public_assistant(uuid) from public, anon, authenticated;
grant execute on function public.resolve_public_assistant(uuid) to provider_operator;

-- ---------------------------------------------------------------------------
-- 4. The writer of AI usage
-- ---------------------------------------------------------------------------
-- One call per answered request, carrying that request's total across every model call it made
-- (the loop sums them; nothing records a call twice). The reference is the request's own id, so
-- a retry of this call is the same fact and `app.record_usage` returns the row it already wrote.
-- Executable by `provider_operator` alone: a person who could call this could invent usage.

create function public.record_ai_usage(
  p_organization_id uuid,
  p_capability      text,
  p_provider_key    text,
  p_input_tokens    bigint,
  p_output_tokens   bigint,
  p_reference       text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if not (p_capability = any (app.ai_capabilities())) then
    raise exception 'unknown AI capability: %', p_capability using errcode = '22023';
  end if;
  if btrim(coalesce(p_reference, '')) = '' then
    raise exception 'a request reference is required' using errcode = '22023';
  end if;
  if coalesce(p_input_tokens, 0) < 0 or coalesce(p_output_tokens, 0) < 0 then
    raise exception 'token counts cannot be negative' using errcode = '22023';
  end if;

  -- Zero is not recorded: `app.record_usage` refuses it, and a request that consumed nothing
  -- did not consume nothing *of a meter* -- it simply is not an event.
  if coalesce(p_input_tokens, 0) > 0 then
    perform app.record_usage(
      p_organization_id, 'ai_tokens_input', p_input_tokens, p_provider_key, now(),
      null, null, null, p_reference, p_capability, 'platform_account');
  end if;
  if coalesce(p_output_tokens, 0) > 0 then
    perform app.record_usage(
      p_organization_id, 'ai_tokens_output', p_output_tokens, p_provider_key, now(),
      null, null, null, p_reference, p_capability, 'platform_account');
  end if;
end;
$fn$;

comment on function public.record_ai_usage(uuid, text, text, bigint, bigint, text) is
  'Records what one AI request consumed, as ai_tokens_input and ai_tokens_output, through app.record_usage. The writer of both meters. Idempotent on (organization, meter, reference).';

revoke all on function public.record_ai_usage(uuid, text, text, bigint, bigint, text) from public, anon, authenticated;
grant execute on function public.record_ai_usage(uuid, text, text, bigint, bigint, text) to provider_operator;

-- The meters say so only now that something writes them. `catalogue.ts` reads `writer` to decide
-- whether a Plan quota over a meter promises tracking that happens.
update public.platform_meters
   set writer = 'public.record_ai_usage'
 where id in ('ai_tokens_input', 'ai_tokens_output');

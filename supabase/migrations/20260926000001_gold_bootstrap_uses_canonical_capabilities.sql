-- Repair the GOLD bootstrap primitive without rewriting migration history.
--
-- The first version could create a GOLD membership attached to an empty Admin role. Normal
-- founding/provisioning gets its authority from the application domain's ALL_CAPABILITIES and
-- passes that set to SQL, where roles_capabilities_known validates it. This maintenance door now
-- follows the same shape instead of inventing a second SQL-side capability vocabulary.

do $$
declare
  v_capabilities text[];
  v_constraint text;
begin
  select pg_get_constraintdef(c.oid) into v_constraint
    from pg_constraint c
   where c.conrelid = 'public.roles'::regclass
     and c.conname = 'roles_capabilities_known';

  select coalesce(array_agg(distinct match[1] order by match[1]), '{}'::text[])
    into v_capabilities
    from regexp_matches(v_constraint, '''([^'']+)''::text', 'g') as match;

  if not ('billing.manage' = any (v_capabilities)) then
    v_capabilities := array_append(v_capabilities, 'billing.manage');

    alter table public.roles drop constraint roles_capabilities_known;
    execute format(
      'alter table public.roles add constraint roles_capabilities_known check (capabilities <@ array[%s]::text[])',
      (select string_agg(quote_literal(capability), ', ' order by capability)
         from unnest(v_capabilities) as capability)
    );
  end if;
end
$$;

create or replace function public.bootstrap_gold_internal_workspace(
  p_organization_id uuid,
  p_role text,
  p_capabilities text[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
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
  perform app.require_platform_staff();

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
$fn$;

comment on function public.bootstrap_gold_internal_workspace(uuid, text, text[]) is
  'Staff-only repair door that assigns gold_internal to one explicit organization when valid and creates/updates the caller''s real organization membership using the same capabilities normal founding passes from the domain layer.';

revoke all on function public.bootstrap_gold_internal_workspace(uuid, text, text[]) from public;
grant execute on function public.bootstrap_gold_internal_workspace(uuid, text, text[]) to authenticated;

drop function if exists public.bootstrap_gold_internal_workspace(uuid);

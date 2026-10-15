-- GildOps' operating organization is platform configuration, not a commercial fact.
--
-- Until now the application recognised GildOps' own organization by searching for the current
-- holder of the `gold_internal` Plan, so changing a Plan could change which organization was
-- GildOps. The identity now lives on the `platform_settings` singleton; the Plan keeps deciding
-- only what that organization is entitled to.
--
-- `gold_public_organization_id` and `workflow_review_organization_id` remain separate public-site
-- and intake targets. They are not this identity and are not read by it.
begin;

alter table public.platform_settings
  add column operating_organization_id uuid
    constraint platform_settings_operating_organization_fk
    references public.organizations (id) on delete restrict;

comment on column public.platform_settings.operating_organization_id is
  'GildOps'' own operating organization: the one organization Platform Administration is presented in. One value per deployment because the table is a singleton. Set by bootstrap_gold_internal_workspace or the backfill below, never by a client; once set it can only be cleared deliberately, never pointed at another organization in one step. Independent of the organization''s Plan.';

-- Reassignment in one statement is what a bug in a privileged function would look like. A
-- deliberate re-designation has to clear the value first, which no granted function does.
create function app.operating_organization_is_stable()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if old.operating_organization_id is not null
     and new.operating_organization_id is not null
     and new.operating_organization_id <> old.operating_organization_id then
    raise exception 'the GildOps operating organization is already %', old.operating_organization_id
      using errcode = '23505';
  end if;
  return new;
end;
$fn$;

revoke all on function app.operating_organization_is_stable() from public;

create trigger platform_settings_operating_organization_is_stable
  before update of operating_organization_id on public.platform_settings
  for each row execute function app.operating_organization_is_stable();

-- Backfill from the one current internal-plan holder. A clean database has none and stays
-- unconfigured (Platform is then unreachable until bootstrap designates one); more than one is
-- ambiguous and stops the migration rather than guessing.
do $$
declare
  v_holders uuid[];
begin
  if not exists (select 1 from public.platform_settings where singleton) then
    raise exception 'platform_settings has no singleton row' using errcode = '55000';
  end if;

  select coalesce(array_agg(distinct opa.organization_id), '{}'::uuid[])
    into v_holders
    from public.organization_plan_assignments opa
    join public.platform_plans pp on pp.id = opa.plan_id
   where pp.key = 'gold_internal'
     and pp.kind = 'plan'
     and opa.plan_kind = 'plan'
     and opa.period_start <= current_date
     and opa.period_end > current_date;

  if cardinality(v_holders) > 1 then
    raise exception 'cannot identify the GildOps operating organization: % organizations currently hold the gold_internal plan (%)',
      cardinality(v_holders), v_holders
      using errcode = '23505';
  end if;

  if cardinality(v_holders) = 1 then
    update public.platform_settings
       set operating_organization_id = v_holders[1]
     where singleton;
  end if;
end
$$;

-- For SQL that needs the identity itself. No client grant: a caller learns it only through
-- caller_operating_organization_id, which also requires their membership.
create function app.operating_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select ps.operating_organization_id from public.platform_settings ps where ps.singleton;
$fn$;

revoke all on function app.operating_organization_id() from public, anon, authenticated;

-- Identity and membership together, so the answer never tells a non-member which organization is
-- GildOps. Platform authority is a separate question (platform_staff); this function neither asks
-- it nor grants it.
create function public.caller_operating_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select ps.operating_organization_id
    from public.platform_settings ps
   where ps.singleton
     and exists (
       select 1
         from public.memberships m
        where m.organization_id = ps.operating_organization_id
          and m.user_id = (select auth.uid())
     );
$fn$;

comment on function public.caller_operating_organization_id() is
  'GildOps'' operating organization when the caller is a member of it; null when the deployment has none or the caller is not a member. Never derived from a Plan, a name or platform authority.';

revoke all on function public.caller_operating_organization_id() from public, anon;
grant execute on function public.caller_operating_organization_id() to authenticated;

-- The bootstrap keeps its name and signature for existing callers. Its steps are now separate:
--   identity      designate the operating organization once, or confirm it is this one;
--   entitlement   assign the non-billable internal Plan only when no base Plan is current;
--   role          reuse or create the founding role with the canonical capabilities;
--   membership    create or repair the caller's own membership.
-- Platform authority is checked first and is never written here.
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
  v_operating uuid;
  v_designated boolean := false;
  v_plan_assigned boolean := false;
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

  -- Locked so two concurrent first bootstraps cannot both see an unset identity.
  select ps.operating_organization_id into v_operating
    from public.platform_settings ps
   where ps.singleton
     for update;

  if not found then
    raise exception 'platform_settings has no singleton row' using errcode = '55000';
  end if;

  if v_operating is not null and v_operating <> p_organization_id then
    raise exception 'another organization is already the GildOps operating organization'
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

  if v_operating is null then
    -- A business already on another base Plan is a customer, not an empty organization made for
    -- GildOps. Refuse rather than make it GildOps permanently by mistake.
    if v_current_plan is not null and v_current_plan <> v_plan then
      raise exception 'target organization already has a conflicting current base Plan'
        using errcode = '23P01';
    end if;

    update public.platform_settings
       set operating_organization_id = p_organization_id
     where singleton;
    v_designated := true;
  end if;

  -- Once designated, the operating organization's Plan is commercial state owned by
  -- platform.commercial operations. A Plan already in place is left alone.
  if v_current_plan is null then
    insert into public.organization_plan_assignments
      (organization_id, plan_id, plan_kind, period_start, period_end, assigned_by, note)
    values
      (p_organization_id, v_plan, 'plan', current_date, '9999-12-31'::date, v_actor,
       'GildOps operating organization bootstrap');
    v_plan_assigned := true;
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

  select coalesce(nullif(btrim(u.email), ''), 'GildOps staff') into v_display_name
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
     jsonb_build_object(
       'membership_id', v_membership,
       'role_id', v_role,
       'operating_organization_designated', v_designated,
       'plan_id', case when v_plan_assigned then v_plan end
     ));

  return v_membership;
end;
$fn$;

comment on function public.bootstrap_gold_internal_workspace(uuid, text, text[]) is
  'Platform-staff door (platform.organizations and platform.commercial) that designates GildOps'' operating organization once, or confirms it, then assigns the non-billable internal Plan only when no base Plan is current and creates or repairs the caller''s own membership with the canonical founding capabilities. Refuses any other organization once one is designated.';

revoke all on function public.bootstrap_gold_internal_workspace(uuid, text, text[]) from public, anon;
grant execute on function public.bootstrap_gold_internal_workspace(uuid, text, text[]) to authenticated;

commit;

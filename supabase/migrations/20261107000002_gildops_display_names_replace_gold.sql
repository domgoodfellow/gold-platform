-- GildOps is the product's name. Display values still carrying the old name "GOLD" are renamed;
-- keys and ids are unchanged (`gold_internal`, `platform`, function names), so nothing that
-- refers to them moves. Work Order 4, Part E.

-- The operating organization's fallback role.
update public.roles r
   set name = 'GildOps Admin'
 where r.name = 'GOLD Internal Admin'
   and not exists (
     select 1 from public.roles other
      where other.organization_id = r.organization_id
        and lower(other.name) = lower('GildOps Admin')
   );

-- Plan labels and descriptions.
update public.platform_plans set label = 'GildOps Internal' where label = 'GOLD Internal';
update public.platform_plans set label = 'GildOps Platform' where label = 'GOLD Platform';
update public.platform_plans
   set description = replace(replace(description, 'GOLD''s', 'GildOps'''), 'GOLD ', 'GildOps ')
 where description like '%GOLD%' and key in ('gold_internal', 'platform');

-- The old default website title, wherever a revision still stores it.
update public.public_site_revisions
   set pages = replace(pages::text, 'GOLD | One operating system for your business', 'GildOps')::jsonb
 where pages::text like '%GOLD | One operating system for your business%';

-- The bootstrap names the role it creates "GildOps Admin" from now on.
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
         and lower(name) = lower('GildOps Admin')
       limit 1;

      if v_existing_internal_role is not null then
        raise exception 'A GildOps Admin role already exists with different permissions.'
          using errcode = '23505';
      end if;

      insert into public.roles (organization_id, name, capabilities, created_by)
      values (p_organization_id, 'GildOps Admin', v_capabilities, v_actor)
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


-- The default GildOps homepage text, in the plain words of docs/ui-system.md → Words we use, and
-- without claims the product does not support today (self-configuring, independently sold
-- products). Only what a new homepage starts from changes; an already-published homepage keeps
-- its own copy.
CREATE OR REPLACE FUNCTION app.default_gold_homepage_sections()
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select $json$[
    {"kind":"hero","eyebrow":"One system, not six","heading":"Run your business from one connected system.","body":"GildOps brings your sales, customers, communication, scheduling, work, automation, payments and reporting together.","primaryCta":{"label":"Request a demo","href":"/demo"},"secondaryCta":{"label":"See how GildOps works","href":"#how-it-works"}},
    {"kind":"problem","heading":"The problem isn’t one bad tool. It’s the gap between all of them.","paragraphs":["Customer details live in one place. Calls and texts happen somewhere else. Jobs get tracked in a spreadsheet, and nobody has one view of what a customer is waiting on.","GildOps keeps that information together, so the next call, quote or job starts from the full picture instead of another round of asking the customer to repeat themselves."]},
    {"kind":"capabilities","eyebrow":"Three ways in","heading":"Pick where GildOps helps first.","body":"Start with what your business needs now, and add more later.","items":[{"title":"Sales","body":"Turn leads into customers without losing the conversation."},{"title":"Operations","body":"Know what needs to happen, who is doing it, and what happens next."},{"title":"Customer Service","body":"Give customers one conversation with your business."}]},
    {"kind":"process","eyebrow":"How it works","heading":"You review every step before it goes live.","items":[{"step":"01","title":"See how you work today","body":"A short conversation about the tools you use now and where they fall short."},{"step":"02","title":"Set up your workspace","body":"Your services, pricing, hours and roles get set up — not a template, your operation."},{"step":"03","title":"Review and launch","body":"Test the real workflows with your team, then launch only when you’re ready."},{"step":"04","title":"Improve over time","body":"Turn on more of GildOps as the business needs it, without starting over."}]},
    {"kind":"trust","eyebrow":"Why GildOps","heading":"Built so you can trust what it does.","items":[{"title":"Your data stays yours","body":"Every business’s records stay separate, from the screen through the database."},{"title":"A person stays in the loop","body":"AI can draft and assist; it does not act or publish on its own."},{"title":"Set up for you, not a template","body":"Your work types, pricing and roles reflect how you actually run — no fork to maintain."},{"title":"You decide when to launch","body":"Nothing goes live for your business until you’ve reviewed it."}]},
    {"kind":"cta","heading":"Run your business from one connected system.","body":"Request a demo and we’ll show you where GildOps fits — starting with the parts your business needs most.","primaryCta":{"label":"Request a demo","href":"/demo"},"secondaryCta":{"label":"Prefer to explore independently? Create an account.","href":"/sign-up"}}
  ]$json$::jsonb;
$function$;

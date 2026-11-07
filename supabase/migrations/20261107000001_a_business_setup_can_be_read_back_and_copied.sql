-- A business's setup can be read back out, copied into another business, and saved as a template.
--
-- 1. `organization_identity.serves`: who the business serves (people, companies or both). It sits
--    beside `industry` because it is the same kind of fact: something the business says about
--    itself, private to its members, changed under `organization.manage`. It is written by
--    `set_business_serves` from the Business information step and by applying a setup.
-- 2. `read_business_setup`: the one reader of a business's setup, as rows. It reads setup tables
--    only — kinds of work, stages, moves, steps, needs, booking, fields, roles, opening hours,
--    wording, who it serves, brand, customer forms and rules — and never customers, jobs, invoices,
--    payments, phone numbers, connections or the public address. The application turns the rows
--    into a `BusinessShape`. A person who manages the business may read it; so may platform staff
--    holding `platform.catalogue`, who save a business as a starting template.
-- 3. A draft copied from another business: `configuration_proposals.origin = 'copied'`, with
--    `copied_from` naming the business it came from. Only somebody who manages both may write one.

-- ---------------------------------------------------------------------------
-- 1. Who a business serves
-- ---------------------------------------------------------------------------

alter table public.organization_identity
  add column serves text check (serves is null or serves in ('people', 'companies', 'both'));

comment on column public.organization_identity.serves is
  'Who the business serves: people, companies or both. Null until the business says.';

-- Writes to this table are granted column by column; row security still requires organization.manage.
grant update (serves) on public.organization_identity to authenticated;

create function public.set_business_serves(p_organization_id uuid, p_serves text)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then
    raise exception 'set_business_serves requires an authenticated caller' using errcode = '42501';
  end if;

  -- Row security decides who may write (organization.manage), exactly as for the rest of the identity.
  insert into public.organization_identity as i (organization_id, serves, updated_by)
  values (p_organization_id, p_serves, v_actor)
  on conflict (organization_id) do update
    set serves = excluded.serves, updated_at = now(), updated_by = excluded.updated_by
  where i.organization_id in (select app.current_tenant_ids())
    and i.serves is distinct from excluded.serves;
end;
$fn$;

revoke all on function public.set_business_serves(uuid, text) from public, anon;
grant execute on function public.set_business_serves(uuid, text) to authenticated;

-- The three published templates say who they serve.
update public.industry_templates set shape = shape || '{"serves": "companies"}'::jsonb where key = 'answering_service';
update public.industry_templates set shape = shape || '{"serves": "both"}'::jsonb where key = 'rental_field_service';
update public.industry_templates set shape = shape || '{"serves": "people"}'::jsonb where key = 'appointment_clinic';

-- ---------------------------------------------------------------------------
-- 2. The reader
-- ---------------------------------------------------------------------------

create function public.read_business_setup(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_founding_role uuid;
begin
  if (select auth.uid()) is null
     or not (
       (p_organization_id in (select app.current_tenant_ids())
        and app.has_capability(p_organization_id, 'organization.manage'))
       or app.has_platform_capability('platform.catalogue')
     ) then
    raise exception 'you may not read this business''s setup' using errcode = '42501';
  end if;

  -- Every business already has the role it was founded with; a copy keeps its own.
  select r.id into v_founding_role
    from public.roles r where r.organization_id = p_organization_id
   order by r.created_at, r.id limit 1;

  return jsonb_build_object(
    'industry', (select i.industry from public.organization_identity i where i.organization_id = p_organization_id),
    'serves', (select i.serves from public.organization_identity i where i.organization_id = p_organization_id),
    'types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', t.name,
        'schedulable', t.schedulable,
        'booking', case when t.booking_status_id is null then null else jsonb_build_object(
          'status_id', t.booking_status_id,
          'duration_minutes', t.booking_duration_minutes,
          'cadence_minutes', t.booking_cadence_minutes,
          'minimum_notice_minutes', t.booking_minimum_notice_minutes,
          'horizon_days', t.booking_horizon_days,
          'allow_same_day', t.booking_allow_same_day,
          'reschedule_cutoff_minutes', t.booking_reschedule_cutoff_minutes,
          'cancel_cutoff_minutes', t.booking_cancel_cutoff_minutes,
          'cancellation_status_id', t.booking_cancellation_status_id) end,
        'stages', coalesce((
          select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name,
                   'releases_resource', s.releases_resource, 'marks_complete', s.marks_complete) order by s.position, s.created_at)
            from public.work_item_statuses s where s.type_id = t.id), '[]'::jsonb),
        'transitions', coalesce((
          select jsonb_agg(jsonb_build_object('from', m.from_status_id, 'to', m.to_status_id))
            from public.work_item_transitions m where m.type_id = t.id), '[]'::jsonb),
        'checklist', coalesce((
          select jsonb_agg(c.label order by c.position, c.created_at)
            from public.work_item_type_checklist_items c where c.type_id = t.id), '[]'::jsonb),
        'requirements', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'resource_class', q.resource_class, 'quantity', q.quantity,
                   'capabilities', coalesce((
                     select jsonb_agg(rc.name order by rc.name)
                       from public.work_item_type_resource_requirement_capabilities qc
                       join public.resource_capabilities rc on rc.id = qc.capability_id
                      where qc.requirement_id = q.id), '[]'::jsonb)) order by q.position, q.created_at)
            from public.work_item_type_resource_requirements q where q.type_id = t.id), '[]'::jsonb)
      ) order by t.name, t.created_at)
      from public.work_item_types t where t.organization_id = p_organization_id), '[]'::jsonb),
    'fields', coalesce((
      select jsonb_agg(jsonb_build_object('entity', f.entity_type, 'key', f.key, 'label', f.label, 'kind', f.kind,
               'required', f.required, 'options', f.options) order by f.entity_type, f.position, f.created_at)
        from public.field_definitions f where f.organization_id = p_organization_id), '[]'::jsonb),
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object('name', r.name, 'capabilities', r.capabilities) order by r.created_at, r.id)
        from public.roles r where r.organization_id = p_organization_id and r.id is distinct from v_founding_role), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object('day_of_week', h.day_of_week,
               'opens_at', to_char(h.opens_at, 'HH24:MI'), 'closes_at', to_char(h.closes_at, 'HH24:MI'))
               order by h.day_of_week, h.opens_at)
        from public.operating_hours h where h.organization_id = p_organization_id), '[]'::jsonb),
    'wording', (
      select jsonb_build_object('nouns', p.nouns, 'labels', p.labels, 'navigation', p.navigation)
        from public.organization_business_profiles p where p.organization_id = p_organization_id),
    'brand', (
      select jsonb_build_object('accent', b.accent, 'heading_font', b.heading_font, 'body_font', b.body_font)
        from public.brand_settings b where b.organization_id = p_organization_id),
    -- Only a customer form started from a form template can be described; one built from scratch stays behind.
    'portal_forms', coalesce((
      select jsonb_agg(jsonb_build_object('template', f.created_from_template_key, 'name', f.name) order by f.created_at, f.id)
        from public.portal_forms pf
        join public.forms f on f.id = pf.form_id and f.organization_id = pf.organization_id
       where pf.organization_id = p_organization_id
         and f.archived_at is null and f.created_from_template_key is not null), '[]'::jsonb),
    -- Only the rule a setup can describe: on an event, move the job to a stage.
    'automations', coalesce((
      select jsonb_agg(jsonb_build_object('name', a.name, 'on', a.trigger_event_action, 'status_id', x.status_id) order by a.created_at, a.id)
        from public.automation_rules a
        join public.automation_actions x on x.rule_id = a.id and x.action_kind = 'change_status' and x.status_id is not null
       where a.organization_id = p_organization_id and a.trigger_kind = 'event' and a.enabled
         and (select count(*) from public.automation_actions y where y.rule_id = a.id) = 1), '[]'::jsonb)
  );
end;
$fn$;

revoke all on function public.read_business_setup(uuid) from public, anon;
grant execute on function public.read_business_setup(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A draft copied from another business
-- ---------------------------------------------------------------------------

alter table public.configuration_proposals drop constraint configuration_proposals_origin_check;
alter table public.configuration_proposals
  add constraint configuration_proposals_origin_check
    check (origin in ('drafted', 'template', 'provisioned', 'agreed', 'copied')),
  -- Plain uuid, not a foreign key, for the same reason as `template_key`: a proposal references
  -- only its business and its author (`proposals.test.ts`). The insert policy checks it.
  add column copied_from uuid,
  add constraint configuration_proposals_copied_from_check
    check ((origin = 'copied') = (copied_from is not null) and copied_from is distinct from organization_id);

comment on column public.configuration_proposals.copied_from is
  'For a draft copied from another business (origin copied), that business. Written once.';

drop policy configuration_proposals_insert on public.configuration_proposals;
create policy configuration_proposals_insert on public.configuration_proposals
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and created_by = (select auth.uid())
    and app.has_capability(organization_id, 'configuration.propose')
    and origin in ('drafted', 'template', 'copied')
    and deferred_at is null
    and (template_key is null
         or exists (select 1 from public.industry_templates t where t.key = template_key and t.published))
    -- A copy names a business its author manages.
    and (copied_from is null
         or (copied_from in (select app.current_tenant_ids())
             and app.has_capability(copied_from, 'organization.manage')))
  );

-- A retried copy still says where it was copied from (recreated from `20261106000001`).
create or replace function public.retry_configuration_proposal(p_proposal_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor    uuid := (select auth.uid());
  v_proposal public.configuration_proposals;
  v_id       uuid;
begin
  select * into v_proposal from public.configuration_proposals where id = p_proposal_id;
  if v_actor is null or v_proposal.id is null
     or v_proposal.organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(v_proposal.organization_id, 'configuration.propose') then
    raise exception 'you may not set up this business' using errcode = '42501';
  end if;
  if v_proposal.outcome <> 'failed' then
    raise exception 'only a setup that stopped part-way can be tried again' using errcode = '55000';
  end if;

  insert into public.configuration_proposals
    (organization_id, description, shape, gaps, drafted_by, created_by, template_key, origin, copied_from)
  values
    (v_proposal.organization_id, v_proposal.description, v_proposal.shape, v_proposal.gaps,
     v_proposal.drafted_by, v_actor, v_proposal.template_key, v_proposal.origin, v_proposal.copied_from)
  returning id into v_id;

  return v_id;
end;
$fn$;

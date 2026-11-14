-- Contacts: who may view them, and how one is removed.
--
-- `customer.read` makes viewing contacts a permission of its own, enforced by row security on the
-- contact tables and checked by every function that names contacts outside it. `customer.delete`
-- governs taking a contact out of the business: archive (kept, hidden from working lists, can be
-- restored) or, only when nothing the business must keep refers to it, permanent deletion.
-- Taking a contact off the call list (`call_list.remove`) is a different thing and stays so.

-- 1. The permissions. Until now membership alone showed every contact, so every existing role
--    receives `customer.read`. Deleting contacts is new destructive authority, so only unrestricted
--    administrators (roles holding every existing permission) receive `customer.delete`; changing
--    business settings alone does not imply it, and every other role is granted it explicitly.
create function pg_temp.add_capabilities(p_add text[], p_to_every_role text[], p_to_unrestricted text[]) returns void
language plpgsql as $$
declare v_constraint text; v_before text[]; v_after text[];
begin
  select pg_get_constraintdef(oid) into v_constraint from pg_constraint
    where conrelid = 'public.roles'::regclass and conname = 'roles_capabilities_known';
  select array_agg(distinct m[1]) into v_before from regexp_matches(v_constraint, '''([^'']+)''::text', 'g') m;
  v_after := v_before || array(select c from unnest(p_add) c where not c = any(v_before));
  alter table public.roles drop constraint roles_capabilities_known;
  execute format('alter table public.roles add constraint roles_capabilities_known check (capabilities <@ array[%s]::text[])',
    (select string_agg(quote_literal(c), ',' order by c) from unnest(v_after) c));
  -- These updates only add permissions, so they cannot leave a business without someone who
  -- manages roles. The guard for that is set aside for them alone, because it refuses any change
  -- in a business that already has nobody holding `role.manage`. This runs as one statement:
  -- if anything fails, the guard's suspension is undone with everything else, and no other
  -- session ever sees the guard off.
  alter table public.roles disable trigger roles_capabilities_update_guard;
  update public.roles set capabilities = capabilities || array(select c from unnest(p_to_every_role) c where not c = any(capabilities))
    where not capabilities @> p_to_every_role;
  -- An unrestricted administrator is a role holding every permission that existed before this
  -- migration: the founding role (provisioned with all of them) and copies of it. A role someone
  -- deliberately restricted, even slightly, does not gain a new destructive permission.
  update public.roles set capabilities = capabilities || array(select c from unnest(p_to_unrestricted) c where not c = any(capabilities))
    where capabilities @> v_before and not capabilities @> p_to_unrestricted;
  alter table public.roles enable trigger roles_capabilities_update_guard;
  if (select tgenabled from pg_trigger where tgrelid = 'public.roles'::regclass and tgname = 'roles_capabilities_update_guard') <> 'O' then
    raise exception 'roles_capabilities_update_guard was not restored';
  end if;
end $$;
select pg_temp.add_capabilities(array['customer.read', 'customer.delete'], array['customer.read'], array['customer.delete']);
drop function pg_temp.add_capabilities(text[], text[], text[]);
-- Industry templates carry copies of roles; a role made from one could see contacts until now, so
-- each template role gains `customer.read` too (the role presets in code changed the same way).
update public.industry_templates t
   set shape = jsonb_set(t.shape, '{roles}', (
     select jsonb_agg(case when r->'capabilities' ? 'customer.read' then r
                           else jsonb_set(r, '{capabilities}', jsonb_build_array('customer.read') || coalesce(r->'capabilities', '[]'::jsonb)) end
                      order by position)
       from jsonb_array_elements(t.shape->'roles') with ordinality as e(r, position)))
 where jsonb_typeof(t.shape->'roles') = 'array'
   and exists (select 1 from jsonb_array_elements(t.shape->'roles') r where not coalesce(r->'capabilities' ? 'customer.read', false));

-- Setups not yet applied carry roles too. A draft, or a failed setup (retrying copies its roles
-- into a new draft), would otherwise create roles that cannot view contacts. Each one changed is
-- logged under the data migration account (20261113000001). A setup being applied is locked
-- against edits and is left as it is; the preflight lists any.
with updated as (
  update public.configuration_proposals p
     set shape = jsonb_set(p.shape, '{roles}', (
       select jsonb_agg(case when r->'capabilities' ? 'customer.read' then r
                             else jsonb_set(r, '{capabilities}', jsonb_build_array('customer.read') || coalesce(r->'capabilities', '[]'::jsonb)) end
                        order by position)
         from jsonb_array_elements(p.shape->'roles') with ordinality as e(r, position)))
   where p.outcome in ('draft', 'failed')
     and jsonb_typeof(p.shape->'roles') = 'array'
     and exists (select 1 from jsonb_array_elements(p.shape->'roles') r where not coalesce(r->'capabilities' ? 'customer.read', false))
  returning p.id, p.organization_id, p.outcome
)
insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  select organization_id, '00000000-0000-4000-8000-0000000000a3', 'configuration_proposal', id, 'configuration_proposal.roles_updated',
         jsonb_build_object('added', 'customer.read', 'outcome', outcome, 'recorded_by', 'migration',
           'migration', '20261113000002_contact_read_and_removal')
    from updated;

-- 2. The organizations where the caller's role holds a permission. A row policy written as
--    `organization_id in (select app.tenant_ids_with(...))` evaluates this once per statement.
create function app.tenant_ids_with(p_capability text) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.organization_id
    from public.memberships m
    join public.roles r on r.id = m.role_id
   where m.user_id = (select auth.uid())
     and p_capability = any (r.capabilities);
$$;
revoke all on function app.tenant_ids_with(text) from public, anon;
grant execute on function app.tenant_ids_with(text) to authenticated;

-- 3. Viewing contacts needs `customer.read`. A record of another workspace that refers to a contact
--    (an opportunity, a task, a job, an invoice) stays readable as before; only the contact behind
--    the reference is withheld. The customer portal's own policy is unchanged.
alter policy customers_select on public.contacts
  using (organization_id in (select app.tenant_ids_with('customer.read')));
alter policy contact_people_read on public.contact_people
  using (organization_id in (select app.tenant_ids_with('customer.read')));
alter policy contact_companies_read on public.contact_companies
  using (organization_id in (select app.tenant_ids_with('customer.read')));
alter policy contact_affiliations_read on public.contact_affiliations
  using (organization_id in (select app.tenant_ids_with('customer.read')));
alter policy customer_locations_select on public.customer_locations
  using (organization_id in (select app.tenant_ids_with('customer.read')));
-- Contact history (added, changed, imported, archived, calls logged against them) carries names
-- and details, so it follows the same permission. Every other event is unchanged.
alter policy events_select on public.events
  using (organization_id in (select app.current_tenant_ids())
    and (entity_type <> 'customer' or organization_id in (select app.tenant_ids_with('customer.read'))));

-- 4. Lookups that name contacts outside row security. Suggesting which contact a conversation or a
--    form response belongs to is browsing contacts, so without `customer.read` they suggest none.
create or replace function public.conversation_customer_candidates(p_organization_id uuid, p_conversation_id uuid)
returns table(customer_id uuid, name text, email text, phone text)
language plpgsql stable security definer set search_path = '' as $$
declare v public.conversations;
begin
  if p_organization_id not in (select app.current_tenant_ids()) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  if not app.has_capability(p_organization_id, 'customer.read') then return; end if;
  select * into v from public.conversations where organization_id = p_organization_id and id = p_conversation_id;
  if not found then return; end if;
  return query
    select c.id, c.name, c.email, c.phone
      from app.contact_matches(p_organization_id,
             case v.channel when 'sms' then 'phone' else 'email' end,
             case v.channel when 'sms' then v.external_number else v.external_email end) m
      join public.contacts c on c.organization_id = p_organization_id and c.id = m
     order by c.name, c.id;
end $$;

create or replace function public.form_submission_customer_candidates(p_organization_id uuid, p_submission_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_answers jsonb; v_definition jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  if not app.has_capability(p_organization_id, 'customer.read') then return '[]'::jsonb; end if;
  select s.answers, r.definition into v_answers, v_definition
    from public.form_submissions s
    join public.form_revisions r on r.organization_id = s.organization_id and r.form_id = s.form_id and r.id = s.form_revision_id
   where s.organization_id = p_organization_id and s.id = p_submission_id;
  if v_answers is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone) order by c.name)
    from public.contacts c
    where c.organization_id = p_organization_id
      and c.id in (
        select app.contact_matches(p_organization_id, fld->>'type', v_answers->>(fld->>'id'))
          from jsonb_array_elements(v_definition->'fields') fld
         where fld->>'type' in ('email', 'phone') and v_answers ? (fld->>'id'))
  ), '[]'::jsonb);
end;
$$;

-- 5. The Dialer's disclosure. Whoever places calls sees the name, email and phone number of the
--    contacts on the call list (contacts with an open Call task), and nothing else of the
--    directory: no other contact, no notes, fields or history. Whether the contact is archived is
--    included, so an archived contact's open call stays visible and marked rather than hidden.
--    `dialer_contact_candidates` stays the matching disclosure for a number the caller already has.
create function public.call_list_contacts(p_organization_id uuid, p_customer_ids uuid[])
returns table(id uuid, name text, email text, phone text, archived boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.has_capability(p_organization_id, 'call.place') or app.has_capability(p_organization_id, 'customer.read')) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  return query
    select c.id, c.name, c.email, c.phone, c.archived_at is not null
      from public.contacts c
     where c.organization_id = p_organization_id
       and c.id = any (p_customer_ids[1:100])
       and exists (select 1 from public.crm_tasks t
                    where t.organization_id = c.organization_id and t.customer_id = c.id
                      and t.status = 'open' and t.kind = 'call');
end $$;
revoke all on function public.call_list_contacts(uuid, uuid[]) from public, anon;
grant execute on function public.call_list_contacts(uuid, uuid[]) to authenticated;

-- 6. Archive. An archived contact keeps its id and every record that refers to it; it leaves the
--    directory's default view, contact pickers and working counts, and can be restored. Only the
--    functions below set these columns (no column grant).
alter table public.contacts
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id),
  add constraint contacts_archive_attributed check ((archived_at is null) = (archived_by is null));

create or replace view public.contact_directory with (security_invoker = true) as
  select c.id, c.organization_id, c.name, c.email, c.phone, c.created_at, c.created_by, c.custom, c.stage_id,
         c.lifecycle, c.lead_temperature, c.contact_type,
         coalesce(a.company_id, case when c.contact_type = 'company' then c.id end) as directory_company_id,
         coalesce(a.company_name, case when c.contact_type = 'company' then c.name end) as directory_company_name,
         coalesce(a.company_name, c.name) as company_sort,
         c.archived_at
    from public.contacts c
    left join lateral (
      select af.company_id, company.name as company_name
        from public.contact_affiliations af
        join public.contacts company on company.organization_id = af.organization_id and company.id = af.company_id
       where af.organization_id = c.organization_id and af.person_id = c.id and af.active
       order by af.is_primary desc, company.name, af.company_id
       limit 1) a on true;

-- What refers to a contact and must be kept, by kind; empty when deleting it loses nothing the
-- business is required to keep. Event history is kept either way and never blocks. Every table
-- with a foreign key to contacts appears here except three that deleting handles itself: the
-- contact's own person/company details (removed with it), its location links (removed, and a
-- place nothing else uses is removed too) and import provenance (kept as evidence without the
-- person's values; see `app.release_contact_import_provenance`). The contact-removal database
-- test fails when a new reference is added without a decision.
create function app.contact_retained_records(p_organization_id uuid, p_contact_id uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    case when exists (select 1 from public.opportunities x where x.organization_id = p_organization_id
                        and (x.customer_id = p_contact_id or x.primary_person_id = p_contact_id)) then 'opportunities' end,
    case when exists (select 1 from public.crm_tasks x where x.organization_id = p_organization_id and x.customer_id = p_contact_id) then 'tasks' end,
    case when exists (select 1 from public.calls x where x.organization_id = p_organization_id and x.customer_id = p_contact_id) then 'calls' end,
    case when exists (select 1 from public.conversations x where x.organization_id = p_organization_id and x.customer_id = p_contact_id)
           or exists (select 1 from public.communication_threads x where x.organization_id = p_organization_id and x.customer_id = p_contact_id) then 'conversations' end,
    case when exists (select 1 from public.invoices x where x.organization_id = p_organization_id and x.customer_id = p_contact_id)
           or exists (select 1 from public.customer_commercial_proposals x where x.organization_id = p_organization_id and x.customer_id = p_contact_id)
           or exists (select 1 from public.customer_proposal_invites x where x.organization_id = p_organization_id and x.customer_id = p_contact_id)
           or exists (select 1 from public.customer_proposal_handoffs x where x.organization_id = p_organization_id and x.customer_id = p_contact_id) then 'finance' end,
    case when exists (select 1 from public.work_items x where x.organization_id = p_organization_id and x.customer_id = p_contact_id)
           or exists (select 1 from public.assets x where x.organization_id = p_organization_id and x.customer_id = p_contact_id) then 'work' end,
    case when exists (select 1 from public.support_cases x where x.organization_id = p_organization_id and x.customer_id = p_contact_id) then 'support' end,
    case when exists (select 1 from public.service_engagements x where x.organization_id = p_organization_id and x.customer_id = p_contact_id)
           or exists (select 1 from public.client_tenant_relationships x where x.organization_id = p_organization_id and x.customer_id = p_contact_id)
           or exists (select 1 from public.customer_notification_settings x where x.organization_id = p_organization_id and x.customer_id = p_contact_id)
           or exists (select 1 from public.customer_notification_recipients x where x.organization_id = p_organization_id and x.customer_id = p_contact_id)
           or exists (select 1 from app.notification_jobs x where x.organization_id = p_organization_id and x.customer_id = p_contact_id)
           or exists (select 1 from app.notification_challenges x where x.organization_id = p_organization_id and x.customer_id = p_contact_id) then 'services' end,
    case when exists (select 1 from public.external_actors x where x.organization_id = p_organization_id and x.customer_id = p_contact_id)
           or exists (select 1 from public.customer_portal_invites x where x.organization_id = p_organization_id and x.customer_id = p_contact_id) then 'portal' end,
    case when exists (select 1 from public.marketing_inquiries x where x.organization_id = p_organization_id and x.customer_id = p_contact_id)
           or exists (select 1 from public.form_submissions x where x.organization_id = p_organization_id and x.customer_id = p_contact_id) then 'forms' end,
    case when exists (select 1 from public.customer_discovery_snapshots x where x.organization_id = p_organization_id and x.customer_id = p_contact_id) then 'discovery' end,
    case when exists (select 1 from public.document_links x where x.organization_id = p_organization_id and x.customer_id = p_contact_id) then 'documents' end,
    case when exists (select 1 from public.contact_affiliations x where x.organization_id = p_organization_id
                        and (x.person_id = p_contact_id or x.company_id = p_contact_id)) then 'affiliations' end,
    case when exists (select 1 from public.report_definitions x where x.organization_id = p_organization_id and x.customer_id = p_contact_id) then 'reports' end
  ]::text[], null);
$$;
revoke all on function app.contact_retained_records(uuid, uuid) from public, anon, authenticated;

-- Whether a contact can be deleted, and if not which kinds of records keep it. Kinds only: no
-- counts, names or ids of records the person may not be able to read.
create function public.contact_removal_check(p_organization_id uuid, p_contact_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_archived timestamptz;
begin
  if not app.has_capability(p_organization_id, 'customer.delete') then
    raise exception 'Your role cannot archive or delete contacts.' using errcode = '42501';
  end if;
  select archived_at into v_archived from public.contacts where organization_id = p_organization_id and id = p_contact_id;
  if not found then raise exception 'This contact no longer exists.' using errcode = 'P0002'; end if;
  return jsonb_build_object('archived', v_archived is not null,
    'retained', to_jsonb(app.contact_retained_records(p_organization_id, p_contact_id)));
end $$;
revoke all on function public.contact_removal_check(uuid, uuid) from public, anon;
grant execute on function public.contact_removal_check(uuid, uuid) to authenticated;

create function public.archive_contact(p_organization_id uuid, p_contact_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := app.require_capability(p_organization_id, 'customer.delete'); v_contact public.contacts;
begin
  select * into v_contact from public.contacts where organization_id = p_organization_id and id = p_contact_id for update;
  if not found then raise exception 'This contact no longer exists.' using errcode = 'P0002'; end if;
  if v_contact.archived_at is not null then raise exception 'This contact is already archived.' using errcode = '22023'; end if;
  update public.contacts set archived_at = now(), archived_by = v_actor where organization_id = p_organization_id and id = p_contact_id;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'customer', p_contact_id, 'customer.archived', jsonb_build_object('name', v_contact.name));
end $$;
revoke all on function public.archive_contact(uuid, uuid) from public, anon;
grant execute on function public.archive_contact(uuid, uuid) to authenticated;

create function public.restore_contact(p_organization_id uuid, p_contact_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid := app.require_capability(p_organization_id, 'customer.delete'); v_contact public.contacts;
begin
  select * into v_contact from public.contacts where organization_id = p_organization_id and id = p_contact_id for update;
  if not found then raise exception 'This contact no longer exists.' using errcode = 'P0002'; end if;
  if v_contact.archived_at is null then raise exception 'This contact is not archived.' using errcode = '22023'; end if;
  update public.contacts set archived_at = null, archived_by = null where organization_id = p_organization_id and id = p_contact_id;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'customer', p_contact_id, 'customer.restored',
    jsonb_build_object('name', v_contact.name, 'archived_at', v_contact.archived_at, 'archived_by', v_contact.archived_by));
end $$;
revoke all on function public.restore_contact(uuid, uuid) from public, anon;
grant execute on function public.restore_contact(uuid, uuid) to authenticated;

-- Permanent deletion: only a contact nothing the business must keep refers to. The check and the
-- delete run under the contact's row lock, so a record attached a moment earlier still refuses
-- it, and any reference the check does not know about refuses it through its foreign key rather
-- than being cascaded away. Removed with the contact, in the same transaction: its location
-- links, each of its places that nothing else uses (checked against every reference to a
-- location, so no cascade reaches another record), and the person's values in import history,
-- whose source links stay as evidence so an import cannot quietly add them back. The event log
-- keeps who deleted whom and when, with the name only.
create function public.delete_contact(p_organization_id uuid, p_contact_id uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_actor uuid := app.require_capability(p_organization_id, 'customer.delete');
  v_contact public.contacts;
  v_retained text[];
  v_places uuid[];
  v_removed_places integer := 0;
  v_import_links integer;
begin
  select * into v_contact from public.contacts where organization_id = p_organization_id and id = p_contact_id for update;
  if not found then raise exception 'This contact no longer exists.' using errcode = 'P0002'; end if;
  v_retained := app.contact_retained_records(p_organization_id, p_contact_id);
  if cardinality(v_retained) > 0 then
    raise exception 'This contact has records that must be kept. Archive it instead.'
      using errcode = '23503', detail = array_to_string(v_retained, ',');
  end if;

  with gone as (
    delete from public.customer_locations where organization_id = p_organization_id and customer_id = p_contact_id returning location_id
  ) select coalesce(array_agg(distinct location_id), '{}') into v_places from gone;
  with removed as (
    delete from public.locations l
     where l.organization_id = p_organization_id and l.id = any (v_places)
       and not exists (select 1 from public.customer_locations x where x.organization_id = l.organization_id and x.location_id = l.id)
       and not exists (select 1 from public.work_items x where x.organization_id = l.organization_id and x.location_id = l.id)
       and not exists (select 1 from public.assets x where x.organization_id = l.organization_id and x.location_id = l.id)
       and not exists (select 1 from public.document_links x where x.organization_id = l.organization_id and x.location_id = l.id)
       and not exists (select 1 from public.external_readings x where x.organization_id = l.organization_id and x.location_id = l.id)
       and not exists (select 1 from public.report_definitions x where x.organization_id = l.organization_id and x.location_id = l.id)
       and not exists (select 1 from public.resources x where x.organization_id = l.organization_id and x.base_location_id = l.id)
       and not exists (select 1 from public.support_case_links x where x.organization_id = l.organization_id and x.location_id = l.id)
    returning 1
  ) select count(*) into v_removed_places from removed;

  -- Defined with the import tables (20261113000003): keeps each source link as evidence and clears
  -- the person's values from import history.
  v_import_links := app.release_contact_import_provenance(p_organization_id, p_contact_id);

  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'customer', p_contact_id, 'customer.deleted',
    jsonb_build_object('name', v_contact.name, 'contact_type', v_contact.contact_type,
      'created_at', v_contact.created_at, 'created_by', v_contact.created_by, 'archived_at', v_contact.archived_at,
      'location_links_removed', cardinality(v_places), 'places_removed', v_removed_places, 'import_links_kept', v_import_links));
  begin
    delete from public.contacts where organization_id = p_organization_id and id = p_contact_id;
  exception when foreign_key_violation then
    raise exception 'This contact has records that must be kept. Archive it instead.' using errcode = '23503';
  end;
end $$;
revoke all on function public.delete_contact(uuid, uuid) from public, anon;
grant execute on function public.delete_contact(uuid, uuid) to authenticated;

-- 7. Working counts and lists leave archived contacts out, like the directory.
create or replace function public.crm_relationship_overview(p_organization_id uuid)
returns jsonb language sql stable set search_path = '' as $function$
  select jsonb_build_object(
    'total', count(*),
    'people', count(*) filter (where c.contact_type = 'person'),
    'companies', count(*) filter (where c.contact_type = 'company'),
    'unspecified', count(*) filter (where c.contact_type = 'unspecified'),
    'newLast30Days', count(*) filter (where c.created_at >= now() - interval '30 days'),
    'lead', count(*) filter (where c.lifecycle = 'lead'),
    'prospect', count(*) filter (where c.lifecycle = 'prospect'),
    'customer', count(*) filter (where c.lifecycle = 'customer'),
    'unclassified', count(*) filter (where c.lifecycle is null))
  from public.contacts c where c.organization_id = p_organization_id and c.archived_at is null
$function$;

-- 8. Functions that name contacts to other workspaces: the dashboard count and the not-contacted list leave archived
--    contacts out; Marketing and form responses name a linked contact only to `customer.read`.
CREATE OR REPLACE FUNCTION public.crm_dashboard_summary(p_organization_id uuid, p_month date)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with settings as (select timezone from public.organizations where id = p_organization_id),
  open_deals as (select o.* from public.opportunities o join public.opportunity_stages s on s.organization_id=o.organization_id and s.id=o.stage_id
    where o.organization_id=p_organization_id and s.kind='open'),
  closes as (
    select distinct on(e.entity_id) e.entity_id,e.payload->>'stage_kind' as kind
    from public.events e, settings z where e.organization_id=p_organization_id and e.entity_type='opportunity'
      and e.action in ('opportunity.created','opportunity.stage_changed') and e.payload->>'stage_kind' in ('won','lost')
      and e.occurred_at >= (date_trunc('month',p_month::timestamp) at time zone z.timezone)
      and e.occurred_at < ((date_trunc('month',p_month::timestamp) + interval '1 month') at time zone z.timezone)
    order by e.entity_id,e.occurred_at desc,e.id desc
  )
  select jsonb_build_object(
    'customers',(select count(*) from public.contacts where organization_id=p_organization_id and archived_at is null),
    'open',(select count(*) from open_deals),
    'today',(select count(*) from public.crm_tasks f,settings z where f.organization_id=p_organization_id and f.status='open' and (f.due_at at time zone z.timezone)::date=(now() at time zone z.timezone)::date),
    'overdue',(select count(*) from public.crm_tasks where organization_id=p_organization_id and status='open' and due_at < now()),
    'noNext',(select count(*) from public.opportunity_worklist o join open_deals d on d.id=o.id where not o.has_future_follow_up),
    'unassigned',(select count(*) from open_deals where owner_membership_id is null),
    'forecast',coalesce((select jsonb_agg(t) from (select currency,sum(amount_minor)::text as amount_minor from open_deals
      where expected_close_on >= date_trunc('month',p_month::timestamp)::date and expected_close_on < (date_trunc('month',p_month::timestamp)+interval '1 month')::date and currency is not null group by currency) t),'[]'::jsonb),
    'pipeline',coalesce((select jsonb_agg(t) from (select currency,sum(amount_minor)::text as amount_minor from open_deals where currency is not null group by currency) t),'[]'::jsonb),
    'won',(select count(*) from closes where kind='won'), 'lost',(select count(*) from closes where kind='lost')
  )
$function$;

CREATE OR REPLACE FUNCTION public.customers_not_contacted(p_organization_id uuid, p_days integer DEFAULT 30)
 RETURNS TABLE(customer_id uuid, name text, email text, phone text, last_activity timestamp with time zone, last_activity_local text, time_zone text, days_since integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select c.id,
         c.name,
         c.email,
         c.phone,
         max(a.occurred_at),
         to_char(max(a.occurred_at) at time zone o.timezone, 'YYYY-MM-DD HH24:MI'),
         o.timezone,
         case
           when max(a.occurred_at) is not null
             then extract(day from now() - max(a.occurred_at))::integer
         end
    from public.contacts c
    join public.organizations o
      on o.id = c.organization_id
    left join public.customer_activity a
      on a.organization_id = c.organization_id
     and a.customer_id = c.id
   where c.organization_id = p_organization_id
     and c.archived_at is null
   group by c.id, c.name, c.email, c.phone, o.timezone
  having max(a.occurred_at) is null
      or max(a.occurred_at) < now() - make_interval(days => greatest(p_days, 0))
   order by max(a.occurred_at) asc nulls first;
$function$;

CREATE OR REPLACE FUNCTION public.marketing_read(p_organization_id uuid, p_view text, p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb; since timestamptz; until_at timestamptz; page_no integer; search text; selected uuid; zone text;
begin
  perform app.require_marketing(p_organization_id);
  select timezone into zone from public.organizations where id=p_organization_id;
  since:=coalesce(nullif(p_filters->>'from','')::date,(now() at time zone zone)::date-29)::timestamp at time zone zone;
  until_at:=(coalesce(nullif(p_filters->>'to','')::date,(now() at time zone zone)::date)+1)::timestamp at time zone zone;
  if until_at<since or until_at-since>interval '366 days' then raise exception 'Choose a period of up to one year'; end if;
  page_no:=greatest(1,least(100000,coalesce((p_filters->>'page')::integer,1)));
  search:=replace(replace(coalesce(p_filters->>'q',''),'%',''),'_','');
  selected:=nullif(p_filters->>'campaign','')::uuid;
  if p_view='inquiry' then
    select to_jsonb(i)||jsonb_build_object('answers',s.answers,'definition',r.definition,'customer_name',case when app.has_capability(p_organization_id,'customer.read') then cu.name end)
      into result from public.marketing_inquiries i
      join public.form_submissions s on (s.organization_id,s.id)=(i.organization_id,i.submission_id)
      join public.form_revisions r on (r.organization_id,r.form_id,r.id)=(s.organization_id,s.form_id,s.form_revision_id)
      left join public.contacts cu on (cu.organization_id,cu.id)=(i.organization_id,i.customer_id)
      where i.organization_id=p_organization_id and i.id=(p_filters->>'id')::uuid;
    return result;
  elsif p_view='audience' then
    select jsonb_build_object('total',count(*),'customers',case when not app.has_capability(p_organization_id,'customer.read') then '[]'::jsonb else (select coalesce(jsonb_agg(x),'[]') from
      (select cu.id,cu.name,cu.created_at from public.contacts cu join public.marketing_audiences a on a.organization_id=cu.organization_id
       where a.organization_id=p_organization_id and a.id=(p_filters->>'id')::uuid
       and cu.archived_at is null and (a.stage_id is null or cu.stage_id=a.stage_id) and (a.created_from is null or cu.created_at>=a.created_from)
       and (a.created_before is null or cu.created_at<a.created_before+interval '1 day') order by cu.name,cu.id limit 25) x) end)
    into result from public.contacts cu join public.marketing_audiences a on a.organization_id=cu.organization_id
      where a.organization_id=p_organization_id and a.id=(p_filters->>'id')::uuid
      and cu.archived_at is null and (a.stage_id is null or cu.stage_id=a.stage_id) and (a.created_from is null or cu.created_at>=a.created_from)
      and (a.created_before is null or cu.created_at<a.created_before+interval '1 day');
    return result;
  elsif p_view='customers' then
    perform app.require_capability(p_organization_id,'customer.read');
    return (select coalesce(jsonb_agg(x),'[]') from (select id,name,email,phone from public.contacts where organization_id=p_organization_id and archived_at is null
      and (name ilike '%'||search||'%' or email ilike '%'||search||'%') order by name,id limit 25) x);
  end if;
  with campaigns as (
    select c.*,m.display_name owner_name,
      (select jsonb_build_object('name',page->>'name','slug',case when (page->>'isHome')::boolean then '' else page->>'slug' end) from public.public_sites s join public.public_site_revisions r on (r.organization_id,r.site_id,r.id)=(s.organization_id,s.id,s.current_published_revision_id), lateral jsonb_array_elements(r.pages) page where s.organization_id=c.organization_id and s.id=c.landing_site_id and page->>'id'=c.landing_page_id::text) landing_page,
      (select count(*) from public.marketing_inquiries i where i.organization_id=c.organization_id and i.campaign_id=c.id and i.occurred_at>=since and i.occurred_at<until_at) leads,
      (select count(*) from public.marketing_inquiries i where i.organization_id=c.organization_id and i.campaign_id=c.id and i.occurred_at>=since and i.occurred_at<until_at and i.status='handed_off') handoffs,
      (select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name)),'[]') from public.marketing_campaign_audiences ca join public.marketing_audiences a on (a.organization_id,a.id)=(ca.organization_id,ca.audience_id) where ca.organization_id=c.organization_id and ca.campaign_id=c.id) audiences,
      (select coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'public_key',f.public_key,'published',f.current_published_revision_id is not null and f.archived_at is null,'token',cf.token)),'[]') from public.marketing_campaign_forms cf join public.forms f on (f.organization_id,f.id)=(cf.organization_id,cf.form_id) where cf.organization_id=c.organization_id and cf.campaign_id=c.id) forms
    from public.marketing_campaigns c left join public.memberships m on (m.organization_id,m.id)=(c.organization_id,c.owner_membership_id)
    where c.organization_id=p_organization_id
      and (search='' or c.name ilike '%'||search||'%') and (selected is null or c.id=selected)
      and (coalesce(p_filters->>'status','')='' or p_view<>'campaigns' or c.status=p_filters->>'status')
      and (coalesce(p_filters->>'objective','')='' or c.objective=p_filters->>'objective')
      and (coalesce(p_filters->>'owner','')='' or c.owner_membership_id=(p_filters->>'owner')::uuid)
      and (coalesce(p_filters->>'attention','')<>'ending' or c.status='active' and c.planned_end_on<=(now() at time zone (select timezone from public.organizations where id=p_organization_id))::date+7)
      and (coalesce(p_filters->>'attention','')<>'setup' or c.status<>'archived' and c.objective in ('lead_generation','engagement') and not exists(select 1 from public.marketing_campaign_forms cf where cf.organization_id=c.organization_id and cf.campaign_id=c.id))
  ), inquiries as (
    select i.*,case when app.has_capability(p_organization_id,'customer.read') then cu.name end customer_name from public.marketing_inquiries i left join public.contacts cu on (cu.organization_id,cu.id)=(i.organization_id,i.customer_id)
    where i.organization_id=p_organization_id
      and (case when p_filters->>'handoff'='true' then i.handed_off_at else i.occurred_at end)>=since
      and (case when p_filters->>'handoff'='true' then i.handed_off_at else i.occurred_at end)<until_at
      and (selected is null or i.campaign_id=selected)
      and (search='' or i.form_name_at_capture ilike '%'||search||'%' or i.campaign_name_at_capture ilike '%'||search||'%' or i.id::text ilike '%'||search||'%')
      and (p_view<>'leads' or coalesce(p_filters->>'status','')='' or i.status=p_filters->>'status')
      and (coalesce(p_filters->>'review','')<>'awaiting' or i.status in ('new','in_review'))
      and (coalesce(p_filters->>'source','')='' or coalesce(i.source_context->>'utm_source',i.source)=p_filters->>'source')
      and (coalesce(p_filters->>'attributed','')<>'true' or i.campaign_id is not null)
  )
  select jsonb_build_object(
    'campaigns',(select coalesce(jsonb_agg(x),'[]') from (select * from campaigns order by created_at desc,id limit case when p_view='campaigns' then 25 else 8 end offset case when p_view='campaigns' then (page_no-1)*25 else 0 end) x),
    'campaign_total',(select count(*) from campaigns),
    'attention',jsonb_build_object(
      'active',(select coalesce(jsonb_agg(x),'[]') from (select * from campaigns where status='active' order by created_at desc,id limit 5) x),
      'setup',(select coalesce(jsonb_agg(x),'[]') from (select * from campaigns where status<>'archived' and objective in ('lead_generation','engagement') and jsonb_array_length(forms)=0 order by created_at desc,id limit 5) x),
      'ending',(select coalesce(jsonb_agg(x),'[]') from (select * from campaigns where status='active' and planned_end_on<=(now() at time zone (select timezone from public.organizations where id=p_organization_id))::date+7 order by planned_end_on,id limit 5) x),
      'new',(select coalesce(jsonb_agg(x),'[]') from (select * from inquiries where status='new' order by occurred_at desc,id limit 5) x),
      'in_review',(select coalesce(jsonb_agg(x),'[]') from (select * from inquiries where status='in_review' order by occurred_at desc,id limit 5) x)
    ),
    'inquiries',(select coalesce(jsonb_agg(x),'[]') from (select * from inquiries order by occurred_at desc,id limit case when p_view='leads' then 25 else 8 end offset case when p_view='leads' then (page_no-1)*25 else 0 end) x),
    'inquiry_total',(select count(*) from inquiries),
    'summary',(select jsonb_build_object(
      'active',(select count(*) from public.marketing_campaigns where organization_id=p_organization_id and status='active'),
      'active_in_period',(select count(*) from public.marketing_campaigns c where c.organization_id=p_organization_id and exists(select 1 from public.events e where e.organization_id=c.organization_id and e.entity_id=c.id and e.action='campaign.status' and e.payload->>'status'='active' and e.occurred_at<until_at and (e.occurred_at>=since or not exists(select 1 from public.events later where later.organization_id=e.organization_id and later.entity_id=e.entity_id and later.action='campaign.status' and later.occurred_at>e.occurred_at and later.occurred_at<since)))),
      'acquired',count(*),'attributed',count(*) filter(where campaign_id is not null),'cohort_handoffs',count(*) filter(where status='handed_off'),
      'handoffs',(select count(*) from public.marketing_inquiries where organization_id=p_organization_id and handed_off_at>=since and handed_off_at<until_at and (selected is null or campaign_id=selected)),
      'awaiting',count(*) filter(where status in ('new','in_review')),
      'submissions',(select count(*) from public.form_submissions s where s.organization_id=p_organization_id and s.submitted_at>=since and s.submitted_at<until_at and (selected is null or exists(select 1 from public.marketing_campaign_forms cf where cf.organization_id=s.organization_id and cf.form_id=s.form_id and cf.campaign_id=selected)))
    ) from inquiries),
    'audiences',(select coalesce(jsonb_agg(x),'[]') from (select a.*,st.name stage_name,(select count(*) from public.contacts cu where cu.organization_id=a.organization_id and cu.archived_at is null and (a.stage_id is null or cu.stage_id=a.stage_id) and (a.created_from is null or cu.created_at>=a.created_from) and (a.created_before is null or cu.created_at<a.created_before+interval '1 day')) matching from public.marketing_audiences a left join public.contact_relationship_stages st on (st.organization_id,st.id)=(a.organization_id,a.stage_id) where a.organization_id=p_organization_id and (p_view<>'audiences' or search='' or a.name ilike '%'||search||'%') order by a.created_at desc,a.id limit 25 offset case when p_view='audiences' then (page_no-1)*25 else 0 end) x),
    'audience_total',(select count(*) from public.marketing_audiences a where organization_id=p_organization_id and (search='' or a.name ilike '%'||search||'%')),
    'sources',(select coalesce(jsonb_agg(x),'[]') from (select coalesce(source_context->>'utm_source','Unknown / unattributed') source,coalesce(source_context->>'utm_medium','Unknown') medium,form_name_at_capture form,campaign_name_at_capture campaign,count(*) acquired,count(*) filter(where status='handed_off') handoffs from inquiries group by 1,2,3,4 order by count(*) desc limit 50) x),
    'trend',(select coalesce(jsonb_agg(x order by x.day),'[]') from (select (occurred_at at time zone (select timezone from public.organizations where id=p_organization_id))::date as "day",count(*) acquired,count(*) filter(where status='handed_off') handoffs from inquiries group by 1) x),
    'events',(select coalesce(jsonb_agg(x),'[]') from (select id,entity_type,entity_id,action,occurred_at,payload from public.events where organization_id=p_organization_id and entity_type in ('marketing_campaign','marketing_inquiry','marketing_audience') and (selected is null or entity_id=selected or entity_id in (select id from public.marketing_inquiries where organization_id=p_organization_id and campaign_id=selected)) order by occurred_at desc,id limit 12) x),
    'members',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',coalesce(display_name,'Member'))),'[]') from public.memberships where organization_id=p_organization_id),
    'stages',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from public.contact_relationship_stages where organization_id=p_organization_id),
    'available_pages',(select coalesce(jsonb_agg(jsonb_build_object('id',page->>'id','name',page->>'name','site',s.id,'revision',r.id)),'[]') from public.public_sites s join public.public_site_revisions r on (r.organization_id,r.site_id,r.id)=(s.organization_id,s.id,s.current_published_revision_id), lateral jsonb_array_elements(r.pages) page where s.organization_id=p_organization_id),
    'available_forms',(select coalesce(jsonb_agg(x),'[]') from (select id,name,public_key,current_published_revision_id is not null and archived_at is null published from public.forms where organization_id=p_organization_id order by updated_at desc limit 100) x),
    'campaign_options',(select coalesce(jsonb_agg(x),'[]') from (select id,name from public.marketing_campaigns where organization_id=p_organization_id order by updated_at desc limit 100) x),
    'period',jsonb_build_object('from',since,'to',until_at,'from_date',(since at time zone zone)::date,'to_date',(until_at at time zone zone)::date-1)
  ) into result;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.list_form_submissions(p_organization_id uuid, p_form_id uuid, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200); v_result jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  if not exists (select 1 from public.forms where organization_id = p_organization_id and id = p_form_id) then
    return null;
  end if;
  select jsonb_build_object(
    'total', (select count(*) from public.form_submissions
               where organization_id = p_organization_id and form_id = p_form_id),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'submittedAt', s.submitted_at, 'revisionId', s.form_revision_id,
        'source', s.source, 'answers', s.answers,
        'customerId', s.customer_id, 'customerName', case when app.has_capability(p_organization_id, 'customer.read') then c.name end,
        'bookingWorkItemId', s.booking_work_item_id) order by s.submitted_at desc)
      from (select * from public.form_submissions
             where organization_id = p_organization_id and form_id = p_form_id
             order by submitted_at desc limit v_limit) s
      left join public.contacts c on c.organization_id = s.organization_id and c.id = s.customer_id), '[]'::jsonb),
    'revisions', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'number', r.revision_number, 'definition', r.definition))
      from public.form_revisions r
      where r.organization_id = p_organization_id and r.form_id = p_form_id
        and r.id in (select form_revision_id from public.form_submissions
                      where organization_id = p_organization_id and form_id = p_form_id)), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_form_submission_page(p_organization_id uuid, p_form_id uuid, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_result jsonb;
begin
  perform app.require_public_site_manager(p_organization_id);
  if not exists (select 1 from public.forms where organization_id = p_organization_id and id = p_form_id) then
    return null;
  end if;
  with page as materialized (
    select s.* from public.form_submissions s
    where s.organization_id = p_organization_id and s.form_id = p_form_id
    order by s.submitted_at desc, s.id desc limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from public.form_submissions where organization_id = p_organization_id and form_id = p_form_id),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'submittedAt', s.submitted_at, 'revisionId', s.form_revision_id,
      'source', s.source, 'answers', s.answers, 'customerId', s.customer_id,
      'customerName', case when app.has_capability(p_organization_id, 'customer.read') then c.name end, 'bookingWorkItemId', s.booking_work_item_id
    ) order by s.submitted_at desc, s.id desc)
      from page s left join public.contacts c on c.organization_id = s.organization_id and c.id = s.customer_id), '[]'::jsonb),
    'revisions', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.revision_number, 'definition', r.definition))
      from public.form_revisions r where r.organization_id = p_organization_id and r.form_id = p_form_id
        and r.id in (select form_revision_id from page)), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

-- 9. An archived contact is not added to the call list.
create or replace function public.add_call_list_entries(
  p_organization_id uuid, p_customer_ids uuid[], p_title text, p_due_at timestamptz,
  p_owner_membership_id uuid default null, p_notes text default null
) returns setof uuid language sql volatile security invoker set search_path = '' as $$
  insert into public.crm_tasks(organization_id, customer_id, kind, title, notes, due_at, owner_membership_id, created_by)
    select p_organization_id, c.id, 'call', btrim(p_title), nullif(btrim(coalesce(p_notes, '')), ''), p_due_at,
      p_owner_membership_id, (select auth.uid())
      from public.contacts c
     where c.organization_id = p_organization_id and c.id = any (p_customer_ids) and c.archived_at is null
  on conflict (organization_id, customer_id) where status = 'open' and kind = 'call' do nothing
  returning customer_id
$$;

notify pgrst, 'reload schema';

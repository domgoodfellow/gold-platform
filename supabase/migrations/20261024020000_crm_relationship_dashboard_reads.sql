-- CRM Dashboard reads: a relationship overview and the recently active relationships preview.
-- Both are security-invoker reads over canonical contacts, affiliations, events and tasks; nothing
-- new is stored. Identity type and lifecycle are counted as separate dimensions.

create function public.crm_relationship_overview(p_organization_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
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
  from public.contacts c where c.organization_id = p_organization_id
$$;
revoke all on function public.crm_relationship_overview(uuid) from public, anon;
grant execute on function public.crm_relationship_overview(uuid) to authenticated;

-- Qualifying relationship activity is what happened with a contact, never a correction to its record:
-- calls placed, ended or written up; completed tasks (calls, emails, meetings, tasks); lifecycle
-- transitions (a temperature-only change does not count); relationship stage moves; and opportunities
-- created or moved for the contact. customer.updated, affiliation and type changes, task creation or
-- rescheduling, conversation threads and call.linked (a link time, not an interaction time) do not count.
create function public.crm_recent_relationships(p_organization_id uuid, p_limit integer default 8, p_include_next boolean default false)
returns table(contact_id uuid, name text, contact_type text, lifecycle text, company_id uuid, company_name text,
  event_id uuid, action text, detail jsonb, occurred_at timestamptz,
  next_task_id uuid, next_task_title text, next_task_due_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with qualifying as (
    select case when e.entity_type = 'customer' then e.entity_id else (e.payload->>'customer_id')::uuid end as contact_id,
      e.id, e.action, e.payload, e.occurred_at
    from public.events e
    where e.organization_id = p_organization_id and (
      (e.entity_type = 'customer' and e.action in ('call.placed', 'call.ended', 'call.wrapped_up', 'customer.stage_changed'))
      or (e.entity_type = 'customer' and e.action = 'customer.classification_changed'
        and (e.payload->'from_lifecycle') is distinct from (e.payload->'to_lifecycle'))
      or (e.entity_type = 'follow_up' and e.action = 'follow_up.completed')
      or (e.entity_type = 'opportunity' and e.action in ('opportunity.created', 'opportunity.stage_changed')))
  ), latest as (
    select distinct on (q.contact_id) q.* from qualifying q where q.contact_id is not null
    order by q.contact_id, q.occurred_at desc, q.id desc
  )
  select d.id, d.name, d.contact_type, d.lifecycle,
    case when d.contact_type = 'person' then d.directory_company_id end,
    case when d.contact_type = 'person' then d.directory_company_name end,
    l.id, l.action,
    jsonb_strip_nulls(jsonb_build_object('kind', l.payload->'kind', 'title', l.payload->'title', 'direction', l.payload->'direction',
      'to_lifecycle', l.payload->'to_lifecycle', 'stage_name', l.payload->'stage_name', 'stage_kind', l.payload->'stage_kind')),
    l.occurred_at, t.id, t.title, t.due_at
  from latest l
  join public.contact_directory d on d.organization_id = p_organization_id and d.id = l.contact_id
  left join lateral (
    select f.id, f.title, f.due_at from public.crm_tasks f
    where p_include_next and f.organization_id = p_organization_id and f.customer_id = l.contact_id and f.status = 'open'
    order by f.due_at, f.id limit 1
  ) t on true
  order by l.occurred_at desc, l.id desc
  limit greatest(1, least(coalesce(p_limit, 8), 25))
$$;
revoke all on function public.crm_recent_relationships(uuid, integer, boolean) from public, anon;
grant execute on function public.crm_recent_relationships(uuid, integer, boolean) to authenticated;

notify pgrst, 'reload schema';

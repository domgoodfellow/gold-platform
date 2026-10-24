-- Recently active relationships carries a call's recorded status and duration, so the Dashboard can say
-- whether a call connected instead of implying every call was a conversation. Same rows, same rules.

create or replace function public.crm_recent_relationships(p_organization_id uuid, p_limit integer default 8, p_include_next boolean default false)
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
      'to_lifecycle', l.payload->'to_lifecycle', 'status', l.payload->'status', 'duration', l.payload->'duration', 'stage_name', l.payload->'stage_name', 'stage_kind', l.payload->'stage_kind')),
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

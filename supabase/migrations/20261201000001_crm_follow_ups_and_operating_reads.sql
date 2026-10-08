do $$
declare v_known text[]; v_constraint text;
begin
  select pg_get_constraintdef(oid) into v_constraint from pg_constraint
    where conrelid = 'public.roles'::regclass and conname = 'roles_capabilities_known';
  select array_agg(distinct m[1]) into v_known from regexp_matches(v_constraint, '''([^'']+)''::text', 'g') m;
  v_known := v_known || array['follow_up.manage'];
  alter table public.roles drop constraint roles_capabilities_known;
  execute format('alter table public.roles add constraint roles_capabilities_known check (capabilities <@ array[%s]::text[])',
    (select string_agg(quote_literal(c), ',') from unnest(v_known) c));
end $$;
update public.roles set capabilities = capabilities || array['follow_up.manage'] where 'organization.manage' = any(capabilities);

alter table public.opportunities add constraint opportunities_org_customer_id unique(organization_id, customer_id, id);
create table public.crm_follow_ups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  opportunity_id uuid,
  kind text not null check(kind in ('call','email','meeting','task')),
  title text not null check(length(btrim(title)) between 1 and 200),
  notes text check(length(notes) <= 10000),
  due_at timestamptz not null check(isfinite(due_at)),
  owner_membership_id uuid,
  status text not null default 'open' check(status in ('open','completed','cancelled')),
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  foreign key(organization_id, customer_id) references public.customers(organization_id, id),
  foreign key(organization_id, customer_id, opportunity_id) references public.opportunities(organization_id, customer_id, id),
  foreign key(organization_id, owner_membership_id) references public.memberships(organization_id, id) on delete set null(owner_membership_id),
  check((status = 'completed') = (completed_at is not null and completed_by is not null)),
  check(status = 'completed' or (completed_at is null and completed_by is null))
);
create index follow_ups_org_due on public.crm_follow_ups(organization_id, status, due_at, id);
create index follow_ups_customer on public.crm_follow_ups(organization_id, customer_id, status, due_at);
create index follow_ups_opportunity on public.crm_follow_ups(organization_id, opportunity_id, due_at, id) where status = 'open';
create index follow_ups_owner on public.crm_follow_ups(organization_id, owner_membership_id, due_at);
alter table public.crm_follow_ups enable row level security;
alter table public.crm_follow_ups force row level security;
revoke all on public.crm_follow_ups from anon, authenticated;
grant select on public.crm_follow_ups to authenticated;
grant insert(organization_id, customer_id, opportunity_id, kind, title, notes, due_at, owner_membership_id, created_by) on public.crm_follow_ups to authenticated;
grant update(opportunity_id, kind, title, notes, due_at, owner_membership_id, status) on public.crm_follow_ups to authenticated;
create policy follow_ups_read on public.crm_follow_ups for select to authenticated using(organization_id in (select app.current_tenant_ids()));
create policy follow_ups_create on public.crm_follow_ups for insert to authenticated with check(
  organization_id in (select app.current_tenant_ids()) and created_by = (select auth.uid()) and app.has_capability(organization_id, 'follow_up.manage'));
create policy follow_ups_update on public.crm_follow_ups for update to authenticated using(
  organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'follow_up.manage')) with check(
  organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id, 'follow_up.manage'));

create function app.observe_follow_up() returns trigger language plpgsql set search_path = '' as $$
declare v_action text;
begin
  if tg_op = 'UPDATE' and old.status <> 'open' and new is distinct from old then
    raise exception 'Completed or cancelled follow-ups are historical. Create a new follow-up.' using errcode = '23514';
  end if;
  if new.status = 'completed' then
    new.completed_at := coalesce(old.completed_at, now());
    new.completed_by := coalesce(old.completed_by, auth.uid());
  end if;
  if tg_op = 'INSERT' then v_action := 'follow_up.created';
  elsif new is not distinct from old then return new;
  elsif new.status = 'completed' then v_action := 'follow_up.completed';
  elsif new.status = 'cancelled' then v_action := 'follow_up.cancelled';
  else v_action := 'follow_up.updated'; end if;
  insert into public.events(organization_id, actor_id, entity_type, entity_id, action, payload)
    values(new.organization_id, auth.uid(), 'follow_up', new.id, v_action,
      jsonb_build_object('customer_id',new.customer_id,'opportunity_id',new.opportunity_id,'title',new.title,'kind',new.kind,
        'due_at',new.due_at,'status',new.status,'owner_membership_id',new.owner_membership_id,
        'before',case when tg_op = 'UPDATE' then to_jsonb(old) else null end));
  return new;
end $$;
create trigger follow_up_observed before insert or update on public.crm_follow_ups for each row execute function app.observe_follow_up();
revoke all on function app.observe_follow_up() from public;

create or replace view public.customer_activity with (security_invoker = true) as
  select e.organization_id, coalesce(c.id, w.customer_id,
    case
      when e.entity_type in ('opportunity','follow_up') or e.action = 'location.linked' or (e.action = 'document.created' and e.payload ? 'customer_id') then (e.payload->>'customer_id')::uuid
      when e.action = 'document.created' and e.payload ? 'work_item_id' then
        (select wi.customer_id from public.work_items wi where wi.organization_id = e.organization_id and wi.id = (e.payload->>'work_item_id')::uuid)
    end) as customer_id,
    e.id as event_id, e.action, e.entity_type, e.entity_id, e.payload, e.actor_id, e.occurred_at
    from public.events e left join public.customers c on c.organization_id = e.organization_id and c.id = e.entity_id
    left join public.work_items w on w.organization_id = e.organization_id and w.id = e.entity_id;

create view public.opportunity_worklist with(security_invoker = true) as
  select o.*, f.id as next_follow_up_id, f.title as next_follow_up_title, f.due_at as next_follow_up_due_at,
    exists(select 1 from public.crm_follow_ups future where future.organization_id = o.organization_id and future.opportunity_id = o.id
      and future.status = 'open' and future.due_at >= now()) as has_future_follow_up
  from public.opportunities o left join lateral (
    select id,title,due_at from public.crm_follow_ups where organization_id = o.organization_id and opportunity_id = o.id and status = 'open'
    order by due_at,id limit 1
  ) f on true;
grant select on public.opportunity_worklist to authenticated;

create function public.crm_pipeline_preview(p_organization_id uuid, p_limit integer default 10)
returns setof public.opportunity_worklist language sql stable security invoker set search_path = '' as $$
  select (ranked.item).* from (
    select o as item, row_number() over(partition by o.stage_id order by o.expected_close_on nulls last, o.created_at desc, o.id) as rank
    from public.opportunity_worklist o where o.organization_id = p_organization_id
  ) ranked where ranked.rank <= greatest(1,least(p_limit,12))
$$;
revoke all on function public.crm_pipeline_preview(uuid,integer) from public;
grant execute on function public.crm_pipeline_preview(uuid,integer) to authenticated;

create function public.crm_dashboard_summary(p_organization_id uuid, p_month date)
returns jsonb language sql stable security invoker set search_path = '' as $$
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
    'customers',(select count(*) from public.customers where organization_id=p_organization_id),
    'open',(select count(*) from open_deals),
    'today',(select count(*) from public.crm_follow_ups f,settings z where f.organization_id=p_organization_id and f.status='open' and (f.due_at at time zone z.timezone)::date=(now() at time zone z.timezone)::date),
    'overdue',(select count(*) from public.crm_follow_ups where organization_id=p_organization_id and status='open' and due_at < now()),
    'noNext',(select count(*) from public.opportunity_worklist o join open_deals d on d.id=o.id where not o.has_future_follow_up),
    'unassigned',(select count(*) from open_deals where owner_membership_id is null),
    'forecast',coalesce((select jsonb_agg(t) from (select currency,sum(amount_minor)::text as amount_minor from open_deals
      where expected_close_on >= date_trunc('month',p_month::timestamp)::date and expected_close_on < (date_trunc('month',p_month::timestamp)+interval '1 month')::date and currency is not null group by currency) t),'[]'::jsonb),
    'pipeline',coalesce((select jsonb_agg(t) from (select currency,sum(amount_minor)::text as amount_minor from open_deals where currency is not null group by currency) t),'[]'::jsonb),
    'won',(select count(*) from closes where kind='won'), 'lost',(select count(*) from closes where kind='lost')
  )
$$;
revoke all on function public.crm_dashboard_summary(uuid,date) from public;
grant execute on function public.crm_dashboard_summary(uuid,date) to authenticated;

update public.platform_catalog_features set implementation_state='available', packaging_default='included',
  description=case key when 'follow_ups' then 'Actionable CRM follow-ups, collection and calendar.' else 'Opportunity win rate from recorded lifecycle transitions.' end
  where key in ('follow_ups','conversion_tracking');
update public.platform_catalog_features set implementation_state='partial', description='Customer ownership is not yet stored; Opportunity ownership is available separately.' where key='ownership_assignment';
insert into public.platform_catalog_runtime_mappings(feature_id,mapping_kind,mapping_value)
  select id,'module_key','reception' from public.platform_catalog_features where key in ('follow_ups','conversion_tracking')
  on conflict do nothing;
notify pgrst, 'reload schema';

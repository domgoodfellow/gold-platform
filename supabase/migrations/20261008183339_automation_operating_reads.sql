-- Read-only projections retain the caller's RLS; historical runs remain immutable.
create function public.automation_operating_summary(p_organization_id uuid, p_since timestamptz, p_until timestamptz)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'runs', (select count(*) from public.automation_runs where organization_id=p_organization_id and occurred_at>=p_since and occurred_at<p_until),
    'failed', (select count(*) from public.automation_runs where organization_id=p_organization_id and occurred_at>=p_since and occurred_at<p_until and outcome='failed'),
    'deliveries', (select coalesce(jsonb_object_agg(state,n), '{}'::jsonb) from (select state,count(*) n from public.message_deliveries where organization_id=p_organization_id and queued_at>=p_since and queued_at<p_until group by state) d),
    'days', (select coalesce(jsonb_agg(d order by "day"),'[]'::jsonb) from (
      select (r.occurred_at at time zone o.timezone)::date as "day", count(*) total, count(*) filter(where outcome='failed') failed
      from public.automation_runs r join public.organizations o on o.id=r.organization_id
      where r.organization_id=p_organization_id and r.occurred_at>=p_since and r.occurred_at<p_until group by 1
    ) d),
    'rules', (select coalesce(jsonb_agg(d),'[]'::jsonb) from (
      select rule_id, count(*) filter(where occurred_at>=p_since and occurred_at<p_until) total,
        count(*) filter(where occurred_at>=p_since and occurred_at<p_until and outcome='failed') failed,
        (array_agg(id order by occurred_at desc,id desc))[1] last_id,
        max(occurred_at) last_at, (array_agg(outcome order by occurred_at desc,id desc))[1] last_outcome
      from public.automation_runs where organization_id=p_organization_id group by rule_id
    ) d)
  );
$$;
revoke all on function public.automation_operating_summary(uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.automation_operating_summary(uuid,timestamptz,timestamptz) to authenticated;

-- One statement replaces the entire configuration; identity, ownership and position cannot change.
grant update(subject_field,operator,value) on public.automation_conditions to authenticated;
create policy automation_conditions_update on public.automation_conditions for update to authenticated
using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id,'automation.manage'))
with check (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id,'automation.manage')
  and exists(select 1 from public.automation_rules r where r.id=automation_conditions.rule_id and r.organization_id=automation_conditions.organization_id and r.trigger_kind<>'counter_threshold'));
grant update(action_kind,status_id,template_id,channel,shift_minutes,work_item_type_id) on public.automation_actions to authenticated;
create policy automation_actions_update on public.automation_actions for update to authenticated
using (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id,'automation.manage'))
with check (organization_id in (select app.current_tenant_ids()) and app.has_capability(organization_id,'automation.manage'));

create index automation_runs_org_rule_recent_idx on public.automation_runs(organization_id,rule_id,occurred_at desc,id desc);


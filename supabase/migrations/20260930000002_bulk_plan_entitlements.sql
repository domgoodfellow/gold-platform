-- Bulk read door for catalogue pages. The single-plan function remains the one authority for
-- entitlement precedence; this function only supplies plan identity and invokes it per input.
create function public.plan_entitled_features_bulk(p_plan_ids uuid[])
returns table (plan_id uuid, feature_id uuid)
language sql
stable
security invoker
set search_path = ''
as $fn$
  select requested.plan_id, entitled.feature_id
    from unnest(p_plan_ids) as requested(plan_id)
    cross join lateral public.plan_entitled_features(requested.plan_id) as entitled;
$fn$;

comment on function public.plan_entitled_features_bulk(uuid[]) is
  'Entitled Features for several Plans, reusing public.plan_entitled_features so entitlement precedence has one implementation.';

revoke all on function public.plan_entitled_features_bulk(uuid[]) from public;
grant execute on function public.plan_entitled_features_bulk(uuid[]) to authenticated;

-- Two corrections to the numbers surface, found by using it.
--
-- 1. A binding that is still `provisioning` does not make a number that the provider has already
--    confirmed unusable. Readiness is the resource's own state; a binding only *degrades* it, when
--    the scope behind it has failed or been suspended. Counting `provisioning` as not-ready refused
--    texts from numbers that had been working.
--
-- 2. Releasing an assignment comes back, with the screen that needs it: `assign_phone_number` had no
--    undo, so a number once given to someone could never be taken away (20261006000004 dropped the
--    function when nothing called it; the Numbers page now does).

create or replace view public.phone_number_readiness with (security_invoker = true) as
select n.organization_id,
       n.id as phone_number_id,
       case
         when n.lifecycle <> 'active' then 'unavailable'
         when n.origin = 'provisioned' then
           case
             when r.status is null or r.status in ('disabled') then 'unavailable'
             when r.status = 'failed' or b.status = 'failed' then 'degraded'
             when b.status = 'suspended' then 'unavailable'
             when r.status = 'pending' then 'setup_required'
             else 'ready'
           end
         when n.origin in ('external', 'browser') then 'ready'
         else 'unavailable'
       end as readiness
  from public.phone_numbers n
  left join public.organization_provider_resources r
    on r.organization_id = n.organization_id and r.id = n.provider_resource_id
  left join public.organization_provider_bindings b
    on b.organization_id = r.organization_id and b.id = r.binding_id;

create function public.release_phone_number_assignment(p_organization_id uuid, p_assignment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
begin
  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'organization.manage') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  update public.phone_number_assignments
     set released_at = now(), is_default = false
   where organization_id = p_organization_id and id = p_assignment_id and released_at is null;
  if not found then
    raise exception 'no active assignment here' using errcode = '42501';
  end if;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  select p_organization_id, v_actor, 'phone_number', phone_number_id, 'phone_number.released',
         jsonb_build_object('assignment_id', p_assignment_id)
    from public.phone_number_assignments where id = p_assignment_id;
end;
$fn$;
revoke all on function public.release_phone_number_assignment(uuid, uuid) from public, anon;
grant execute on function public.release_phone_number_assignment(uuid, uuid) to authenticated;

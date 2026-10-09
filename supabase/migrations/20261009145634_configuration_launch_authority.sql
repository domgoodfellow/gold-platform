-- Reuse the runtime entitlement resolver; disabled/unentitled capabilities cannot block launch.
-- No rows or history are rewritten. Recovery is a forward replacement of this function.
create or replace function app.organization_launch_blockers_unchecked(p_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_blockers text[] := array[]::text[];
begin
  if app.module_entitled(p_id, 'booking') and (
    not exists (select 1 from public.organizations o where o.id = p_id and o.slug is not null)
    or not exists (select 1 from public.work_item_types t
      where t.organization_id = p_id and t.booking_status_id is not null)
  ) then
    v_blockers := array_append(v_blockers, 'booking');
  end if;
  if app.module_entitled(p_id, 'card_payments') and not exists (
    select 1 from public.payment_accounts a where a.organization_id = p_id
  ) then
    v_blockers := array_append(v_blockers, 'card_payments');
  end if;
  return v_blockers;
end;
$fn$;
revoke all on function app.organization_launch_blockers_unchecked(uuid) from public;

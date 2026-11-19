-- `app.outbound_destination_allowed` (20261116000001) is SECURITY DEFINER and executable by
-- `authenticated`, because invoker-rights `open_call` calls it. Its call-list and inbound-call
-- branches did not ask who was calling, so a signed-in person naming another business could learn
-- whether that business had an open Call task for a contact with a number, or had received a call
-- from it. The answer is now true only for a member of that business who holds `call.place`.
--
-- `open_call` asks only when the caller holds `call.place`, so dialing itself is unchanged: the same
-- members may ring the same numbers. Grants are restated, not widened.
create or replace function app.outbound_destination_allowed(p_organization_id uuid, p_to_number text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.has_capability(p_organization_id, 'call.place')
     and (
          app.has_capability(p_organization_id, 'call.dial_manual')
       or exists (
            select 1 from app.contact_matches(p_organization_id, 'phone', p_to_number) m
             where app.has_capability(p_organization_id, 'customer.read')
                or exists (select 1 from public.crm_tasks t
                            where t.organization_id = p_organization_id and t.customer_id = m
                              and t.status = 'open' and t.kind = 'call'))
       or exists (
            select 1 from public.calls c
             where c.organization_id = p_organization_id and c.direction = 'inbound'
               and app.normalize_phone(c.from_number) = app.normalize_phone(p_to_number))
     )
$$;
revoke all on function app.outbound_destination_allowed(uuid, text) from public, anon;
grant execute on function app.outbound_destination_allowed(uuid, text) to authenticated;

-- Reuse the canonical contact-point matcher. Ambiguous numbers never choose a contact.
create function public.dialer_contact_candidates(p_organization_id uuid, p_number text)
returns table (id uuid, name text, email text, phone text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'call.place') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  return query
    select c.id, c.name, c.email, c.phone
      from app.contact_matches(p_organization_id, 'phone', p_number) m
      join public.contacts c on c.organization_id = p_organization_id and c.id = m
     order by c.id limit 2;
end $$;
revoke all on function public.dialer_contact_candidates(uuid, text) from public, anon;
grant execute on function public.dialer_contact_candidates(uuid, text) to authenticated;

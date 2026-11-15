-- Outbound identity: one resolver, shared numbers, and the reason a number was chosen.
-- The Dialer's contact reads gain the contact's business, and a call can name its own contact.
--
-- 1. A business may share a number: anyone who may place calls may dial from it. Sharing is a
--    fact about the number, set by whoever manages the business. It is not an assignment (an
--    assignment names one member) and it is not a call list.
--
-- 2. One set of candidates answers every question about outbound numbers. `resolve_outbound_number`
--    (what a call is placed from) and `outbound_number_options` (what a person is shown) both read
--    `app.outbound_number_candidates`, so a screen can never offer a number a call would refuse.
--    The order: the member's preference, their default, another number assigned to them, the
--    business's default number, then a shared number. A preference counts only while the number is
--    still one the member may use: releasing the assignment ends it, where before a preference
--    outlived the assignment it was made from.
--
-- 3. The Dialer's contact reads say what kind of contact it is, the business they belong to and
--    their title there, from the canonical affiliation. `call_contact` reads the contact a call is
--    linked to, so a live call shows who it is with whether or not they are on the loaded call list.
--    It reads the link the call holds; it never matches by phone number.

alter table public.phone_numbers add column outbound_shared boolean not null default false;
comment on column public.phone_numbers.outbound_shared is
  'Anyone in the business who may place calls may dial from this number.';

create function public.set_phone_number_outbound_sharing(p_organization_id uuid, p_phone_number_id uuid, p_shared boolean)
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
  update public.phone_numbers
     set outbound_shared = coalesce(p_shared, false), updated_at = now()
   where organization_id = p_organization_id and id = p_phone_number_id;
  if not found then
    raise exception 'no such number here' using errcode = '42501';
  end if;
  insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
  values (p_organization_id, v_actor, 'phone_number', p_phone_number_id, 'phone_number.sharing_changed',
          jsonb_build_object('shared', coalesce(p_shared, false)));
end;
$fn$;
revoke all on function public.set_phone_number_outbound_sharing(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_phone_number_outbound_sharing(uuid, uuid, boolean) to authenticated;

-- Every number the asking member may dial from, once each, under the best reason they hold it.
create function app.outbound_number_candidates(p_organization_id uuid)
returns table (phone_number_id uuid, e164 text, label text, source text, rank integer)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select m.id from public.memberships m
     where m.organization_id = p_organization_id and m.user_id = (select auth.uid())
       and p_organization_id in (select app.current_tenant_ids())
  ),
  usable as (
    select n.id, n.e164, n.label, n.outbound_shared from public.phone_numbers n
      join public.phone_number_readiness r on r.organization_id = n.organization_id and r.phone_number_id = n.id
     where n.organization_id = p_organization_id and n.lifecycle = 'active' and n.voice_outbound_enabled
       and n.origin in ('provisioned', 'external') and r.readiness = 'ready'
  ),
  held as (
    select u.id, u.e164, u.label, 'member_default'::text as source, 1 as rank
      from public.phone_number_assignments a
      join me on me.id = a.member_id
      join usable u on u.id = a.phone_number_id
     where a.organization_id = p_organization_id and a.released_at is null and a.outbound_allowed and a.is_default
    union all
    select u.id, u.e164, u.label, 'member', 2
      from public.phone_number_assignments a
      join me on me.id = a.member_id
      join usable u on u.id = a.phone_number_id
     where a.organization_id = p_organization_id and a.released_at is null and a.outbound_allowed and not a.is_default
    union all
    select u.id, u.e164, u.label, 'organization_default', 3
      from public.telephony_settings t
      join usable u on u.e164 = t.calling_number
     where t.organization_id = p_organization_id
       and exists (select 1 from me)
    union all
    select u.id, u.e164, u.label, 'shared', 4
      from usable u
     where u.outbound_shared
       and exists (select 1 from me)
       and app.has_capability(p_organization_id, 'call.place')
  ),
  candidates as (
    select h.id, h.e164, h.label, h.source, h.rank from held h
    union all
    -- A preference chooses among numbers the member may still use; it grants none.
    select h.id, h.e164, h.label, 'preference', 0
      from public.user_phone_number_preferences p
      join me on me.id = p.member_id
      join (select distinct on (id) id, e164, label from held order by id) h on h.id = p.phone_number_id
     where p.organization_id = p_organization_id
  )
  select distinct on (c.id) c.id, c.e164, c.label, c.source, c.rank
    from candidates c
   order by c.id, c.rank
$$;
-- Reached only through the two public functions below, which run as their owner.
revoke all on function app.outbound_number_candidates(uuid) from public, anon, authenticated;

-- With nothing named: the first candidate. With a number named: that number, only if it is a candidate.
create or replace function public.resolve_outbound_number(p_organization_id uuid, p_phone_number_id uuid default null)
returns table (phone_number_id uuid, e164 text, source text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.phone_number_id, c.e164, c.source
    from app.outbound_number_candidates(p_organization_id) c
   where p_phone_number_id is null or c.phone_number_id = p_phone_number_id
   order by c.rank, c.e164
   limit 1
$$;

-- What the asking member may dial from, in the resolver's own order; `automatic` marks the one a
-- call uses when nothing is named.
create function public.outbound_number_options(p_organization_id uuid)
returns table (phone_number_id uuid, e164 text, label text, source text, automatic boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.phone_number_id, c.e164, c.label, c.source,
         row_number() over (order by c.rank, c.e164) = 1
    from app.outbound_number_candidates(p_organization_id) c
   order by c.rank, c.e164
$$;
revoke all on function public.outbound_number_options(uuid) from public, anon;
grant execute on function public.outbound_number_options(uuid) to authenticated;

-- What the Dialer shows of a contact: who they are, how to reach them, and the business they
-- belong to. A company is its own business; a person's is their primary active affiliation.
create function app.dialer_contact_cards(p_organization_id uuid, p_contact_ids uuid[])
returns table (id uuid, name text, email text, phone text, archived boolean, contact_type text,
               company_id uuid, company_name text, title text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, c.email, c.phone, c.archived_at is not null, c.contact_type,
         coalesce(a.company_id, case when c.contact_type = 'company' then c.id end),
         coalesce(a.company_name, case when c.contact_type = 'company' then c.name end),
         a.title
    from public.contacts c
    left join lateral (
      select af.company_id, company.name as company_name, af.title
        from public.contact_affiliations af
        join public.contacts company on company.organization_id = af.organization_id and company.id = af.company_id
       where af.organization_id = c.organization_id and af.person_id = c.id and af.active
       order by af.is_primary desc, company.name, af.company_id
       limit 1
    ) a on true
   where c.organization_id = p_organization_id and c.id = any (p_contact_ids)
$$;
revoke all on function app.dialer_contact_cards(uuid, uuid[]) from public, anon, authenticated;

drop function public.call_list_contacts(uuid, uuid[]);
create function public.call_list_contacts(p_organization_id uuid, p_customer_ids uuid[])
returns table (id uuid, name text, email text, phone text, archived boolean, contact_type text,
               company_id uuid, company_name text, title text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if not (app.has_capability(p_organization_id, 'call.place') or app.has_capability(p_organization_id, 'customer.read')) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  return query
    select k.* from app.dialer_contact_cards(p_organization_id, p_customer_ids[1:100]) k
     where exists (select 1 from public.crm_tasks t
                    where t.organization_id = p_organization_id and t.customer_id = k.id
                      and t.status = 'open' and t.kind = 'call');
end $fn$;
revoke all on function public.call_list_contacts(uuid, uuid[]) from public, anon;
grant execute on function public.call_list_contacts(uuid, uuid[]) to authenticated;

drop function public.dialer_contact_candidates(uuid, text);
create function public.dialer_contact_candidates(p_organization_id uuid, p_number text)
returns table (id uuid, name text, email text, phone text, archived boolean, contact_type text,
               company_id uuid, company_name text, title text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if p_organization_id not in (select app.current_tenant_ids())
     or not app.has_capability(p_organization_id, 'call.place') then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  return query
    select k.* from app.dialer_contact_cards(
             p_organization_id,
             array(select m from app.contact_matches(p_organization_id, 'phone', p_number) m order by m limit 2)) k
     order by k.id;
end $fn$;
revoke all on function public.dialer_contact_candidates(uuid, text) from public, anon;
grant execute on function public.dialer_contact_candidates(uuid, text) to authenticated;

-- The contact a call is linked to, for a member who may place calls or view contacts. Nothing is
-- returned for a call linked to nobody, a call of another business, or a call that does not exist.
create function public.call_contact(p_organization_id uuid, p_call_id uuid)
returns table (id uuid, name text, email text, phone text, archived boolean, contact_type text,
               company_id uuid, company_name text, title text)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  if p_organization_id not in (select app.current_tenant_ids())
     or not (app.has_capability(p_organization_id, 'call.place') or app.has_capability(p_organization_id, 'customer.read')) then
    raise exception 'insufficient privilege' using errcode = '42501';
  end if;
  return query
    select k.* from app.dialer_contact_cards(
             p_organization_id,
             array(select c.customer_id from public.calls c
                    where c.organization_id = p_organization_id and c.id = p_call_id and c.customer_id is not null)) k;
end $fn$;
revoke all on function public.call_contact(uuid, uuid) from public, anon;
grant execute on function public.call_contact(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

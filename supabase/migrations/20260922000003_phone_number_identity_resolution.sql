-- A preference is a narrower choice than an assignment: it cannot name a number the member is
-- not currently permitted to use. The resolver, not a component, owns precedence.
create table public.user_phone_number_preferences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  member_id uuid not null,
  phone_number_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, member_id),
  foreign key (organization_id, member_id) references public.memberships(organization_id,id),
  foreign key (organization_id, phone_number_id) references public.phone_numbers(organization_id,id)
);
alter table public.user_phone_number_preferences enable row level security;
alter table public.user_phone_number_preferences force row level security;
create policy user_phone_number_preferences_select on public.user_phone_number_preferences for select to authenticated using (organization_id in (select app.current_tenant_ids()));
create policy user_phone_number_preferences_platform_select on public.user_phone_number_preferences for select to authenticated using ((select app.is_platform_staff()));
grant select on public.user_phone_number_preferences to authenticated;

create function public.set_user_phone_number_preference(p_organization_id uuid,p_phone_number_id uuid) returns void language plpgsql volatile security definer set search_path='' as $$
declare v_member uuid; begin
 select id into v_member from public.memberships where organization_id=p_organization_id and user_id=auth.uid();
 if v_member is null then raise exception 'not a member here' using errcode='42501'; end if;
 if not exists(select 1 from public.phone_number_assignments a join public.phone_numbers n on n.organization_id=a.organization_id and n.id=a.phone_number_id where a.organization_id=p_organization_id and a.member_id=v_member and a.phone_number_id=p_phone_number_id and a.released_at is null and a.outbound_allowed and n.lifecycle='active' and n.outbound_enabled) then raise exception 'that number is not a permitted outbound identity' using errcode='42501'; end if;
 insert into public.user_phone_number_preferences(organization_id,member_id,phone_number_id) values(p_organization_id,v_member,p_phone_number_id) on conflict(organization_id,member_id) do update set phone_number_id=excluded.phone_number_id,updated_at=now(); end $$;
create function public.resolve_effective_outbound_identity(p_organization_id uuid) returns text language sql stable security definer set search_path='' as $$
 with member as (select id from public.memberships where organization_id=p_organization_id and user_id=auth.uid()), permitted as (select a.phone_number_id,a.is_default from public.phone_number_assignments a join member m on m.id=a.member_id join public.phone_numbers n on n.organization_id=a.organization_id and n.id=a.phone_number_id where a.organization_id=p_organization_id and a.released_at is null and a.outbound_allowed and n.lifecycle='active' and n.outbound_enabled), chosen as (select p.phone_number_id from public.user_phone_number_preferences p join member m on m.id=p.member_id join permitted x on x.phone_number_id=p.phone_number_id where p.organization_id=p_organization_id union all select phone_number_id from permitted where is_default limit 1) select n.e164 from chosen c join public.phone_numbers n on n.organization_id=p_organization_id and n.id=c.phone_number_id union all select n.e164 from public.telephony_settings t join public.phone_numbers n on n.organization_id=t.organization_id and n.e164=t.calling_number where t.organization_id=p_organization_id and n.lifecycle='active' and n.outbound_enabled limit 1; $$;
revoke all on function public.set_user_phone_number_preference(uuid,uuid) from public;
revoke all on function public.resolve_effective_outbound_identity(uuid) from public;
grant execute on function public.set_user_phone_number_preference(uuid,uuid),public.resolve_effective_outbound_identity(uuid) to authenticated;

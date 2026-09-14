-- A provider resource is evidence that a carrier knows a number. A phone number is the
-- organization-facing capability: its lifecycle, enabled directions and permitted identities.
alter table public.organization_provider_resources
  add constraint organization_provider_resources_org_id_unique unique (organization_id, id);
alter table public.memberships
  add constraint memberships_org_id_unique unique (organization_id, id);

create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider_resource_id uuid not null,
  e164 text not null check (e164 ~ '^\+[1-9][0-9]{7,14}$'),
  label text null check (label is null or length(btrim(label)) between 1 and 120),
  lifecycle text not null default 'active' check (lifecycle in ('active','inactive','quarantined')),
  purpose text not null default 'general' check (purpose in ('general','sales','support')),
  inbound_enabled boolean not null default true,
  outbound_enabled boolean not null default true,
  health text not null default 'unknown' check (health in ('unknown','healthy','degraded','failed')),
  health_checked_at timestamptz null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid null references auth.users(id),
  unique (organization_id,id), unique (organization_id,e164),
  unique (organization_id,provider_resource_id),
  foreign key (organization_id,provider_resource_id) references public.organization_provider_resources(organization_id,id)
);
create table public.phone_number_assignments (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
  phone_number_id uuid not null, member_id uuid null, resource_id uuid null,
  outbound_allowed boolean not null default true, is_default boolean not null default false,
  assigned_at timestamptz not null default now(), released_at timestamptz null,
  created_by uuid null references auth.users(id),
  check ((member_id is null) <> (resource_id is null)),
  foreign key (organization_id,phone_number_id) references public.phone_numbers(organization_id,id),
  foreign key (organization_id,member_id) references public.memberships(organization_id,id),
  foreign key (organization_id,resource_id) references public.resources(organization_id,id)
);
create unique index phone_number_assignments_one_default_member on public.phone_number_assignments(organization_id,member_id) where is_default and released_at is null;
create index phone_number_assignments_active_number on public.phone_number_assignments(organization_id,phone_number_id) where released_at is null;
alter table public.phone_numbers enable row level security; alter table public.phone_numbers force row level security;
alter table public.phone_number_assignments enable row level security; alter table public.phone_number_assignments force row level security;
create policy phone_numbers_select on public.phone_numbers for select to authenticated using (organization_id in (select app.current_tenant_ids()));
create policy phone_assignments_select on public.phone_number_assignments for select to authenticated using (organization_id in (select app.current_tenant_ids()));
create policy phone_numbers_platform_select on public.phone_numbers for select to authenticated using ((select app.is_platform_staff()));
create policy phone_assignments_platform_select on public.phone_number_assignments for select to authenticated using ((select app.is_platform_staff()));
grant select on public.phone_numbers, public.phone_number_assignments to authenticated;

create function public.sync_phone_number(p_organization_id uuid,p_provider_resource_id uuid,p_e164 text,p_label text default null,p_status text default 'active') returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_id uuid; begin perform app.require_platform_staff();
 if not exists(select 1 from public.organization_provider_resources where organization_id=p_organization_id and id=p_provider_resource_id and resource_type='twilio_phone_number') then raise exception 'provider resource is not a phone number in this organization' using errcode='23503'; end if;
 insert into public.phone_numbers(organization_id,provider_resource_id,e164,label,lifecycle) values(p_organization_id,p_provider_resource_id,p_e164,nullif(btrim(p_label),''),p_status)
 on conflict(organization_id,e164) do update set provider_resource_id=excluded.provider_resource_id,label=excluded.label,lifecycle=excluded.lifecycle,updated_at=now() returning id into v_id; return v_id; end $$;
create function public.assign_phone_number(p_organization_id uuid,p_phone_number_id uuid,p_member_id uuid default null,p_resource_id uuid default null,p_default boolean default false) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_id uuid; begin
 if p_organization_id not in(select app.current_tenant_ids()) or not app.has_capability(p_organization_id,'organization.manage') then raise exception 'insufficient privilege' using errcode='42501'; end if;
 if p_default and p_member_id is null then raise exception 'a default identity belongs to a member' using errcode='23514'; end if;
 if p_default then update public.phone_number_assignments set is_default=false where organization_id=p_organization_id and member_id=p_member_id and released_at is null; end if;
 insert into public.phone_number_assignments(organization_id,phone_number_id,member_id,resource_id,is_default,created_by) values(p_organization_id,p_phone_number_id,p_member_id,p_resource_id,p_default,v_actor) returning id into v_id;
 insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload) values(p_organization_id,v_actor,'phone_number',p_phone_number_id,'phone_number.assigned',jsonb_build_object('assignment_id',v_id)); return v_id; end $$;
create function public.release_phone_number_assignment(p_organization_id uuid,p_assignment_id uuid) returns void language plpgsql volatile security definer set search_path='' as $$ declare v_actor uuid:=auth.uid(); begin if p_organization_id not in(select app.current_tenant_ids()) or not app.has_capability(p_organization_id,'organization.manage') then raise exception 'insufficient privilege' using errcode='42501'; end if; update public.phone_number_assignments set released_at=now(),is_default=false where organization_id=p_organization_id and id=p_assignment_id and released_at is null; if not found then raise exception 'no active assignment here' using errcode='42501'; end if; end $$;
revoke all on function public.sync_phone_number(uuid,uuid,text,text,text) from public;
revoke all on function public.assign_phone_number(uuid,uuid,uuid,uuid,boolean) from public;
revoke all on function public.release_phone_number_assignment(uuid,uuid) from public;
grant execute on function public.sync_phone_number(uuid,uuid,text,text,text) to authenticated;
grant execute on function public.assign_phone_number(uuid,uuid,uuid,uuid,boolean),public.release_phone_number_assignment(uuid,uuid) to authenticated;

-- Forward-only identity migration. PostgreSQL preserves relation OIDs and inbound FKs.
alter table public.customers rename to contacts;
alter table public.customer_stages rename to contact_relationship_stages;
alter table public.crm_follow_ups rename to crm_tasks;
alter table public.contacts add column contact_type text not null default 'unspecified'
  check(contact_type in ('person','company','unspecified'));
alter table public.contacts add constraint contacts_typed_identity unique(organization_id,id,contact_type);

-- Rewrite stored SQL/PLpgSQL relation references; historical event/capability keys stay unchanged.
do $migration$
declare f record; body text;
begin
  for f in select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','app') and p.prokind='f'
      and p.prosrc ~ '\m(customers|customer_stages|crm_follow_ups)\M'
  loop
    body:=regexp_replace(f.definition,'public\.customers\M','public.contacts','g');
    body:=regexp_replace(body,'public\.customer_stages\M','public.contact_relationship_stages','g');
    body:=regexp_replace(body,'public\.crm_follow_ups\M','public.crm_tasks','g');
    execute body;
  end loop;
end $migration$;

-- Compatibility aliases share one physical store and enforce the caller's underlying RLS.
create view public.customers with(security_invoker=true) as select * from public.contacts;
create view public.customer_stages with(security_invoker=true) as select * from public.contact_relationship_stages;
create view public.crm_follow_ups with(security_invoker=true) as select * from public.crm_tasks;
grant select,insert,update on public.customers,public.customer_stages,public.crm_follow_ups to authenticated;
grant all on public.customers,public.customer_stages,public.crm_follow_ups to service_role;

create table public.contact_people(
 organization_id uuid not null, contact_id uuid not null,
 contact_type text not null default 'person' check(contact_type='person'),
 given_name text, family_name text,
 primary key(organization_id,contact_id),
 foreign key(organization_id,contact_id,contact_type) references public.contacts(organization_id,id,contact_type) on delete cascade
);
create table public.contact_companies(
 organization_id uuid not null, contact_id uuid not null,
 contact_type text not null default 'company' check(contact_type='company'),
 legal_name text,
 primary key(organization_id,contact_id),
 foreign key(organization_id,contact_id,contact_type) references public.contacts(organization_id,id,contact_type) on delete cascade
);
create table public.contact_affiliations(
 id uuid primary key default gen_random_uuid(),organization_id uuid not null,
 person_id uuid not null,company_id uuid not null,
 person_type text not null default 'person' check(person_type='person'),
 company_type text not null default 'company' check(company_type='company'),
 title text check(length(title)<=200),is_primary boolean not null default false,
 active boolean not null default true,created_at timestamptz not null default now(),
 created_by uuid not null references auth.users(id),
 unique(organization_id,person_id,company_id),
 foreign key(organization_id,person_id,person_type) references public.contacts(organization_id,id,contact_type),
 foreign key(organization_id,company_id,company_type) references public.contacts(organization_id,id,contact_type),
 check(person_id<>company_id)
);
create index contact_affiliations_company on public.contact_affiliations(organization_id,company_id,active);
create index contact_affiliations_person on public.contact_affiliations(organization_id,person_id,active);
create index contacts_directory_type on public.contacts(organization_id,contact_type,name,id);
alter table public.contact_people enable row level security;
alter table public.contact_people force row level security;
create policy contact_people_read on public.contact_people for select to authenticated
 using(organization_id in (select app.current_tenant_ids()));
revoke all on public.contact_people from public,anon,authenticated;
grant select on public.contact_people to authenticated;
grant all on public.contact_people to service_role;
alter table public.contact_companies enable row level security;
alter table public.contact_companies force row level security;
create policy contact_companies_read on public.contact_companies for select to authenticated
 using(organization_id in (select app.current_tenant_ids()));
revoke all on public.contact_companies from public,anon,authenticated;
grant select on public.contact_companies to authenticated;
grant all on public.contact_companies to service_role;
alter table public.contact_affiliations enable row level security;
alter table public.contact_affiliations force row level security;
create policy contact_affiliations_read on public.contact_affiliations for select to authenticated
 using(organization_id in (select app.current_tenant_ids()));
revoke all on public.contact_affiliations from public,anon,authenticated;
grant select on public.contact_affiliations to authenticated;
grant all on public.contact_affiliations to service_role;

create function app.contact_type_details() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.contact_type='person' then
  insert into public.contact_people(organization_id,contact_id) values(new.organization_id,new.id) on conflict do nothing;
 elsif new.contact_type='company' then
  insert into public.contact_companies(organization_id,contact_id) values(new.organization_id,new.id) on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function app.contact_type_details() from public,anon,authenticated;
create trigger contacts_type_details after insert or update of contact_type on public.contacts
 for each row execute function app.contact_type_details();

create function public.create_crm_contact(p_organization_id uuid,p_name text,p_email text,p_phone text,p_custom jsonb,
 p_contact_type text,p_lifecycle text default 'lead',p_lead_temperature text default 'unrated',
 p_company_id uuid default null,p_title text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=app.require_capability(p_organization_id,'customer.create'); identity uuid;
begin
 if p_contact_type not in ('person','company') or p_contact_type is null then
  raise exception 'Choose Person or Company.' using errcode='22023';
 end if;
 if p_company_id is not null and p_contact_type<>'person' then raise exception 'Only people have company affiliations.' using errcode='22023'; end if;
 identity:=public.create_contact(p_organization_id,p_name,p_email,p_phone,p_custom,p_lifecycle,p_lead_temperature);
 update public.contacts set contact_type=p_contact_type where organization_id=p_organization_id and id=identity;
 if p_company_id is not null then
  -- Creation authority may attach only the newly created person, never change an existing person.
  insert into public.contact_affiliations(organization_id,person_id,company_id,title,created_by)
   values(p_organization_id,identity,p_company_id,nullif(trim(p_title),''),actor);
 end if;
 return identity;
end $$;
revoke all on function public.create_crm_contact(uuid,text,text,text,jsonb,text,text,text,uuid,text) from public,anon;
grant execute on function public.create_crm_contact(uuid,text,text,text,jsonb,text,text,text,uuid,text) to authenticated;

create function public.update_crm_contact(p_organization_id uuid,p_contact_id uuid,p_name text,p_email text,p_phone text,
 p_custom jsonb,p_stage_id uuid,p_contact_type text,p_lifecycle text default null,p_lead_temperature text default null)
 returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=app.require_capability(p_organization_id,'customer.update'); prior text;
begin
 select contact_type into prior from public.contacts where organization_id=p_organization_id and id=p_contact_id for update;
 if not found then raise exception 'Contact unavailable.' using errcode='42501'; end if;
 if p_contact_type not in ('person','company','unspecified') or p_contact_type is null
  or (prior<>'unspecified' and p_contact_type<>prior) then
  raise exception 'Classify an unspecified contact as Person or Company; existing typed identities cannot change kind.' using errcode='22023';
 end if;
 perform public.update_contact(p_organization_id,p_contact_id,p_name,p_email,p_phone,p_custom,p_stage_id,p_lifecycle,p_lead_temperature);
 update public.contacts set contact_type=p_contact_type where organization_id=p_organization_id and id=p_contact_id;
 if prior<>p_contact_type then
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
   values(p_organization_id,actor,'customer',p_contact_id,'contact.type_classified',jsonb_build_object('from',prior,'to',p_contact_type));
 end if;
end $$;
revoke all on function public.update_crm_contact(uuid,uuid,text,text,text,jsonb,uuid,text,text,text) from public,anon;
grant execute on function public.update_crm_contact(uuid,uuid,text,text,text,jsonb,uuid,text,text,text) to authenticated;

create function public.save_contact_affiliation(p_organization_id uuid,p_person_id uuid,p_company_id uuid,
 p_title text default null,p_is_primary boolean default false,p_active boolean default true)
 returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=app.require_capability(p_organization_id,'customer.update'); affiliation uuid;
begin
 -- Typed composite keys reject wrong types and cross-tenant references, including unknown IDs.
 perform 1 from public.contacts where organization_id=p_organization_id and id=p_person_id and contact_type='person' for update;
 if not found then raise exception 'Person unavailable.' using errcode='42501'; end if;
 if not exists(select 1 from public.contacts where organization_id=p_organization_id and id=p_company_id and contact_type='company') then
  raise exception 'Company unavailable.' using errcode='42501'; end if;
 insert into public.contact_affiliations(organization_id,person_id,company_id,title,is_primary,active,created_by)
 values(p_organization_id,p_person_id,p_company_id,nullif(trim(p_title),''),p_is_primary,p_active,actor)
 on conflict(organization_id,person_id,company_id) do update set title=excluded.title,is_primary=excluded.is_primary,active=excluded.active
 returning id into affiliation;
 insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
 values(p_organization_id,actor,'customer',p_person_id,'contact.affiliation_changed',jsonb_build_object('affiliation_id',affiliation,'company_id',p_company_id,'active',p_active));
 return affiliation;
end $$;
revoke all on function public.save_contact_affiliation(uuid,uuid,uuid,text,boolean,boolean) from public,anon;
grant execute on function public.save_contact_affiliation(uuid,uuid,uuid,text,boolean,boolean) to authenticated;
notify pgrst,'reload schema';

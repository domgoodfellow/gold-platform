create table public.organization_business_profiles (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  revision integer not null check(revision > 0),
  nouns jsonb not null default '{}' check(jsonb_typeof(nouns)='object'),
  navigation jsonb not null default '[]' check(jsonb_typeof(navigation)='array'),
  labels jsonb not null default '{}' check(jsonb_typeof(labels)='object'),
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id)
);
alter table public.organization_business_profiles enable row level security;
alter table public.organization_business_profiles force row level security;
create policy business_profile_read on public.organization_business_profiles for select to authenticated
  using(organization_id in (select app.current_tenant_ids()));
revoke all on public.organization_business_profiles from public,anon,authenticated;
grant select on public.organization_business_profiles to authenticated;

create function public.save_business_profile(p_organization_id uuid,p_revision integer,p_nouns jsonb,p_navigation jsonb,p_labels jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_revision integer; v_key text; v_value jsonb;
  v_keys constant text[] := array['home','library','sales','customers','pipeline','comms','calls','comms-inbox','marketing','support','ai','finance','finance-quotes','finance-invoices','finance-payments','automations','automation-rules','automation-messages','automation-activity','field','work','schedule','resources','locations','assets','studio','studio-website','studio-portal','studio-forms','studio-templates','follow-ups','calendar'];
begin
  if not app.has_capability(p_organization_id,'organization.manage') then raise exception 'Business profile management required' using errcode='42501'; end if;
  if p_nouns is null or jsonb_typeof(p_nouns)<>'object' or p_navigation is null or jsonb_typeof(p_navigation)<>'array' or p_labels is null or jsonb_typeof(p_labels)<>'object' then raise exception 'Invalid business profile' using errcode='22023'; end if;
  if jsonb_array_length(p_navigation)>cardinality(v_keys) then raise exception 'Too many destinations' using errcode='22023'; end if;
  for v_key,v_value in select * from jsonb_each(p_nouns) loop
    if v_key<>all(array['customer','opportunity','work','invoice','quote','resource','location','service']) or jsonb_typeof(v_value)<>'object'
      or (select count(*) from jsonb_object_keys(v_value))<>2 or not(v_value ?& array['singular','plural'])
      or jsonb_typeof(v_value->'singular')<>'string' or jsonb_typeof(v_value->'plural')<>'string'
      or length(btrim(v_value->>'singular')) not between 1 and 80 or length(btrim(v_value->>'plural')) not between 1 and 80
      then raise exception 'Invalid business noun' using errcode='22023'; end if;
  end loop;
  for v_value in select * from jsonb_array_elements(p_navigation) loop
    if jsonb_typeof(v_value)<>'string' or (v_value#>>'{}')<>all(v_keys) then raise exception 'Unknown destination' using errcode='22023'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_navigation))<>(select count(distinct value) from jsonb_array_elements(p_navigation)) then raise exception 'Duplicate destination' using errcode='22023'; end if;
  for v_key,v_value in select * from jsonb_each(p_labels) loop
    if v_key<>all(v_keys) or jsonb_typeof(v_value)<>'string' or length(btrim(v_value#>>'{}')) not between 1 and 80 then raise exception 'Invalid destination label' using errcode='22023'; end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text,2702));
  select revision into v_revision from public.organization_business_profiles where organization_id=p_organization_id;
  if coalesce(v_revision,0)<>p_revision then raise exception 'Business profile changed; reload before saving' using errcode='40001'; end if;
  v_revision:=coalesce(v_revision,0)+1;
  insert into public.organization_business_profiles(organization_id,revision,nouns,navigation,labels,updated_by)
    values(p_organization_id,v_revision,p_nouns,p_navigation,p_labels,auth.uid())
    on conflict(organization_id) do update set revision=excluded.revision,nouns=excluded.nouns,navigation=excluded.navigation,labels=excluded.labels,updated_at=now(),updated_by=auth.uid();
  return v_revision;
end $$;
revoke all on function public.save_business_profile(uuid,integer,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_business_profile(uuid,integer,jsonb,jsonb,jsonb) to authenticated;

-- Company sorting/grouping is a projection of one identity store, with invoker RLS.
create view public.contact_directory with(security_invoker=true) as
 select c.*,coalesce(a.company_id,case when c.contact_type='company' then c.id end) as directory_company_id,
 coalesce(a.company_name,case when c.contact_type='company' then c.name end) as directory_company_name,
 coalesce(a.company_name,c.name) as company_sort
 from public.contacts c left join lateral (
  select af.company_id,company.name as company_name from public.contact_affiliations af
   join public.contacts company on company.organization_id=af.organization_id and company.id=af.company_id
   where af.organization_id=c.organization_id and af.person_id=c.id and af.active
   order by af.is_primary desc,company.name,af.company_id limit 1
 ) a on true;
grant select on public.contact_directory to authenticated,service_role;

alter table public.opportunities add column primary_person_id uuid;
alter table public.opportunities add constraint opportunities_primary_person_same_org
 foreign key(organization_id,primary_person_id) references public.contacts(organization_id,id);
create function app.check_opportunity_primary_person() returns trigger language plpgsql set search_path='' as $$
begin
 if new.primary_person_id is not null and not exists(
  select 1 from public.contact_affiliations a where a.organization_id=new.organization_id
  and a.company_id=new.customer_id and a.person_id=new.primary_person_id and a.active
 ) then raise exception 'Primary person must be actively affiliated with the opportunity company.' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function app.check_opportunity_primary_person() from public,anon,authenticated;
create trigger opportunity_primary_person before insert or update of primary_person_id,customer_id on public.opportunities
 for each row execute function app.check_opportunity_primary_person();
create or replace function public.apply_import_run(p_organization_id uuid, p_run_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor       uuid := app.require_capability(p_organization_id, 'integration.manage');
  v_status      text;
  v_row         record;
  v_customer_id uuid;
  v_created     integer := 0;
  v_updated     integer := 0;
  v_failed      integer := 0;
  v_skipped     integer := 0;
  v_run public.import_runs;
  v_linked uuid;
  v_location uuid;
  v_address text;
  v_previous jsonb;
  v_current jsonb;
begin
  select status into v_status
  from public.import_runs
  where id = p_run_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'no such run for that organization' using errcode = '22023';
  end if;
  if v_status in ('completed','completed_with_errors') then return; end if;
  if v_status not in ('pending','running') then
    raise exception 'this run cannot be applied' using errcode='22023';
  end if;
  select * into v_run from public.import_runs where id=p_run_id and organization_id=p_organization_id;
  if exists(select 1 from public.integration_resources r where r.id=v_run.resource_id
      and r.organization_id=p_organization_id and r.resource_type='file_upload'
      and (r.metadata->>'totalRows')::integer<>v_run.rows_seen) then
    raise exception 'staging is incomplete; resume staging before applying' using errcode='22023';
  end if;
  -- Different runs for the same tenant/source cannot race past the source-link check.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||v_run.connector_key,0));
  v_created:=v_run.rows_created; v_updated:=v_run.rows_updated; v_failed:=v_run.rows_failed;

  update public.import_runs set status = 'running' where id = p_run_id;

  for v_row in
    select * from public.import_staging_rows
    where run_id = p_run_id and organization_id = p_organization_id and status = 'ready'
    order by created_at, id limit 100
  loop
    begin
      v_customer_id := null;
      v_linked := null;
      select c.id into v_linked from public.external_record_links l
        join public.contacts c on c.organization_id=l.organization_id and c.id=l.gold_entity_id
        where l.organization_id=p_organization_id and l.connector_key=v_run.connector_key
          and l.external_record_id=v_row.source_record_key and l.gold_entity_type='customer';
      if v_linked is not null then
        v_row.proposed_action:='update'; v_row.matched_customer_id:=v_linked;
      end if;

      if v_row.proposed_action = 'create' then
        if not app.has_capability(p_organization_id, 'customer.create') then
          raise exception 'you cannot add customers here' using errcode = '42501';
        end if;

        insert into public.contacts (organization_id, name, email, phone, custom, created_by, lifecycle, lead_temperature, contact_type)
        values (
          p_organization_id,
          v_row.normalized ->> 'name',
          v_row.normalized ->> 'email',
          v_row.normalized ->> 'phone',
          coalesce(v_row.normalized -> 'custom', '{}'::jsonb),
          v_actor,
          coalesce(v_row.normalized ->> 'lifecycle','lead'),
          coalesce(v_row.normalized ->> 'lead_temperature','unrated'),
          coalesce(v_row.normalized ->> 'contact_type','unspecified')
        )
        returning id into v_customer_id;

        insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
        values (
          p_organization_id, v_actor, 'customer', v_customer_id, 'customer.imported',
          jsonb_build_object('run_id', p_run_id, 'source_record_key', v_row.source_record_key)
        );

        v_created := v_created + 1;

      elsif v_row.proposed_action = 'update' then
        if not app.has_capability(p_organization_id, 'customer.update') then
          raise exception 'you cannot change customers here' using errcode = '42501';
        end if;
        if v_row.matched_customer_id is null then
          raise exception 'no matched customer to update' using errcode = '22023';
        end if;

        -- Compare mapped fields with the last successfully applied source values. Local edits win:
        -- refuse the row and retain its provenance instead of overwriting it silently.
        v_previous := null;
        select s.normalized into v_previous from public.external_record_links l
          join public.import_staging_rows s on s.organization_id=l.organization_id and s.run_id=l.run_id
            and s.source_record_key=l.external_record_id and s.status='applied'
          where l.organization_id=p_organization_id and l.connector_key=v_run.connector_key
            and l.external_record_id=v_row.source_record_key and l.gold_entity_id=v_row.matched_customer_id
            and l.gold_entity_type='customer' limit 1;
        select jsonb_build_object('name',name,'email',email,'phone',phone,'lifecycle',lifecycle,
          'lead_temperature',lead_temperature,'contact_type',contact_type,'custom',custom) into v_current from public.contacts
          where organization_id=p_organization_id and id=v_row.matched_customer_id for update;
        if v_previous is not null and (
          exists(select 1 from jsonb_each(v_row.normalized - 'custom' - 'location' - 'company_contact_id' - 'affiliation_title') f
            where v_previous ? f.key and v_current->f.key is distinct from v_previous->f.key
              and v_current->f.key is distinct from f.value and f.value <> 'null'::jsonb)
          or exists(select 1 from jsonb_each(coalesce(v_row.normalized->'custom','{}')) f
            where v_previous->'custom' ? f.key and v_current->'custom'->f.key is distinct from v_previous->'custom'->f.key
              and v_current->'custom'->f.key is distinct from f.value)) then
          raise exception 'Local edit conflict. Contact preserved. Reconcile the source with the contact, then review a new import.' using errcode='40001';
        end if;

        update public.contacts
           set name   = coalesce(v_row.normalized ->> 'name', name),
               phone  = coalesce(v_row.normalized ->> 'phone', phone),
               email = coalesce(v_row.normalized ->> 'email', email),
               contact_type = coalesce(nullif(v_row.normalized ->> 'contact_type','unspecified'),contact_type),
               lifecycle = coalesce(v_row.normalized ->> 'lifecycle', lifecycle),
               lead_temperature = coalesce(v_row.normalized ->> 'lead_temperature', lead_temperature),
               custom = custom || coalesce(v_row.normalized -> 'custom', '{}'::jsonb)
         where id = v_row.matched_customer_id
           and organization_id = p_organization_id;

        v_customer_id := v_row.matched_customer_id;

        insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
        values (
          p_organization_id, v_actor, 'customer', v_customer_id, 'customer.import_matched',
          jsonb_build_object('run_id', p_run_id, 'source_record_key', v_row.source_record_key)
        );

        v_updated := v_updated + 1;
      end if;

      if nullif(v_row.normalized->>'company_contact_id','') is not null then
        -- Exact canonical IDs only; never match or create affiliations by a similar company name.
        perform public.save_contact_affiliation(p_organization_id,v_customer_id,
          (v_row.normalized->>'company_contact_id')::uuid,v_row.normalized->>'affiliation_title',false,true);
      end if;

      v_address:=nullif(concat_ws(', ',nullif(v_row.normalized->'location'->>'address',''),
        nullif(v_row.normalized->'location'->>'city',''),nullif(v_row.normalized->'location'->>'province','')),'');
      -- A province alone does not invent a site. Available partial geography stays in the source row.
      if v_address is not null and (nullif(v_row.normalized->'location'->>'address','') is not null
          or nullif(v_row.normalized->'location'->>'city','') is not null) then
        perform app.require_capability(p_organization_id,'location.create');
        select l.id into v_location from public.locations l join public.customer_locations cl
          on cl.organization_id=l.organization_id and cl.location_id=l.id
          where cl.organization_id=p_organization_id and cl.customer_id=v_customer_id and l.address=v_address limit 1;
        if not found then
          v_location:=public.create_location(p_organization_id,v_row.normalized->>'name',v_address,null,'{}'::jsonb);
          perform public.link_customer_location(p_organization_id,v_customer_id,v_location);
        end if;
      end if;

      insert into public.external_record_links
        (organization_id, connector_key, external_record_id, gold_entity_type, gold_entity_id, run_id, resource_id, last_synced_at)
      select r.organization_id, r.connector_key, v_row.source_record_key, 'customer', v_customer_id, p_run_id, r.resource_id, now()
      from public.import_runs r
      where r.id = p_run_id
      on conflict (organization_id, connector_key, external_record_id, gold_entity_type)
      do update set gold_entity_id = excluded.gold_entity_id, run_id = excluded.run_id, last_synced_at = now();

      update public.import_staging_rows set status = 'applied', proposed_action=v_row.proposed_action, matched_customer_id=v_customer_id where id = v_row.id;
    exception when others then
      select count(*) filter(where status='applied' and proposed_action='create'),
             count(*) filter(where status='applied' and proposed_action='update')
        into v_created,v_updated from public.import_staging_rows
        where organization_id=p_organization_id and run_id=p_run_id;
      v_failed := v_failed + 1;
      update public.import_staging_rows
         set status = 'failed',
             validation_errors = validation_errors || jsonb_build_array(sqlerrm)
       where id = v_row.id;
    end;
  end loop;

  select count(*) into v_skipped
  from public.import_staging_rows
  where run_id = p_run_id and organization_id = p_organization_id
    and status in ('duplicate', 'invalid', 'ignored');

  update public.import_runs
     set status       = case when exists(select 1 from public.import_staging_rows where organization_id=p_organization_id and run_id=p_run_id and status='ready') then 'running' when v_failed > 0 then 'completed_with_errors' else 'completed' end,
         finished_at  = case when exists(select 1 from public.import_staging_rows where organization_id=p_organization_id and run_id=p_run_id and status='ready') then null else now() end,
         rows_created = v_created,
         rows_updated = v_updated,
         rows_skipped = v_skipped,
         rows_failed  = v_failed
   where id = p_run_id;
end;
$fn$;



notify pgrst,'reload schema';

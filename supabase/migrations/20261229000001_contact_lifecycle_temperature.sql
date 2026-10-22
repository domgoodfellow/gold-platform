-- Existing records remain unclassified. Defaults apply only to future inserts.
alter table public.customers add column lifecycle text,
  add column lead_temperature text not null default 'unrated';
alter table public.customers alter column lifecycle set default 'lead';
alter table public.customers add constraint customers_lifecycle_check
  check (lifecycle in ('lead','prospect','customer')),
  add constraint customers_lead_temperature_check check (lead_temperature in ('unrated','cold','warm','hot'));
comment on column public.customers.lifecycle is 'Contact lifecycle, independent of relationship and opportunity stages. NULL means legacy unclassified; never inferred from payments or stage.';

-- Atomic extensions of the established commands. Explicit capability checks guard definer writes.
create function public.create_contact(p_organization_id uuid, p_name text, p_email text, p_phone text,
  p_custom jsonb, p_lifecycle text default 'lead', p_lead_temperature text default 'unrated')
returns uuid language plpgsql security definer set search_path = '' as $fn$
declare
  actor uuid := app.require_capability(p_organization_id,'customer.create');
  contact uuid;
begin
  contact := public.create_customer(p_organization_id,p_name,p_email,p_phone,p_custom);
  update public.customers set lifecycle=coalesce(p_lifecycle,'lead'), lead_temperature=coalesce(p_lead_temperature,'unrated')
    where organization_id=p_organization_id and id=contact;
  return contact;
end;
$fn$;
revoke all on function public.create_contact(uuid,text,text,text,jsonb,text,text) from public,anon;
grant execute on function public.create_contact(uuid,text,text,text,jsonb,text,text) to authenticated;

create function public.update_contact(p_organization_id uuid, p_customer_id uuid, p_name text,
  p_email text, p_phone text, p_custom jsonb, p_stage_id uuid,
  p_lifecycle text default null, p_lead_temperature text default null)
returns void language plpgsql security definer set search_path = '' as $fn$
declare
  actor uuid := app.require_capability(p_organization_id,'customer.update');
  before public.customers;
  after public.customers;
begin
  select * into before from public.customers where organization_id=p_organization_id and id=p_customer_id for update;
  if not found then raise exception 'no such contact here, or not yours to change' using errcode='42501'; end if;
  perform public.update_customer(p_organization_id,p_customer_id,p_name,p_email,p_phone,p_custom,p_stage_id);
  update public.customers set lifecycle=coalesce(p_lifecycle,lifecycle), lead_temperature=coalesce(p_lead_temperature,lead_temperature)
    where organization_id=p_organization_id and id=p_customer_id returning * into after;
  if before.lifecycle is distinct from after.lifecycle or before.lead_temperature is distinct from after.lead_temperature then
    insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
      values(p_organization_id,actor,'customer',p_customer_id,'customer.classification_changed',
        jsonb_build_object('from_lifecycle',before.lifecycle,'to_lifecycle',after.lifecycle,
          'from_temperature',before.lead_temperature,'to_temperature',after.lead_temperature));
  end if;
end;
$fn$;
revoke all on function public.update_contact(uuid,uuid,text,text,text,jsonb,uuid,text,text) from public,anon;
grant execute on function public.update_contact(uuid,uuid,text,text,text,jsonb,uuid,text,text) to authenticated;

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
        join public.customers c on c.organization_id=l.organization_id and c.id=l.gold_entity_id
        where l.organization_id=p_organization_id and l.connector_key=v_run.connector_key
          and l.external_record_id=v_row.source_record_key and l.gold_entity_type='customer';
      if v_linked is not null then
        v_row.proposed_action:='update'; v_row.matched_customer_id:=v_linked;
      end if;

      if v_row.proposed_action = 'create' then
        if not app.has_capability(p_organization_id, 'customer.create') then
          raise exception 'you cannot add customers here' using errcode = '42501';
        end if;

        insert into public.customers (organization_id, name, email, phone, custom, created_by, lifecycle, lead_temperature)
        values (
          p_organization_id,
          v_row.normalized ->> 'name',
          v_row.normalized ->> 'email',
          v_row.normalized ->> 'phone',
          coalesce(v_row.normalized -> 'custom', '{}'::jsonb),
          v_actor,
          coalesce(v_row.normalized ->> 'lifecycle','lead'),
          coalesce(v_row.normalized ->> 'lead_temperature','unrated')
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

        update public.customers
           set name   = coalesce(v_row.normalized ->> 'name', name),
               phone  = coalesce(v_row.normalized ->> 'phone', phone),
               email = coalesce(v_row.normalized ->> 'email', email),
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


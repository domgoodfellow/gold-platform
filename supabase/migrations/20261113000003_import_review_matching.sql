-- Contact import matching and review. Staging decides one of: update the contact this source
-- record is already linked to; update the one contact with the same email (when the mapping trusts
-- email); hold the row for a person to decide (several contacts share the email, the email match is
-- not trusted, the same source record was imported before from a file with another name, its
-- contact was deleted, or only the phone number matches); skip a repeat of an earlier row of the
-- same file; or create a new contact. A name alone never matches. A person decides held rows (Create, Update
-- one of the matching contacts, or Skip) before anything is applied, and applying never creates a
-- contact that has appeared since the review without being decided.

alter table public.import_staging_rows drop constraint import_staging_rows_status_check;
alter table public.import_staging_rows add constraint import_staging_rows_status_check
  check (status in ('ready', 'review', 'duplicate', 'invalid', 'ignored', 'applied', 'failed'));
alter table public.import_staging_rows drop constraint import_staging_rows_proposed_action_check;
alter table public.import_staging_rows add constraint import_staging_rows_proposed_action_check
  check (proposed_action in ('create', 'update', 'skip', 'review'));
alter table public.import_staging_rows
  -- Why staging chose what it did; null for rows staged before this existed and for plain creates.
  add column match_reason text check (match_reason in
    ('source', 'source_other_file', 'source_deleted', 'email', 'email_shared', 'email_unconfirmed', 'phone', 'phone_in_file', 'email_in_file', 'contact_in_file')),
  -- Existing contacts this row might be, for a person to choose between. Never acted on alone.
  add column candidate_customer_ids uuid[] not null default '{}' check (cardinality(candidate_customer_ids) <= 10),
  add column decided_by uuid references auth.users(id),
  add column decided_at timestamptz,
  add constraint import_staging_rows_decision_attributed check ((decided_by is null) = (decided_at is null)),
  add constraint import_staging_rows_review_undecided check ((status = 'review') = (proposed_action = 'review'));

-- A source link whose contact was deleted stays, marked, as evidence that this source record was
-- imported and its contact deliberately removed; a later import of the same record is held for a
-- person instead of adding them back.
alter table public.external_record_links add column contact_deleted_at timestamptz;

-- Called by `delete_contact` (20261113000002) in its transaction. Marks the contact's source links,
-- clears the person's values from finished import rows (their outcome, run and source key stay),
-- holds again any waiting row that would have updated them, and drops them from candidate lists.
-- Returns how many source links were kept.
create function app.release_contact_import_provenance(p_organization_id uuid, p_contact_id uuid) returns integer
language plpgsql volatile security definer set search_path = '' as $fn$
declare v_links integer;
begin
  update public.external_record_links set contact_deleted_at = now()
   where organization_id = p_organization_id and gold_entity_type = 'customer' and gold_entity_id = p_contact_id;
  get diagnostics v_links = row_count;
  update public.import_staging_rows set raw = '{}'::jsonb, normalized = '{}'::jsonb, matched_customer_id = null
   where organization_id = p_organization_id and matched_customer_id = p_contact_id
     and status in ('applied', 'failed', 'duplicate', 'invalid', 'ignored');
  update public.import_staging_rows
     set status = 'review', proposed_action = 'review', match_reason = 'source_deleted', matched_customer_id = null,
         candidate_customer_ids = array_remove(candidate_customer_ids, p_contact_id), decided_by = null, decided_at = null
   where organization_id = p_organization_id and matched_customer_id = p_contact_id and status = 'ready';
  update public.import_staging_rows set candidate_customer_ids = array_remove(candidate_customer_ids, p_contact_id)
   where organization_id = p_organization_id and p_contact_id = any (candidate_customer_ids);
  return v_links;
end;
$fn$;
revoke all on function app.release_contact_import_provenance(uuid, uuid) from public, anon, authenticated;

create or replace function public.stage_import_rows(p_organization_id uuid, p_run_id uuid, p_rows jsonb)
returns integer language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_run public.import_runs;
  v_row jsonb;
  v_existing public.import_staging_rows;
  v_customer uuid;
  v_errors jsonb;
  v_count integer;
  v_email text;
  v_phone text;
  v_status text;
  v_action text;
  v_reason text;
  v_candidates uuid[];
  v_others uuid[];
  v_suffix text;
  v_deleted boolean;
  v_trust_email boolean;
begin
  perform app.require_capability(p_organization_id, 'integration.manage');
  select * into v_run from public.import_runs
    where id=p_run_id and organization_id=p_organization_id for update;
  if not found then raise exception 'no such run for that organization' using errcode='22023'; end if;
  if v_run.status<>'pending' then raise exception 'rows can only be staged before application' using errcode='22023'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>100 then
    raise exception 'stage at most 100 rows per batch' using errcode='22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_rows)) <>
     (select count(distinct x->>'source_record_key') from jsonb_array_elements(p_rows) x) then
    raise exception 'source keys must be present and unique within each batch' using errcode='22023';
  end if;
  v_trust_email := v_run.mapping_snapshot->>'dedupe_key' = 'email';

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if nullif(btrim(v_row->>'source_record_key'),'') is null
      or jsonb_typeof(v_row->'raw') is distinct from 'object'
      or jsonb_typeof(v_row->'normalized') is distinct from 'object'
      or jsonb_typeof(v_row->'validation_errors') is distinct from 'array' then
      raise exception 'invalid staging payload' using errcode='22023';
    end if;
    select * into v_existing from public.import_staging_rows
      where organization_id=p_organization_id and run_id=p_run_id
        and source_record_key=v_row->>'source_record_key';
    if found then
      if v_existing.raw is distinct from v_row->'raw' or v_existing.normalized is distinct from v_row->'normalized' then
        raise exception 'a staged source key cannot change; start a new run' using errcode='22023';
      end if;
      continue;
    end if;

    v_errors:=v_row->'validation_errors';
    if nullif(btrim(v_row->'normalized'->>'name'),'') is null
       or lower(btrim(v_row->'normalized'->>'name')) in ('null','none','nan') then
      v_errors:=v_errors||jsonb_build_array('Business name is missing.');
    end if;
    v_customer:=null; v_candidates:='{}'; v_reason:=null; v_status:='ready'; v_action:='create';
    v_email:=app.normalize_email(v_row->'normalized'->>'email');
    v_phone:=app.normalize_phone(v_row->'normalized'->>'phone');

    -- The stable source identifier, scoped to this organization and source, is the contact itself.
    select c.id into v_customer from public.external_record_links l
      join public.contacts c on c.organization_id=l.organization_id and c.id=l.gold_entity_id
      where l.organization_id=p_organization_id and l.connector_key=v_run.connector_key
        and l.external_record_id=v_row->>'source_record_key' and l.gold_entity_type='customer';
    -- This source record was imported before and its contact deliberately deleted.
    v_deleted := v_customer is null and exists(select 1 from public.external_record_links l
      where l.organization_id=p_organization_id and l.connector_key=v_run.connector_key
        and l.external_record_id=v_row->>'source_record_key' and l.gold_entity_type='customer' and l.contact_deleted_at is not null);

    if jsonb_array_length(v_errors)>0 then
      v_status:='invalid'; v_action:='skip';
    elsif v_customer is not null then
      v_action:='update'; v_reason:='source';
    elsif v_deleted then
      v_status:='review'; v_action:='review'; v_reason:='source_deleted';
    elsif v_email is not null and exists(select 1 from public.import_staging_rows s
        where s.organization_id=p_organization_id and s.run_id=p_run_id and s.status in ('ready','review')
          and app.normalize_email(s.normalized->>'email')=v_email) then
      -- The same email earlier in this file: one person, already on its way in.
      v_status:='duplicate'; v_action:='skip'; v_reason:='email_in_file';
    else
      if v_email is not null then
        select coalesce(array_agg(m.id order by m.id), '{}') into v_candidates
          from (select match as id from app.contact_matches(p_organization_id, 'email', v_email) match limit 10) m;
      end if;
      -- A file's source keys are scoped by its name, so the same file uploaded again under another
      -- name finds no link above. The same whole row, or the same source ID with the same name or
      -- email, linked from another file of this source is held for a person: it is probably that
      -- contact, but it is never applied alone. A source ID alone is not enough, because unrelated
      -- files often number their rows the same way.
      v_suffix:=substring(v_row->>'source_record_key' from '^[0-9a-f]{64}(:(?:id|row):.+)$');
      v_others:='{}';
      if v_suffix is not null then
        select coalesce(array_agg(m.id order by m.id), '{}') into v_others
          from (select distinct c.id from public.external_record_links l
                  join public.contacts c on c.organization_id=l.organization_id and c.id=l.gold_entity_id
                 where l.organization_id=p_organization_id and l.connector_key=v_run.connector_key
                   and l.gold_entity_type='customer' and l.external_record_id<>v_row->>'source_record_key'
                   and l.external_record_id ~ '^[0-9a-f]{64}:' and right(l.external_record_id, length(v_suffix))=v_suffix
                   and (v_suffix like ':row:%'
                     or lower(btrim(c.name))=lower(btrim(v_row->'normalized'->>'name'))
                     or (v_email is not null and app.normalize_email(c.email)=v_email))
                 limit 10) m;
      end if;
      if cardinality(v_candidates)=1 and v_trust_email then
        v_customer:=v_candidates[1]; v_candidates:='{}'; v_action:='update'; v_reason:='email';
      elsif cardinality(v_others)>0 then
        v_status:='review'; v_action:='review'; v_reason:='source_other_file';
        select coalesce(array_agg(x order by x), '{}') into v_candidates
          from (select distinct x from unnest(v_others||v_candidates) x limit 10) y;
      elsif cardinality(v_candidates)>0 then
        v_status:='review'; v_action:='review';
        v_reason:=case when cardinality(v_candidates)>1 then 'email_shared' else 'email_unconfirmed' end;
      elsif v_phone is not null then
        -- A phone number is evidence, never proof: a shared office line reaches many people. Two
        -- different emails say two people, so only a row or contact without an email is held.
        select coalesce(array_agg(m.id order by m.id), '{}') into v_candidates
          from (select c.id from app.contact_matches(p_organization_id, 'phone', v_phone) match
                  join public.contacts c on c.organization_id=p_organization_id and c.id=match
                 where v_email is null or app.normalize_email(c.email) is null limit 10) m;
        if cardinality(v_candidates)>0 then
          v_status:='review'; v_action:='review'; v_reason:='phone';
        elsif exists(select 1 from public.import_staging_rows s
            where s.organization_id=p_organization_id and s.run_id=p_run_id and s.status in ('ready','review')
              and app.normalize_phone(s.normalized->>'phone')=v_phone
              and (v_email is null or app.normalize_email(s.normalized->>'email') is null)) then
          v_status:='review'; v_action:='review'; v_reason:='phone_in_file';
        end if;
      end if;
    end if;
    -- One contact is updated by at most one row of a file.
    if v_status='ready' and v_customer is not null and exists(select 1 from public.import_staging_rows s
        where s.organization_id=p_organization_id and s.run_id=p_run_id and s.status='ready'
          and s.proposed_action='update' and s.matched_customer_id=v_customer) then
      v_status:='duplicate'; v_action:='skip'; v_reason:='contact_in_file';
    end if;

    insert into public.import_staging_rows
      (organization_id,run_id,source_record_key,raw,normalized,validation_errors,proposed_action,matched_customer_id,status,
       match_reason,candidate_customer_ids)
    values (p_organization_id,p_run_id,v_row->>'source_record_key',v_row->'raw',v_row->'normalized',v_errors,
      v_action,v_customer,v_status,v_reason,v_candidates);
  end loop;
  select count(*) into v_count from public.import_staging_rows where organization_id=p_organization_id and run_id=p_run_id;
  update public.import_runs set rows_seen=v_count where organization_id=p_organization_id and id=p_run_id;
  return v_count;
end;
$fn$;
revoke all on function public.stage_import_rows(uuid,uuid,jsonb) from public,anon;
grant execute on function public.stage_import_rows(uuid,uuid,jsonb) to authenticated;

-- A person's decision on one row before applying: create a new contact, update one of the
-- contacts it might be, or skip it. A row linked by its source ID is that contact already, so it
-- is never made into a new one. Recorded with who decided and when.
create function public.decide_import_row(p_organization_id uuid, p_run_id uuid, p_row_id uuid, p_decision text, p_customer_id uuid default null)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := app.require_capability(p_organization_id, 'integration.manage');
  v_run public.import_runs;
  v_row public.import_staging_rows;
begin
  -- Choosing between existing contacts is looking at them.
  perform app.require_capability(p_organization_id, 'customer.read');
  select * into v_run from public.import_runs where id=p_run_id and organization_id=p_organization_id for update;
  if not found then raise exception 'no such run for that organization' using errcode='22023'; end if;
  if v_run.status not in ('pending','running') then raise exception 'This import has already been applied.' using errcode='22023'; end if;
  select * into v_row from public.import_staging_rows
    where organization_id=p_organization_id and run_id=p_run_id and id=p_row_id for update;
  if not found then raise exception 'no such row in that import' using errcode='22023'; end if;
  if v_row.status not in ('ready','review','ignored') then
    raise exception 'Only rows still waiting to be imported can be decided.' using errcode='22023';
  end if;
  if v_row.match_reason='source' and p_decision='create' then
    raise exception 'This row is already linked to its contact by the source ID.' using errcode='22023';
  end if;
  if p_decision='create' then
    -- One email is one contact in a business (`customers_org_email_unique`), so this could never be created.
    if exists(select 1 from app.contact_matches(p_organization_id, 'email', v_row.normalized->>'email')) then
      raise exception 'A contact already has this email. Update that contact or skip this row.' using errcode='22023';
    end if;
    update public.import_staging_rows set proposed_action='create', matched_customer_id=null, status='ready',
      decided_by=v_actor, decided_at=now() where id=v_row.id;
  elsif p_decision='update' then
    if p_customer_id is null or not (p_customer_id=any(v_row.candidate_customer_ids)
        or p_customer_id is not distinct from v_row.matched_customer_id) then
      raise exception 'Choose one of the matching contacts.' using errcode='22023';
    end if;
    if exists(select 1 from public.import_staging_rows s where s.organization_id=p_organization_id and s.run_id=p_run_id
        and s.id<>v_row.id and s.status='ready' and s.proposed_action='update' and s.matched_customer_id=p_customer_id) then
      raise exception 'Another row in this import already updates that contact.' using errcode='22023';
    end if;
    update public.import_staging_rows set proposed_action='update', matched_customer_id=p_customer_id, status='ready',
      decided_by=v_actor, decided_at=now() where id=v_row.id;
  elsif p_decision='skip' then
    update public.import_staging_rows set proposed_action='skip', status='ignored',
      decided_by=v_actor, decided_at=now() where id=v_row.id;
  else
    raise exception 'Choose create, update or skip.' using errcode='22023';
  end if;
end;
$fn$;
revoke all on function public.decide_import_row(uuid,uuid,uuid,text,uuid) from public,anon;
grant execute on function public.decide_import_row(uuid,uuid,uuid,text,uuid) to authenticated;

-- Skip every row still waiting for a decision, in one step. Returns how many were skipped.
create function public.skip_undecided_import_rows(p_organization_id uuid, p_run_id uuid)
returns integer language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := app.require_capability(p_organization_id, 'integration.manage');
  v_count integer;
begin
  perform 1 from public.import_runs where id=p_run_id and organization_id=p_organization_id and status in ('pending','running') for update;
  if not found then raise exception 'This import cannot be changed.' using errcode='22023'; end if;
  update public.import_staging_rows set proposed_action='skip', status='ignored', decided_by=v_actor, decided_at=now()
    where organization_id=p_organization_id and run_id=p_run_id and status='review';
  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;
revoke all on function public.skip_undecided_import_rows(uuid,uuid) from public,anon;
grant execute on function public.skip_undecided_import_rows(uuid,uuid) to authenticated;

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
  v_email text;
  v_phone text;
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
  if exists(select 1 from public.import_staging_rows where organization_id=p_organization_id and run_id=p_run_id and status='review') then
    raise exception 'Decide every row marked Needs review before importing.' using errcode='22023';
  end if;
  -- Imports into one business's contacts run one at a time, whatever their source, so two runs
  -- cannot both create the same new person.
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':contact-import',0));
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
        -- A contact with this email (or, without emails to tell them apart, this phone number) that
        -- appeared after review is not created twice. A person's explicit Create stands.
        if v_row.decided_by is null then
          v_email:=app.normalize_email(v_row.normalized->>'email');
          v_phone:=app.normalize_phone(v_row.normalized->>'phone');
          if v_email is not null and exists(select 1 from app.contact_matches(p_organization_id,'email',v_email)) then
            raise exception 'A contact with this email was added after this import was reviewed. Nothing was created; review a new import.' using errcode='23505';
          end if;
          if v_phone is not null and exists(select 1 from app.contact_matches(p_organization_id,'phone',v_phone) match
              join public.contacts c on c.organization_id=p_organization_id and c.id=match
              where v_email is null or app.normalize_email(c.email) is null) then
            raise exception 'A contact with this phone number was added after this import was reviewed. Nothing was created; review a new import.' using errcode='23505';
          end if;
        end if;

        insert into public.contacts (organization_id, name, email, phone, custom, created_by, lifecycle, lead_temperature, contact_type)
        values (
          p_organization_id,
          v_row.normalized ->> 'name',
          v_row.normalized ->> 'email',
          v_row.normalized ->> 'phone',
          coalesce(v_row.normalized -> 'custom', '{}'::jsonb),
          v_actor,
          coalesce(v_row.normalized ->> 'lifecycle', v_row.normalized ->> 'default_lifecycle'),
          coalesce(v_row.normalized ->> 'lead_temperature','unrated'),
          coalesce(v_row.normalized ->> 'contact_type','unspecified')
        )
        returning id into v_customer_id;

        insert into public.events (organization_id, actor_id, entity_type, entity_id, action, payload)
        values (
          p_organization_id, v_actor, 'customer', v_customer_id, 'customer.imported',
          jsonb_build_object('run_id', p_run_id, 'source_record_key', v_row.source_record_key,
            'decided_by', v_row.decided_by)
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
          jsonb_build_object('run_id', p_run_id, 'source_record_key', v_row.source_record_key,
            'match', v_row.match_reason, 'decided_by', v_row.decided_by, 'first_from_source', v_previous is null)
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
      do update set gold_entity_id = excluded.gold_entity_id, run_id = excluded.run_id, last_synced_at = now(), contact_deleted_at = null;

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

notify pgrst, 'reload schema';

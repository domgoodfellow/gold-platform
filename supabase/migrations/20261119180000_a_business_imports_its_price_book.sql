-- A business imports its price book. A mapping may now target `price_book_item` as well as
-- `customer`; its one field is a `price_book` plan, and its rows are staged, decided and applied
-- by the price-book functions below. A row is matched to an item by the source's stable ID (an
-- external record link) or else by the item's name, which is already unique in a business
-- (`price_book_items_org_name_unique`); a match updates that item, an unchanged one is skipped.
-- Writing goes through `create_price_book_item` / `update_price_book_item`, so the currency is
-- the business's own and the events are the ones a person's edit records. Both
-- `integration.manage` and `price.manage` are required.
--
-- The three run commands keep their names and arguments; each now hands a run to the contact or
-- price-book function by the run's snapshotted target, and the contact functions (renamed, bodies
-- unchanged) are no longer callable directly, so a price-book run can never be applied as contacts.
-- A later change to how contacts are staged, decided or applied replaces the `*_contact_*`
-- function, not the dispatcher.

alter table public.integration_mappings drop constraint integration_mappings_target_entity_check;
alter table public.integration_mappings add constraint integration_mappings_target_entity_check
  check (target_entity in ('customer', 'price_book_item'));

alter table public.external_record_links drop constraint external_record_links_gold_entity_type_check;
alter table public.external_record_links add constraint external_record_links_gold_entity_type_check
  check (gold_entity_type in ('customer', 'price_book_item'));

alter table public.import_staging_rows add column matched_price_item_id uuid;
alter table public.import_staging_rows add constraint import_staging_rows_matched_price_item_fkey
  foreign key (organization_id, matched_price_item_id)
  references public.price_book_items (organization_id, id) on delete set null (matched_price_item_id);

alter table public.import_staging_rows drop constraint import_staging_rows_match_reason_check;
alter table public.import_staging_rows add constraint import_staging_rows_match_reason_check
  check (match_reason in ('source', 'source_other_file', 'source_deleted', 'email', 'email_shared', 'email_unconfirmed',
    'phone', 'phone_in_file', 'email_in_file', 'contact_in_file', 'quality', 'name', 'name_in_file'));

create or replace function public.import_pipeline_version()
returns integer language sql immutable set search_path = '' as $$ select 4 $$;

-- ---------------------------------------------------------------------------
-- The contact functions keep their bodies under new names.
-- ---------------------------------------------------------------------------

alter function public.stage_import_rows(uuid, uuid, jsonb) rename to stage_contact_import_rows;
alter function public.apply_import_run(uuid, uuid) rename to apply_contact_import_run;
alter function public.decide_import_row(uuid, uuid, uuid, text, uuid) rename to decide_contact_import_row;
revoke all on function public.stage_contact_import_rows(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.apply_contact_import_run(uuid, uuid) from public, anon, authenticated;
revoke all on function public.decide_contact_import_row(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Price book: staging
-- ---------------------------------------------------------------------------

create function public.stage_price_book_import_rows(p_organization_id uuid, p_run_id uuid, p_rows jsonb)
returns integer language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_run public.import_runs;
  v_currency text;
  v_row jsonb;
  v_key text;
  v_errors jsonb;
  v_name text;
  v_unit text;
  v_amount bigint;
  v_row_currency text;
  v_item uuid;
  v_reason text;
  v_status text;
  v_action text;
  v_count integer;
begin
  perform app.require_capability(p_organization_id, 'integration.manage');
  perform app.require_capability(p_organization_id, 'price.manage');
  select * into v_run from public.import_runs where id=p_run_id and organization_id=p_organization_id for update;
  if not found then raise exception 'no such run for that organization' using errcode='22023'; end if;
  if v_run.mapping_snapshot->>'target_entity' is distinct from 'price_book_item' then
    raise exception 'that run does not import into the price book' using errcode='22023';
  end if;
  if v_run.status<>'pending' then raise exception 'rows can only be staged before application' using errcode='22023'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>100 then
    raise exception 'stage at most 100 rows per batch' using errcode='22023';
  end if;
  select o.currency into v_currency from public.organizations o where o.id=p_organization_id;
  if v_currency is null then raise exception 'This business has not said what it trades in.' using errcode='22023'; end if;

  for v_row in select value from jsonb_array_elements(p_rows) order by (value->>'seq')::integer loop
    v_key := btrim(coalesce(v_row->>'source_record_key', ''));
    if v_key = '' or jsonb_typeof(v_row->'raw') is distinct from 'object'
      or jsonb_typeof(v_row->'normalized') is distinct from 'object'
      or jsonb_typeof(v_row->'validation_errors') is distinct from 'array' then
      raise exception 'invalid staging payload' using errcode='22023';
    end if;
    -- Resuming stages only the rows not staged yet.
    continue when exists(select 1 from public.import_staging_rows s
      where s.organization_id=p_organization_id and s.run_id=p_run_id and s.source_record_key=v_key);

    -- The values are checked here again: the price book's own rules, whatever the caller sent.
    v_errors := v_row->'validation_errors';
    v_name := btrim(coalesce(v_row->'normalized'->>'name', ''));
    v_unit := btrim(coalesce(v_row->'normalized'->>'unit', ''));
    v_amount := case when (v_row->'normalized'->>'unit_amount_minor') ~ '^[0-9]{1,15}$' then (v_row->'normalized'->>'unit_amount_minor')::bigint end;
    v_row_currency := upper(nullif(btrim(coalesce(v_row->'normalized'->>'currency', '')), ''));
    if jsonb_array_length(v_errors)=0 then
      if length(v_name) not between 1 and 200 then v_errors := v_errors || to_jsonb('An item needs a name of 200 characters or fewer.'::text); end if;
      if length(v_unit) not between 1 and 40 then v_errors := v_errors || to_jsonb('An item needs a unit of 40 characters or fewer.'::text); end if;
      if v_amount is null then v_errors := v_errors || to_jsonb('An item needs a price of zero or more.'::text); end if;
      if v_row_currency is not null and v_row_currency<>v_currency then
        v_errors := v_errors || to_jsonb(format('Priced in %s; this price book is in %s.', v_row_currency, v_currency));
      end if;
    end if;

    v_item := null; v_reason := null; v_status := 'ready'; v_action := 'create';
    if jsonb_array_length(v_errors)>0 then
      v_status := 'invalid'; v_action := 'skip';
    elsif exists(select 1 from public.import_staging_rows s where s.organization_id=p_organization_id and s.run_id=p_run_id
        and s.status in ('ready','review','ignored') and lower(btrim(s.normalized->>'name'))=lower(v_name)) then
      -- An earlier row of this source names the same item.
      v_status := 'duplicate'; v_action := 'skip'; v_reason := 'name_in_file';
    else
      select i.id into v_item from public.external_record_links l
        join public.price_book_items i on i.organization_id=l.organization_id and i.id=l.gold_entity_id
       where l.organization_id=p_organization_id and l.gold_entity_type='price_book_item'
         and l.connector_key=v_run.connector_key and l.external_record_id=v_key;
      if v_item is not null then v_reason := 'source';
      else
        select i.id into v_item from public.price_book_items i
         where i.organization_id=p_organization_id and lower(btrim(i.name))=lower(v_name);
        if v_item is not null then v_reason := 'name'; end if;
      end if;
      if v_item is not null then
        v_action := 'update';
        if exists(select 1 from public.price_book_items i where i.id=v_item
            and i.name=v_name and i.unit=v_unit and i.unit_amount_minor=v_amount) then
          v_status := 'ignored'; v_action := 'skip';
        end if;
      end if;
    end if;

    insert into public.import_staging_rows
      (organization_id, run_id, source_record_key, raw, normalized, validation_errors, proposed_action, matched_price_item_id, status, match_reason)
    values (p_organization_id, p_run_id, v_key, v_row->'raw',
      jsonb_build_object('name', v_name, 'unit', v_unit, 'unit_amount_minor', v_amount, 'currency', v_currency),
      v_errors, v_action, v_item, v_status, v_reason);
  end loop;

  select count(*) into v_count from public.import_staging_rows where organization_id=p_organization_id and run_id=p_run_id;
  update public.import_runs set rows_seen=v_count where organization_id=p_organization_id and id=p_run_id;
  return v_count;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Price book: a person's decision on one row
-- ---------------------------------------------------------------------------

create function public.decide_price_book_import_row(p_organization_id uuid, p_run_id uuid, p_row_id uuid, p_decision text)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_actor uuid := app.require_capability(p_organization_id, 'integration.manage');
  v_run public.import_runs;
  v_row public.import_staging_rows;
begin
  perform app.require_capability(p_organization_id, 'price.manage');
  select * into v_run from public.import_runs where id=p_run_id and organization_id=p_organization_id for update;
  if not found then raise exception 'no such run for that organization' using errcode='22023'; end if;
  if v_run.status not in ('pending','running') then raise exception 'This import has already been applied.' using errcode='22023'; end if;
  select * into v_row from public.import_staging_rows
    where organization_id=p_organization_id and run_id=p_run_id and id=p_row_id for update;
  if not found then raise exception 'no such row in that import' using errcode='22023'; end if;
  if v_row.status not in ('ready','review','ignored') then
    raise exception 'Only rows still waiting to be imported can be decided.' using errcode='22023';
  end if;
  if p_decision='create' then
    if v_row.matched_price_item_id is not null or exists(select 1 from public.price_book_items i
        where i.organization_id=p_organization_id and lower(btrim(i.name))=lower(btrim(v_row.normalized->>'name'))) then
      raise exception 'An item already has this name. Update that item or skip this row.' using errcode='22023';
    end if;
    update public.import_staging_rows set proposed_action='create', status='ready', decided_by=v_actor, decided_at=now() where id=v_row.id;
  elsif p_decision='update' then
    if v_row.matched_price_item_id is null then
      raise exception 'No item in the price book matches this row.' using errcode='22023';
    end if;
    update public.import_staging_rows set proposed_action='update', status='ready', decided_by=v_actor, decided_at=now() where id=v_row.id;
  elsif p_decision='skip' then
    update public.import_staging_rows set proposed_action='skip', status='ignored', decided_by=v_actor, decided_at=now() where id=v_row.id;
  else
    raise exception 'Choose create, update or skip.' using errcode='22023';
  end if;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Price book: applying, one bounded batch per call
-- ---------------------------------------------------------------------------

create function public.apply_price_book_import_run(p_organization_id uuid, p_run_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
declare
  v_run public.import_runs;
  v_row public.import_staging_rows;
  v_item uuid;
  v_failed integer;
  v_more boolean;
begin
  perform app.require_capability(p_organization_id, 'integration.manage');
  perform app.require_capability(p_organization_id, 'price.manage');
  select * into v_run from public.import_runs where id=p_run_id and organization_id=p_organization_id for update;
  if not found then raise exception 'no such run for that organization' using errcode='22023'; end if;
  if v_run.mapping_snapshot->>'target_entity' is distinct from 'price_book_item' then
    raise exception 'that run does not import into the price book' using errcode='22023';
  end if;
  if v_run.status in ('completed','completed_with_errors') then return; end if;
  if v_run.status not in ('pending','running') then raise exception 'this run cannot be applied' using errcode='22023'; end if;
  if exists(select 1 from public.import_staging_rows where organization_id=p_organization_id and run_id=p_run_id and status='review') then
    raise exception 'Decide every row marked Needs review before importing.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text||':price-book-import',0));
  update public.import_runs set status='running' where id=p_run_id;

  for v_row in
    select * from public.import_staging_rows
     where organization_id=p_organization_id and run_id=p_run_id and status='ready'
     order by created_at, id limit 100
  loop
    begin
      if v_row.proposed_action='update' then
        v_item := v_row.matched_price_item_id;
        perform public.update_price_book_item(v_item, v_row.normalized->>'name', v_row.normalized->>'unit', (v_row.normalized->>'unit_amount_minor')::bigint);
      else
        v_item := public.create_price_book_item(p_organization_id, v_row.normalized->>'name', v_row.normalized->>'unit', (v_row.normalized->>'unit_amount_minor')::bigint);
      end if;
      insert into public.external_record_links
        (organization_id, connector_key, external_record_id, gold_entity_type, gold_entity_id, run_id, resource_id, last_synced_at)
      values (p_organization_id, v_run.connector_key, v_row.source_record_key, 'price_book_item', v_item, p_run_id, v_run.resource_id, now())
      on conflict (organization_id, connector_key, external_record_id, gold_entity_type)
      do update set gold_entity_id=excluded.gold_entity_id, run_id=excluded.run_id, last_synced_at=now();
      update public.import_staging_rows set status='applied', matched_price_item_id=v_item where id=v_row.id;
    exception when others then
      update public.import_staging_rows set status='failed', validation_errors=validation_errors || jsonb_build_array(sqlerrm) where id=v_row.id;
    end;
  end loop;

  select count(*) filter (where status='failed'), bool_or(status='ready') into v_failed, v_more
    from public.import_staging_rows where organization_id=p_organization_id and run_id=p_run_id;
  update public.import_runs r
     set status       = case when coalesce(v_more,false) then 'running' when v_failed>0 then 'completed_with_errors' else 'completed' end,
         finished_at  = case when coalesce(v_more,false) then null else now() end,
         rows_created = c.created, rows_updated = c.updated, rows_skipped = c.skipped, rows_failed = v_failed
    from (select count(*) filter (where status='applied' and proposed_action='create') created,
                 count(*) filter (where status='applied' and proposed_action='update') updated,
                 count(*) filter (where status in ('duplicate','invalid','ignored')) skipped
            from public.import_staging_rows where organization_id=p_organization_id and run_id=p_run_id) c
   where r.id=p_run_id;
end;
$fn$;

revoke all on function public.stage_price_book_import_rows(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.decide_price_book_import_row(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.apply_price_book_import_run(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The run commands, by the run's target
-- ---------------------------------------------------------------------------

create function app.import_run_target(p_organization_id uuid, p_run_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select r.mapping_snapshot->>'target_entity' from public.import_runs r where r.organization_id=p_organization_id and r.id=p_run_id
$$;
revoke all on function app.import_run_target(uuid, uuid) from public, anon, authenticated;

create function public.stage_import_rows(p_organization_id uuid, p_run_id uuid, p_rows jsonb)
returns integer language plpgsql volatile security definer set search_path = '' as $fn$
begin
  if app.import_run_target(p_organization_id, p_run_id) = 'price_book_item' then
    return public.stage_price_book_import_rows(p_organization_id, p_run_id, p_rows);
  end if;
  return public.stage_contact_import_rows(p_organization_id, p_run_id, p_rows);
end;
$fn$;

create function public.decide_import_row(p_organization_id uuid, p_run_id uuid, p_row_id uuid, p_decision text, p_customer_id uuid default null)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
begin
  if app.import_run_target(p_organization_id, p_run_id) = 'price_book_item' then
    perform public.decide_price_book_import_row(p_organization_id, p_run_id, p_row_id, p_decision);
  else
    perform public.decide_contact_import_row(p_organization_id, p_run_id, p_row_id, p_decision, p_customer_id);
  end if;
end;
$fn$;

create function public.apply_import_run(p_organization_id uuid, p_run_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $fn$
begin
  if app.import_run_target(p_organization_id, p_run_id) = 'price_book_item' then
    perform public.apply_price_book_import_run(p_organization_id, p_run_id);
  else
    perform public.apply_contact_import_run(p_organization_id, p_run_id);
  end if;
end;
$fn$;

revoke all on function public.stage_import_rows(uuid, uuid, jsonb) from public, anon;
grant execute on function public.stage_import_rows(uuid, uuid, jsonb) to authenticated;
revoke all on function public.decide_import_row(uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function public.decide_import_row(uuid, uuid, uuid, text, uuid) to authenticated;
revoke all on function public.apply_import_run(uuid, uuid) from public, anon;
grant execute on function public.apply_import_run(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';

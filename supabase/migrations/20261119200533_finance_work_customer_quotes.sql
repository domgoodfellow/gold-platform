-- Finance owns prices and proposals; Work owns delivery configuration and execution.
alter table public.work_item_types add column archived_at timestamptz;
alter table public.price_book_items add column delivery_type_id uuid;
alter table public.price_book_items add constraint price_book_delivery_type_same_org
  foreign key (organization_id, delivery_type_id)
  references public.work_item_types (organization_id, id) on delete restrict;

create function public.set_catalog_delivery_type(p_item_id uuid, p_type_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.price_book_items where id=p_item_id for update;
  if auth.uid() is null or v_org is null or v_org not in (select app.current_tenant_ids())
     or not app.has_capability(v_org,'price.manage') then
    raise insufficient_privilege using message='You cannot manage this catalog.';
  end if;
  if not exists(select 1 from public.usable_modules(v_org) m where m='billing') then
    raise insufficient_privilege using message='The catalog is not available for this business.';
  end if;
  if p_type_id is not null and not exists(select 1 from public.work_item_types
      where id=p_type_id and organization_id=v_org and archived_at is null) then
    raise exception 'Choose an active Work type in this business.' using errcode='22023';
  end if;
  update public.price_book_items set delivery_type_id=p_type_id where id=p_item_id;
end $$;
revoke all on function public.set_catalog_delivery_type(uuid,uuid) from public,anon;
grant execute on function public.set_catalog_delivery_type(uuid,uuid) to authenticated;

create function public.archive_work_item_type(p_type_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.work_item_types where id=p_type_id for update;
  if auth.uid() is null or v_org is null or v_org not in (select app.current_tenant_ids())
      or not app.has_capability(v_org,'field.manage') then
    raise insufficient_privilege using message='You cannot manage this Work type.';
  end if;
  update public.work_item_types set archived_at=case when p_archived then coalesce(archived_at,now()) else null end,
    booking_status_id=case when p_archived then null else booking_status_id end,
    booking_duration_minutes=case when p_archived then null else booking_duration_minutes end
    where id=p_type_id;
  insert into public.events(organization_id,actor_id,entity_type,entity_id,action,payload)
    values(v_org,auth.uid(),'work_item_type',p_type_id,
      case when p_archived then 'work_item_type.archived' else 'work_item_type.restored' end,'{}');
end $$;
revoke all on function public.archive_work_item_type(uuid,boolean) from public,anon;
grant execute on function public.archive_work_item_type(uuid,boolean) to authenticated;

-- Locking the type also serializes creation with archival. Existing Work remains editable.
create function app.require_active_delivery_type() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.work_item_types where organization_id=new.organization_id
    and id=new.type_id and archived_at is null for share;
  if not found then raise exception 'This Work type is archived or unavailable.' using errcode='22023'; end if;
  return new;
end $$;
revoke all on function app.require_active_delivery_type() from public,anon,authenticated;
create trigger work_items_active_type before insert on public.work_items
  for each row execute function app.require_active_delivery_type();

create function app.prevent_archived_booking() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.archived_at is not null and new.booking_status_id is not null then
    raise exception 'Restore this Work type before publishing booking.' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function app.prevent_archived_booking() from public,anon,authenticated;
create trigger work_type_active_booking before update on public.work_item_types
  for each row execute function app.prevent_archived_booking();

-- Deletion is deliberately stricter than archival: even configuration references prevent it.
create function public.work_type_deletable(p_type_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare v_org uuid; r record; v_used boolean; v_predicate text;
begin
  select organization_id into v_org from public.work_item_types where id=p_type_id and archived_at is not null;
  if auth.uid() is null or v_org is null or v_org not in(select app.current_tenant_ids())
      or not app.has_capability(v_org,'field.manage') then return false; end if;
  for r in select c.conrelid, c.conkey, c.confkey from pg_catalog.pg_constraint c
      where c.contype='f' and c.confrelid='public.work_item_types'::regclass loop
    select string_agg(format('%I = %L::%s',a.attname,
        case when b.attname='id' then p_type_id else v_org end,
        pg_catalog.format_type(a.atttypid,a.atttypmod)), ' and ')
      into v_predicate
      from unnest(r.conkey,r.confkey) k(child,parent)
      join pg_catalog.pg_attribute a on a.attrelid=r.conrelid and a.attnum=k.child
      join pg_catalog.pg_attribute b on b.attrelid='public.work_item_types'::regclass and b.attnum=k.parent;
    execute format('select exists(select 1 from %s where %s)',r.conrelid::regclass,v_predicate) into v_used;
    if v_used then return false; end if;
  end loop;
  -- Rules and reviewed setup documents can also hold type IDs without foreign keys.
  if exists(select 1 from public.automation_rules where organization_id=v_org and to_jsonb(automation_rules)::text like '%'||p_type_id::text||'%') then return false; end if;
  return true;
end $$;
revoke all on function public.work_type_deletable(uuid) from public,anon;
grant execute on function public.work_type_deletable(uuid) to authenticated;
create function public.delete_unused_work_type(p_type_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  -- Serialize referencing writes as well as the final dependency check.
  perform 1 from public.work_item_types where id=p_type_id for update;
  if not public.work_type_deletable(p_type_id) then
    raise exception 'Archive this type and remove its dependencies before deleting it.' using errcode='42501';
  end if;
  delete from public.work_item_types where id=p_type_id;
end $$;
revoke all on function public.delete_unused_work_type(uuid) from public,anon;
grant execute on function public.delete_unused_work_type(uuid) to authenticated;

-- Atomic delivery + current catalog snapshot. A refused price leaves no orphan Work.
create function public.create_work_from_service(p_organization_id uuid,p_title text,p_status_id uuid,
  p_customer_id uuid,p_location_id uuid,p_resource_ids uuid[],p_asset_id uuid,p_custom jsonb,
  p_item_id uuid,p_quantity integer) returns uuid
language plpgsql security invoker set search_path='' as $$
declare v_work uuid; v_type uuid;
begin
  select delivery_type_id into v_type from public.price_book_items
    where organization_id=p_organization_id and id=p_item_id for share;
  if v_type is null or not exists(select 1 from public.work_item_statuses
      where organization_id=p_organization_id and id=p_status_id and type_id=v_type) then
    raise exception 'Choose a starting stage for the service delivery type.' using errcode='22023';
  end if;
  v_work := public.create_work_item(p_organization_id,p_title,p_status_id,p_customer_id,p_location_id,p_resource_ids,p_asset_id,p_custom);
  perform public.add_work_item_priced_line(v_work,p_item_id,p_quantity);
  return v_work;
end $$;
revoke all on function public.create_work_from_service(uuid,text,uuid,uuid,uuid,uuid[],uuid,jsonb,uuid,integer) from public,anon;
grant execute on function public.create_work_from_service(uuid,text,uuid,uuid,uuid,uuid[],uuid,jsonb,uuid,integer) to authenticated;

-- Fulfil an accepted quote line without creating a second charge. The proposal remains the
-- financial source; Work records delivery only, and its historical link survives catalog edits.
alter table public.work_items add column source_proposal_id uuid;
alter table public.work_items add column source_proposal_position integer;
alter table public.work_items add constraint work_source_proposal_same_org
  foreign key (organization_id,source_proposal_id) references public.customer_commercial_proposals(organization_id,id) on delete restrict;
alter table public.work_items add constraint work_source_proposal_pair
  check ((source_proposal_id is null) = (source_proposal_position is null));
create function app.delivery_customer_follows_quote() returns trigger language plpgsql set search_path='' as $$
begin
  if old.source_proposal_id is not null and new.customer_id is distinct from old.customer_id then
    raise exception 'The delivery customer comes from the accepted quote.' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function app.delivery_customer_follows_quote() from public,anon,authenticated;
create trigger delivery_customer_from_quote before update of customer_id on public.work_items
  for each row execute function app.delivery_customer_follows_quote();
create unique index work_one_delivery_per_quote_line on public.work_items(organization_id,source_proposal_id,source_proposal_position)
  where source_proposal_id is not null;
-- Only this command can set provenance; the ordinary column grants do not include these columns.
create function public.create_work_from_proposal(p_organization_id uuid,p_proposal_id uuid,p_position integer,p_title text,
  p_status_id uuid,p_location_id uuid,p_resource_ids uuid[],p_asset_id uuid,p_custom jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_proposal public.customer_commercial_proposals; v_item uuid; v_type uuid; v_work uuid;
begin
  select * into v_proposal from public.customer_commercial_proposals where id=p_proposal_id for share;
  if auth.uid() is null or v_proposal.organization_id is null or v_proposal.organization_id is distinct from p_organization_id
    or v_proposal.organization_id not in (select app.current_tenant_ids())
    or not app.has_capability(v_proposal.organization_id,'work_item.create') then
    raise insufficient_privilege using message='You cannot deliver this quote.';
  end if;
  if v_proposal.basis<>'catalog' or v_proposal.status<>'accepted' then
    raise exception 'Accept the customer quote before creating delivery.' using errcode='22023';
  end if;
  select price_book_item_id into v_item from public.customer_commercial_proposal_lines
    where organization_id=v_proposal.organization_id and proposal_id=p_proposal_id and position=p_position;
  select delivery_type_id into v_type from public.price_book_items
    where organization_id=v_proposal.organization_id and id=v_item for share;
  if v_type is null or not exists(select 1 from public.work_item_statuses
    where organization_id=v_proposal.organization_id and type_id=v_type and id=p_status_id) then
    raise exception 'Link this service to a delivery Work type and choose its starting stage.' using errcode='22023';
  end if;
  select id into v_work from public.work_items where organization_id=v_proposal.organization_id
    and source_proposal_id=p_proposal_id and source_proposal_position=p_position;
  if v_work is not null then return v_work; end if;
  -- The unique constraint below also fences concurrent double-clicks. A failed insert rolls back
  -- the ordinary creation command, including its event, checklist and resource assignments.
  begin
    v_work := public.create_work_item(v_proposal.organization_id,p_title,p_status_id,v_proposal.customer_id,
      p_location_id,p_resource_ids,p_asset_id,p_custom);
    update public.work_items set source_proposal_id=p_proposal_id,source_proposal_position=p_position where id=v_work;
  exception when unique_violation then
    select id into v_work from public.work_items where organization_id=v_proposal.organization_id
      and source_proposal_id=p_proposal_id and source_proposal_position=p_position;
    if v_work is null then raise; end if;
  end;
  return v_work;
end $$;
revoke all on function public.create_work_from_proposal(uuid,uuid,integer,text,uuid,uuid,uuid[],uuid,jsonb) from public,anon;
grant execute on function public.create_work_from_proposal(uuid,uuid,integer,text,uuid,uuid,uuid[],uuid,jsonb) to authenticated;

create function app.prevent_delivery_requotation() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.work_items where organization_id=new.organization_id and id=new.work_item_id and source_proposal_id is not null) then
    raise exception 'Invoice delivery from the accepted customer quote.' using errcode='22023';
  end if;
  return new;
end $$;
revoke all on function app.prevent_delivery_requotation() from public,anon,authenticated;
create trigger proposal_delivery_no_second_quote before insert on public.work_item_priced_lines
  for each row execute function app.prevent_delivery_requotation();

-- Extend the existing invoker projection. No quote table and no changes to stored terms.
do $$
declare v_existing text;
begin
  v_existing := rtrim(pg_get_viewdef('public.finance_quote_records'::regclass,true), E';\n ');
  execute 'create or replace view public.finance_quote_records with (security_invoker=true) as '
    || 'select q.*,q.work_item_id as quote_id,null::uuid as proposal_id from ('||v_existing||') q union all '
    || $view$select null::uuid,p.organization_id,'Quote v'||p.version,p.created_at,p.customer_id,c.name,
      p.status,(select count(*) from public.customer_commercial_proposal_lines l where l.proposal_id=p.id),
      p.catalog_total_minor,p.currency,exists(select 1 from public.invoices i where i.organization_id=p.organization_id and i.proposal_id=p.id),p.id,p.id
      from public.customer_commercial_proposals p left join public.contacts c on c.organization_id=p.organization_id and c.id=p.customer_id
      where p.basis='catalog' and (p.version=(select max(n.version) from public.customer_commercial_proposals n
        where n.organization_id=p.organization_id and n.customer_id=p.customer_id)
        or p.status='accepted' or exists(select 1 from public.invoices i where i.organization_id=p.organization_id and i.proposal_id=p.id))$view$;
end $$;

-- Declined customer quotes remain readable, but are never money awaiting an invoice.
do $$
declare v_definition text;
begin
  v_definition := pg_get_functiondef('public.finance_dashboard_summary(uuid,date,date)'::regprocedure);
  execute replace(v_definition,'and not invoiced)', 'and not invoiced and (proposal_id is null or status <> ''declined''))');
end $$;

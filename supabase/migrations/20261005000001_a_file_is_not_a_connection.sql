-- A file is not a connection.
--
-- `csv` was seeded as a connector ("CSV / spreadsheet file", auth_method none) so that an uploaded
-- file had a `connection_id` to hang from. That modelled a format as a system: a Connection is a
-- persistent relationship with an outside provider that is authorized, configured, synced and
-- disconnected, and a file has none of those. It also put CSV on every business's Browse screen
-- beside Google and HubSpot.
--
-- An uploaded file is now an `integration_resources` row with no connection, held up by its own
-- bytes (`storage_path`). The check below is what says so: a resource belongs to a connection or
-- to a stored file, and never to nothing. Everything a run needs from the source is read from the
-- resource, so `begin_import_run` no longer requires a connection either.

alter table public.integration_resources
  alter column connection_id drop not null;

alter table public.integration_resources
  add constraint integration_resources_has_an_owner
  check (connection_id is not null or storage_path is not null);

comment on column public.integration_resources.connection_id is
  'The external system this was reached through. Null for an uploaded file, which belongs to none and is held up by storage_path instead.';

-- Existing uploads leave their fake connection. `integration_resources` cascades from a
-- connection, so the resources are detached first; the composite foreign key is MATCH SIMPLE, so a
-- null connection_id is simply not checked.
update public.integration_resources r
   set connection_id = null,
       resource_type = 'file_upload',
       updated_at    = now()
  from public.integration_connections c
 where c.id = r.connection_id
   and c.connector_key = 'csv'
   and r.storage_path is not null;

-- A `csv` connection holds no credential (auth_method none), so nothing is lost by removing it.
delete from public.integration_connections where connector_key = 'csv';
delete from public.platform_connectors     where key = 'csv';

-- What a run records as its source when the source is a file rather than a connector. Rewritten on
-- the two places that carried the old key so a re-import of the same file still lands on the
-- external_record_links row it already made, instead of beginning a second history.
update public.import_runs           set connector_key = 'file_upload' where connector_key = 'csv';
update public.external_record_links set connector_key = 'file_upload' where connector_key = 'csv';

create or replace function public.begin_import_run(p_organization_id uuid, p_mapping_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_actor         uuid := app.require_capability(p_organization_id, 'integration.manage');
  v_mapping       record;
  v_source_key    text;
  v_run_id        uuid;
begin
  select m.resource_id, m.mapping, m.dedupe_key, m.target_entity
    into v_mapping
  from public.integration_mappings m
  where m.id = p_mapping_id
    and m.organization_id = p_organization_id;

  if not found then
    raise exception 'no such mapping for that organization' using errcode = '22023';
  end if;

  -- A resource reached through a connection names that connector; an uploaded file has no
  -- connection and is its own source.
  select coalesce(c.connector_key, 'file_upload') into v_source_key
  from public.integration_resources r
  left join public.integration_connections c
    on c.organization_id = r.organization_id and c.id = r.connection_id
  where r.id = v_mapping.resource_id
    and r.organization_id = p_organization_id;

  if v_source_key is null then
    raise exception 'that mapping''s resource does not exist' using errcode = '22023';
  end if;

  insert into public.import_runs
    (organization_id, resource_id, mapping_id, connector_key, mapping_snapshot, initiated_by)
  values (
    p_organization_id,
    v_mapping.resource_id,
    p_mapping_id,
    v_source_key,
    jsonb_build_object(
      'mapping', v_mapping.mapping,
      'dedupe_key', v_mapping.dedupe_key,
      'target_entity', v_mapping.target_entity
    ),
    v_actor
  )
  returning id into v_run_id;

  return v_run_id;
end;
$fn$;

-- A tenant session could insert or edit any `integration_resources` row, including one claiming
-- to be a zone or a DNS record `app.services.dns` had actually discovered or written -- work
-- order 1 closeout, section 2.
--
-- **The gap.** `integration_resources_insert`/`_update` (20260914000001) check only organization
-- membership and `integration.manage`; neither looks at `resource_type`. `record_integration_resource`
-- (20260914000002) is `language plpgsql`, not `security definer` -- it is a convenience wrapper
-- that adds an audit event, not a privilege boundary, so its insert is exactly as permissive as a
-- raw one. Discovery (`replace_integration_resources`, D56) already writes every OAuth-reached
-- resource through `integration_operator`, a role no human session can wear -- but nothing ever
-- stopped a tenant's own token from inserting the same shape of row directly and having the DNS
-- reconciler (`app.services.dns.operations`) read it back as proof GildOps itself observed or
-- created something it never did.
--
-- **The fix is structural, not a list of today's resource types.** `connector_key` and
-- `resource_type` are open vocabulary on purpose (`20260914000001`'s own file header): a ninth
-- connector adds itself with an adapter, never a migration. Enumerating "google_calendar,
-- hubspot_pipeline, cloudflare_zone, ..." in a policy would quietly defeat that the day a tenth
-- connector ships and nobody remembers to update a list here. What every provider-discovered
-- resource already has, and what a tenant-owned artifact (today: an uploaded import file) already
-- lacks, is a `connection_id` -- a resource reached *through* an authorization is never one a
-- session typed in by hand. A tenant may still create or edit a resource with no connection_id
-- (a file, D63); a resource tied to one is provider evidence, and only the machine role that reads
-- the connection's own credential may write it.
--
-- **The DNS bridge's own provenance write moves onto the same door.** `app.services.dns.operations`
-- previously wrote a `cloudflare_dns_record` resource under the caller's own forwarded token --
-- which this migration now refuses outright, so that code is corrected in the same change
-- (`app/services/dns/operations.py`) to call `record_managed_integration_resource` instead, the
-- `replace_integration_resources` sibling this file adds for a single upsert rather than a bulk
-- resync.

drop policy integration_resources_insert on public.integration_resources;

create policy integration_resources_insert on public.integration_resources
  for insert to authenticated
  with check (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'integration.manage')
    and connection_id is null
  );

drop policy integration_resources_update on public.integration_resources;

create policy integration_resources_update on public.integration_resources
  for update to authenticated
  using (
    organization_id in (select app.current_tenant_ids())
    and app.has_capability(organization_id, 'integration.manage')
    and connection_id is null
  )
  with check (
    organization_id in (select app.current_tenant_ids())
    and connection_id is null
  );

comment on policy integration_resources_insert on public.integration_resources is
  'A tenant may create a resource with no connection_id (today: an uploaded file, D63). Anything reached through a connection is provider evidence and is written only by integration_operator (record_managed_integration_resource, replace_integration_resources).';

comment on policy integration_resources_update on public.integration_resources is
  'The same boundary as the insert policy, both directions: a tenant may not touch an existing connection-scoped row, and may not move a row it owns onto one by setting connection_id.';

-- ---------------------------------------------------------------------------
-- The machine door for one resource, not a whole connection's resync
-- ---------------------------------------------------------------------------

-- `replace_integration_resources` is the right shape for "here is everything this authorization
-- can reach right now" (a connector's own discovery, which disables whatever the provider no
-- longer lists). A DNS record `app.services.dns` ensures is the opposite shape: exactly one
-- resource, recorded or corrected on its own, that must never cause every other resource under
-- the same connection to be marked stale. Same role, same ownership derivation (the connection
-- names its own organization; the caller names neither) -- a sibling door, not a second system.
create function public.record_managed_integration_resource(
  p_connection_id uuid,
  p_resource_type text,
  p_external_id   text,
  p_display_name  text,
  p_metadata      jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_org uuid;
  v_id  uuid;
begin
  select organization_id into v_org from public.integration_connections where id = p_connection_id;
  if not found then
    raise exception 'no such connection' using errcode = '22023';
  end if;

  if p_resource_type !~ '^[a-z][a-z0-9_]{0,40}$' then
    raise exception 'resource_type must be lowercase letters, digits and underscores' using errcode = '22023';
  end if;
  if p_external_id is null or length(btrim(p_external_id)) = 0 then
    raise exception 'external_id is required for a managed resource' using errcode = '22023';
  end if;

  insert into public.integration_resources
    (organization_id, connection_id, resource_type, external_id, display_name, metadata)
  values
    (v_org, p_connection_id, p_resource_type, p_external_id,
     left(coalesce(nullif(btrim(p_display_name), ''), p_external_id), 200),
     coalesce(p_metadata, '{}'::jsonb))
  on conflict (organization_id, connection_id, resource_type, external_id) where external_id is not null
  do update set display_name = excluded.display_name, metadata = excluded.metadata,
                status = 'active', updated_at = now()
  returning id into v_id;

  return v_id;
end;
$fn$;

comment on function public.record_managed_integration_resource(uuid, text, text, text, jsonb) is
  'Records or corrects one provider-observed resource under a connection this role already proved by reading its credential. integration_operator only -- the tenant-forgery door this migration closes has no other replacement.';

revoke all on function public.record_managed_integration_resource(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_managed_integration_resource(uuid, text, text, text, jsonb) to integration_operator;

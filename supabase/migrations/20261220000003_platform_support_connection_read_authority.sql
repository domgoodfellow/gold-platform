-- Tenant connection diagnostics are part of audited organization support, not registry editing.
begin;
CREATE OR REPLACE FUNCTION public.organization_integration_connections(p_organization_id uuid)
 RETURNS TABLE(id uuid, connector_key text, connector_name text, account_label text, status text, scopes text[], has_credential boolean, resource_count bigint, last_verified_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform app.require_platform_capability('platform.organizations');

  return query
  select c.id, c.connector_key, coalesce(k.name, c.connector_key), c.account_label, c.status, c.scopes,
         c.secret_id is not null,
         (select count(*) from public.integration_resources r where r.connection_id = c.id),
         c.last_verified_at, c.created_at
    from public.integration_connections c
    left join public.platform_connectors k on k.key = c.connector_key
   where c.organization_id = p_organization_id
   order by c.created_at desc;
end;
$function$;
notify pgrst, 'reload schema';
commit;

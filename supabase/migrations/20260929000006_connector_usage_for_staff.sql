-- Platform → Integrations answers "which businesses are connected to each connector, and is any
-- of it failing" without opening one business at a time.
--
-- Counts only. A staff reader learns how many connections exist and how many need attention,
-- never an account label or a credential (D55): `secret_id` is not selected, and the function is
-- the one door because `integration_connections` has no staff read policy across tenants (I21).

create function public.platform_connector_usage()
returns table (
  connector_key         text,
  active_connections    bigint,
  attention_connections bigint,
  organizations         bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
begin
  perform app.require_platform_staff();

  return query
  select c.connector_key,
         count(*) filter (where c.status = 'active'),
         count(*) filter (where c.status = 'needs_attention'),
         count(distinct c.organization_id) filter (where c.status <> 'disconnected')
    from public.integration_connections c
   group by c.connector_key;
end;
$fn$;

comment on function public.platform_connector_usage() is
  'Platform staff''s per-connector counts of connections and of those needing attention. Counts only: no account, no credential (D55).';

revoke all on function public.platform_connector_usage() from public;
grant execute on function public.platform_connector_usage() to authenticated;

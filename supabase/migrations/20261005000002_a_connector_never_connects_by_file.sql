-- `connection_method = 'file'` existed for the `csv` connector, removed in 20261005000001. A file
-- is an artifact handed to GOLD, not a way of connecting to an outside system, so the value has no
-- referent left and would only invite the next file format to be catalogued as a connector.

update public.platform_connectors set connection_method = 'custom' where connection_method = 'file';

alter table public.platform_connectors drop constraint platform_connectors_connection_method_check;
alter table public.platform_connectors
  add constraint platform_connectors_connection_method_check
  check (connection_method in ('native', 'mcp', 'automation', 'custom'));

-- Cloudflare: a tenant's own DNS account, as a Connector (D33, D55) -- work order 1, section 1.
--
-- **Tenant-owned, not GildOps-provisioned.** The custom-domain hosting account Vercel attaches a
-- hostname to is a `platform_provider_account` GildOps owns (D44/D62, `20261010000001`). The
-- Cloudflare account that answers for a business's own DNS is the opposite ownership -- the
-- business holds it, GildOps stores a reference, the same `integration_connections` axis
-- `20260914000001` built for a tenant's own Google Workspace or HubSpot. Modelling Cloudflare as a
-- second `organization_provider_bindings` row would borrow a table whose grants and doors all
-- assume the writer is staff; it is not, here.
--
-- **No new table, and no new index either.** A connected zone is discovered exactly like a Google
-- calendar or a Drive sheet -- `integration_resources`, `resource_type = 'cloudflare_zone'`, the
-- column already open vocabulary (`20260914000001`'s own file header). A DNS record this runtime
-- writes is provenance of the same shape, `resource_type = 'cloudflare_dns_record'`. The retry
-- safety `ensure` needs (work order section 2: the second call must land on the first call's own
-- row) is already held by `integration_resources_external_unique`
-- (`organization_id, connection_id, resource_type, external_id`, `20260929000005`) -- built for
-- `replace_integration_resources`'s own idempotent discovery, and exactly the shape a DNS record's
-- provenance needs too. This file adds only what does not already exist: the catalogue row.

insert into public.platform_connectors
  (key, name, description, category, suite, status, auth_method, connection_method, is_public, display_order, capabilities)
values
  ('cloudflare', 'Cloudflare', 'The DNS zone a business already manages there -- connected once so GildOps can publish the records a hosting provider asks for.', 'Infrastructure', null, 'beta', 'oauth2', 'native', true, 15, array['app_connections']);

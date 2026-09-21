-- Platform authority stops being one boolean.
--
-- Until now a row in `platform_staff` meant "runs GOLD", all of it. GOLD is one organization with
-- salespeople, support and operators in it, and only some of them should reach the Platform section
-- of its own shell -- and then only the parts their job needs. The vocabulary below is the
-- platform's own, exactly as `roles.capabilities` is a tenant's: what a person may reach lives on
-- their row, and adding a permission means writing the code, the screen and a migration extending
-- this check.
--
-- Existing staff keep everything (the default), so no one loses a door they had. A narrower row is
-- written by hand, as every staff write is (D28): staff hold no insert/update/delete on this table,
-- and this migration adds no grant.
--
-- **What this does and does not enforce.** The web runtime reads the caller's own row and refuses a
-- `/platform/**` route the row does not name, so a limited operator neither sees nor is served the
-- rest. The narrow-door functions still check `app.require_platform_staff()`, which is deliberately
-- unchanged: they trust "is staff", not "which parts". Making each door check a permission is a
-- separate, larger change and is recorded as such (constraints.md, D59).

alter table public.platform_staff
  add column capabilities text[] not null
    default array['platform.organizations', 'platform.catalogue', 'platform.commercial', 'platform.providers', 'platform.health'],
  add constraint platform_staff_capabilities_known
    check (capabilities <@ array['platform.organizations', 'platform.catalogue', 'platform.commercial', 'platform.providers', 'platform.health']::text[]);

comment on column public.platform_staff.capabilities is
  'Which parts of the platform this person may reach: organizations (tenants, provisioning, support), catalogue (products, plans, meters, connectors), commercial (pricing, billing), providers, health (overview, failures). Read by the web runtime to project navigation and refuse a route; the narrow-door functions still check platform_staff membership only.';

-- Six connectors have a working OAuth adapter and a vendor contract test, and were still `planned`.
-- Cloudflare was seeded `beta` with its own adapter (20261101000001) and is not touched here.
--
-- What each adapter does today, and so what its status may claim:
--   google_workspace  sign-in, refresh, revoke, account label, calendars + spreadsheet metadata (first 50)
--   microsoft_365     sign-in, refresh (always rotates), no per-token revoke, calendars + workbooks (first 50)
--   hubspot           sign-in, refresh, portal name, deal pipelines
--   notion            sign-in, no refresh needed, workspace name, shared databases (first 50)
--   slack             sign-in, bot token (no refresh), workspace name, public channels, revoke
--   dropbox           sign-in, refresh, revoke, account email, top-level folders
-- None paginates beyond its first page except Cloudflare, and none writes. That is `beta`, never
-- `live`: `live` is held back until discovery pages and a write caller exists.
--
-- `status` is the catalogue's *product maturity* and nothing else. Whether this deployment holds
-- the vendor's registration is `apps/api`'s answer (`readiness`), so promoting a row here never
-- makes a Connect button appear on a deployment that could not honour it.

update public.platform_connectors
   set status = 'beta'
 where key in ('google_workspace', 'microsoft_365', 'hubspot', 'notion', 'slack', 'dropbox')
   and status = 'planned';

-- A parent connector becoming beta does not make each app inside it available: only what the
-- adapter reads is `partial` (it discovers resources and proves the connection; nothing syncs or
-- writes), and every other app stays as seeded.
update public.platform_connector_apps a
   set implementation_state = 'partial'
  from public.platform_connectors c
 where a.connector_id = c.id
   and a.implementation_state = 'planned'
   and (c.key, a.key) in (
     ('google_workspace', 'calendar'),
     ('google_workspace', 'drive'),
     ('google_workspace', 'sheets'),
     ('microsoft_365',    'calendar'),
     ('microsoft_365',    'onedrive'),
     ('microsoft_365',    'excel')
   );

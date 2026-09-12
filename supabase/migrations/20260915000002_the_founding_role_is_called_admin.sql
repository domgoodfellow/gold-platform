-- The organization's top ordinary role is now named `Admin`, not `Owner` — vocabulary only (D45).
--
-- Roles are tenant-owned data (D6): `roles.name` is a string a business can rename freely, and
-- nothing anywhere branches on what it says — `app.has_capability` checks `capabilities`, never
-- `name`. What changes here is only the *default* word this platform hands a founder on day
-- one, `FOUNDING_ROLE` in `apps/web/lib/domain/tenancy/organizations.ts`, changed alongside this
-- migration. The reason is naming, not authorization: `platform_staff` is a separate axis (D28),
-- and this is the explicit statement that an organization's own top role is never that axis
-- wearing a tenant's clothing — "organization admin" and "platform admin" are two different
-- things, and the word an organization sees for the first should not read like a claim on the
-- second.
--
-- **A narrow, one-time data correction, not a precedent for rewriting a tenant's own words.**
-- Every `roles` row named exactly `Owner` that also holds precisely the founding capability set
-- is the platform's own seeded default, not a business's deliberate choice — renaming it once is
-- the platform correcting its own default, the same latitude `constraints.md` already grants
-- "before a paying tenant." A role a business already renamed away from `Owner`, or one it kept
-- named `Owner` with a *different* capability set (which could only mean a business chose that
-- name and shape themselves), is untouched — this statement cannot tell those apart from a
-- coincidence, and does not try to.

update public.roles
   set name = 'Admin'
 where name = 'Owner'
   and capabilities @> array[
         'customer.create', 'customer.update', 'role.manage', 'field.manage', 'location.create',
         'resource.create', 'work_item.create', 'asset.create', 'document.create',
         'work_item.transition', 'work_item.schedule', 'work_item.record', 'organization.manage',
         'price.manage', 'work_item.price', 'work_item.update', 'invoice.issue', 'payment.record',
         'automation.manage', 'configuration.propose', 'assistant.ask', 'report.read',
         'report.manage', 'call.place', 'integration.manage'
       ]::text[]
   and array[
         'customer.create', 'customer.update', 'role.manage', 'field.manage', 'location.create',
         'resource.create', 'work_item.create', 'asset.create', 'document.create',
         'work_item.transition', 'work_item.schedule', 'work_item.record', 'organization.manage',
         'price.manage', 'work_item.price', 'work_item.update', 'invoice.issue', 'payment.record',
         'automation.manage', 'configuration.propose', 'assistant.ask', 'report.read',
         'report.manage', 'call.place', 'integration.manage'
       ]::text[] @> capabilities;

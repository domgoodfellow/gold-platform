# ADR-050 — The organization header carries no workspace Calendar shortcut

**Date:** 2026-10-24
**Status:** Accepted (owner-approved GuildOps V1.4 work order, section 11)
**Supersedes:** ADR-048, point 4 only
**Superseded by:** ADR-052, point 2 Calendar placement only. Points 1 and 3 remain active.

**Amended:** 2026-11-16, owner-approved CRM Calendar Navigation & Dashboard Integration work order: CRM Calendar is a first-class workspace sidebar destination; its sidebar and Dashboard agenda links replace the redundant CRM page-header actions. The organization-header restriction remains.

**Extended:** 2026-11-16 by ADR-053: organization Activity joins the header utilities as authorized history. The Calendar-shortcut and notification restrictions remain.

## Context

ADR-048 point 4 kept a Calendar shortcut in the persistent organization header, offered for the entered workspace while its Home was usable. The header is organization chrome: it appeared and disappeared as a person moved between workspaces, and it treated one workspace's calendar as an organization utility. Only CRM and Work register calendars, and both are already reached from their own pages.

The V1.4 work order asked whether a canonical organization notification read model could take that slot. None exists: the notification code in the repository delivers customer-facing service notifications and has no operator inbox or permission-safe read model.

## Decision

1. The persistent organization header shows location, organization utilities (Team and Connections where permitted), the command palette and Agent access. It carries no workspace Calendar shortcut.
2. Calendars remain registered workspace destinations (`AREAS`, `NavItem.calendar`) and are reached in context: CRM from its sidebar and Dashboard agenda, Work from its Dashboard. CRM native events remain available without the optional Tasks feature. No address is built by appending `/calendar`.
3. No notification control is added until an operator notification read model and destination exist. That is a separate feature dependency, not a placeholder.

## Consequences

- `org-shell.tsx` no longer derives a calendar workspace; `lib/shell.ts` keeps `NavItem.calendar` for contextual shortcuts (`workspaceShortcuts`).
- `apps/web/tests/architecture/static/workspace-shell.test.ts` asserts the header has no calendar shortcut and builds no calendar address.
- All other ADR-048 points stand.

## Rejected alternatives

- **Replace Calendar with a notification bell now.** There is no operator notification read model; a bell would be decorative and would imply a capability that does not exist.
- **Keep the shortcut only for CRM.** It would still make one workspace's page an organization utility.

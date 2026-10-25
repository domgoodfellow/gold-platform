# ADR-048 — The sidebar owns workspace navigation; the header owns page identity and actions

**Date:** 2026-10-20
**Status:** Accepted (approved by the owner on 2026-10-20 after the Slice 2B review)
**Supersedes:** ADR-046, point 6 only, in that the page header may no longer present the workspace's destinations
**Superseded by:** ADR-050, point 4 only (no workspace Calendar shortcut in the organization header)

**Amended:** 2026-10-21, owner-directed UI composition correction: point 5's outlined tile is replaced by ordinary sidebar glyph geometry; typography and the divider retain workspace hierarchy.

## Context

ADR-046 allowed the page header to present the workspace projection as a compact destination strip. In practice:

- seven pages opted in one by one (AI, Communications Home, Finance Home and collections, Marketing, Studio Home, Support); the rest did not;
- the strip appeared only when the page canvas was at least 896 px and it fitted beside the actions, so in the Slice 2A captures it showed only at 1440 px, exactly when the full sidebar showed the same list;
- an open Agent or Configure panel hid it, so a page's header changed with panel state;
- it shared the action row with the page's own business actions and gave way to them;
- it was never the only path: the collapsed sidebar rail keeps every destination with a tooltip, and phones have the menu sheet and the page-location menu;
- for keyboard and screen-reader users it was a second navigation landmark repeating the sidebar.

The header also built its Calendar shortcut by appending `/calendar` to the workspace address, which produced `/comms/configuration/calendar` for a configuration-only member.

## Decision

1. The entered-workspace sidebar (and its phone sheet and page-location menu) is the one persistent workspace navigation.
2. The page header owns page identity, contextual business actions, page-support modes (Activity, Insights, Configure) and page-local view controls. It never reproduces the workspace's destination list.
3. Page-local view controls (list or board, filters, periods, record sub-views) are not workspace navigation and stay in the page.
4. The header Calendar shortcut is the projection's registered calendar for the workspace (`NavItem.calendar`), offered only while the workspace Home is usable. The header builds no addresses.
5. Inside a workspace the heading row is set apart from its pages by typography and a divider, in the full and collapsed sidebar. Workspace glyphs use the same dimensions and alignment as ordinary sidebar rows, without a separate tile, special scaling or negative margins. The shared selected state continues to distinguish the current page.

## Consequences

- `WorkspaceDestinationNav` and `headerDestinations` are removed; `PageHeader` and `CollectionHeader` no longer accept `navigation`; `HeaderControls` is only the action row.
- Calendar pages still check only organization membership, not their workspace's availability. Hiding the shortcut does not secure the route; that access question is open (Slice 2C).
- Work Home's "Manage Work" panel still writes its own list of links; moving it onto the projection is Slice 2C work.

## Rejected alternatives

- **A strip on every eligible page.** More duplication, forced onto pages whose action row is full, and still hidden whenever a panel opens.
- **A strip only when the sidebar is unavailable.** There is no such state: the rail and the phone menu always carry the full list.
- **A filled heading tile.** It would carry the visual weight of a selected row.

## Enforcement / current owners

- `docs/ui-system.md` → *Header composition*; `docs/product.md` → *Workspace navigation*; `docs/architecture.md` → *Navigation architecture*.
- `apps/web/tests/architecture/static/navigation.test.ts` (headers read no projection), `apps/web/tests/unit/shell-projection.test.ts` (destinations by role, Calendar shortcut), `apps/web/tests/component/shell-navigation.test.tsx` and `apps/web/tests/component/workspace-heading.test.tsx`.
- `apps/web/e2e/workspace-navigation.spec.ts` (browser acceptance, not run by the pull-request gate).

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.

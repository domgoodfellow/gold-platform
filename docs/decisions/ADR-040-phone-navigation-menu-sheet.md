# ADR-040 — Phone navigation uses the shared Menu sheet, not a persistent bottom bar

**Recorded:** 2026-10-07  
**Status:** Accepted  
**Origin:** UI recovery audit of the current operator shell and mobile navigation.

## Context

The organization shell currently renders a fixed phone bar with Home, AI and Menu. That creates a second persistent navigation layer, gives Agent the visual weight of a destination, consumes vertical space on every phone surface, and forces shell geometry/panels to account for a bar that does not exist at larger widths.

The product already has one projected navigation hierarchy and a mobile Sheet implementation through the shared Sidebar.

## Decision

Below the phone breakpoint, the workspace header exposes the global Menu/hamburger trigger. It opens the sidebar's full-height mobile Sheet using the same projected navigation hierarchy as desktop.

The mobile Sheet:

- places organization identity/switching in its header;
- renders Home, Library, eligible workspaces and authorized Platform Administration;
- keeps Account in its footer;
- closes through its close control, backdrop, Escape where applicable, or destination selection.

The Agent remains a workspace-global utility available from the header. It is not a permanent navigation destination.

Back/parent navigation remains distinct from opening the global Menu.

The persistent Home / AI / Menu bottom bar is retired.

## Consequences

- Phone, tablet and desktop share one information architecture and differ only in projection.
- The shell no longer reserves persistent bottom-bar space.
- Page-support panels and Agent no longer need to stop above a navigation bar.
- Mobile organization switching moves into the navigation Sheet rather than being duplicated in page chrome.
- Existing shell code, geometry, comments and tests that encode `OrgNavBar` must migrate together.

## Rejected alternatives

- Keeping the bottom bar and adding a header hamburger as a second Menu affordance.
- Maintaining a separate reduced phone navigation registry.
- Treating Agent as a peer navigation destination.

## Enforcement / current owners

- `docs/ui-system.md`
- organization shell / workspace header
- shared Sidebar mobile Sheet
- adaptive-shell and navigation browser tests

Executable tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.

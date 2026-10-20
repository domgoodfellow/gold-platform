# ADR-047 — One page location and identity contract

**Date:** 2026-10-19
**Status:** Accepted (approved by the owner on 2026-10-19 after the Batch 1 architecture review)
**Supersedes:** ADR-046, point 3 only (Home shown as an Overview child)
**Superseded by:** None

## Context

The Batch 1 review found that page location and page titles had no single owner:

- About fifty pages wrote their own breadcrumb trail, in four styles (`workspaceAncestry`, `workspaceConfigCrumbs`, `platformAncestry` and literal strings). Literal labels bypassed the registry and business vocabulary.
- The rule that hides a title already shown in the header bar was written separately in `PageHeader`, `CollectionHeader` and `WorkspaceHome`. `CollectionHeader` drifted, which produced the duplicate Dialer heading repaired in `55c2ce9`.
- The phone Up control was calculated separately from the desktop trail and skipped record parents that have no sidebar row.
- Settings showed only "Settings" in the bar and printed the page name in the content, the reverse of every other page.
- Two pages (the automation rule builder and the agent workbench) published no location at all; the loading and not-found states did not either.
- Inside an entered workspace, Home appeared twice: as the workspace heading context and as an Overview row and strip item.

## Decision

1. **Workspace Home (A1).** Inside an entered workspace, the workspace heading is the link to its canonical Home and shows as current there. No child row and no header-strip item repeats the Home route. ADR-046 points 1–2 and 4–7 stand.
2. **Labels by key (A2).** Business vocabulary is applied by stable destination and entity keys, never by matching displayed words. A workspace name is never relabelled by a destination label.
3. **One location per page.** Every page inside the organization, Settings and Platform shells shows one coherent location: ancestors plus the current page. A loading page keeps its known ancestors and shows the record name only once it is known. A missing, deleted or unauthorized record shows a not-found state inside its nearest valid ancestors, without saying which of those it was (U-14). Record data is never invented.
4. **One resolver.** The location is resolved from the existing registries (`AREAS`, `WORKSPACES`, `CONFIG_TARGETS`, Library and personal sections, the Settings navigation and the Platform registry) through explicit route patterns. Only location metadata is added; there is no second navigation registry. Pages supply record labels from the server. An unknown route is reported as unresolved rather than given an invented ancestry.
5. **Existence, access, visibility and hierarchy are separate.** An ancestor is a link only when it is a real page the viewer may open; hidden-from-sidebar is not the same as unauthorized. Redirect-only and grouping levels (Settings, Library, Team & access, a configuration landing that redirects to its only entry) are plain text (U-15). Server-side authorization is unchanged; links are a courtesy.
6. **Headings (A3, B-D4, U-8).** Each page has one meaningful `h1`. When the bar already shows the page, the `h1` is visually hidden; its accessible name may be longer than the breadcrumb label. Settings follows the same rule. Home keeps its greeting as visible content that is not the page heading. Long-form Help articles may keep a visible reading title.
7. **Hierarchy rules (B-D1, B-D2, B-D3, U-1).** Query filters are not levels. A selection with its own route is a record level; a selection held in the query is a filter. Platform starts at "Platform" and omits group headings that have no page. Settings presentation groups are not levels.
8. **Phone Up.** The hierarchical Up control goes to the last linked ancestor of the same trail. It is separate from browser history.
9. **Names (U-11).** "Setup" is the canonical navigation label for the Setup lifecycle.
10. **Library placeholders (A4).** Library sections with no working behaviour are hidden from production navigation until they have it. Their routes and data remain.
11. **Deferred (B-D5).** Breadcrumbs for configuration targets whose ownership is under review (Support queue and service-level configuration, AI agent configuration, Studio configuration, Numbers for read-only members, Custom fields, Secrets) keep their current structure and are marked open until the configuration review.

## Consequences

- `lib/route/page-location.ts` is the resolver. Header components adopt it one archetype at a time; until a page is migrated, its existing crumbs remain.
- Pages stop writing ancestors. `workspaceAncestry`, `workspaceConfigCrumbs` and `platformAncestry` are retired once every caller has moved.
- The workspace heading replaced the Overview row and the Home strip item in Slice 2A. The Settings visible titles change only when their slice ships.
- Migration status is recorded in `docs/ui-system.md` → *Page location contract*. The first adopters are the CRM operating pages (`RESOLVED_LOCATION_ROUTES`).
- Known gaps at acceptance: the sidebar still relabels destinations by displayed word (`businessLabel`); the header Calendar link is header-owned navigation (Batch 2); the Settings visible titles and the Library placeholders remain until their slices ship.

## Rejected alternatives

- **Each page writes its own trail.** The current state; it drifts with every page.
- **Derive ancestry from URL depth or the longest registered prefix.** Treats static sub-pages as records and creates artificial levels.
- **Use sidebar visibility as the link rule.** Hidden destinations such as Opportunities would lose their parent link, and visibility would be mistaken for authorization.
- **Keep Overview as a child label for Home.** It repeats the parent route as a peer of real destinations.

## Enforcement / current owners

- `docs/ui-system.md` → *Page identity* (presentation contract); `docs/product.md` → *Workspace navigation*; `docs/architecture.md` → *Navigation architecture*.
- `apps/web/tests/unit/page-location.test.ts` — resolver behaviour over representative routes, authorization, loading, missing and unresolved cases.
- Rendered acceptance (Batch 1 review, AC1–AC11) is required for each migrated archetype.

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.

# ADR-046 — Entered workspaces use contextual navigation over one canonical projection

**Date:** 2026-10-19
**Status:** Accepted (approved by the owner on 2026-10-19 as the target workspace navigation model)
**Supersedes:** ADR-006; ADR-045 Part B, only its flat-sidebar rendering
**Superseded in part by:** ADR-047 (2026-10-19) — point 3 only: the workspace heading links to Home and no Overview child repeats it

## Context

Four accepted or canonical statements described different organization navigation at the same time:

- ADR-006: a workspace row whose chevron discloses children; Home is not repeated as a child.
- ADR-045 Part B (2026-10-17): one flat business list without workspace entry or back rows.
- `docs/product.md`: flat workspace rows with no children; contextual pages reached from operating surfaces.
- `docs/ui-system.md` and the restored implementation: entering a workspace swaps the sidebar to that workspace's own navigation.

Each implementation could cite a document that agreed with it. The sidebar was flattened (2026-10-17) and restored (2026-10-18) within two days, and the documents were rewritten each time without recording which decision was in force.

## Decision

1. Outside a workspace, the organization sidebar shows the shared destinations (Home, Search, Library) and the workspace directory: one row per eligible workspace.
2. Entering a workspace changes the contextual sidebar to that workspace's navigation: its canonical Home, its eligible operating destinations and its applicable configuration entry points.
3. Inside the workspace, the canonical Home appears as **Overview**. Overview is a label for the Home route, not a separate page, route or domain authority.
4. Workspace destinations are never flattened into the organization-level list.
5. Labels, routes, hierarchy, visibility and permissions derive from the canonical projections (`AREAS`, `WORKSPACES`, `CONFIG_TARGETS`, `WORKSPACE_CONFIGURE` and `projectShell`). Authorization and entitlement filter destinations before any business label or order applies.
6. The page header communicates location and offers page-specific actions. It may present the projection; it never defines workspace navigation of its own.
7. Phone, tablet and desktop present the same authorized destination hierarchy.

Carried forward unchanged:

- From ADR-006: a workspace appears only when the organization and person have at least one real, reachable operating surface; no coming-soon rows or placeholder children.
- From ADR-045 Part B: the versioned business profile, its nouns, destination labels and destination order, its authorization rules and its Calendar provenance decisions. Order applies among a workspace's own destinations.

## Consequences

- `docs/product.md` owns this information architecture; `docs/ui-system.md` owns its presentation; `docs/architecture.md` owns the projection modules and their dependency rules.
- The header destination strip is an optional presentation of the projection. Which pages draw it is presentation, not navigation authority.
- Known implementation gaps against this decision, recorded on acceptance and not yet corrected: the business-profile editor lists destinations from `businessDestinations` (`lib/application/shell/business-navigation.ts`) rather than from the projection the sidebar draws, including workspace Homes and `sidebar: false` areas whose labels and order the sidebar does not apply; and header strip adoption differs between pages of the same workspace.

## Rejected alternatives

- One flat business list (ADR-045 Part B). It removed workspace context from record and configuration pages and was reversed within a day.
- Chevron disclosure of every workspace's children in one tree (ADR-006). It exposes all destinations at the organization level.
- Header-owned workspace navigation. A second authority beside the sidebar.

## Enforcement / current owners

- `docs/product.md` → Workspace navigation; `docs/ui-system.md` → Navigation model; `docs/architecture.md` → Navigation architecture.
- `apps/web/tests/unit/shell-projection.test.ts`, `apps/web/tests/unit/business-profile.test.ts`, `apps/web/e2e/adaptive-shell.spec.ts` (browser acceptance, not run by the pull-request gate).
- `apps/web/tests/architecture/static/contract-documents.test.ts` keeps the canonical documents free of the superseded flat model and the ADR supersession links intact.

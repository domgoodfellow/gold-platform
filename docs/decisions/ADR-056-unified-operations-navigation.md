# ADR-056 — Operations share one sidebar; Studio gathers creation; Administration stays apart

**Date:** 2026-11-19
**Status:** Accepted (owner work order "Unified Operations Navigation and Studio Integration", 2026-11-19). Delivered first as a staff-only preview; the contextual layout remains the default rendering until the owner makes this layout the default.
**Supersedes:** ADR-046 point 2 (entering an operating workspace replaces the sidebar) and ADR-049's "Dashboard first child" placement, in part and for the unified layout only (see Decision 2 and 3)
**Superseded by:** None

## Context

Nine workspaces were each an entered context: opening CRM replaced the sidebar with CRM's pages, so moving from Contacts to the Dialer meant leaving CRM, returning to the directory and entering Communications. Operators move between the operating workspaces many times an hour. AI agents, automation workflows and the website, form and portal editors are a different kind of work — authoring reusable things — but were spread across three workspaces beside the operating ones. Platform Administration was already a separate privileged scope.

## Decision

1. **Three scopes.** Operations (CRM, Communications, Marketing, Support, Work, Finance); Studio (creation: Experiences, Agents, Workflows, and GildOps' own Interface design); Administration (the existing privileged control plane). Home, Search, Calendar and Library remain shared utilities above them.
2. **Operations share one persistent sidebar.** Each operating workspace is a collapsible group. Moving between groups never replaces the sidebar. Opening a destination opens its group and selects it; any group can be opened or collapsed without changing the address. A group heading links to that workspace's Dashboard (its existing landing route), so Dashboard is not repeated as a child; a member who may only configure the workspace gets a heading with no page of its own. A workspace's Settings and any staff link follow its pages inside the group.
3. **Studio is an entered creation context.** It shows Overview (Studio's landing route), Experiences (Website, Customer portal, Forms, Templates), the AI workspace's agent tools (Agents, Where agents answer, Knowledge, Tools & permissions, Agent activity, Evaluations), the Automations workspace's workflow tools (Workflows, Message templates, Runs), Interface design for GildOps staff, and Studio's links to shared Settings. Groups are headed by the owning workspace's own label, so runtime ownership stays visible. Home leaves it.
4. **Administration is unchanged:** a separate entered context with its own registry and guard.
5. **One projection.** The layout is composed by `unifiedNavigation` (`lib/unified-navigation.ts`) from `projectShell`'s authorized output. It filters nothing itself and adds no address the contextual layout does not already offer the same person. Labels, routes, entitlement, permission and work-shape filtering are unchanged. Routes, record addresses and breadcrumbs are unchanged; AI, Automations, website and portal keep their engines, records and publication contracts (ADR-019, ADR-055).
6. **A reversible preview first.** GildOps staff holding the interface-design platform permission (`INTERFACE_DESIGN_CAPABILITY`, today `platform.catalogue`) open Studio → Interface design → Navigation, compare both layouts over the real projection at desktop, rail and phone widths, and apply the unified layout to their own browser. The choice is an httpOnly cookie that the shell honours only after confirming that authority in GildOps' operating organization; elsewhere, and for everybody else, the contextual layout draws. A header control shows the preview is on and leaves it in one press. No migration.

## Consequences

- ADR-046 points 1 and 3–7 and ADR-049's explicit Dashboard remain the contract of the default (contextual) layout. When the owner makes the unified layout the default, ADR-046 point 2 is superseded outright and this record's Status changes.
- My Work is not built in this slice. Home's "Mine" scope already projects a member's CRM tasks, Work, Support cases and conversations from their owning domains; a My Work destination should be that projection, not a new task table (`docs/journeys.md` → Gaps).
- A dedicated platform permission for interface development does not exist; adding one extends `platform_staff_capabilities_known` (a migration). Until then the permission over the product's catalogue stands in.
- Draft navigation configurations, evaluation and versioned proposals are future work; the experiment's preview takes a proposal object so that work has a place to land. Publishing navigation for everybody and editing routes are not provided.

## Rejected alternatives

- A second sidebar registry or hardcoded unified list: two sources that could disagree about eligibility.
- Moving AI and Automations routes under `/studio`: breaks deep links and blurs runtime ownership for no navigation gain.
- Storing the preview per member in the database: a migration for a reversible experiment.
- Honouring the preview anywhere a person is platform staff: platform authority is resolved only in GildOps' operating organization.

## Enforcement / current owners

- `docs/product.md` → Workspace navigation; `docs/ui-system.md` → Navigation model; `docs/surfaces/shell.md` → Unified navigation preview; `docs/surfaces/studio.md`; `docs/architecture.md` → Navigation architecture; `docs/security.md` → Platform staff permissions.
- `apps/web/tests/unit/unified-navigation.test.ts`, `apps/web/tests/component/shell-navigation.test.tsx`, `apps/web/tests/component/workspace-heading.test.tsx`, `apps/web/tests/component/navigation-experiment.test.tsx`, `apps/web/tests/architecture/static/navigation.test.ts`.

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.

# UI rule audit — Phase 0

Baseline: `main@2a5fcd2` (2026-10-06).

This document records normative UI rules and their current disposition. It does not silently rewrite conflicting history.

## Canonical rules confirmed on current main

### UI-RULE-001 — Settings is one landing page with five scopes
**Status:** CANONICAL

`docs/ui-spec.md` defines `/organizations/{id}/settings` as a landing page for Organization, Account, Access, Connections, and Plan & usage. The current Settings work on main now routes the account-menu entry through that landing page and the current Playwright Settings test asserts all five owners.

**Implementation evidence:** latest commit `2a5fcd2` changed the account menu and Settings E2E to enter through the landing chooser rather than bypassing it.

### UI-RULE-002 — Account and organization settings are different scopes
**Status:** CANONICAL

Personal Account owns Profile and Security & sign-in under `/settings/account/**`; Organization owns business configuration under `/organizations/{id}/settings/**`.

### UI-RULE-003 — Platform Administration is not a tenant workspace
**Status:** CANONICAL

Current constraints explicitly distinguish organization context from Platform Administration and place Platform under GildOps' own organization only for staff authority.

### UI-RULE-004 — Workspace Home is the canonical parent destination; Overview is not a competing page type
**Status:** CANONICAL

The row body opens Home; the chevron expands children. Home summarizes the workspace and routes into child surfaces.

### UI-RULE-005 — Insights is contextual/shared, not a workspace row
**Status:** CANONICAL

Deep Insights routes may exist, and pages may expose an Insights support mode, but that does not create an Insights workspace.

### UI-RULE-006 — Page identity belongs to the page, not WorkspaceHeader
**Status:** CANONICAL

`PageHeader` or a screen archetype owns page identity. `WorkspaceHeader` is global chrome and only hosts the published breadcrumb location.

### UI-RULE-007 — Generic title + description repetition is explicitly rejected
**Status:** CANONICAL

`PageHeader` intentionally has no generic `description` prop. Explanatory text must earn its place in the task structure.

### UI-RULE-008 — Page width is semantic, not page-local
**Status:** CANONICAL

`AppPage` exposes `fluid | form | reading`. Route authors choose a mode rather than arbitrary max-width values.

### UI-RULE-009 — Support actions have one order and one rail
**Status:** CANONICAL

Activity → Insights → Configure render after business actions and use the shared page-support rail.

### UI-RULE-010 — Navigation and actions are different interaction classes
**Status:** CANONICAL

Rows/links navigate; action controls mutate or open task UI. Styling must not make different semantics look interchangeable.

## Explicitly stale / superseded rules found in the decision history

### UI-RULE-011 — Separate Platform shell / context-switcher destination
**Status:** STALE

D45's old interface consequence is explicitly amended by D59/D60. The current model is one adaptive shell with Platform nested under GildOps' organization.

### UI-RULE-012 — Older workspace registration/navigation set
**Status:** STALE

D61's navigation section is explicitly marked superseded by D66. It must not be used as the source of current sidebar/workspace truth.

### UI-RULE-013 — Settings as a persistent global scope tab bar
**Status:** STALE

Current `ui-spec.md` says the landing page owns the five scopes and each scope owns its own local navigation. The global persistent tab-bar interpretation is obsolete.

## Current implementation/documentation mismatches to resolve in later phases

### UI-RULE-014 — Visual audit coverage is representative, not exhaustive
**Status:** UNIMPLEMENTED

`docs/testing.md` and `playwright.visual.config.ts` deliberately bound visual regression to a small representative set. Phase 0 requires an exhaustive screenshot audit inventory. This is not a contradiction in the existing test strategy; it is a new forensic tool with a different purpose and must remain separate from the normal visual regression gate.

### UI-RULE-015 — Legacy compatibility Platform route remains present
**Status:** IMPLEMENTATION_DETAIL / MIGRATION DEBT

`app/platform/[[...path]]/page.tsx` remains beside canonical nested Platform routes. It is classified separately in the surface inventory as `PLATFORM_COMPAT`, not as another Platform ownership model.

### UI-RULE-016 — Existing visual audit script still navigates legacy `/platform/**` addresses
**Status:** STALE TOOLING

`apps/web/scripts/audit/platform-visual.mjs` navigates `/platform/organizations`, `/platform/catalog/products`, etc. Canonical Platform routes are nested under the GildOps organization. The script must be retired or rewritten to derive canonical URLs from demo context.

## Ambiguities requiring measurement before migration

### UI-RULE-017 — Card usage
**Status:** AMBIGUOUS UNTIL MEASURED

The spec defines different semantic card taxonomies. A raw `Card` primitive cannot by itself identify the task pattern. Phase 0 must count raw card usage and classify its semantic owner before any global card rewrite.

### UI-RULE-018 — Spacing
**Status:** AMBIGUOUS UNTIL MEASURED

Spacing differences may encode hierarchy or may be drift. The audit must measure repeated gap/padding classes and relate them to archetypes rather than flattening everything to one token.

### UI-RULE-019 — Settings local navigation
**Status:** NEEDS VISUAL/INTERACTION AUDIT

Current Settings ownership was corrected on main, but the actual visual density, spacing, row affordances, responsive behavior, and local-nav consistency still require screenshot and browser inspection.

## Source-of-truth order for Phase 0

When sources disagree, do not pick whichever is newest-looking by prose alone. Resolve in this order:

1. explicit current decision that names the superseded decision;
2. current `docs/ui-spec.md` product/UI contract;
3. current architectural tests and route ownership;
4. current implementation;
5. older decision history retained for rationale.

Every later migration finding should cite the rule ID that justifies it.

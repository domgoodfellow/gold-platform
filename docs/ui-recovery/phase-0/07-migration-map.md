# UI migration dependency map — Phase 0

Baseline: `main@2a5fcd2`.

This is a dependency order, not an implementation schedule.

```text
Docs / product rules
        ↓
route + scope inventory
        ↓
tokens / source-owned primitives
        ↓
shared application controls
        ↓
layout + headers + navigation
        ↓
shared surfaces
        ↓
screen patterns / archetypes
        ↓
Settings + Platform + workspace foundations
        ↓
feature routes
        ↓
public/auth specialized surfaces
        ↓
visual regression baselines
```

## Foundation nodes

### F0 — Rule authority
Inputs:
- `docs/ui-spec.md`
- supersession records in `docs/constraints.md`
- architecture tests

Blocks:
- every migration that changes navigation, ownership or page identity.

### F1 — Page geometry
Owners:
- `components/layout/app-page.tsx`
- workspace shell geometry

Blocks:
- arbitrary page-local max-width/edge alignment cleanup.

### F2 — Page identity
Owners:
- `PageHeader`
- `RecordHeader`
- pattern-owned identity such as Collection/Workspace Home

Blocks:
- duplicated titles;
- generic descriptions;
- page actions placed in WorkspaceHeader.

### F3 — Navigation
Owners:
- shell projection;
- workspace row/chevron contract;
- Settings landing/local navigation;
- account menu;
- breadcrumb publishing.

Blocks:
- Settings cleanup;
- Platform cleanup;
- workspace Home migrations.

### F4 — Surface semantics
Owners:
- Section
- Card
- DataTable
- EmptyState
- CollectionView
- ViewNav

Blocks:
- card/list convergence;
- spacing convergence;
- table/card mobile behavior.

### F5 — Support rail
Owners:
- Activity
- Insights
- Configure trigger/order/registrars.

Blocks:
- route-specific Configure buttons/panels;
- duplicated contextual Insights.

## High-priority migration clusters

### M1 — Settings
Depends on F1, F2, F3, F4.

Why first:
- current ownership was just corrected;
- it exposes Account, Access, Connections and Plan semantics;
- it is where navigation, row density, form composition and scope confusion are most visible.

### M2 — Platform Administration
Depends on F1, F2, F3, F4, F5.

Special prerequisite:
- retire/update legacy `/platform/**` visual audit tooling before using screenshots as evidence.

### M3 — Workspace Homes
Depends on F1, F2, F3, F4, F5.

Goal:
- one recognizable Home grammar without forcing identical content.

### M4 — Collections
Depends on F1, F2, F4.

Goal:
- converge toolbar/search/filter/action/view-switcher placement;
- preserve domain-specific columns and board/card representations.

### M5 — Record details
Depends on F1, F2, F4, F5.

### M6 — Editors/configuration
Depends on F1, F2, F4.

### M7 — Public/auth
Separate shell family; migrate only after operator-shell foundations stop moving.

## Do-not-migrate-yet rule

A route is not migration-ready until:
1. it has a surface ID;
2. it has an archetype;
3. its owner/scope are known;
4. shared prerequisites are identified;
5. baseline screenshot exists for the meaningful viewport(s);
6. any navigation/product contradiction is resolved.

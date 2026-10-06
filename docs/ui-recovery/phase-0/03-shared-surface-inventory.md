# Shared surface inventory

Baseline: `main@2a5fcd2`.

## Counts

- Shared application UI files: **52**
- Source-owned `@gold/ui` component primitives: **37**

## Shared application categories

- `README.md/`: 1
- `class-names.ts/`: 1
- `controls/`: 10
- `display/`: 4
- `feedback/`: 1
- `headers/`: 3
- `layout/`: 5
- `marketing/`: 11
- `navigation/`: 5
- `panels/`: 4
- `patterns/`: 3
- `surfaces/`: 4

## Architectural split already present

The repository already distinguishes source-owned generic primitives in `packages/ui` from application-level controls, layout, navigation, headers, patterns, panels and surfaces in `apps/web/components`. Phase 0 therefore treats that split as existing architecture to validate, not something to replace.

## Immediate audit targets

- `headers/page-header.tsx` — generic page identity, explicitly no generic description prop.
- `layout/app-page.tsx` — canonical page width modes: fluid, form, reading.
- `patterns/workspace-home.tsx` and `patterns/collection-header.tsx` — task-level screen compositions.
- `surfaces/card.tsx`, `surfaces/section.tsx`, `surfaces/collection-view.tsx` — shared presentation semantics.
- `navigation/account-menu.tsx`, `navigation/view-nav.tsx` — cross-surface navigation behavior.

Machine-readable inventory: `03-shared-surface-inventory.json`.

# `apps/web/components`

This directory owns **shared GildOps application UI and application chrome**.

It sits between generic `packages/ui` primitives and feature-specific UI.

## Ownership

| Folder | Owns |
| --- | --- |
| `controls/` | Shared semantic application controls and form composition |
| `layout/` | Cross-feature page and shell geometry |
| `navigation/` | Shared navigation and context controls |
| `headers/` | Workspace, page and record identity compositions |
| `patterns/` | Reusable task-level GildOps screen compositions |
| `panels/` | Shared rail/drawer/support-panel infrastructure |
| `surfaces/` | Shared semantic presentation surfaces |
| `feedback/` | Cross-feature feedback/fallback presentation |
| `display/` | Generic application display vocabulary such as tables, definitions and toolbars |
| `marketing/` | Shared GildOps marketing presentation where it is genuinely cross-page |

A component belongs here when its responsibility is a stable application contract reused across product capabilities.

Caller count is evidence of reuse.

It is not the ownership rule.

## Dependency direction

A shared component may import:

- `@gold/ui` generic primitives;
- pure route/navigation helpers;
- types needed to describe application context.

It must not import:

- `@/features/*`;
- `@/app/*`;
- `@/lib/db/*`;
- provider adapters;
- authoritative domain mutation logic.

Features may consume shared application components.

Shared application components do not consume features.

## What does not belong here

Do not place:

- database queries;
- provider operations;
- tenant-specific calculations;
- business validation;
- authorization decisions;
- feature-specific workflow state;

in shared components.

Those responsibilities belong to their canonical layers.

See:

- `docs/architecture.md`
- `docs/ui-system.md`

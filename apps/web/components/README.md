# `components/`

Shared GildOps application UI and application chrome — broader than domain-agnostic primitives.
A component belongs here when it is genuinely reusable across product capabilities, even where it
knows a cross-cutting application concept: workspace, page, shell, organization context, account
context, navigation, breadcrumbs, application routes, panels, drawers, application feedback, or
shared collection presentation.

It must not become authoritative for business rules, authorization decisions, database queries,
provider operations, tenant-specific calculations or feature-specific workflow semantics. Those
stay in `lib/domain/` and `features/`.

| Folder | Owns |
|---|---|
| `controls/` | Semantic application controls — buttons, inputs, form composition, confirmation |
| `layout/` | Cross-feature page/shell geometry |
| `navigation/` | Shared application navigation and context controls |
| `headers/` | Shared workspace/page/record identity compositions |
| `panels/` | Shared rail/drawer/support-panel infrastructure |
| `surfaces/` | Shared application presentation surfaces |
| `feedback/` | Cross-feature fallback/feedback presentation |
| `display/` | Existing generic data/display vocabulary — tables, definitions, badges, toolbars, widgets |
| `marketing/` | GildOps marketing-specific shared presentation |
| `packages/ui` (`@gold/ui`) | Source-owned generic primitives, one layer below this one |
| `class-names.ts` | Shared class composition and the visible focus ring |

**Dependency direction.** A shared component here may import `@gold/ui` and pure navigation/route
helpers or domain **types** needed to describe application context. It must not import
`@/features/*`, `@/app/*`, `@/lib/db/*` or `@/lib/adapters/*`, and it must not call an authoritative
domain operation. A feature may consume a shared component; a shared component may not consume a
feature.

Caller count is evidence that an abstraction may be useful, not the ownership rule. The promotion
test is whether the responsibility is a stable cross-feature application contract, not how many
routes currently render it. Tenancy-specific or account-recovery composition — e.g. a not-found
screen that composes a feature's own fallback shell — belongs in `features/`, not here.

Nothing here reads the database or decides a business rule. Components receive values and events;
`lib/domain/` remains authoritative for validation and decisions.

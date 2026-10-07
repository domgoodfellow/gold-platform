# UI recovery program

This document is the migration target for the GildOps operator UI recovery. It records what the current repository actually does, what should remain, what must change, and the visual/composition direction that later implementation slices must follow.

It does **not** pretend the migration is already complete. `docs/ui-system.md` is the canonical current UI system. This recovery document records the audit, migration rationale and implementation sequence; when a recovery decision becomes canonical, it must also be reflected in `docs/ui-system.md` or an ADR rather than living here alone.

## Goal

GildOps should feel like one deliberately composed operational application, not a collection of route scaffolds.

The target is:

```text
ShadCN primitives
↓
GildOps application controls
↓
Reusable compositions / surface patterns
↓
Task-specific screen archetypes
↓
Domain pages
```

The current repository is strong at the first two layers and inconsistent above them. The recovery therefore does **not** replace Tailwind, ShadCN, Radix or Lucide. It fixes the missing composition layer and migrates routes onto it.

---

## Phase 0 — current-state audit

### Repository facts

- The web app is already ShadCN-based. `apps/web/components.json` uses `radix-nova`, neutral base colour, CSS variables and Lucide.
- `packages/ui` already owns source-level primitives: cards, buttons, inputs, badges, dialogs, drawers, sheets, sidebar, empty states, tabs, tables and related controls.
- `apps/web/components` already has application-level controls and several composition attempts: `WorkspaceHome`, `PageHeader`, `CollectionHeader`, `CollectionView`, `KpiCard`, `Widget`, `AppPage`, drawers and the shared shell.
- The authenticated organization tree currently contains **125** organization-scoped `page.tsx` routes: **92** non-Platform operator/settings/library surfaces and **33** Platform control-plane surfaces, plus public/auth/marketing surfaces outside that tree.
- Before this branch, only six visual Playwright fixtures represented the application: a workspace Home, collection board, organization settings, 404/state, work-item detail and Platform control-plane page. They are useful samples, not exhaustive surface QA.
- `CollectionView` exists, but the UI spec itself says Settings is the first consumer and other eligible collections have not yet been migrated.
- Page-wide padding is already centralized in `PAGE_PADDING = 'p-4 sm:p-6 lg:p-8'`. Screens that appear to have inconsistent padding are therefore likely bypassing the canonical shell/composition, adding local full-bleed structures, or using nested patterns with their own spacing. The solution is not to hand-tune every route.
- The current CSS follows `prefers-color-scheme` directly. There is no explicit user Appearance override for System / Light / Dark.
- Tenant branding and personal appearance are separate concerns. Tenant branding currently owns accent and brand typography; personal appearance must not alter customer-facing tenant surfaces.

### Confirmed systemic problems

#### 1. Workspace Homes are under-designed

Several current Homes are only a title plus KPI count cards or one large empty state:

- CRM / `sales`: Customers + Pipeline counts, then "Nothing recorded in Sales yet".
- Communications: count cards, or one large zero-content state, plus raw readiness hints.
- Automations: Rules / Messages / Activity counts, or one large zero-content state.
- Field: Work / Schedule / Resources / Locations / Assets counts, or one large zero-content state.
- Library: its top navigation is repeated again as a vertical destination list.
- Finance is richer, but is still mostly a grid of generic `Widget` rectangles rather than a composed financial cockpit.

A workspace Home must summarize operating responsibility, not merely count child routes.

#### 2. The application has primitives but too little composition

The current code jumps too often from low-level controls directly to pages. The missing middle layer includes patterns such as:

- operational metric
- attention / exception panel
- current-work panel
- trend / chart panel
- status / readiness panel
- progress panel
- destination directory
- activity panel
- collection toolbar
- settings section
- related-record projection

These are not all interchangeable "cards".

#### 3. Surface migrations are partial

The repo contains both legacy and newer patterns:

- `PageHeader` exists and explicitly removed a generic description prop.
- `CollectionHeader` exists for collection/board screens.
- `CollectionView` exists for user-selectable list/grid/table presentation.
- Many routes delegate to feature components that still predate those patterns.
- Some collections support multiple representations while equivalent entity collections do not.
- Some sibling views use route-backed navigation while older screens still carry local/tab assumptions.
- The result is inconsistent even though individual implementations are locally reasonable.

#### 4. The mobile navigation target is stale

Current code and `ui-spec.md` still implement a persistent phone bottom bar:

```text
Home | AI | Menu
```

The recovery target is:

```text
Header
[ hamburger ] [ current context ] [ contextual/global actions ]

hamburger
↓
full-height navigation sheet
  organization switcher at top
  Home / Library / Workspaces / authorized Platform
  account at bottom
```

Close behavior: X, backdrop, Escape where applicable, and destination selection. Global navigation and hierarchical Back remain distinct.

The Agent remains globally available, but it is not justification for a permanent three-cell bottom navigation bar.

#### 5. The sidebar is carrying too much product discovery

The sidebar is fast travel, not the complete sitemap.

Workspace Home is the richer workspace directory. Destinations need a prominence model:

```text
Primary       sidebar + Home
Secondary     Home / contextual links
Configuration Configure panel + deep settings
Resource      parent/resource hierarchy
Contextual    toolbar / row / overflow
```

Examples already clear from the product model:

- Communications Inbox and Calls are primary.
- Communications Numbers is owned by Communications but is primarily configuration/resource management.
- Automations Activity is useful Home content and may remain a secondary route without consuming permanent navigation.
- Finance Pricing is configuration, not a peer of Quotes/Invoices/Payments.

#### 6. Zero-data states are being asked to substitute for product design

"Nothing recorded in X yet" is not sufficient as a workspace Home.

A zero-data Home must still expose:

- what the workspace can do
- available destinations
- setup/readiness
- primary creation/import/configuration actions
- useful next steps

As data arrives, setup content yields to operational content. The Home does not lose its structure.

---

## Keep / amend / retire

### Keep

- ShadCN/Radix/Tailwind/Lucide foundation.
- The five-layer ownership direction in D23.
- Shared `AppShell` / `WorkspaceShell`.
- Centralized `PAGE_PADDING`.
- `PageLocation` publishing breadcrumb/location state into the workspace header.
- Separation between workspace-global tools and page-local actions.
- `PageHeader`'s removal of generic descriptive subtitles.
- `CollectionHeader` as a compact collection/board identity pattern.
- `ViewNav` as URL-backed sibling navigation.
- `CollectionView` as the personal presentation chooser where a collection genuinely supports multiple representations.
- `DataTable`'s responsive card fallback for entity tables where that representation is appropriate.
- Contextual Configure / right rail and deep settings routes.
- Canonical domain ownership: a workspace may project information owned elsewhere without copying the authoritative record.
- Entitlement/permission/readiness-aware navigation.

### Amend

- Workspace Home contract: from "summary cards + empty state" to a composed operating cockpit.
- Widget taxonomy: retain data/source-of-truth rules, but allow richer visual roles and compositions.
- Sidebar child lists: keep only genuinely primary operating destinations.
- Workspace Home toolbar: contextual creation, Customize and Configure where supported.
- Global Home: become the cross-workspace command center rather than setup/activity only.
- Visual regression strategy: keep representative golden screenshots, add an audit crawler/contact-sheet workflow for broad coverage.
- Collection representation policy: finish the migration for eligible entity collections rather than leaving Settings as the sole adopter.
- Appearance: add Personal Settings → Appearance with explicit theme and density choices.
- Existing workspace route nomenclature where route history leaks old concepts (for example CRM still landing on `/sales`).

### Retire

- Persistent mobile `Home | AI | Menu` bottom bar.
- Generic "title + restated purpose subtitle" as a default page grammar.
- Treating every bordered rectangle as the same visual kind of card.
- Giant workspace-level empty-state rectangles that replace the Home.
- Permanent sidebar entries for configuration-only resources.
- Duplicate navigation where Home simply repeats tabs or sidebar children.
- Local page-by-page spacing fixes when the problem belongs to an archetype/composition.
- New one-off UI patterns introduced directly in a feature page without first proving the need at the shared composition layer.

---

## Phase 1 — visual and composition direction

### Visual target

Use the current neutral Nova/ShadCN foundation, but compose it like a mature operational product.

The visual character is:

- neutral canvas
- strong black/white hierarchy
- soft nested surfaces
- subtle rings/borders, not boxes around everything
- rounded modules
- compact controls
- deliberate density
- useful whitespace rather than empty canvas
- typography that creates a clear reading path
- visualizations only when they answer an operational question
- domain-specific composition within one common visual language

Do **not** create a second theme framework or switch ShadCN registry styles at runtime.

### Surface hierarchy

Use a small set of screen archetypes:

1. **Global Home** — cross-workspace command center.
2. **Workspace Home** — operating cockpit, attention, current work, destinations, readiness.
3. **Collection** — browse/search/filter/sort/select/change representation.
4. **Record / Detail** — identity, state, actions, related information, history.
5. **Operational workspace** — communication inbox, schedule, builder, dialer; task-specific and allowed to break ordinary page composition.
6. **Configuration** — stacked settings grouped by responsibility, not nested miniature shells.
7. **Insights / Report** — comparative data, trends and explanations.
8. **Builder / Editor** — canvas/workbench with inspector/tooling.
9. **Wizard / Lifecycle** — guided progression through ordered state.

A page selects an archetype first. It does not start by selecting arbitrary cards.

### Composition roles

These are semantic visual roles. They may initially be local compositions; promote them to shared components only when their contract is stable.

- Metric / KPI
- Trend
- Attention / exception
- Current / upcoming work
- Activity
- Status / readiness
- Progress
- Destination / quick access
- Related-record projection
- Collection toolbar
- Settings group
- Form section

### Workspace Home grammar

A Home is partly fixed and partly customizable:

```text
Workspace title                         Primary action  Customize  Configure

Needs attention                        only when meaningful

Operational summary / metrics

Current, upcoming or recent work

Native widgets + authorized cross-workspace projections

Explore workspace                      stable destination directory

Readiness / configuration              when incomplete or useful
```

Not every region is visible at all times. Empty space is not filled for symmetry.

### Global Home grammar

```text
Home                                   Customize

Needs attention across workspaces

Today / upcoming / my work

Pinned or user-selected widgets

Workspace summaries

Recent cross-workspace activity

Setup/readiness                         only while useful
```

A projected item always links to its canonical owner.

### Header grammar

- The sticky workspace header answers global location/context and global utilities.
- The page/surface owns its visible identity and page-local actions.
- Generic descriptive subtitles are forbidden unless the second line adds real scope/state/context.
- A factual metadata line remains valid.
- One primary action is the normal default.
- Configure is contextual and belongs at the page/workspace layer it configures.
- Back and global navigation are separate affordances.

### Collection grammar

Default browse composition:

```text
compact collection identity + actions
route-backed sibling navigation, if any
search / filters / sort / view / density toolbar
content
```

Representation switching is not universal:

- entity collections may support table/list/grid according to use
- ledgers/logs/analytical tables remain tables
- maps/boards are task views, not cosmetic alternatives

### Zero-data grammar

A major empty state answers:

1. what is absent
2. whether configuration/readiness blocks it
3. what the operator can do next

It does not duplicate a continuously visible primary action without reason.

### Appearance

Add **Personal Settings → Appearance**. It is a user preference, not organization branding.

Initial scope:

- Theme: System / Light / Dark
- Density: Comfortable / Compact
- Motion: System / Reduced

Defer style presets until the default visual system is mature. Do not let "Appearance" become a workaround for an unfinished base design.

Tenant branding continues to own customer/business brand colour and brand typography. Personal appearance must never change public booking, sites, forms or customer portal presentation.

---

## Phase 2 — UI Surface Lab

The branch includes a development-only prototype route inside the ordinary organization shell:

```text
/organizations/{organizationId}/ui-lab
```

It is implemented under an App Router `(dev)` route group, requires normal organization access, and returns 404 in production.

Purpose:

- prove the visual/composition direction with real repository primitives
- compare multiple semantic surface roles together
- give later implementation slices one visual target
- prevent every feature page from inventing its own grammar

The lab is **not** a new production design system and is not added to normal navigation. Prototype helpers inside the lab must not be imported by product screens.

It demonstrates:

- Home composition
- metrics
- attention
- progress/readiness
- activity/current work
- destination modules
- collection toolbar shape
- configuration/form grouping
- light neutral surface hierarchy

Later slices should extract only repeated, stable contracts into `apps/web/components`.

Phase 0 also adds two repeatable audit tools:

- `pnpm audit:ui` / `pnpm audit:ui:write` — static organization-route census and pattern adoption report.
- `pnpm audit:ui:capture` — authenticated browser crawler that follows safely reachable organization links, captures full-page screenshots and records console/page/request failures. It requires the existing local E2E/demo stack and does not click mutations.

---

## Migration order after Phase 2

The remaining work should be handed off as small verified slices:

1. shell + mobile navigation migration and update the tests that still encode the retired bottom bar
2. global Home
3. workspace Home composition infrastructure
4. CRM Home
5. Communications Home and move Numbers to configuration prominence
6. Finance Home
7. Automations Home and reclassify Messages/Activity
8. Field Home
9. Studio Home
10. Library Home
11. eligible collections onto the canonical collection grammar
12. record/detail surfaces
13. settings/configuration consistency
14. Appearance settings
15. exhaustive desktop/tablet/phone audit crawler
16. final consistency sweep and end-to-end cross-workspace journeys

Every slice must inspect current implementation, preserve domain ownership and authoritative reads, verify desktop and mobile, and update the visual audit evidence.

---

## Recovery invariant

Do not solve the same UI problem locally twice.

When a route exposes a general problem:

```text
observe route
→ identify archetype/pattern problem
→ fix or define the shared contract
→ migrate affected surfaces
→ verify visually
```

The desired result is not "all pages look identical."

The desired result is:

> Every screen looks like it belongs to the same product, while its composition clearly reflects the job being done.

# Canonical surface archetypes — Phase 0

These are classification targets, not a new universal component API. Existing `components/patterns/*`, `PageHeader`, `AppPage`, `RecordHeader`, `CollectionView`, and `DataTable` remain the starting vocabulary.

## A1 — Workspace Home
Purpose: summarize one workspace, expose its primary child surfaces, contextual status and next actions.

Required characteristics:
- one page identity;
- no competing Overview page type;
- child-surface navigation is obvious;
- contextual Insights/Configure use support modes where valid;
- summary/KPI cards navigate to owned child surfaces rather than becoming mini-apps.

## A2 — Collection
Purpose: find, filter, scan and open a set of records.

Typical composition:
- page/collection identity;
- search/filter/view controls;
- primary creation/import action where authorized;
- table/list/cards/board presentation chosen by semantics;
- empty/loading/error states;
- record navigation.

## A3 — Record Detail
Purpose: understand and act on one canonical record.

Typical composition:
- record identity/status;
- primary record actions;
- sections/timeline/related records;
- contextual Activity/Insights/Configure only when sources exist.

## A4 — Focused Editor / Form
Purpose: complete one bounded edit or creation task.

Typical composition:
- `AppPage width="form"` or equivalent focused geometry;
- clear save/cancel/recovery path;
- field groups with authoritative validation feedback;
- no dashboard/card chrome around every field group.

## A5 — Settings Landing
Purpose: choose the configuration owner/scope.

For GildOps current Settings this is specifically:
- Organization
- Account
- Access
- Connections
- Plan & usage

It is a directory/chooser, not a persistent global tab shell.

## A6 — Settings Detail
Purpose: configure one owned concern.

Required characteristics:
- breadcrumb back to Settings and owner scope where applicable;
- local navigation only for siblings owned by the same scope;
- forms/rows grouped by meaning;
- no duplicated destinations across owners.

## A7 — Configuration Surface
Purpose: configure behavior owned by an operational workspace or capability.

It may live as:
- a dedicated route;
- a Configure support rail;
- a link from Configure to the authoritative Settings owner.

It must not create a second configuration path.

## A8 — Dashboard / Insights
Purpose: analyze canonical data without becoming a second operational owner.

Required characteristics:
- derived/reporting state only;
- links back to canonical operational records/surfaces;
- contextual summaries may live in support rails;
- deep shared Insights routes remain cross-cutting.

## A9 — Master–Detail / Operational Console
Purpose: operate on a stream/list while preserving selected-record context.

Examples include inbox/calling-like surfaces.

Required characteristics:
- selection state has clear URL/ownership semantics where needed;
- pane geometry is intentional;
- narrow viewports collapse to a sequential task, not squeezed columns.

## A10 — Wizard / Onboarding
Purpose: progress through a bounded multi-step state transition.

Required characteristics:
- visible progress;
- preservation/reuse of known information;
- recoverable back/forward behavior;
- explicit completion/readiness state.

## A11 — Platform Administration
Purpose: operate GildOps' SaaS control plane.

Required characteristics:
- rendered only in GildOps organization context with platform permission;
- visually recognizable as Platform scope without pretending organization context changed;
- never copied into tenant workspaces;
- commercial/provider vocabulary remains control-plane vocabulary.

## A12 — Public / Customer Experience
Purpose: complete a customer-facing task outside the authenticated operator shell.

Includes booking, portal, proposal, public forms, hosted sites and embeds.

These surfaces use their own shell/brand rules and are audited separately from authenticated operator consistency.

## A13 — Auth / Personal Identity
Purpose: authenticate or manage the person rather than a business.

Includes login/signup/recovery and personal Account/Profile/Security.

## A14 — State / Exception
Purpose: communicate unavailable, not-found, locked, permission or empty-major-state conditions.

Required characteristics:
- truth first;
- recovery/next step where one exists;
- no fake primary action;
- same shell/context rules as the surface that failed.

## Classification rule

A route gets one primary archetype. It may compose secondary patterns. If none fit, mark `SPECIALIZED` and justify why before inventing another shared archetype.

# GildOps UI System

## Purpose

This document defines the **canonical user-interface and interaction system for GildOps**.

It answers:

- How is the application organized from the user's perspective?
- What UI layers exist and what does each own?
- What makes a page a Workspace Home, Collection, Record Detail, Settings page or operational console?
- How are navigation, page identity, actions, spacing and responsive behavior expressed consistently?
- Which patterns should be reused rather than rebuilt route by route?
- How is a rendered surface considered verified?

This document defines current UI rules.

It does not describe implementation history.

Product ownership belongs in `docs/product.md`.

Domain ownership belongs in `docs/domain-model.md`.

Application layering belongs in `docs/architecture.md`.

Historical UI decisions belong in `docs/decisions/`.

---

## Core principle

The interface exists to translate human intent into software capability.

The user should not need to understand:

- database structure;
- package layout;
- provider architecture;
- billing catalogue internals;
- route implementation;
- shared-engine boundaries;

unless one of those concepts is itself the user's task.

Design around:

```text
User goal
↓
Recognizable place
↓
Clear action
↓
Immediate feedback
↓
Durable result
```

Not:

```text
Database table
↓
Generic page
↓
Generic cards
↓
Buttons
```

---

## UI hierarchy

GildOps uses the following UI hierarchy:

```text
Design tokens
↓
Primitives
↓
Shared application components
↓
Patterns
↓
Surface archetypes
↓
Feature composition
↓
Routed pages
```

Each level has a different responsibility.

---

### Design tokens

Design tokens define reusable visual roles such as:

- color;
- typography;
- spacing scale;
- border/radius;
- elevation;
- control size;
- breakpoints;
- motion;
- shell geometry.

Values live in the implementation, not duplicated in this document.

Routes do not invent new token values for local convenience.

---

### Brand and theme

#### Semantic visual foundation (Slice A)

`packages/ui/src/design-system.ts` owns the closed Minimal, Layered and Expressive preset
registry, typed selections, safe token resolution and shared surface variants. All presets
resolve to the same roles in `apps/web/app/globals.css`: existing page/surface/text/brand/status
colors plus raised/recessed/accent surfaces, strong border, focus, pressed feedback, radius,
elevation/overlay shadows, caption/body/title/display typography, control height/spacing and
motion durations/easing. Minimal is flat, Layered adds restrained hierarchy, Expressive adds
larger shapes, richer accent surfaces and longer feedback. None changes status colors or brand
contrast derivation. Color always accompanies a label, icon, border or selection state.

`VisualScope` is an explicit opt-in boundary. No operational shell selects a preset in Slice A;
existing consumers keep their default classes and behavior. `designProperties` admits only
closed registry values, never arbitrary properties, CSS strings or tenant styles. Appearance
uses existing forced light/dark roles; system appearance inherits the host scheme. Brand
accent, on-accent and readable link colors remain owned by `brandPalette`/`BrandStyle`.
`VisualScope` supplies its DOM container to shared Radix dialog, dropdown and popover portals
so their scheme, density and tokens survive portaling. Consumers outside a scope continue
portaling to the body. Do not clip the scope or apply transforms that change fixed positioning.

Canonical variant ownership:

| Concern | Owner and supported API |
| --- | --- |
| Card | `@gold/ui/components/card`: default, quiet, outlined, elevated, accent; web `surfaces/card` forwards the variant |
| Operational panel | `components/operational/primitives`: same surface variant map, existing density and composition retained |
| Button | `@gold/ui/components/button`: existing variants plus soft and loading; web `controls/button` maps soft/ghost tones and forwards loading |
| Selectable card | `components/controls/selectable-card`: native button over shared Button; aria-pressed, visible ring, caller-owned selection policy; no nested actions |
| Tabs / segmented content | shared Radix Tabs; `TabsList` line (default) or segmented; route navigation retains its existing link grammar |
| Menu / popover | shared Radix content: menu default/comfortable density, popover default/compact; scoped tokens preserve keyboard behavior |
| Toolbar | existing `components/display/data` Toolbar: default, quiet, outlined; layout container, not an ARIA toolbar with unimplemented arrow-key behavior |
| Input / field group | shared Input default/filled (forwarded by TextInput), shared FieldGroup default/inset; web FormField owns label/hint/error association |
| Feedback | shared Alert adds success/warning alongside default/destructive; operational StatePill remains the status vocabulary |

Loading buttons retain their accessible label, expose aria-busy and disable native activation.
Callers supply a meaningful loading label. Pressed and selected states retain non-color cues;
error states use aria-invalid and associated messages. Focus stays visible independent of brand
color. Compact density cannot reduce scoped phone controls below 44px. System reduced motion
always wins; personal reduced motion may additionally remove motion, but never force it on.

Scoped light-mode status values use darker platform-owned shades to maintain text contrast
on recessed/tinted surfaces; this is independent of every preset and tenant brand. Forced
appearance re-resolves destructive and neutral accent aliases in its own scope. Brand previews
continue applying their explicit derived brand properties over those neutral defaults.

Configuration contracts (types only; no new persistence or publishing behavior):

- `PersonalAppearancePreferences`: Account/person-owned appearance, preset, density, shape,
  motion. Future Appearance UI applies this to an operational scope.
- `OrganizationDesignDefaults`: Organization-owned operational preset, density, shape,
  motion defaults. Future authorized configuration must have one domain owner; it is not a
  second brand_settings authority. No migration, write action or persisted defaults yet.
- `StudioWebsiteDesignOverrides`: Studio-owned public website design and section overrides,
  scoped to section IDs. Future values must be validated, revisioned and snapshotted by the
  existing publication boundary. No public schema, renderer or publisher changes in Slice A.

Operational precedence: established platform defaults → organization defaults → explicit
personal preferences; undefined personal fields inherit (`resolveDesignSelection`). Shape and
density override their preset roles. OS reduced motion remains an unconditional cap. Brand
identity remains orthogonal and its status exclusions/contrast rules cannot be overridden.
Public design precedence: public defaults → organization brand identity → website design →
section overrides. Personal operator preferences never enter public snapshots. Studio's editor
chrome may consume operational tokens; its public canvas must receive a separate public scope
when Slice B integrates these contracts. Never put website overrides on the app shell.

The development-only `/dev/design-system` gallery renders real components in all six
preset/scheme combinations with a density selector, field error/disabled/loading states,
surface selection, schedule tabs/filter, truthful empty KPI and interactive modal/menu/popover.
It reads no tenant data. The exact route is anonymous only in development; the page rejects
production access. Production builds do not expose the gallery as an operational feature.
Use desktop, tablet and phone widths; inspect hover/pressed/focus, overlay focus restoration,
scheme inheritance, errors and reduced motion. This gallery is a test surface, not a new
Settings destination or another design system.

Slice B must add validated preference storage/readers and authorized organization defaults,
integrate Appearance with explicit precedence, and introduce Studio design persistence and
publication snapshots only after its own schema/security review. Expand operational scope
usage deliberately, with route-level visual regressions; do not bulk redesign routes.

An Organization's visual identity is one accent colour, a heading and body typeface from a closed list, and an optional logo. Authority is `brand_settings`, read by `getBrand` and written by `setBrand`, `uploadLogo` and `removeLogo`. Nothing else stores brand state.

Resolution path:

```text
brand_settings → getBrand → brandPalette → BrandStyle / brandStyleProperties → [data-brand] custom properties → shared components
```

- `brandPalette` (`lib/domain/branding/palette.ts`) is the only place a role is derived. The stored accent is never replaced; a foreground (`--on-accent`) and per-scheme link colour (`--accent-text`) are derived from it to meet 4.5:1 text contrast.
- `BrandStyle` writes `--accent`, `--on-accent`, `--accent-text`, `--font-heading` and `--font-body` on `[data-brand]`, which the Organization shell and public pages set. An Organization that has chosen nothing writes nothing and renders the platform's neutral look. A font choice applies without an accent.
- `[data-brand]` also sets `font-family: var(--font-body)`. Body text inherits from the `<body>` element, which sits above the brand scope, so the scope must apply the font itself.
- The Branding preview renders the shared `Button` and `TextInput` inside its own `[data-brand]` scope whose properties come from `brandStyleProperties`, the same derivation the shell uses. `[data-appearance="light|dark"]` forces a scheme for the preview; a role that is an alias must be declared again inside that selector.

Role ownership:

| Role | Owner | Brand may change it |
| --- | --- | --- |
| Background, surface, border, text, muted, hover, selected, ring | Platform | No |
| Primary action fill, its foreground, branded links | Organization accent | Yes |
| Danger, warning, success | Platform and domain rules | No |
| Heading and body typeface | Organization, from `FONT_STACKS` | Yes |

Use `bg-accent text-on-accent` for a branded action and `text-accent-text` for a branded link. Use `text-foreground`, not `text-primary`, for ordinary neutral text. Never colour an operational status with the accent: a status colour carries meaning the Organization cannot override.

Branding edits are a local draft over the persisted brand. An unfinished or malformed colour is rejected, blocks saving, and leaves the preview on the saved value. "Use platform default" clears the accent and resets both typefaces; it is saved like any other edit. Logos are uploaded and removed independently of colour and type.

Configuration ownership: Branding owns the logo, accent and typography. Public profile (`settings/public-profile`) owns customer-facing name, tagline, description and contact details. Domains (`settings/domains`) owns the public booking address and connected domains. Studio may read the brand; it does not store a second one. A viewer's light/dark preference is personal and is never an Organization setting.

Not yet supported: separate logo variants for dark backgrounds, advanced colour overrides, and optimistic-concurrency checks on simultaneous brand edits (the last save wins).

No workspace spells a palette colour. A test (`e2e/workspace-convergence.spec.ts`) fails if a hub paints one of Tailwind's default palette values, and `residual-polish` / `interaction-states` enforce the same in source.

---

### Shared operational components

`components/operational/primitives.tsx` is the one source of the operational presentation vocabulary. A workspace composes these; it does not define its own panel, tile, badge, empty box or tab strip. They are presentation only: they take data and links, never fetch, and never decide permission.

| Component | Owns | A workspace still decides |
| --- | --- | --- |
| `OperationalPanel` | titled section: heading, count, destination link, action, `flush` or padded body, `compact` or `standard` density | the content and which destination it links to |
| `MetricTile` | label, value, detail, optional passive icon, linked or plain; `emphasis` only for a platform-reported exception | the figure, its meaning and its destination |
| `StatePill` / `StatusTone` | neutral, accent, success, warning, danger | which platform-owned fact maps to a tone; tenant labels stay neutral |
| `PanelState` | `empty`, `not-configured`, `unavailable`, `restricted` | the message and any first action |
| `ViewNavigation` | URL-backed sibling views; current view is marked by `aria-current`, weight and an underline | the views and their URLs |
| `OperationalTable` | header, row and overflow geometry | columns and rows |
| `ConfigureLink` (`components/controls`) | the one "Configure" entry on a hub | the destination; it is never a second editor |

Page identity is `PageHeader` (or `WorkspaceHome`). Search and period filters sit in a toolbar under it, not in its actions, so the actions are the workspace's real tasks. A restated purpose sentence is not used; factual metadata (period, timezone, working date) is `meta`.

Empty states are one of four facts and must not be rendered alike: **empty** (a true zero), **not configured** (something required is missing; link to where), **unavailable** (the read failed or could not be verified; never shown as zero or healthy), **restricted** (about the viewer, not the data). Optional polish, such as a missing logo or introduction, is a suggestion, not an exception.

### Configure and readiness

Every configurable concern is one registered **configuration target** (`CONFIG_TARGETS` in `lib/navigation.ts`): a key, a path, the entitlement it needs and the configuration permission it needs. Settings, Setup, workspace Configure controls and Home all resolve destinations from it; none holds a path of its own. A target with `directory: false` is a workspace-owned door: still one registered destination, reached from its workspace and not listed in the Settings directory.

A workspace Home has at most one Configure entry, and it is one of two things:

- **Contextual Configure** — the page-support rail (`PageHeader configure` with a `ConfigureRegistrar`), used only when the rail holds real controls or links for the concern (CRM). A rail mode with nothing registered is not offered.
- **Configuration destination** — `ConfigureMenu`, resolved on the server by `WorkspaceConfigure` from `WORKSPACE_CONFIGURE`. It applies the same entitlement-and-permission gate as the Settings directory, then renders nothing, one link named for what it opens, or a menu. It never opens a collection that merely relates to the workspace, and never offers a door the member may not configure or the business is not entitled to.

Readiness states are separate facts and are worded once (`ReadinessState`, `ReadinessBadge`): operational (proven), configured (present; the domain has nothing to verify with), needs configuration, needs verification, unavailable, restricted, not measured, not applicable. Entitlement, activation, permission, configuration, provider verification and observed operation are never collapsed into one flag. Setup importance (required, recommended, optional) is independent of operational state: only a required gap blocks launch, and launch is decided by the database's blocker authority, not by this vocabulary. Setup progress states required items outstanding separately from areas finished, and says that the latter includes optional areas. Unknown is never shown as healthy or as zero.

`interactive.tsx` holds the client-only pieces (`FilterMenu`, `RelativeTime`) so Server Component workspaces can use the rest.

---

### Primitives

Generic primitives live in `packages/ui`.

Examples include:

- Button;
- Input;
- Field;
- Card;
- Table;
- Dialog;
- Drawer;
- Sheet;
- Tabs;
- Sidebar;
- Tooltip;
- Popover;
- Breadcrumb;
- Empty;
- Skeleton.

A primitive knows how a generic control behaves.

It does **not** know:

- what a workspace is;
- what Settings owns;
- what a customer record means;
- where page actions belong;
- whether a page is a Collection or Record Detail.

---

### Shared application components

Shared GildOps UI components live under `apps/web/components`.

They encode stable application-level grammar.

Examples include:

- page/layout containers;
- headers;
- navigation;
- support rails;
- common controls;
- shared surfaces;
- page patterns.

Use these before introducing another route-local implementation of the same responsibility.

---

### Patterns

Patterns compose shared components into recurring task structures.

Examples:

- Workspace Home;
- Collection Header;
- Settings navigation row;
- Empty/State page;
- record identity;
- master/detail shell.

A pattern should express a recognizable user task, not merely a repeated visual shape.

---

### Surface archetypes

A surface archetype defines the **kind of task a page supports**.

Every routed application surface should have one primary archetype or be explicitly specialized.

The canonical archetypes are defined later in this document.

---

## Visual hierarchy

Visual hierarchy communicates:

- what the page is;
- what matters now;
- what belongs together;
- what can be acted on;
- what is supporting context;
- what is secondary;
- where attention should move next.

Hierarchy may use:

- position;
- spacing;
- typography;
- weight;
- contrast;
- grouping;
- density;
- color;
- motion.

Do not compensate for weak structure by adding borders around everything.

Do not compensate for weak information architecture by adding headings to every block.

Whitespace and proximity should carry grouping before decorative containers are introduced.

---

## Typography

Typography uses a controlled hierarchy.

Canonical roles include:

```text
Page title
Section heading
Subheading
Body
Supporting text
Metadata
Label
Code / tabular data
```

Do not introduce arbitrary screen-specific font sizes.

A page title should look like a page title everywhere.

A section heading should not become visually equivalent to a page title merely because a route wants emphasis.

Supporting text is not automatically a subtitle.

---

## Page identity

Every page has one primary identity.

Page identity consists of the minimum combination required to answer:

```text
Where am I?
What am I looking at?
What can I do here?
```

The shared page-identity components own this responsibility.

---

### `WorkspaceHeader`

`WorkspaceHeader` is global application chrome.

It may own:

- persistent shell context;
- workspace-global triggers;
- global breadcrumb location where the shell requires it;
- shell-aligned controls.

It does **not** own a route's page title or route-specific description.

Do not put page-local business actions in the global workspace header.

---

### `PageHeader`

`PageHeader` owns ordinary page identity.

It supports:

- title;
- ancestor breadcrumbs;
- optional factual metadata;
- page-level actions.

It deliberately does **not** expose a generic `description` slot.

A page should not automatically render:

```text
Title
Sentence explaining the title
```

Explanatory copy belongs only when the task actually needs explanation.

Use:

- form instructions;
- empty-state explanation;
- section-level guidance;
- warning/context;
- factual metadata;

where those concepts belong.

Do not add filler because a page feels visually empty.

---

### `CollectionHeader`

Collections and boards should expose the work surface promptly.

A Collection Header is intentionally more compact than a generic page introduction.

It may contain:

- identity;
- breadcrumbs;
- collection controls;
- primary action;
- supported page-rail triggers.

It should not become a large hero block above a table or board.

---

### `RecordHeader`

A Record Header represents the identity of one canonical record.

It may expose:

- record title/name;
- concise factual status/metadata;
- breadcrumbs;
- record actions.

It should reuse the common page-identity system rather than creating a visually separate header family.

---

## Page geometry

### Page drawer layout

`components/panels/page-drawer.tsx` owns the layout of every contextual page drawer. Use `PageDrawerContent` with a direct `PageDrawerHeader` and `PageDrawerTitle`, one body, and an optional direct `PageDrawerFooter`. The shell keeps the header, close control and footer visible while only the body scrolls. It supplies 16px body gutters even for existing callers that omit `PageDrawerBody`; feature forms must not add another outer `p-4` or `px-4 pb-4` wrapper.

Use an explicit `PageDrawerBody` when body layout needs customization. Its standard padding is the default; `padding="none"` is reserved for a contained full-width surface such as a preview. Put field-group spacing inside the body. Place primary and cancel actions in the footer for focused creation; associate a footer submit button with its form using a unique form id. Drawers keep their own nonmodal docking, stack, Escape dismissal and focus-return behavior. Do not invent route-specific drawers or horizontal overflow to fit content.

The footer must be a direct child of `PageDrawerContent`, outside the scrolling form. Use React `useId` for the form association so multiple drawers on one page do not share an id. Do not put `PageDrawerFooter` inside a feature form: that prevents the shell from keeping actions visible. Catalogue and Plan forms follow this contract alongside tenant creation forms.

```tsx
<PageDrawerContent>
  <PageDrawerHeader><PageDrawerTitle>New form</PageDrawerTitle></PageDrawerHeader>
  <PageDrawerBody>
    <form id={formId} action={createAction} className="space-y-4">
      {/* Shared field controls and validation */}
    </form>
  </PageDrawerBody>
  <PageDrawerFooter>
    <Button type="submit" form={formId}>Create form</Button>
    <PageDrawerClose asChild><Button type="button">Cancel</Button></PageDrawerClose>
  </PageDrawerFooter>
</PageDrawerContent>
```

Website template previews use `components/display/preview-frame.tsx` to render the canonical website sections in an isolated, scaled viewport. Public responsive breakpoints must follow the preview width rather than the application's width. Studio website and form editors share `features/studio/editor-layout.tsx`; secondary panes respond to the available editor container width and open as page drawers on compact layouts. Editing state remains in the workbench owner when a drawer closes.

Studio Home retains a contained website overview, four factual summaries, Forms/content, recent submissions, creation shortcuts and a supporting publishing/attention/public-surface/activity column even when empty. Public website links require both a ready managed hostname and a published revision. A published site can simultaneously have an unpublished working revision. Booking readiness consumes usable module access, published bookable types and a public slug; portal invitations remain in CRM and brand/public-address configuration remains in Organization Settings.

Page geometry is semantic.

Use the shared page container rather than route-local arbitrary widths.

The canonical width modes are:

### Fluid

For surfaces whose work area benefits from available width.

Examples:

- tables;
- boards;
- dashboards;
- scheduling;
- master/detail;
- operational consoles;
- Platform administration collections.

### Form

For focused creation or editing tasks.

The goal is readable labels, fields and validation—not an artificially narrow mobile-like column.

### Reading

For prose-heavy or linear review tasks where line length materially affects comprehension.

Routes should choose the correct semantic mode.

Avoid route-level:

```text
max-w-md
max-w-xl
max-w-2xl
```

unless the local element itself, rather than the page, has a legitimate width requirement.

---

## Vertical rhythm

Vertical spacing is part of the system, not route decoration.

The old pattern of every page manually choosing unrelated `mt-*`, `mb-*`, `gap-*` values produces inconsistent hierarchy.

The canonical model is based on **relationships**:

```text
Page identity
↓
Page-local navigation / toolbar when present
↓
Primary content

Section heading
↓
Section body

Section
↓
Next peer section

Toolbar
↓
Collection

Field group
↓
Next field group
```

Shared layout/pattern components should own these common relationships.

Route-local spacing is reserved for exceptional internal composition.

Do not solve a shared rhythm problem by repeating the same utility class in dozens of pages.

---

### Section rhythm

A semantic `Section` represents a meaningful peer region of a page.

It should own the standard relationship to adjacent peer sections.

A page should not choose among arbitrary `mt-6`, `mt-8`, and `mt-10` values merely because each route was authored independently.

Variants are allowed only when they represent a real semantic difference, such as:

- compact;
- standard;
- separated/emphasized.

Use a small named vocabulary rather than raw spacing variation.

---

## Navigation model

Navigation should reflect the user's mental model.

Do not expose internal software architecture merely because it exists.

The operator navigation is organized as:

```text
Home

Library

Workspaces
  CRM
  Communications
  Marketing
  Support
  Work
  Finance
  Automations
  AI
  Studio

Team / Connections / Agent are workspace-header utilities.
Settings is reached through the account menu.
Platform Administration is a separate context in the context switcher for authorized platform staff.
```

Only real, reachable and authorized destinations render.

---

## Workspace navigation

Organization navigation shows Home, Library and available workspaces as flat links to their canonical Homes. Entering a workspace replaces only the persistent sidebar's central navigation with Back to Workspaces, the workspace identity, Overview and its eligible operating Areas. Back to Workspaces returns to organization Home. Overview opens `WORKSPACES[].home`; destinations come from `AREAS`, preserving canonical URLs and entitlement, feature-readiness, permission and organization-shape gates. `sidebar: false` Areas retain ownership for deep links but do not become navigation rows. Longest canonical route matching resolves nested/detail ownership and active destinations on refresh, history navigation and organization switching. Settings retains its existing contextual sidebar; Platform retains its separate privileged navigation. The same contextual content appears in the collapsed rail and mobile Sheet, which closes after selecting a destination. The Organization shell, account footer, rails and telephone runtime persist across client navigation.

On phones, the shared header presents a compact page-location control on the left and the menu trigger at the right. Desktop (md and wider) retains the full page-published breadcrumb trail. The phone uses the same current label with a semantic parent link and, where multiple authorized destinations exist, a Radix dropdown projected from the existing workspace, Settings or Platform navigation. Parent resolution prefers the nearest authorized page-published ancestor (including supported query state), then the authorized registered configuration parent or collection for a detail route, then workspace overview, then authorized shell Home. Organization Home and restricted contexts without a valid parent omit the arrow. Unresolved routes show their known label without fabricated destinations. No parent is derived by trimming a pathname or using browser history. Work overview remains /field and Work Items remains /work. The modal Sidebar Sheet owns mobile navigation and authorized context switching in its header; restricted recovery shells retain noninteractive mobile identity. Agent uses the shared rail controller through a sidebar action. Account remains in the footer. There is no persistent bottom navigation bar. The sheet dismisses on outside interaction, Escape, its close control, navigation selection and pathname/history changes, restoring focus to its trigger. Desktop switching stays in the sidebar. Marketing mobile navigation groups secondary Log in and primary Request a demo in the sheet footer.

Automations Home is an operational dashboard with a compact search/period/action toolbar, four current-rule or period-execution metrics, contained attention categories, Rules preview, recent executions, execution trends, and an activity/health/failures/insights rail. Period boundaries and displayed timestamps use the Organization timezone. Exact aggregates remain separate from bounded previews; execution completion never proves message delivery. Empty organizations retain every panel. Rules and Activity use URL-backed filters and pagination; runs and deliveries have deep-linkable contextual inspectors. The existing rule-detail route is a linear Trigger → all Conditions → ordered Actions workbench with a contextual node inspector, single-pane mobile navigation, canonical diagnostics, and read-only inspection. New rules authored through the UI start disabled; enabling explains future effects and requires deliberate confirmation. Triggers remain immutable. Condition/action edits replace the configuration in one authorized database statement. Templates use the existing message-template store and focused drawers with supported placeholder insertion and a labeled sample-only preview. Workspace navigation uses the shared contextual projection; execution ownership is unchanged.

Never add:

- “Coming soon” child pages;
- dead links;
- placeholder routes;
- configuration-only pages to make the workspace look larger.

---

### Workspace Home

Work Home at `/field` is a contained operational dashboard: search/date/create/dispatch/configure toolbar, four scheduling/assignment summaries, attention tabs, resource dispatch overview, upcoming work and seven-day commitments, and a Today/status/activity/capacity rail. Counts span their stated scope; previews are bounded. Selected-day requirements and availability conflicts come from the canonical scheduling projection, while unassigned scheduled and unscheduled backlogs span all dates. Unconfigured opening hours are explicitly identified; permissive availability semantics remain unchanged. No arrival, GPS, route or productivity metrics are inferred.

Dispatch at `/work/dispatch` is a queue, assignment board and selected-Work inspector. Date, type, status, resource, class, assignment state, mode and selection persist in the URL. Schedule mode displays canonical resource commitments/free windows; Map mode uses actual Work Location coordinates and the existing map renderer, with List/Schedule fallback when unavailable. Assignment, scheduling and feasibility invoke the existing Work actions. Work collection List uses database filters and pagination; Board independently reads each configured status with exact counts, bounded cards and links to the full stage collection. Work configuration uses a type-selection workbench and General, Workflow, Requirements, Checklist, Booking and Fields sections. Resources expose class/capability filters and selected-day availability and assignments. Resource availability and Work/Schedule configuration mutations refresh the operational consumers. Workspace navigation uses the shared contextual projection without parallel record authorities.

Communications Home at `/comms` uses a compact search/date/action toolbar, four readiness summaries, a 70/30 desktop grid with attention categories, an Inbox queue and canonical CallHistory preview, and a Today/status/activity/insights rail. Previews are bounded; exact counts and selected-period call rates come from tenant-scoped database reads. Inbox filters and search survive destination links. Outstanding conversations and wrap-up are current work, while missed/recent calls use the selected organization-timezone period. Empty states retain every panel. Today shows recorded communication activity, not an invented schedule; unsupported presence, callbacks, compliance controls and response-time trends are not simulated.

Calls remains `/calls`; Inbox list/detail remains `/comms/inbox`; number inventory/detail remains `/comms/numbers`. Configuration remains `/settings/calls`, with shared visible sections for outcomes, messaging readiness, routing, identity, business hours and recording/compliance information. New call uses the canonical dialer drawer; compose/reply requires a runtime-ready sender. Calling and message handling keep their existing independent capabilities. The routing editor loads saved ordered primary/fallback members before enabling Save; a failed load cannot overwrite them with empty targets. Calls, Inbox and Numbers are destinations in the Communications contextual sidebar.

Finance Home uses a contained operational dashboard with four financial-state summaries, inline Needs attention categories, open invoices, recent payments, collections/performance, and a due/status/activity/insights rail. Selected-month received payments and reporting are separate from current receivables and uninvoiced priced Work. Empty organizations keep the complete composition. Quotes, Invoices and Payments use URL-backed search, status, Customer, date and pagination controls; dashboard previews are deliberately bounded, while totals come from complete database aggregates. Finance search and financial reporting have contextual routes under `/finance/search` and `/finance/reports`, while contextual support pages remain absent from the sidebar.

Finance creation uses the shared PageDrawer: quotes add snapshotted price-book lines to canonical Work, invoices review eligible priced Work before canonical issuance, and payments select or preselect an invoice before append-only recording. Corrections use signed entries; manual source never implies a payment method. Invoice and quote links open `/work/[workItemId]?tab=financials`. Services & Pricing remains owned by `/settings/pricing`, with a scannable catalogue and contextual create/edit drawers, trading currency and payment configuration. Aggregate financial values require `report.read`; pricing, issuance, payment and organization configuration permissions remain independent.

Marketing and Support use domain operating Homes at `/marketing` and `/support`; tenant AI uses an agent-management operating Home at `/ai`. Support has a dense Home with four exact KPI drilldowns, attention lists, active Cases, queue workload, resolution performance and a desktop context rail. Local navigation reaches Cases list/board, queue workbench, Case detail, service levels and reports. Shared drawers own Case creation and editing; narrow screens use Case summaries and stacked inspectors. Empty views retain usable panel structure and real configuration actions. Support uses Headset, Marketing uses Megaphone, AI uses Bot, and Work retains Wrench. Organization workspace selection stays flat; entered workspaces use contextual navigation. The global Agent utility retains Bot and opens the Agent rail; tenant AI exposes neither Platform AI Runtime nor provider credentials. Support's visual and interaction references live in `docs/design/support/`.

AI Home follows the dashboard reference with a compact action/filter toolbar, four exact KPI drilldowns, agent/deployment/activity previews and a contextual readiness, handoff and allowance rail. Empty panels retain useful actions; provider health, missing usage and unavailable runtimes are explicit. Local collection navigation stays inside the AI workspace context. Agent details use section navigation, a central draft editor and a readiness inspector; phones use a section selector and agent cards. Save checks draft concurrency, Publish creates an immutable version, and deployment version changes are deliberate. Unsaved editor changes survive section navigation and can be recovered after reload/back navigation from per-actor tab storage; recovery retains the original draft revision for conflict detection. Channel drawers never expose provider credentials. Knowledge sources are published websites; tests and evaluation verdicts are personal. Execution inspectors link to Communications rather than duplicating public transcripts. Visual targets and interaction evidence live in `docs/design/ai/`.


CRM Home launches Customers, Opportunities and the Opportunity pipeline; the feature-gated Customer board is labeled Relationship pipeline. Its primary commercial summary counts only Opportunities whose configured stage is Open. Unstaged Opportunities have a separate count. Stage values are displayed separately per currency. Opportunity routes remain registered CRM children with `sidebar: false`, preserving the flat organization workspace chooser and remaining absent from the contextual sidebar.

Opportunity creation and editing use the shared PageDrawer. The collection preserves filters and pagination in the URL. Pipeline cards share the same records and detail destinations; stage movement uses a labeled select and explicit save action. Each board stage independently previews up to ten Opportunities with exact count and per-currency totals. Unstaged is a visual column, never a stored stage. The example pipeline's column/header/card hierarchy informs the production board without runtime example imports or demo state.

CRM Home is an operational dashboard: compact search/action/month toolbar, four KPI summaries, inline Needs attention categories, commercial pipeline snapshot, Recent Customers and CRM Insights, and a Today/Recent activity rail. Follow-ups use one contextual PageDrawer across Home, collection, calendar and Customer/Opportunity sections. Completion is an inline authorized action; edit/reschedule retains its originating context. The Follow-ups calendar uses URL-backed day/week/month, date, navigation and owner filters with Organization timezone. All domain calendars use the shared calendar foundation in `components/calendar`: URL/date/view handling, view navigation, date picker, period toolbar, workspace frame, agenda columns and month grid. Work and CRM supply canonical reads, filters and event content; Work resource timelines and CRM Follow-up drawers extend this foundation. Domain ownership never creates a separate calendar UI foundation. Follow-ups, calendar and CRM search remain hidden from the permanent workspace-switcher sidebar.

Customer detail hosts Opportunities and Follow-ups tabs with Customer preselected for creation. Opportunity detail prominently shows its next Follow-up and open/recent work. Organization Settings owns Opportunity stages independently of Relationship stages; both use the configuration registry.

Workspace Home is the parent destination.

It answers:

> What matters in this workspace, and where can I go from here?

It may contain:

- concise operational summary;
- relevant status/KPIs;
- recent/urgent items;
- primary next actions;
- direct links into child surfaces;
- contextual Activity / Insights / Configure where valid.

A Workspace Home is not a giant dashboard by default.

Every card or metric must serve navigation, awareness or action.

---

## Organization Home

Organization Home is cross-workspace.

Global Home uses a compact action/period header, at most four authorized KPI cards, and an approximately 70/30 operating/supporting layout when its actual content container is wide enough. Needs attention leads the main column, followed by today's operations, next-seven-day obligations, business performance and bounded recent activity. The supporting column holds three personal priorities, canonical Quick Actions, workspace readiness and supported global Agent prompts. Narrow containers replace attention tables with cards and stack columns; opening the existing Agent rail therefore changes composition without squeezing a desktop table into a narrow pane.

All/Mine/Urgent/Overdue and reporting periods live in the URL. Mine uses Membership and linked Resource ownership, never a display name or inferred assignment. Exact category totals are independent of five-record previews and may overlap. Source failures say unavailable and unknown; successful empty reads say empty. Current queue and schedule scopes are distinct from Today/rolling-seven-day/calendar-month reporting scopes. Monetary figures and payment series remain separate by stored currency. `--warning` denotes an operational exception requiring review; it does not denote provider health.

Quick Actions reuse owning drawers; invoice creation composes the existing Finance workflow. Search is an authorized workspace launcher. Optional performance/activity/health panels have browser-local, actor-and-Organization-scoped preferences. Critical attention and operating responsibility remain visible. The global Agent stays in its existing rail, using its own tools and approvals. Visual references and destination classifications live in `docs/design/home/`.

It may surface important facts from several domains.

It does not become their owner.

Organization Home should prioritize:

- current operational state;
- work requiring attention;
- business-level shortcuts;
- launch/setup/readiness when relevant.

It should not replicate every workspace dashboard.

---

## Library navigation

Library is shared infrastructure, separate from the Workspace list.

Its navigation may expose real Library capabilities such as:

- Files;
- Media;
- Templates;
- Knowledge;
- Collections;
- Sources;
- Trash.

Do not expose a destination merely because its eventual taxonomy has been named.

Navigation requires a real surface.

---

## Platform navigation

Platform Administration is a privileged scope within GildOps' own organization context.

Its navigation is separate from tenant workspace registration.

Platform may group control-plane destinations such as:

```text
Overview

Organizations

Catalog
  Products / families
  Modules / Features
  Meters
  Connectors

Commercial
  Plans & Add-ons
  Pricing
  Economics
  Billing

Infrastructure
  Providers
  AI runtime
  Failures
```

The exact child set follows real implementation.

Platform is not listed beside CRM/Finance/etc. for customer organizations.

---

## Responsive navigation

Information architecture remains stable across viewport classes.

Presentation changes.

Canonical behavior:

### Phone

Persistent bottom navigation:

```text
Home | AI | Menu
```

Three equal controls.

The bar does not scroll.

- **Home** navigates to the projected organization Home.
- **AI** toggles the workspace-global Agent.
- **Menu** opens the full organization navigation in a right-side sheet.

The Menu renders the same projected hierarchy used by desktop navigation.

Do not maintain a separate lossy “phone navigation” information architecture.

### Tablet

Use an icon-focused/collapsed rail or equivalent compact shell while preserving the same navigation hierarchy.

### Desktop

Use the persistent sidebar and higher-density page layouts.

---

## Breadcrumbs and back navigation

Breadcrumbs describe hierarchy/location.

A back control describes the user's task escape or return path.

They are not interchangeable.

Use breadcrumbs when the page sits in a meaningful navigable hierarchy.

Use Back when a focused task or mobile context benefits from an explicit return control.

Do not show the current title twice merely because both a header and breadcrumb can render text.

On narrow layouts where breadcrumbs disappear, preserve enough page identity and return context to avoid disorientation.

---

## Local navigation

Local navigation represents sibling views within one owned surface/scope.

Use the shared local-navigation grammar.

Examples:

```text
Access
  Members
  Invitations
  Roles

Account
  Profile
  Security & sign-in

Connections
  Connected
  Browse apps
  other real sibling views
```

Do not build a different tab/navigation component for every domain.

One local navigation component may be wrapped by domain-specific components that define:

- labels;
- URLs;
- visibility;
- ownership.

Presentation and behavior remain shared.

---

## Navigation vs actions

Navigation changes location or view.

Actions perform or initiate work.

Controls that look the same should behave the same.

Do not style:

- links;
- mutations;
- disclosure toggles;
- modal/sheet triggers;

as interchangeable controls without a clear interaction distinction.

Examples:

```text
Customers       → navigation
New customer    → action
Platform group  → disclosure within system navigation
Configure       → page-support trigger
```

---

## Page support rail

The page-support rail hosts contextual secondary tools.

The canonical support-mode order is:

```text
Activity
Insights
Configure
```

A page renders only modes for which it has a real source.

---

### Activity

Activity shows relevant historical/current events for the page context.

Do not create an Activity trigger whose panel has no canonical event source.

---

### Insights

Insights shows contextual analysis.

It may summarize reporting data or link to deeper Insights routes.

It does not create a second analytical source.

---

### Configure

Configure exposes page/workspace-owned configuration.

Where configuration belongs to Settings, Configure should link or transition to the authoritative Settings destination rather than create duplicate settings.

---

### Agent

The Agent is not a page-support mode.

It is workspace-global assistance.

Agent and page-support rail are independent panels.

They may share shell behavior but not conceptual ownership.

---

## Panel behavior

Panels should preserve context rather than unnecessarily replacing the page.

Desktop behavior may dock panels beside content when geometry permits.

Mid-width layouts may overlay from the right.

Phone layouts may use a bottom or full-height sheet appropriate to the task.

Do not:

- dim the entire application for persistent supporting tools unless the interaction is modal;
- use arbitrary route-specific margins to align panel geometry;
- allow a panel to obscure persistent phone navigation without accounting for it.

Shell geometry is shared infrastructure.

---

## Surface archetypes

Every real routed surface should map to one primary archetype.

A route may compose secondary patterns.

If none fits, classify it as specialized and justify the new behavior before introducing another shared archetype.

---

### A1 — Workspace Home

Purpose:

> Summarize one workspace and route into its real operating surfaces.

Typical content:

- status;
- high-value metrics;
- urgent/recent work;
- child-surface links;
- primary next actions.

Avoid:

- repeating every child screen;
- generic card grids with no action;
- a second “Overview” destination.

---

### A2 — Collection

Purpose:

> Find, filter, scan and open many records.

Typical composition:

```text
Collection identity
Toolbar / search / filters / views / primary action
Collection body
Pagination or bounded loading
States
```

Representations may include:

- table;
- list;
- cards;
- board;
- map;

when the data/task justifies them.

A representation switch exists only when multiple views materially help the task.

---

### A3 — Record Detail

Purpose:

> Understand and act on one canonical record.

Typical content:

- record identity;
- factual state;
- primary actions;
- owned sections;
- related-record projections;
- timeline/activity;
- contextual support modes.

Avoid turning a detail page into an unstructured stack of cards.

---

### A4 — Focused Form / Editor

Purpose:

> Complete one bounded creation or editing task.

Use:

- semantic Form page width;
- clear field grouping;
- labels/instructions;
- validation at the field/task level;
- clear save/cancel/close behavior;
- dirty/pending state handling where needed.

Avoid:

- cards around every field group;
- repeated page title inside the form;
- business validation only in the browser.

---

### A5 — Settings Context

Purpose:

> Move between the cross-workspace administrative concerns of a person and an organization.

Settings has no landing page and no directory page. Entering it swaps the shell's sidebar content, inside the same `Sidebar`, for Back to app, a settings search, and three groups:

```text
Personal        Profile, Security & sign-in
Organization    General, Branding, Domains, Features
Administration  Team & access, Connections, Plan & usage
```

Opening Settings lands on the first destination the member may use. Every destination is a deep link and receives the Settings sidebar whether or not the person came through the menu. Back to app returns to the last page of the same business that was not Settings, validated as a path inside that business, otherwise Home.

Search covers these destinations and the configuration workspaces own (from `CONFIG_TARGETS`) and routes each to its canonical owner. Settings does not list workspace configuration.

---

### A6 — Settings Page Identity

The global bar names the section once (`PageHeader section="Settings"`; Help uses `section="Help"`); the title beneath is the page. A page does not publish its own title as a breadcrumb and print it again as a heading. Forms use the bounded `form` width; pages with tables or catalogues use `fluid`.

---

### A7 — Settings Detail

Purpose:

> Configure one owned concern.

Typical composition:

- Settings breadcrumb;
- page identity;
- local sibling navigation when appropriate;
- semantic sections or form groups;
- state/help near the relevant control.

Do not repeat peer scope destinations inside another scope.

---

### A8 — Operational Configuration

Purpose:

> Configure a workspace/capability close to where it is operated.

Use when moving the operator away from the work would be harmful and the configuration clearly belongs to that operational domain.

If Settings already owns the configuration, link there instead.

---

### A9 — Dashboard / Insights

Purpose:

> Analyze canonical facts.

A dashboard may combine several metrics and visualizations.

Every metric should answer a real operating question.

Do not create charts because the page is called a dashboard.

Analysis must link back to the operational records or destinations where action occurs.

---

### A10 — Master–Detail

Purpose:

> Operate a list/stream while preserving selected-record context.

Examples:

- Inbox;
- queues;
- communication threads;
- dense administration workflows.

Desktop may use adjacent panes.

Phone must collapse into a sequential flow rather than compressing both panes into unusable columns.

Selection state should be URL-backed when direct navigation/history matters.

---

### A11 — Operational Console

Purpose:

> Support active, high-density operational work.

Examples:

- calling;
- dispatch;
- live communication;
- scheduling operations.

Console surfaces may prioritize dense controls and current state over explanatory content.

They still follow shared:

- page identity;
- control semantics;
- state;
- accessibility;
- responsive rules.

---

### A12 — Wizard / Onboarding

Purpose:

> Move through a bounded multi-step transition.

Required behavior:

- visible progress;
- clear step identity;
- preservation of already-known data;
- recoverable back/forward behavior;
- validation before irreversible transitions;
- clear completion/readiness state.

Do not ask for data already known from an authoritative prior step unless the user is confirming or correcting it.

---

### A13 — Platform Administration

Purpose:

> Operate the GildOps SaaS control plane.

Platform pages may use:

- collections;
- record details;
- dashboards;
- configuration;

but always within recognizable Platform scope.

Control-plane vocabulary should remain distinct from tenant-facing vocabulary where the concepts differ.

---

### A14 — Public / Customer Experience

Purpose:

> Complete a customer-facing task outside the authenticated operator shell.

Examples:

- booking;
- hosted form;
- proposal;
- portal;
- public website;
- payment return.

Use tenant/customer brand/context where appropriate.

Do not expose operator navigation or GildOps control-plane concepts.

---

### A15 — Auth / Personal Identity

Purpose:

> Authenticate or manage the Person.

Includes:

- login;
- sign-up;
- password recovery;
- Account;
- Security & sign-in.

Security-sensitive actions require clear state and confirmation.

---

### A16 — State / Exception

Purpose:

> Explain why normal content cannot be shown and what can happen next.

Examples:

- empty state;
- not found;
- unavailable;
- permission denied;
- feature locked;
- disconnected;
- error.

Truth comes first.

Do not fabricate a primary action when none is valid.

---

## Collections

Collections should share a predictable operating grammar.

### Toolbar order

Use only relevant controls, commonly:

```text
Search
Filters
Sort / grouping
View switch
Secondary actions
Primary action
```

The primary action should be visually and spatially stable across similar collections.

Do not scatter collection actions above and below the data.

---

### Search

Search should:

- state what it searches when ambiguous;
- preserve URL state when shareable/navigation-relevant;
- debounce remote search when needed;
- provide a clear reset;
- not masquerade as an advanced filter system.

---

### Filters

Filters should reflect meaningful domain dimensions.

Active filters must be visible and removable.

Do not hide an active filtering condition so thoroughly that a user believes data is missing.

---

### Tables

Use tables for structured comparison across repeated records.

Tables should support:

- readable column hierarchy;
- stable row actions;
- sorting only where meaningful;
- explicit empty/loading/error states;
- horizontal scrolling where preserving columns is better than destructive compression.

Do not force a desktop table into unreadable stacked cells solely to avoid horizontal scrolling.

---

### Cards

A Card is a container primitive, not an archetype.

Use cards when they communicate a meaningful independent object or grouping.

Do not use a card simply because:

- a section needs spacing;
- a form needs a background;
- a title needs a border;
- the page looks “empty.”

Avoid the default syndrome:

```text
Title
Description
Card
Card
Card
```

unless the task genuinely consists of independent card-like objects.

---

### Boards

Boards are appropriate when state/stage movement is central to the task.

A board must account for:

- large column counts;
- large record counts;
- horizontal navigation;
- drag/accessibility alternative;
- mobile fallback;
- filtering;
- state-change authorization.

---

### Maps

Maps are appropriate when geography materially changes the decision.

A map should not replace a collection's textual access to the same records where accessibility and scanability require both.

---

## Forms

Forms are task structures.

Use semantic grouping.

---

### Labels and help

Every field has an accessible label.

Help text explains:

- format;
- consequence;
- domain meaning;

when needed.

Do not use placeholder text as the only label.

---

### Validation

Validation occurs at several levels:

```text
input formatting
domain validation
authorization
database constraints
provider validation
```

The UI should display authoritative errors near the relevant task/field when possible.

Do not duplicate every business rule in client JavaScript and assume the result is authoritative.

---

### Save behavior

Use explicit save when changes are material, multi-field or consequential.

Use immediate mutation only where:

- the action is narrow;
- the effect is clear;
- rollback/error behavior is understandable.

Pending state must prevent accidental duplicate submission when duplication would matter.

---

### Destructive actions

Destructive actions require consequence-appropriate friction.

Confirmation should state:

- what changes;
- whether it can be undone;
- what related state is preserved or affected.

Do not require ceremonial confirmation for harmless reversible actions.

---

## Status and feedback

Every asynchronous action should have an understandable state:

```text
idle
pending
success / applied
error / refused
```

Use loading indicators that preserve page structure where possible.

Avoid full-page spinners for local mutations.

### Status colour

Colour on a status states a fact, never a label's wording.

- GildOps-owned facts may carry a semantic tone: a verified connection, a failed execution, a setup area that is ready. They use `success`, `warning` or `danger`.
- Tenant-authored statuses stay neutral. A stage, case status or custom label the organization wrote has no platform meaning, so it is never coloured by comparing its text. Where a domain keeps an authoritative classification (an opportunity stage's Open, Won or Lost; a case's open or resolved state), that classification may supply a tone, separately from the label.
- Brand and interaction colour (`accent`, `accent-text`) never carries operational meaning.
- State is never conveyed by colour alone: pair it with text or an icon.

---

### Success

Success feedback should confirm the result, not celebrate routine operations.

Prefer:

> Customer created.

over noisy generic celebration.

---

### Errors

Error messages should:

- describe what failed in user language;
- preserve input where safe;
- distinguish validation from system failure;
- provide recovery when one exists;
- avoid leaking sensitive provider/security details.

---

### Empty states

An empty state answers:

```text
What is absent?
Why might it be absent?
What can I do next?
```

Do not use the same “Nothing here yet” message everywhere.

---

### Locked / unavailable

Different causes need different states.

Examples:

```text
not entitled
not permitted
not configured
provider unavailable
no data yet
feature not implemented
```

Do not collapse these into “Disabled.”

---

## Settings UI

Settings reinforces ownership through its grouping, not through a landing page. See A5 and A6.

### Organization → General

General is the business profile, one form with four sections: business identity (name, optional legal name, optional industry), primary business address, business contact, and the regional defaults the location implies. The same form is rendered in Setup and writes through the same action.

The address is private to members (`organization_identity`) and is never copied to the public profile; publishing an address is the public profile's own field. A location change proposes a time zone and currency and applies neither until the person accepts it.

Organization setup uses an adaptive step navigation, a focused current-step panel and observed
readiness/launch support panel. Desktop supports three columns, tablet stacks readiness below the
current task, and phone uses contained horizontally scrollable step navigation. Continue changes the
step URL only; completion is always derived from saved domain records. Review lists required,
recommended and optional areas and offers only authorized owning destinations.

Proposal review is a dedicated workbench with independent operations, finance, people, data,
automation, presence and feature views. Switching views retains edits. Save and Apply are separate;
unsaved changes disable Apply and protect browser unload. Apply and launch use deliberate confirmation
dialogs. A failed application reports partial state; an interrupted application asks for inspection
before any new remainder draft. Roles use a scrolling capability body with a fixed action footer.

Organization Settings does not contain:

- Team/Members;
- personal Profile;
- Connections;
- Plan & usage;
- workspace-owned configuration (work types, working hours, price book, stages, call routing, agents, automation rules, website).

---

### Account

Account is person-owned.

Its local navigation should use the same shared sibling-view grammar as other scope navigation.

Do not maintain a one-off tab implementation solely for Account.

---

### Access

Access owns:

```text
Members
Invitations
Roles
```

Use one local-navigation implementation.

“Team” may appear in descriptive copy if useful, but **Access** is the scope owner.

---

### Connections

Connections owns external-system relationships.

Its local navigation must reflect one explicit canonical set of real views.

Do not allow type definitions, comments and rendered tabs to describe different view sets.

---

## Platform UI

Platform Administration should feel like a coherent control plane without becoming a completely separate visual application.

Reuse:

- shell;
- page identity;
- collections;
- record details;
- forms;
- support rails;
- state patterns.

Platform may use denser information presentation because its users perform administrative/system work.

Density is not permission to abandon hierarchy.

---

## Responsive behavior

Responsive design is intentional re-composition, not desktop shrinkage.

For every significant surface, decide:

- what remains visible;
- what moves;
- what stacks;
- what becomes a sheet/drawer;
- what becomes sequential;
- what scrolls;
- which controls remain persistent.

---

### Breakpoint behavior

Test at meaningful layout classes rather than arbitrary device brands.

At minimum, verify:

- phone;
- tablet/compact;
- desktop;
- wide desktop where rails/panels dock.

A surface with a meaningful custom transition may require an additional viewport.

---

## Accessibility

Accessibility is a functional requirement.

At minimum:

- all interactive controls are keyboard reachable;
- focus is visible;
- labels/names are programmatic;
- disclosure controls expose state;
- dialogs/sheets manage focus correctly;
- semantic elements match their purpose;
- status is not communicated by color alone;
- contrast is sufficient;
- motion respects reduced-motion preference;
- table/board alternatives remain operable;
- touch targets remain usable on phone;
- error messages are discoverable and associated with fields where relevant.

Do not create a visually custom control when the existing accessible primitive already provides the required behavior.

---

## Motion

Motion communicates:

- spatial relationship;
- state change;
- continuity;
- feedback.

Motion should be subtle and functional.

Avoid motion that:

- delays the task;
- obscures content;
- creates layout instability;
- ignores reduced-motion preferences;
- exists only to make ordinary navigation feel “premium.”

---

## Content and terminology

Use domain language from `docs/domain-model.md`.

Do not expose implementation jargon where the user has a better business concept.

Examples:

```text
Provider Account
```

belongs in Platform Administration.

A tenant may instead see the resulting:

```text
Phone number
Sending domain
Connection status
```

when those are the concepts they operate.

Use consistent verbs.

If an action is called “Invite member” in one Access screen, do not call the same action “Create user” elsewhere.

---

## Loading, error and permission boundaries

Every routed surface should account for:

- loading;
- no data;
- error;
- permission denied;
- not entitled;
- not found;
- unavailable dependency;

where those states are possible.

Do not treat a redirect to a generic marketing 404 as acceptable authenticated-shell behavior.

Errors should remain in the correct context/shell when possible.

---

## Verification

A UI change is not verified solely because:

- TypeScript passes;
- unit tests pass;
- a source scan sees a component;
- the page compiles.

For user-visible changes, verification includes rendered evidence.

---

### Browser verification

Inspect:

- routing;
- interaction;
- keyboard/focus;
- drawers/sheets/dialogs;
- browser APIs;
- data state;
- errors;
- responsive transitions.

---

### Visual verification

Inspect:

- hierarchy;
- alignment;
- spacing;
- density;
- wrapping;
- clipping;
- overflow;
- table/board behavior;
- panel geometry;
- empty/loading/error states;
- major viewport classes.

---

### Visual regression vs exhaustive audit

These are different tools.

#### Visual regression

Use a small representative baseline of canonical patterns.

Purpose:

> Detect unintended visual change in established reference surfaces.

Do not snapshot every current inconsistency and call it canonical.

#### Exhaustive UI audit

Use broad route/surface capture.

Purpose:

> Find inconsistency, breakage and drift across the application.

The audit should record:

- route template;
- actual URL;
- viewport;
- screenshot;
- runtime console errors;
- failed requests;
- source/archetype mapping;
- unreached routes.

An unreached dynamic route is reported honestly rather than forced with invented IDs.

---

## Creating or changing a surface

Before implementation:

1. identify the user's primary task;
2. identify the owning domain/workspace/scope;
3. select the primary archetype;
4. inspect existing shared components/patterns;
5. identify states and permissions;
6. identify responsive transitions;
7. identify support modes, if any.

During implementation:

1. use shared page geometry;
2. use shared page identity;
3. use shared navigation grammar;
4. use shared semantic spacing;
5. keep business rules out of presentation;
6. expose real states;
7. avoid duplicate canonical records.

Before completion:

1. run the relevant tests;
2. open the rendered surface;
3. verify desktop;
4. verify tablet/compact when behavior changes;
5. verify phone;
6. verify empty/error/locked states as applicable;
7. verify keyboard/focus for new interactions.

---

## UI anti-patterns

Do not introduce:

- title + generic explanatory sentence by default;
- border/card around every section;
- route-local arbitrary page width;
- route-local spacing used to repair shared geometry;
- multiple unrelated implementations of sibling local navigation;
- duplicate page title in breadcrumb and heading without purpose;
- configuration duplicated in operating surfaces and Settings;
- `Overview` beside `Home`;
- placeholder workspace rows;
- navigation destinations that are actually actions;
- action controls that visually behave like links without reason;
- hidden filters;
- mobile desktop-table compression that destroys readability;
- modal behavior for persistent support tools;
- hard-coded platform/tenant scope differences inside generic primitives;
- UI-only permission checks;
- generic “Disabled” state for entitlement, permission and configuration failures;
- fake dashboards composed of arbitrary cards;
- visual changes reported as verified without opening the application.

---

## Document boundaries

This document owns:

- UI hierarchy;
- navigation behavior;
- page identity;
- page geometry;
- semantic spacing;
- surface archetypes;
- collection/form/state grammar;
- responsive behavior;
- accessibility expectations;
- visual verification.

It does not own:

- domain definitions;
- database schema;
- authorization enforcement;
- deployment;
- product implementation status;
- provider contracts.

Those belong to their respective canonical documents.

## Marketing workspace

Marketing Home is a compact operational dashboard: four evidence-backed KPIs, a contained attention panel with inline categories, campaign performance and active-campaign tables, recent inquiries and acquisition/source results, plus a supporting activity/readiness/insights rail. Empty organizations retain all panel geometry. Local Home/Campaigns/Audiences/Leads/Performance navigation preserves the flat organization workspace chooser and contextual workspace sidebar. Campaign detail is deep-linkable; campaign and audience editors and inquiry review use shared PageDrawer primitives. Collection search, review/status/objective/owner/source filters, date bounds and pagination persist in the URL. Table overflow is contained within its panel at narrow widths. Activation expresses Marketing lifecycle, not delivery success; unestablished consent and unavailable promotional delivery are shown explicitly.

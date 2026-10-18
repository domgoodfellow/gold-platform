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

`VisualScope` is an explicit opt-in boundary. Account shells apply only saved personal choices;
an absent preference row selects no preset and retains existing classes and behavior. Every scope
restarts from the platform token defaults, so a nested scope never inherits its parent's preset. `designProperties` admits only
closed registry values, never arbitrary properties, CSS strings or tenant styles. Appearance
uses existing forced light/dark roles; system appearance inherits the host scheme. Brand
accent, on-accent and readable link colors remain owned by `brandPalette`/`BrandStyle`.
`VisualScope` supplies its DOM container to shared Radix dialog, dropdown, popover, tooltip, sheet and drawer portals
so their scheme, density and tokens survive portaling. Consumers outside a scope continue
portaling to the body. Do not clip the scope or apply transforms that change fixed positioning.

Canonical variant ownership:

| Concern | Owner and supported API |
| --- | --- |
| Card | `@gold/ui/components/card`: default, quiet, outlined, elevated, accent; web `surfaces/card` forwards the variant |
| Operational panel | `components/operational/primitives`: same surface variant map, existing density and composition retained |
| Button | `@gold/ui/components/button`: existing variants plus soft and loading; web `controls/button` maps soft/ghost tones and forwards loading |
| Selectable card | `components/controls/selectable-card`: native button over shared Button; aria-pressed, visible ring, caller-owned selection policy; no nested actions |
| Tabs / segmented content | shared Radix Tabs; `TabsList` segmented (default) or line; URL navigation uses `ViewNav` |
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

Configuration contracts:

- `PersonalAppearancePreferences`: Account/person-owned appearance, preset, density, shape,
  motion. Account Appearance persists this contract as described below.
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
chrome consumes operational tokens; rendered website sections and form previews use the
`data-public-design` boundary. Never put website overrides on the app shell.

#### Personal appearance (Slice B)

`/settings/account/appearance` is a personal Settings destination in `PERSONAL_SECTIONS`.
`projectSettingsNav` derives personal entries from that registry; `AccountSectionNav` uses it
for accounts with no organization shell. The `org` query is only a return hint validated against
the caller's memberships by `PersonalSettingsShell`. Profile remains the default destination.

`lib/domain/identity/appearance.ts` owns validation, verified permanent-account identity, reads,
saves and resets. `account_appearance_preferences` owns persisted selections, independently of
profiles, memberships, brands and public website revisions. There is no automatic row creation.
A successful missing-row read means legacy defaults; failed reads are errors, never defaults.
Reset deletes the row. Save stores only closed choices; blank preset/density/shape values inherit.
Theme is system/light/dark; motion is system/reduced. Last successful account save wins.

`AppearanceEditor` owns a local draft. Visual style is one native radio group of compact tiles;
the single Preview renders the draft through `VisualScope` with real shared components and is
the only rendered sample on the page. Changing controls
does not persist or change the shell. Save and Reset are explicit server actions; Discard restores
the saved selection. Independent light/dark preview controls never become saved preferences.
Pending, unsaved, saved and refused-write states remain distinct, and rejected drafts survive.
The action revalidates the root layout and the editor refreshes server components without a
document reload. No cookies, localStorage or runtime CSS are preference authorities.

`AccountAppearance` reads under the caller's JWT and renders the semantic attributes during SSR.
It wraps OrganizationShell (including nested Platform), personal Settings' organization/fallback
frames, no-business onboarding and the signed-in invitation surface. The active-call dock sits
inside the same scope while telephone providers remain above the shell. Dialer popouts copy the
validated account scope and observe saved updates. PageDrawer portals remain inside the existing
workspace rail host; they require no second theme provider. Scoped Sonner reads `VisualScope`;
`PublicFeedback` preserves the root system-themed toast surface outside account shells.

Forced appearance re-resolves sidebar and other aliases; the Tailwind dark variant uses a
container style query over the closed `--appearance-scheme` token, inheriting the nearest
explicit appearance or public boundary. `BrandStyle` uses its canonical palette's `light-dark`
link colors against the actual scope's color-scheme, including preferences opposite to the OS.
Platform-owned status colors and the OS reduced-motion cap remain independent of preference.

The production section renderer in Studio's WebsiteCanvas and FormRenderer previews reset to the
same public defaults in `globals.css`, while inheriting only validated brand identity aliases.
CSS scopes stop personal variants, density and motion overrides at `data-public-design`. Public
routes, private website previews, booking, forms and portal do not load account appearance.
No website schema, revision, publishing or organization-default persistence changes are included.

Slice C may persist organization operational defaults through one authorized domain owner and
resolve defaults before explicit personal fields. Slice D may persist validated website design
inside the existing revision/publication boundary. Both must preserve the separate public scope,
closed token registry, semantic status roles and unconditional OS reduced-motion cap.

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

`components/operational/primitives.tsx` owns the operational presentation vocabulary; `components/navigation` owns shared route navigation. A workspace composes these; it does not define its own panel, tile, badge, empty box or tab strip. They are presentation only: they take data and links, never fetch, and never decide permission.

| Component | Owns | A workspace still decides |
| --- | --- | --- |
| `OperationalPanel` | titled section: heading, count, destination link, action, `flush` or padded body, `compact` or `standard` density | the content and which destination it links to |
| `MetricTile` | label, value, detail, optional passive icon, linked or plain; `emphasis` only for a platform-reported exception | the figure, its meaning and its destination |
| `StatePill` / `StatusTone` | neutral, accent, success, warning, danger | which platform-owned fact maps to a tone; tenant labels stay neutral |
| `PanelState` | `empty`, `not-configured`, `unavailable`, `restricted` | the message and any first action |
| `ViewNav` (`components/navigation/view-nav`) | URL-backed sibling views; segmented by default, optional line; current view uses `aria-current="page"` and weight | the views and their URLs |
| `OperationalTable` | header, row and overflow geometry | columns and rows |
| `ConfigureLink` (`components/controls`) | the one "Configure" entry on a hub | the destination; it is never a second editor |

Page identity is `PageHeader` (or `WorkspaceHome`). Search and period filters sit in a toolbar under it, not in its actions, so the actions are the workspace's real tasks. A restated purpose sentence is not used; factual metadata (period, timezone, working date) is `meta`.

Empty states are one of four facts and must not be rendered alike: **empty** (a true zero), **not configured** (something required is missing; link to where), **unavailable** (the read failed or could not be verified; never shown as zero or healthy), **restricted** (about the viewer, not the data). Optional polish, such as a missing logo or introduction, is a suggestion, not an exception.

### Navigation and list ownership

- `Tabs` owns in-place tabbed content, Radix keyboard behavior and content relationships.
- `ViewNav` owns URL-backed sibling views as Next Links, preserving browser history and optional scroll behavior.
- `ViewModeSwitcher` owns in-place collection presentation, using pressed buttons.
- `NavigationList` owns destination lists: named `nav`, `ul`, `li` and full-row links, optional icons, supporting text and chevrons, compact or standard spacing. Rows are undivided by default.
- `DividedList` owns divided record lists, including documents and chronological activity.
- `DataTable` owns structured comparable records, including financial records.
- `OperationalPanel` owns operational content containers, not navigation or record semantics.

Tabs, ViewNav and interactive selection groups share the server-importable `tab-styles` contract.
Segmented is the compact navigation default: appearance-aware background, selected fill, radius
and control height. Line is an explicit underline variant with no selected fill. Global selected
styles are scoped to `data-variant`; do not rebuild either variant in a feature. Native button
filters retain their existing state and keyboard semantics. Wrap longer navigation sets; do not
clip items or introduce a horizontal tab scrollbar. Library sections expose all nine destinations;
Library Home uses only the compact responsive destination directory to avoid duplicate navigation.

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

## Content priority and progressive disclosure

The interface shows what the person needs to decide or do now. It does not print the data model.

Do not render a title, description, status, readiness, entitlement or metadata field merely because the data provides it.

Design in this order:

```text
Actor and task
↓
Information priority (now / on request / never)
↓
Surface archetype and page geometry
↓
Visual hierarchy
↓
Interaction and state
↓
Rendered verification
```

### Content test

For every visible supporting sentence, ask:

> What decision would be worse without this text?

If none, remove it or move it to a disclosure the person chooses to open.

A familiar destination needs a page title and nothing more. A route-level description needs a demonstrated orientation or decision purpose. A self-evident label needs neither an icon nor a subtitle.

Defaults:

- Settings row: label plus the operative value, state or control. An explanation is added only where an option is unfamiliar.
- Record row: primary data plus the key state or action. Metadata and history appear on request.
- Feature row: name, current state, and the one action allowed. Setup blockers and upgrade detail appear when they apply.
- Section: heading and content. A section heading earns its place by separating meaningful groups, not by adding a layer.

### Disclosure patterns

Choose the lightest pattern that still lets the person finish the task.

| Pattern | Use for | Never for |
| --- | --- | --- |
| Tooltip | A short, nonessential clarification, such as an icon-only control's name, on hover and focus | Guidance the person must read, or anything interactive |
| Info popover | Supplemental explanation that must also work by touch; opens on click, tap or keyboard | Instructions required before an action |
| Collapsible region | Optional advanced detail, or a long configuration group | Hiding a required step or an active blocker |
| Inline helper or validation | An instruction needed before acting, error recovery, or an actionable blocker | Describing a feature or restating the label |
| Toast | Brief feedback after an action the person just took | The only place a critical message appears, or feature promotion |
| Persistent alert | Safety-critical, account-affecting or unresolved conditions that need sustained visibility | Routine confirmation |

Requirements for every disclosure:

- it opens and closes by keyboard, with visible focus and a way to dismiss it (Escape for floating content);
- its trigger has an accessible name and exposes expanded state;
- it works by touch, with a target large enough to use on a phone;
- critical information is never held only in a tooltip, a toast or a colour.

Do not add an info icon to every row.

### Locked and unavailable capabilities

- A capability the organization is not entitled to may be listed once, in an aggregated and clearly labelled group, with one route to the plan view. Do not repeat a purchase action on every row.
- Unentitled, not permitted, setup required and unavailable remain distinct (see Locked / unavailable). Aggregating them for scanning does not merge their meaning.
- A capability that is not yet available is stated as unavailable. It is never presented as a production-ready paid upgrade, and an internal implementation gap is never written as a customer-facing feature description.

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

The person's eye should land on the current task, then the next action, then supporting detail.

- One unmistakable page identity, and one visually primary action where a primary action exists.
- Reserve accent and strong contrast for selected, active, high-priority or exceptional elements. Large or saturated does not mean important.
- Use fewer alignment edges. Peer controls and values share consistent edges, and one-off margins are not used to fix this.
- Use whitespace to clarify relationships, not to shrink the working area. Wide screens use their width for tables, split views, controls and previews.
- Replace repeated separators and nested cards with spacing and typography when they convey the same structure.
- Do not use decorative arrows, oversized icons or colour weight that implies a priority the content does not have.
- Where many equivalent choices exist, give scan aids: search, group labels, filters, counts and concise state.

F-shaped and Z-shaped reading paths are heuristics. Real workflow, content type, writing direction and viewport decide the layout.

### Colour roles and contrast

Colour is chosen by semantic role (page and surface, text, border, accent, selected, success, warning, danger, focus), using the tokens in Brand and theme. Do not hard-code a colour in a component because of what it is said to feel like.

- Common colour associations (red for urgency, green for success, blue for trust) are suggestive and vary by culture. They never replace measured contrast.
- A tenant accent never recolours success, warning or danger.
- Keep surface and accent palettes cohesive. Use a contrasting accent selectively. Do not build a control plane from several saturated accents.
- Contrast baseline is WCAG 2.2 AA: 4.5:1 for ordinary text, 3:1 for large text and for essential non-text indicators such as control boundaries, focus and selection. Check light and dark, and a representative alternative tenant accent. Do not assume a hue pairing passes.
- Colour is never the only carrier of status, selection or required attention.
- White space is not a white background. Light and dark surfaces both keep a readable spatial hierarchy.

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

Use the typefaces the brand system already supplies (heading, body, and a monospaced role for code and tabular figures). Do not add a font family for a section or a route. Two families is a sensible default for a coherent page, not a quota.

Choose type for legibility and function before character. Serif or sans-serif tone is a secondary consideration.

Keep an ordered scale and consistent weights and vertical rhythm. Prefer these over extra size variants.

Line length follows content role:

- sustained prose uses a narrow measure; about 45–75 characters is a starting point to test, not a limit;
- tables, forms, dashboards and operational settings do not inherit an article width.

Labels and short status text should scan without wrapping where practical. Long names wrap or truncate with their full text still reachable. Check mixed-case labels, numerals, localized text, font scaling and phone width for clipping.

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

An organization has one flat sidebar, in the business's chosen words and order. Setup and Organization General Settings edit the same versioned business profile. Absent configuration retains neutral application labels and does not manufacture a saved profile. Workspace identifiers remain internal domain and Calendar provenance; entering a destination does not replace the sidebar or expose workspace groups.

Authorization and entitlement filter canonical destination keys before labels/order are applied. A business profile never grants a capability, enables a module or supplies arbitrary URLs. Home and Library remain shared destinations. Settings retains its canonical ownership and account-menu entry. Platform Administration is a separate privileged scope, not a tenant workspace.

## Workspace navigation

Workspaces group implementation and configuration ownership internally. Their existing Home URLs remain operational dashboard destinations with task labels in the flat list. Each operating page keeps its own permission guard and relevant configuration action. A page may offer local tabs or record navigation without constructing a second sidebar. Desktop, tablet and phone consume the same authorized business destination list.

### Workspace Home

Work Home at `/field` is a contained operational dashboard: search/date/create/dispatch/configure toolbar, four scheduling/assignment summaries, attention tabs, resource dispatch overview, upcoming work and seven-day commitments, and a Today/status/activity/capacity rail. Counts span their stated scope; previews are bounded. Selected-day requirements and availability conflicts come from the canonical scheduling projection, while unassigned scheduled and unscheduled backlogs span all dates. Unconfigured opening hours are explicitly identified; permissive availability semantics remain unchanged. No arrival, GPS, route or productivity metrics are inferred.

Dispatch at `/work/dispatch` is a queue, assignment board and selected-Work inspector. Date, type, status, resource, class, assignment state, mode and selection persist in the URL. Schedule mode displays canonical resource commitments/free windows; Map mode uses actual Work Location coordinates and the existing map renderer, with List/Schedule fallback when unavailable. Assignment, scheduling and feasibility invoke the existing Work actions. Work collection List uses database filters and pagination; Board independently reads each configured status with exact counts, bounded cards and links to the full stage collection. Work configuration uses a type-selection workbench and General, Workflow, Requirements, Checklist, Booking and Fields sections. Resources expose class/capability filters and selected-day availability and assignments. Resource availability and Work/Schedule configuration mutations refresh the operational consumers. The flat business projection preserves canonical record authorities.

Communications Home at `/comms` uses a compact search/date/action toolbar, four readiness summaries, a 70/30 desktop grid with attention categories, an Inbox queue and canonical CallHistory preview, and a Today/status/activity/insights rail. Previews are bounded; exact counts and selected-period call rates come from tenant-scoped database reads. Inbox filters and search survive destination links. Outstanding conversations and wrap-up are current work, while missed/recent calls use the selected organization-timezone period. Empty states retain every panel. Today shows recorded communication activity, not an invented schedule; unsupported presence, callbacks, compliance controls and response-time trends are not simulated.

Dialer uses `/calls`: up to 25 real open call follow-ups in due-date order, the existing calling form and live controls, and selected customer context. Call history remains at `#call-history` with its filters and pagination. Inbox remains `/comms/inbox`; number inventory belongs to `/comms/configuration/numbers`. Communications Configuration at `/comms/configuration` owns Calling, Messaging, Numbers and Email, links to Work hours and shows recording/compliance information. A phone button beside Agent opens the existing pop-out from every organization page, including phone layouts; options load under current authorization and readiness, and unavailable calling stays disabled. Calling and messaging retain independent permissions. Routing saves wait for ordered primary/fallback members to load; a failed read cannot clear them. Overview, Dialer and Inbox are eligible flat business destinations; Configuration retains page-local entry; number reads remain addressable.

Finance Home uses a contained operational dashboard with four financial-state summaries, inline Needs attention categories, open invoices, recent payments, collections/performance, and a due/status/activity/insights rail. Selected-month received payments and reporting are separate from current receivables and uninvoiced priced Work. Empty organizations keep the complete composition. Quotes, Invoices and Payments use URL-backed search, status, Customer, date and pagination controls; dashboard previews are deliberately bounded, while totals come from complete database aggregates. Finance search and financial reporting have contextual routes under `/finance/search` and `/finance/reports`, while contextual support pages remain absent from the sidebar.

Finance creation uses the shared PageDrawer: quotes add snapshotted price-book lines to canonical Work, invoices review eligible priced Work before canonical issuance, and payments select or preselect an invoice before append-only recording. Corrections use signed entries; manual source never implies a payment method. Invoice and quote links open `/work/[workItemId]?tab=financials`. Services & Pricing belongs to `/finance/configuration/pricing`, with a scannable catalogue and existing create/edit drawers. Payment configuration remains permission-gated, and trading currency links to its sole General Settings editor. Aggregate financial values require `report.read`; pricing, issuance, payment and organization configuration permissions remain independent.

Marketing and Support use domain operating Homes at `/marketing` and `/support`; tenant AI uses an agent-management operating Home at `/ai`. Support has a dense Home with four exact KPI drilldowns, attention lists, active Cases, queue workload, resolution performance and a desktop context rail. Local navigation reaches Cases list/board, queue workbench, Case detail, service levels and reports. Shared drawers own Case creation and editing; narrow screens use Case summaries and stacked inspectors. Empty views retain usable panel structure and real configuration actions. Support uses Headset, Marketing uses Megaphone, AI uses Bot, and Work retains Wrench. Organization workspace selection stays flat; entered workspaces use contextual navigation. The global Agent utility retains Bot and opens the Agent rail; tenant AI exposes neither Platform AI Runtime nor provider credentials. Support's visual and interaction references live in `docs/design/support/`.

AI Home follows the dashboard reference with a compact action/filter toolbar, four exact KPI drilldowns, agent/deployment/activity previews and a contextual readiness, handoff and allowance rail. Empty panels retain useful actions; provider health, missing usage and unavailable runtimes are explicit. Local collection navigation stays inside the AI workspace context. Agent details use section navigation, a central draft editor and a readiness inspector; phones use a section selector and agent cards. Save checks draft concurrency, Publish creates an immutable version, and deployment version changes are deliberate. Unsaved editor changes survive section navigation and can be recovered after reload/back navigation from per-actor tab storage; recovery retains the original draft revision for conflict detection. Channel drawers never expose provider credentials. Knowledge sources are published websites; tests and evaluation verdicts are personal. Execution inspectors link to Communications rather than duplicating public transcripts. Visual targets and interaction evidence live in `docs/design/ai/`.


CRM Home launches Customers, Opportunities and the Opportunity pipeline; the feature-gated Customer board is labeled Relationship pipeline. Its primary commercial summary counts only Opportunities whose configured stage is Open. Unstaged Opportunities have a separate count. Stage values are displayed separately per currency. Opportunity routes remain registered CRM children with `sidebar: false`, retaining deep-link ownership without requiring workspace navigation.

Opportunity creation and editing use the shared PageDrawer. The collection preserves filters and pagination in the URL. Pipeline cards share the same records and detail destinations; stage movement uses a labeled select and explicit save action. Each board stage independently previews up to ten Opportunities with exact count and per-currency totals. Unstaged is a visual column, never a stored stage. The example pipeline's column/header/card hierarchy informs the production board without runtime example imports or demo state.

CRM Home is an operational dashboard: compact search/action/month toolbar, four KPI summaries, inline Needs attention categories, commercial pipeline snapshot, Recent Customers and CRM Insights, and a Today/Recent activity rail. Follow-ups use one contextual PageDrawer across Home, collection, calendar and Customer/Opportunity sections. Completion is an inline authorized action; edit/reschedule retains its originating context. Calendar is one business destination and may also be reached from operational dashboards. Existing `/calendar` children remain compatible and Calendar is available in business navigation; CRM Home and Work Home also link into their own Calendar. The business sidebar remains stable through date/view changes and event editing. Day and Week show a scrollable time grid with duration blocks, overlap columns and selectable half-hour slots; Month uses the shared month board. New event and slot selection open a neutral event drawer for title, start, end and notes. Existing native events can be rescheduled or cancelled through that drawer. The default scope is This business; This view explicitly narrows it using internal provenance. Native events do not require a Customer or Follow-up. CRM Follow-ups and scheduled Work feed the same calendar as domain projections, using their canonical editing paths; a due-only item is identified as Due rather than claiming a duration. Source failures and bounded previews are explicit. Work's resource Schedule remains the availability and dispatch surface. Legacy `/calendar` and `/follow-ups/calendar` links redirect into CRM's contextual Calendar. Calendar uses the shared navigation, period controls, month board and time-block geometry; compact month cells link to their full day. Follow-ups is an eligible flat business destination; CRM search remains a page-local action.

Customer detail hosts Opportunities and Follow-ups tabs with Customer preselected for creation. Opportunity detail prominently shows its next Follow-up and open/recent work. Organization Settings owns Opportunity stages independently of Relationship stages; both use the configuration registry.

An operational dashboard may link to related destinations without becoming their navigation parent.

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

## Administration navigation

Platform Administration lives at `/platform`, with its own shared-shell composition and permission-filtered navigation. The business switcher lists organizations only. GildOps' configured operating-organization Membership and exact live platform capability remain required; the URL conveys no authority. Old organization-scoped Platform addresses render the organization not-found page.

`lib/platform-navigation.ts` owns destination URLs and required capabilities. The authorized GildOps business sidebar offers Administration as a way into this separate scope. Customer organizations never receive that entry.

Its standalone scope provides its own authorized navigation:

```text
Overview
Organizations
Product Registry
  Products
  Meters
Integration Registry
  Connectors
Infrastructure
  Providers
  AI Runtime
Reliability
  Failures
Commercial administration
  Plans & Add-ons / Pricing / Usage & economics / Vendor rates /
  Package economics / Portfolio economics / Billing
```

Each destination is offered only to its own permission. Platform's separate sidebar uses the canonical registry; tenant vocabulary does not relabel control-plane concepts. The same shared header, surfaces, focus states and responsive sidebar apply. During an active business call, entering `/platform` opens a separate tab to retain the business telephone runtime.

---

## Responsive navigation

Information architecture remains stable across viewport classes.

Presentation changes.

Canonical behavior:

### Phone

The header shows contextual page location on the left and Menu on the right. There is no persistent bottom navigation. Business destinations use the same flat authorized navigation inside the sidebar Sheet; organization switching stays in its header. Agent is an explicit open action in the footer beside account access.

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

Below 768 px, Agent is a fullscreen native modal dialog, with the shared header-height band, safe-area padding and visual-viewport height/offset so its composer follows the visible viewport. The browser isolates background focus and interaction; nested Radix History and Context popovers portal inside the dialog. Menu closes before handing focus to Agent; closing Agent restores the visible Menu trigger. Escape dismisses a nested popup first, then Agent. Tablet (768–1279 px) keeps the right overlay; desktop (1280 px and above) keeps docking, resizing and persisted width, including the wide layout at 1720 px.

One dialog element and conversation subtree remain in place across layout changes and stay mounted after first opening. Native modal activation changes browser presentation without reparenting React content; lazy organization-keyed bootstrap, drafts, uploads, selections and pending actions remain with the existing controller. Page-support panels retain their separate nonmodal geometry. The permanent operator identity/scope banner is omitted; recoverable errors remain. Context is the one composer popover: it lists what the Agent sees, holds the one per-conversation control (include the open record) and, for people who manage the business, links to Agent settings in the AI workspace. There is no separate Configure and no model choice: GildOps chooses the model. Answers render as formatted text with Copy and Ask again beneath them, and a question in flight waits in an Agent bubble.

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

Opening Settings lands on the first destination the member may use. Every destination is a deep link and receives the Settings sidebar whether or not the person came through the menu. Back to app restores the flat business list and returns to the last page of the same business that was not Settings, validated as a path inside that business, otherwise Home.

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

## Ethical interaction

Similar controls look and behave alike. Navigation, setting changes, disclosure and destructive actions are visibly different.

- Do not use dark patterns: deceptive defaults, trick questions, disguised advertising, surprise charges, false urgency, misleading hierarchy or manipulated consent.
- Prevent errors rather than explain them afterwards. Offer undo or confirmation in proportion to the risk of the change.
- Turning a feature off must not imply its data was deleted. Confirmation and recovery text state exactly what is kept.
- Do not invent a switch for a capability that is structurally required, and do not show a disabled control whose purpose the person cannot discover.
- Keep entitled, on or off, ready, setup required, unavailable, and permitted distinct. The backend owns these facts. The UI may simplify how they are shown but does not merge or recompute them.
- Feedback is truthful and separates pending, success and failure. Results are announced accessibly.
- A person should not have to learn internal domain or provider terms to finish an ordinary task.

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

Which channel carries a message (toast, inline, persistent alert) follows the disclosure patterns in Content priority and progressive disclosure.

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

A group of unentitled capabilities may be gathered into one labelled area with a single route to the plan view, while each row keeps its own accurate state.

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

Responsive parity means equivalent task access, not identical layout.

- Desktop places controls beside their labels and uses available width. Do not reduce a desktop workspace to a phone-width column.
- Phone stacks deliberately and puts controls first. It does not shrink desktop components.
- Preserve functional density. A settings list must not grow to several screens through repeated descriptions and repeated calls to action.
- Check touch target size and where menus, popovers and sheets open.

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
- contrast meets the WCAG 2.2 AA baseline in Colour roles and contrast;
- tooltips, popovers, menus and sheets work by keyboard and touch, can be dismissed, and have accessible names;
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

Also check, where the change touches them:

- every visible descriptive sentence has a reason under the content test;
- contrast and semantic colour in light, dark and a representative alternative tenant accent;
- every relevant combination of entitlement, activation, readiness and permission, without changing backend authority;
- disclosure controls by keyboard, touch, dismissal and accessible name;
- no critical information exists only in a toast, a hover-only tooltip or a colour.

For a substantial visual change, keep before and after evidence and record any intentional deviation from this document.

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
4. decide what must be visible now, what is on request, and what is omitted (content priority);
5. inspect existing shared components/patterns;
6. identify states and permissions;
7. identify responsive transitions;
8. identify support modes, if any.

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
- a description, status line or metadata field shown only because the data has it;
- a repeated purchase or upgrade action on every locked row;
- an info icon on every row;
- critical guidance held only in a tooltip, a toast or a colour;
- an unavailable capability presented as a paid upgrade;
- dark patterns (see Ethical interaction);
- fake dashboards composed of arbitrary cards;
- visual changes reported as verified without opening the application.

---

## Document boundaries

This document owns:

- UI hierarchy;
- content priority and progressive disclosure;
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

Marketing Home is a compact operational dashboard: four evidence-backed KPIs, a contained attention panel with inline categories, campaign performance and active-campaign tables, recent inquiries and acquisition/source results, plus a supporting activity/readiness/insights rail. Empty organizations retain all panel geometry. Local Home/Campaigns/Audiences/Leads/Performance navigation preserves the business's flat sidebar. Campaign detail is deep-linkable; campaign and audience editors and inquiry review use shared PageDrawer primitives. Collection search, review/status/objective/owner/source filters, date bounds and pagination persist in the URL. Table overflow is contained within its panel at narrow widths. Activation expresses Marketing lifecycle, not delivery success; unestablished consent and unavailable promotional delivery are shown explicitly.


## Persistent application controls

The sidebar footer holds the Account/session menu, which represents the signed-in person: Settings,
Help & documentation, Contact GildOps Support, then Sign out. Help and Contact are organization-scoped
and appear only where an organization is in context. Mobile Agent remains a Sheet control. Locked
organizations keep the Plan & usage recovery destination as their Settings entry. The no-organization
fallback offers personal Settings without inventing an organization Help or Platform context.
Platform Administration is reached at `/platform` from
GildOps' own navigation, only with server-resolved platform authority, and the account menu never
links to it.
`AccountMenu` owns the footer presentation, identity and Sign out. `settings-icons.ts` owns recognizable Settings destination icons, used with accessible
labels and rail tooltips. The existing `SettingsNav` retains search and closes the mobile Sheet
on navigation. Back to app validates its per-tab hint against current authorized destinations
and falls back to organization Home. Stored navigation is never an authorization authority.


## Workspace Configuration navigation

**Navigation must represent meaningful destinations or alternate views, not ordinary content structure.**
A page containing multiple sections does not automatically justify section navigation, tabs or a
secondary sidebar. Before introducing navigation, establish:

1. Whether the destinations have independent routes.
2. Whether the content represents different tasks or one continuous workflow.
3. Whether an existing navigation owner already provides the destination.
4. Whether additional navigation improves usability enough to justify its complexity.

Default to the simplest composition that preserves functionality. A page is an independently routed
task; a section groups content within it; a tab switches necessary alternate views; an anchor marks
a position in the same document; a drawer supports a focused temporary interaction. Headings alone
do not earn navigation. Avoid duplicate titles, context, destinations and generic decorative icons.

`CONFIG_TARGETS` and `WORKSPACE_CONFIGURE` retain canonical configuration ownership and authorization. Relevant operational pages link to their configuration roots; entering a destination does not replace the flat business sidebar. Configuration landing pages may list independent concerns. General Settings separately hosts the versioned business words/navigation editor; it does not fold that independent save into business identity.
General Settings is one form, saved once, whose Business identity, Primary business address and
Business contact groups are separate shared cards beneath the existing Settings sidebar; it has no
section navigation. Settings groups use shared surfaces so Appearance shape, density and
elevation reach them. Resolved links use
text labels, hover, selected and focus roles without a repeated generic icon. Page loading uses the
existing organization boundary; missing or unauthorized concerns resolve to not-found before data
reads. No empty configuration root is offered. `WorkspaceConfigure` remains a shortcut to each root.


Platform uses its own authorized registry and shared responsive sidebar. The business switcher changes business context only. `NavigationActivityContext` carries only a retention hint from the persistent telephone owner. During an active call, cross-business and global personal Settings links open a separate tab. Ordinary same-organization configuration, General Settings and workspace navigation reuse the existing telephone runtime. This does not provide call continuation after reload or browser termination.

Channel diagnostics reuse `messagingSenders` and the existing sender/provider facts. The UI distinguishes planned/unentitled/disabled features, missing provider/callback/relay configuration, inactive or non-SMS numbers, missing active identities, and unverified sending domains. Sender configuration does not grant `message.send`; configuration checks passing never asserts provider acceptance or delivery. Outbound email and mailbox synchronization remain separate capabilities.

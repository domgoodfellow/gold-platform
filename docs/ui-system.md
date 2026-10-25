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

### Phone number presentation

`apps/web/lib/display/phone.ts` owns phone display formatting. Complete North American numbers
read as `(416)555-0176`, including stored `+1`, eleven-digit and ten-digit forms. International,
partial and extension-bearing values keep their existing spelling; do not guess another country's
grouping. Apply formatting to visible text only: stored values, `tel:` links, identifiers and
calling/messaging payloads retain their original values. `PhoneInput` shows formatted text at rest,
reveals the original value while editing and submits that original value. Country-code entry
requirements continue to apply where required by the existing form.

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
motion durations/easing. Minimal is flat: lighter borders, no elevation, neutral selection.
Layered adds restrained hierarchy, moderate elevation and a faint brand tint on selection.
Expressive adds larger shapes, stronger depth, a brand edge on panels, configuration editors and
board columns, a brand underline on the selected tab and a richer brand-tinted selection. The preset
tokens `--visual-border-strength`, `--visual-selected-mix` and `--visual-edge` carry these
differences; no preset adds animation. None changes status colors, the focus ring or brand
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
Theme is system/light/dark; motion is system/reduced; background is none (stored as null),
gradient, grid or ambient3d. Last successful account save wins.

#### Background treatments

A background treatment is a personal Appearance choice, never part of a preset or of Branding.
`DecorativeBackground` (`components/display/background-treatment.tsx`) is the only component that
draws one. It renders inside a designated decorative region only: the `WorkspaceHome`
introduction (`data-slot="workspace-intro"`) and the Appearance and Branding previews. It never
sits behind tables, forms, dialogs or record content. The layer is `aria-hidden`,
`pointer-events: none` and behind content inside an isolated region, so it never covers or
intercepts controls. Colours come only from the brand and neutral tokens.

- None (default): nothing is drawn and the region keeps its normal spacing.
- Ambient gradient and Fine grid: static CSS.
- Ambient 3D: a Three.js wireframe surface in the brand colours, imported on the client only when
  chosen. It falls back to the static gradient when WebGL is unavailable, on narrow (≤ 40rem) or
  low-core devices, or on any load or start-up error, so it never blocks a page. It draws one still
  frame under system or saved reduced motion, pauses while the page is hidden, caps the device
  pixel ratio at 1.5, and disposes its geometry, materials and renderer on unmount.

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

An Organization's visual identity is a palette (a primary colour, plus an optional secondary and an optional highlight), a heading and body typeface from a closed list, and an optional logo. Authority is `brand_settings` (`accent` is the primary; `secondary` and `highlight` are nullable), read by `getBrand` and written by `setBrand` (`set_brand_palette` when the optional roles are sent, otherwise `set_brand_settings`, so a single-colour caller never clears them), `uploadLogo` and `removeLogo`. Nothing else stores brand state. A legacy single-colour brand renders exactly as before: the primary is unchanged, the secondary is derived from it and the highlight is the primary.

Resolution path:

```text
brand_settings → getBrand → organizationPalette → brandTokens → BrandStyle / brandStyleProperties → [data-brand] custom properties → shared components
```

- `organizationPalette` (`lib/domain/branding/palette.ts`) is the only place a role is derived. A stored colour is never replaced; for each role it derives a readable foreground (≥ 4.5:1), a text colour per scheme (≥ 4.5:1) and an indicator colour per scheme (≥ 3:1, for selected marks and outlines). Black, white and pale colours stay usable. Presets (Monochrome, Neutral with one accent, Complementary, Three colours) only fill the three values a typed hex would.
- `brandTokens` is the one place a palette becomes custom properties; the shell and both previews use it. Token map: `--accent` / `--on-accent` / `--accent-text` / `--accent-indicator` (primary: primary actions, selected states, links); `--brand-secondary` / `--on-brand-secondary` / `--brand-secondary-text` (supporting decoration); `--brand-highlight` / `--on-brand-highlight` / `--brand-highlight-indicator` (non-semantic emphasis).
- `BrandStyle` writes those tokens (theme-dependent values through `light-dark()`) with `--font-heading` and `--font-body` on `[data-brand]`, which the Organization shell and public pages set. Switching Organization renders the other Organization's style; nothing carries over. An Organization that has chosen nothing writes nothing and renders the platform's neutral look. A font choice applies without a colour.
- `[data-brand]` also sets `font-family: var(--font-body)`. Body text inherits from the `<body>` element, which sits above the brand scope, so the scope must apply the font itself.
- The Branding preview renders the shared `Button` and `TextInput`, the three palette roles with their foregrounds, a selected row and a decorated dashboard introduction inside its own `[data-brand]` scope whose properties come from `brandStyleProperties`, the same derivation the shell uses. `[data-appearance="light|dark"]` forces a scheme for the preview; a role that is an alias must be declared again inside that selector.

Role ownership:

| Role | Owner | Brand may change it |
| --- | --- | --- |
| Background, surface, border, text, muted, hover, selected, ring | Platform | No |
| Primary action fill, its foreground, branded links, selected indicators | Organization primary | Yes |
| Supporting decoration, non-semantic emphasis | Organization secondary and highlight | Yes |
| Danger, warning, success | Platform and domain rules | No |
| Heading and body typeface | Organization, from `FONT_STACKS` | Yes |

Use `bg-accent text-on-accent` for a branded action and `text-accent-text` for a branded link. Use `text-foreground`, not `text-primary`, for ordinary neutral text. Never colour an operational status with the accent: a status colour carries meaning the Organization cannot override.

Branding edits are a local draft over the persisted brand. An unfinished or malformed colour is rejected, blocks saving, and leaves the preview on the saved value. The secondary and highlight are optional, can be cleared individually and need a primary first. "Use platform default" clears every colour and resets both typefaces; it is saved like any other edit. Logos are uploaded and removed independently of colour and type.

Configuration ownership: Branding owns the logo, palette and typography. Public profile (`settings/public-profile`) owns customer-facing name, tagline, description and contact details. Domains (`settings/domains`) owns the public booking address and connected domains. Studio may read the brand; it does not store a second one. A viewer's light/dark preference is personal and is never an Organization setting.

Not yet supported: separate logo variants for dark backgrounds, advanced colour overrides, and optimistic-concurrency checks on simultaneous brand edits (the last save wins).

No workspace spells a palette colour. A test (`e2e/workspace-convergence.spec.ts`) fails if a hub paints one of Tailwind's default palette values, and `residual-polish` / `interaction-states` enforce the same in source.

---

### Shared operational components

`components/operational/primitives.tsx` owns the operational presentation vocabulary; `components/navigation` owns shared route navigation. A workspace composes these; it does not define its own panel, tile, badge, empty box or tab strip. They are presentation only: they take data and links, never fetch, and never decide permission.

| Component | Owns | A workspace still decides |
| --- | --- | --- |
| `OperationalPanel` | titled section: heading, count, destination link, action, explicit inset or edge-to-edge body, `compact` or `standard` density | the content and which destination it links to |
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
clip items or introduce a horizontal tab scrollbar. Library destinations are reached from the sidebar Library popover and from the tab strip on each Library section page.

### Configure and readiness

Every configurable concern is one registered **configuration target** (`CONFIG_TARGETS` in `lib/navigation.ts`): a key, a path, the entitlement it needs and the configuration permission it needs. Settings, Setup, workspace Configure controls and Home all resolve destinations from it; none holds a path of its own. A target with `directory: false` is a workspace-owned door: still one registered destination, reached from its workspace and not listed in the Settings directory.

A workspace Home has at most one Configure entry, and it is one of two things:

- **Contextual Configure** — the page-support rail (`PageHeader configure` with a `ConfigureRegistrar`), used only when the rail holds real controls for the concern (Work items, Schedule, Resources, Locations, Assets, Support). A rail mode with nothing registered is not offered, and a panel that would only repeat links is not registered.
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

### Page location contract (ADR-047)

**Status.** This is the approved target. Migration is per route (`RESOLVED_LOCATION_ROUTES` in `lib/route/page-location.ts`). Today the CRM operating pages take their location from the resolver: CRM Home, Customers and Customer detail, Relationship pipeline, Opportunities and Opportunity detail, Follow-ups, CRM Calendar and CRM Search. The Opportunity pipeline (open decision U-17), CRM configuration (Batch 3) and every other workspace still publish their own trail through `PageLocation`. A route uses exactly one of the two, never both. On a migrated route the shell resolves the location once, and the bar, the phone's Up control and the page's `h1` read that one answer; loading and refused states keep the known ancestors.

- **One location.** Every page inside the organization, Settings and Platform shells shows one location: its ancestors and the current page, resolved by `resolveLocation` (`lib/route/page-location.ts`) from the canonical registries. A page supplies only server-known record labels; it never writes its own ancestors.
- **Loading and missing.** A loading page keeps its known ancestors and shows the record name only once it is known. A missing, deleted or unauthorized record shows not-found inside its nearest valid ancestors, without disclosing which it was. Record data is never invented.
- **Links.** An ancestor is a link only when it is a real page the viewer may open. Grouping levels and redirect-only addresses (Settings, Library, Team & access, every workspace's Configuration level) are plain text. Sidebar visibility is not the link rule.
- **Levels.** Query filters are not levels; a selection with its own route is. Settings presentation groups and Platform group headings are not levels. Platform starts at "Platform".
- **Heading.** One meaningful `h1`. When the header bar shows the page, the `h1` is visually hidden; its accessible name may be longer than the breadcrumb label. Section headings stay visible. Home keeps its greeting as visible content that is not the heading; a long-form Help article may keep a visible reading title.
- **Phone.** The hierarchical Up control goes to the last linked ancestor of the same trail and is separate from browser history.
- **Vocabulary.** Labels come from destination keys; business vocabulary is applied by key, never by matching displayed words.

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

It should not become a large hero block above a table or board. Like `PageHeader`, a plain-text collection title is visually omitted when it is already published by `PageLocation`; the semantic h1 remains. This rule does not depend on workspace navigation. A distinct breadcrumb label retains the visible page heading.

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

**Unsaved changes in a drawer are opt-in.** An editing form reports whether it differs from what it opened with by calling `usePageDrawerUnsavedChanges(dirty)`, usually with `useFormDirty()` from `components/controls/use-form-dirty.ts`. Once it does, the close control, Escape, `PageDrawerClose` and `usePageDrawerClose()` ask "Discard unsaved changes?" before closing a changed form, and close at once when it is unchanged. The confirmation is the shared Dialog: Keep editing returns focus to where it was in the drawer, Escape closes only the confirmation, and Discard closes the drawer and returns focus to what opened it. An owner closing the drawer after a successful save is never asked. Such a form also keeps Escape working when a submit has left focus on the page body. Drawers that do not opt in — inspection panels, previews, Studio workbench panes — close exactly as before. A refused save keeps what was typed: a drawer form submits through a transition rather than `<form action>`, because React resets an action form after every completed action, refusals included, and moves focus to the refusal. `useDrawerFormSubmit` (`components/controls/use-drawer-form-submit.ts`) owns that lifecycle, single submission and the pending state its footer button reads. Customer fields, New customer, opportunities and follow-ups use it; a read-only follow-up keeps no footer actions. The drawer does not intercept leaving the page: in-page links, browser Back and the workspace switcher are outside its reach, and a form that must survive them keeps its own draft recovery.

**A drawer is not the default container.** A task smaller than its drawer moves to the surface it needs, and the drawer's entry point goes with it:

- **Dialog** (the shared `Dialog` re-exported from `components/controls/confirm-submit.tsx`) for one consequential decision or a short focused entry: a Marketing campaign status change ("Activate campaign?") and Team's Add member (invite by email or add an existing account). A dialog opened from an ordinary button, not a `DialogTrigger`, remembers that button and returns focus to it on close, because Radix returns focus only to its own trigger. A refusal stays in the dialog. Add member keeps the invite form's truthful delivery result and copy-link fallback inside the dialog.
- **Popover** for a small, passing choice tied to one control: Home's Customize.
- **Page section** when every part of the drawer was about the page it opened from: a Studio form's Sharing (links, website, portal, embed and Used by) sits under the editor as `#sharing`, and the toolbar's Sharing link jumps to it.
- **Edit in place** for a record whose row already shows every field: a price item is added and edited in its row of the price book. One row is open at a time, Escape and Cancel discard that row, a refusal keeps the typed values and focuses the reason, and leaving the page with an open, changed row asks first (`useUnsavedChanges`, `components/controls/use-unsaved-changes.ts`). Each save is one write through the existing action; there is no list-wide save.

Drawers stay for creating or editing a record in context where the page behind still helps; those follow the contract above.

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

Which destinations exist and how they are grouped is owned by `docs/product.md` → *Workspace navigation* (ADR-046). This section owns how that hierarchy is presented.

Home, Search and Library form one cluster at the top of the sidebar at every depth. Below it, the organization level draws the workspace directory; an entered workspace draws, in its place, its workspace heading (ADR-049: its icon and name as a plain identity row, followed by the explicit Gauge Dashboard destination only when the member may operate it), its operating destinations and, only where it has configuration pages that are not destinations themselves, a Configuration branch. Home is the way back to the directory; no separate back row is drawn. A configuration address names the destination that edits it (`CONFIG_TARGETS[].destination`), so that destination stays selected there and the sidebar draws no separate branch for it. Settings keeps its own contextual sidebar and account-menu entry; Platform Administration keeps its separate navigation.

## Workspace navigation

Workspaces group operating destinations and configuration by canonical ownership. Each workspace Home remains an operational dashboard. Desktop, tablet and phone consume the same authorized hierarchy, and record/detail/calendar routes retain their workspace context.

### Header composition

The entered-workspace sidebar, with its phone sheet and page-location menu, is the one persistent workspace navigation (ADR-048). The page header owns page identity, the page's business actions, its page-support modes (Activity, Insights, Configure, always last) and page-local view controls; it never reproduces the workspace's destination list. `HeaderControls` is only the action row: actions stay right-aligned and wrap on a narrow canvas. Page-local view controls stay in the page: list or board, dispatch mode, attention categories, invoice filters, inbox queue filters, periods and record sub-views. They are not workspace navigation.

The organization header carries no workspace Calendar shortcut (ADR-050). Calendars are the projection's registered destinations (`NavItem.calendar`), reached in context: CRM from its Dashboard (when tasks are available) and Tasks, Work from its Dashboard; no address is built by appending `/calendar`. No notification control is shown until an operator notification read model exists. Calendar pages themselves still check only organization membership (open question, Slice 2C).

Inside an entered workspace the heading row is set apart from the workspace's pages by an outlined icon tile and a divider, in the full and the collapsed sidebar, so a page that shares the workspace's glyph (CRM and Customers, Communications and Dialer, Marketing and Campaigns) never reads as the same row. The tile is outlined, not filled, so an inactive heading never looks selected; the selected state is the shared sidebar one.

Sidebar destinations and configuration, by workspace:

- **Marketing:** Campaigns, Audiences, Leads and Performance (`marketing.read` or `marketing.manage`; changes still need `marketing.manage`).
- **AI:** Agent activity and Evaluations, for any member. Agents, Channel deployments, Knowledge and Tools stay `organization.manage` configuration targets in AI's Configuration branch.
- **Finance:** Services & Pricing stays under Configure. Financial reports is a header action for `report.read`.
- **Communications:** Numbers and Configuration stay under Configure.

### Workspace Home

Work Home at `/field` is a contained operational dashboard: search/date/create/dispatch/configure toolbar, four scheduling/assignment summaries, attention tabs, resource dispatch overview, upcoming work and seven-day commitments, and a Today/status/activity/capacity rail. Counts span their stated scope; previews are bounded. Selected-day requirements and availability conflicts come from the canonical scheduling projection, while unassigned scheduled and unscheduled backlogs span all dates. Unconfigured opening hours are explicitly identified; permissive availability semantics remain unchanged. No arrival, GPS, route or productivity metrics are inferred. Ordinary panel bodies own 12px compact or 16px standard gutters on all four sides; edge-to-edge tables and full-width row lists own their cell spacing. `body="inset"` is the default and `body="edge-to-edge"` is explicit; legacy `flush` remains compatible. Callers do not repeat outer padding. Insights uses a two-column metric group inside the panel, without nested bordered cards. Work destinations remain in the canonical sidebar. Work toolbar controls use the existing small button size, including date, creation, dispatch and configuration controls. Workspace heading glyphs use ordinary sidebar row dimensions and alignment; typography and the group divider establish hierarchy.

Work creation has one persistent route, `/organizations/[organizationId]/work/new`, using the existing domain form and server action. Home, Work Items and Schedule use `NewWorkAction`; `?type=` preserves the intended type and `/work?create=1` redirects here. The page checks creation permission on the server. Types without stages show an inline prerequisite instead of an empty form; only authorized members see Configure stages, with a return action preserving the type. Members may switch to a configured type. Cancel returns to Work Items, dirty changes guard link navigation, type changes and browser unload, refused submissions retain input, and successful creation returns to Work Items. Browser Back has the shared unsaved-changes hook's existing limitation.


Dispatch at `/work/dispatch` is a queue, assignment board and selected-Work inspector. Date, type, status, resource, class, assignment state, mode and selection persist in the URL. Schedule mode displays canonical resource commitments/free windows; Map mode uses actual Work Location coordinates and the existing map renderer, with List/Schedule fallback when unavailable. Assignment, scheduling and feasibility invoke the existing Work actions. Work collection List uses database filters and pagination; Board independently reads each configured status with exact counts, bounded cards and links to the full stage collection. Work configuration uses a type-selection workbench and General, Workflow, Requirements, Checklist, Booking and Fields sections. Resources expose class/capability filters and selected-day availability and assignments. Resource availability and Work/Schedule configuration mutations refresh the operational consumers. Workspace navigation preserves canonical record authorities.

Communications Home at `/comms` uses a compact search/date/action toolbar, four readiness summaries, a 70/30 desktop grid with attention categories, an Inbox queue and canonical CallHistory preview, and a Today/status/activity/insights rail. Previews are bounded; exact counts and selected-period call rates come from tenant-scoped database reads. Inbox filters and search survive destination links. Outstanding conversations and wrap-up are current work, while missed/recent calls use the selected organization-timezone period. Empty states retain every panel. Today shows recorded communication activity, not an invented schedule; unsupported presence, callbacks, compliance controls and response-time trends are not simulated.

Dialer uses `/calls` as an A11 console (`features/communications/voice/dialer-workspace.tsx`). `PageLocation` publishes Communications / Dialer; the content retains one semantic h1. One toolbar groups Standard/Focus modes on the left and Pop out dialer, Call history and Configuration actions on the right. Call queue and Customer context are pressed visibility buttons, not navigation tabs. Pop-out is an action through the existing organization telephone; it transfers the number, chosen caller line and matching customer attribution, and returns the edited draft without attaching an unrelated number to the selected customer. The global telephone utility remains available. Configuration retains its canonical Communications destination. At 64rem of actual console width, the queue, central calling console and customer context form a three-column composition that follows its content height up to the available viewport height, with independent scrolling for long regions. Empty side regions stay at their natural height and use compact text rather than tall centred empty-state illustrations. Number entry and the keypad share a row once their own form has 26rem available; narrower forms keep a compact keypad below. Sidebar and Agent/page-panel width therefore affect composition without requiring a viewport resize. Below that width a Queue / Calling / Customer switch selects one mounted region; live calls expose Show call controls when another region is selected. Focus keeps only calling and workflow; Call history returns to Standard before opening its anchor. The central console groups readiness, bounded number entry/dial pad or live controls, and Follow-up/Wrap-up behind one surface with internal dividers. Empty side regions retain truthful context. The history disclosure owns its heading, compact daily summary metrics, URL-backed filters, results and pagination in that order; `#call-history` and count/link semantics are preserved. No transcript, recording, script or fullscreen controls are offered without a source. The development-only `/dev/dialer` fixture uses the real shell with a simulated telephone for live-call layout checks; it is not provider evidence. Calling and messaging permissions, readiness and guarded commands remain unchanged.

Finance Home uses a contained operational dashboard with four financial-state summaries, inline Needs attention categories, open invoices, recent payments, collections/performance, and a due/status/activity/insights rail. Selected-month received payments and reporting are separate from current receivables and uninvoiced priced Work. Empty organizations keep the complete composition. Quotes, Invoices and Payments use URL-backed search, status, Customer, date and pagination controls; dashboard previews are deliberately bounded, while totals come from complete database aggregates. Finance search and financial reporting have contextual routes under `/finance/search` and `/finance/reports`, while contextual support pages remain absent from the sidebar.

Finance creation uses the shared PageDrawer: quotes add snapshotted price-book lines to canonical Work, invoices review eligible priced Work before canonical issuance, and payments select or preselect an invoice before append-only recording. Corrections use signed entries; manual source never implies a payment method. Invoice and quote links open `/work/[workItemId]?tab=financials`. Services & Pricing belongs to `/finance/configuration/pricing`, with a scannable catalogue and existing create/edit drawers. Payment configuration remains permission-gated, and trading currency links to its sole General Settings editor. Aggregate financial values require `report.read`; pricing, issuance, payment and organization configuration permissions remain independent.

Marketing and Support use domain operating Homes at `/marketing` and `/support`; tenant AI uses an agent-management operating Home at `/ai`. Support's Home at `/support` is dense with four exact KPI drilldowns, attention lists, active Cases, queue workload, resolution performance and a desktop context rail; it does not repeat its sidebar destinations as cards. Its contextual sidebar lists, beneath the Support identity heading and Dashboard destination, Cases (`/support/cases`, including Case detail), Queues (`/support/queues`), Service levels (`/support/service-levels`) and Reports (`/support/reports`). Each is registered in `AREAS` under the Support workspace and requires `support.read`. Its Cases list/board, status, queue, attention and period controls are local view controls, not destinations, and no page carries a second tab strip or Views menu. Queues and service levels are read views for every `support.read` member. Their configuration is reached only from the page-header Configure control, which opens the Configure panel described under *Configure* below; the `/support/configuration/queues` and `/support/configuration/service-levels` addresses remain deep links, and each keeps its destination selected. Every Support page sets its action row the same way: the reporting period (Home, Cases, Queues and Reports), then New Case where authorized, then Configure last; Support's Home is reached from Dashboard. Shared drawers own Case creation and editing; narrow screens use Case summaries and stacked inspectors. Empty views retain usable panel structure and real configuration actions. Support uses Headset, Marketing uses Megaphone, AI uses Bot, and Work retains Wrench. The organization-level directory lists workspaces only; entered workspaces use contextual navigation. The global Agent utility retains Bot and opens the Agent rail; tenant AI exposes neither Platform AI Runtime nor provider credentials. Support's visual and interaction references live in `docs/design/support/`.

AI Home follows the dashboard reference with a compact action/filter toolbar, four exact KPI drilldowns, agent/deployment/activity previews and a contextual readiness, handoff and allowance rail. Empty panels retain useful actions; provider health, missing usage and unavailable runtimes are explicit. Local collection navigation stays inside the AI workspace context. Agent details use section navigation, a central draft editor and a readiness inspector; phones use a section selector and agent cards. Save checks draft concurrency, Publish creates an immutable version, and deployment version changes are deliberate. Unsaved editor changes survive section navigation and can be recovered after reload/back navigation from per-actor tab storage; recovery retains the original draft revision for conflict detection. Channel drawers never expose provider credentials. Knowledge sources are published websites; tests and evaluation verdicts are personal. Execution inspectors link to Communications rather than duplicating public transcripts. Visual targets and interaction evidence live in `docs/design/ai/`.


CRM Home launches Customers, Opportunities and the Opportunity pipeline; the feature-gated Customer board is labeled Relationship pipeline. Its primary commercial summary counts only Opportunities whose configured stage is Open. Unstaged Opportunities have a separate count. Stage values are displayed separately per currency. Opportunity routes remain registered CRM children with `sidebar: false`, retaining deep-link ownership and CRM's workspace context without becoming sidebar rows.

Opportunity creation and editing use the shared PageDrawer. The collection preserves filters and pagination in the URL. Pipeline cards share the same records and detail destinations; stage movement uses a labeled select and explicit save action. Each board stage independently previews up to ten Opportunities with exact count and per-currency totals. Unstaged is a visual column, never a stored stage. The example pipeline's column/header/card hierarchy informs the production board without runtime example imports or demo state.

CRM Dashboard is relationship first. In reading order at every width: a Relationship overview (Contacts with People, Companies and, when present, Unspecified counts linked to Contacts filters; New contacts, records created in the last 30 days; and the Lead/Prospect/Customer/Unclassified lifecycle distribution, independent of identity type); Recently active relationships, the primary panel, listing a bounded set of contacts by their latest qualifying relationship event (calls placed, ended or written up; completed tasks; lifecycle transitions; relationship stage moves; opportunities created or moved), never by record edits, with a next action only when an open task exists, an optional URL-backed Group by company presentation that places each person once under their primary active company, and a labelled Recently added contacts fallback when nothing qualifying is recorded; Needs attention beside it on wide screens (Overdue, Due today — later today only, so never both — and, with sales, No next follow-up and Unassigned), replaced by one compact all-clear line when nothing is actionable and absent when neither tasks nor sales apply; then Opportunities & Pipeline (open count, pipeline value per currency, unweighted expected closes and win rate for the selected month, stage strip, unstaged count) when stages or opportunities exist, compact stage-setup guidance for members who may configure stages when neither exists, and nothing otherwise. A new business keeps this structure with real zeros and the Add contacts entry point. Recent history remains in the page-support Activity panel. Follow-ups use one contextual PageDrawer across Home, collection, calendar and Customer/Opportunity sections. Completion is an inline authorized action; edit/reschedule retains its originating context. Calendar is a shared interaction reached inside a workspace, never a standalone organization sidebar row. Workspaces have a local `/calendar` child; CRM Home and Work Home also link into their own Calendar. The workspace context remains active through date/view changes and event editing. Day and Week show a scrollable time grid with duration blocks, overlap columns and selectable half-hour slots; Month uses the shared month board. New event and slot selection open a neutral event drawer for title, start, end and notes. Existing native events can be rescheduled or cancelled through that drawer. The default scope is This business; This view explicitly narrows it using internal provenance. Native events do not require a Customer or Follow-up. CRM Follow-ups and scheduled Work feed the same calendar as domain projections, using their canonical editing paths; a due-only item is identified as Due rather than claiming a duration. Source failures and bounded previews are explicit. Work's resource Schedule remains the availability and dispatch surface. Legacy `/calendar`, `/sales/calendar` and `/follow-ups/calendar` links redirect into CRM's contextual Calendar. Calendar uses the shared navigation, period controls, month board and time-block geometry; compact month cells link to their full day. Follow-ups remains a contextual CRM destination; CRM search remains a page-local action.

The contact record has seven URL-backed sections (`?section=…&view=…`): Overview, Sales (Opportunities, Discovery, Proposed configuration, Commercial proposals, Invoices), Tasks, Activity (Timeline, Calls), Related (Work, Locations, Support cases, Services), Documents and Portal, each offered only where the viewer may open it and the capability applies. Former `?tab=` values resolve to their new place. The header shows identity type, company, labelled Lifecycle / Temperature / Relationship stage chips and primary contact details, with Call and Edit; the name stays in the location bar. Overview holds labelled details (custom fields as label/value rows), affiliations, recent activity and a compact related summary; an Unspecified record offers Classify contact. Editing is a focused dialog in three sections (Identity & essentials, Relationship, Additional fields) on the shared guarded dialog. Opportunity creation and editing, and opportunity-stage editing, also use focused dialogs, with Customer preselected from a record. Opportunity detail prominently shows its next Follow-up and open/recent work. Organization Settings owns Opportunity stages independently of Relationship stages; both use the configuration registry.

A Workspace Home is its workspace's parent destination; inside the entered workspace it is reached from the workspace heading (ADR-047). It may also link to destinations in other workspaces without becoming their parent.

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

Settings → Features is a searchable catalogue grouped by product. Each product lists its usable features (included, needing setup, or disabled) as compact rows with their Open, Set up and enable/disable actions; what the plan does not include and what is planned are folded beneath, with one View plan link for the not-included group and an explicit "not available yet, on any plan" for planned work. Status filters with counts and search narrow the catalogue in place, and a search opens the folded groups it matches. A setup reason shared by several products is said once for the page with the features it affects; one product's own reason is said once for that product.

Global Home uses a greeting/date header with Customize (a popover of the two optional panels, applied at once and saved in this browser) and a compact Quick actions dropdown, followed by at most four authorized KPI cards. Needs attention sits beside My priorities; a Today/Next 7 days Schedule sits beside Business performance. The reporting period belongs inside Business performance; current totals retain a short scope label. Optional recent activity follows. Narrow containers use attention cards and stack the panels, including when the global Agent rail opens. Normal priority badges and internal external-link icons are omitted; attention rows retain semantic, keyboard-accessible links. Metric definitions remain available on demand rather than as permanent explanatory captions.

All/Mine/Urgent/Overdue and reporting periods live in the URL. Mine uses Membership and linked Resource ownership, never a display name or inferred assignment. Exact category totals are independent of five-record previews and may overlap. Source failures say unavailable and unknown; successful empty reads say empty. Current queue and schedule scopes are distinct from Today/rolling-seven-day/calendar-month reporting scopes. Monetary figures and payment series remain separate by stored currency. `--warning` denotes an operational exception requiring review; it does not denote provider health.

Quick actions and the organization command palette consume one authorized action list. Actions are grouped by workspace and open owning drawers; invoices open the existing Finance workflow through its collection create query. Search is a command palette opened from the sidebar's Search row, which matches the other primary controls in size and state; it has no keyboard shortcut and no visible shortcut hint. It offers create actions, authorized workspace destinations and supported Agent prompts. The AI workspace manages assistants; the header Agent opens the global conversation rail. Home, Search and Library form one sidebar cluster. Account footers show a saved personal name when available and the organization role.

Setup is onboarding status, not navigation. Organization Home shows one setup banner while the business is in SETUP, computed from `computeSetupOverview`: the count is required blockers only, so recommended and optional areas never block launch. Someone who cannot launch sees the same facts as information with no instruction to act. Live businesses show no banner. The organization switcher carries a quiet "Setup pending" line beneath the business name while setup is open. The checklist, optional recommendations and launch controls stay on the Setup page, and launch uses the existing server-checked command. The shell has no notification bell, notification dialog or setup count. Configuration notifications follow the canonical configuration target's workspace and deduplicate repeated messages. Read failures remain unavailable, and configuration never implies live provider operation. Published website status uses a neutral success presentation even when draft changes also exist. Optional performance/activity panels have browser-local, actor-and-Organization-scoped preferences; core attention and priorities stay visible.

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

Library is one control in the primary sidebar group. It is a trigger, not a link: it opens an anchored popover whose entries come from `LIBRARY_SECTIONS` and link to each section's route, with the current section marked. `/organizations/{id}/library` redirects to Files. Each section page keeps its tab strip, so the sections stay one click apart. "Library" is a plain-text ancestor, since `/library` only redirects. Target (ADR-047, not yet implemented): a section without working behaviour is hidden from the popover and tab strip in production until it has some, and its route remains. Today Media, Templates, Knowledge, Collections and Trash are still listed.

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

The header shows contextual page location on the left and Menu on the right. There is no persistent bottom navigation. Business destinations use the same authorized workspace hierarchy inside the sidebar Sheet; organization switching stays in its header. Agent is an explicit open action in the footer beside account access.

The Menu renders the same projected hierarchy used by desktop navigation.

Do not maintain a separate lossy “phone navigation” information architecture.

### Tablet

Use an icon-focused/collapsed rail or equivalent compact shell while preserving the same navigation hierarchy.

From 768 to 1279 px the sidebar is the icon rail by default, whatever the desktop preference, and names its items as tooltips. The header toggle expands it as a temporary overlay: the page keeps its rail-width layout beneath a dimmed backdrop, focus moves into the navigation, and Escape, the visible Close navigation control, a click on the backdrop, choosing a destination or leaving the tablet width close it, returning focus to the toggle where the person closed it. The overlay is never saved. Its destinations, workspace heading and Configuration group are the same projection as at desktop, so a configuration-only member sees exactly what the desktop sidebar offers them.

### Desktop

Use the persistent sidebar and higher-density page layouts.

From 1280 px the sidebar docks, expanded unless the person collapsed it. That explicit desktop choice is kept in the `sidebar_state` cookie and read on the server. A `sidebar_viewport` cookie records the viewport class the browser last reported, so a reload renders the matching layout without an expanded-then-collapsed flash. A first visit, or one from a different class of device, renders the desktop layout until the browser reports its width. Neither cookie holds account information.

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

Support's Configure opens a nonmodal panel in the page-support rail, beneath the workspace header, through `SupportRegistrar`. The panel lists the queues and service levels the member may configure, using the same configuration read model, editors and commands as the full pages. Each editor opens its own drawer above the panel, and closing it returns to the panel. The trigger appears only when the configuration projection offers at least one of these concerns, so a `support.read`-only member sees no Configure control. Full configuration pages remain addressable. The Configure control never navigates to a landing page.

Where configuration belongs to Settings, Configure should link or transition to the authoritative Settings destination rather than create duplicate settings.

No workspace has a Configuration landing page. Every other workspace Home reaches its configuration through `WorkspaceConfigure`, which renders `ConfigureMenu` over the doors `workspaceConfigureItems` grants the member: nothing, one link named for its page, or a Configure menu of direct links. Finance has one door (Services & pricing, whose page also holds payment collection). Marketing and Automations register no doors, so their Homes show no Configure control. The Dialer offers only its calling doors (Calling & routing, Numbers & assignments). In the sidebar, a workspace's Configuration is a direct link when the member has one door, and otherwise a heading button that expands and collapses the doors; on the collapsed rail it opens the navigation with the group expanded. "Configuration" is a plain-text ancestor in the breadcrumb, and the phone's Up control skips it. Each old `{home}/configuration` address (`sales`, `comms`, `support`, `field`, `finance`, `studio`, `ai`) redirects on the server to the first door the member may open, or shows not-found when there is none. A configuration-only member's workspace row opens that first door directly. Customers registers no Configure panel, and the Relationship pipeline links straight to Relationship stages for members who may open it.

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

Opening Settings lands on the first destination the member may use. Every destination is a deep link and receives the Settings sidebar whether or not the person came through the menu. Back to app restores the appropriate workspace context and returns to the last page of the same business that was not Settings, validated as a path inside that business, otherwise Home.

Search covers these destinations and the configuration workspaces own (from `CONFIG_TARGETS`) and routes each to its canonical owner. Settings does not list workspace configuration.

---

### A6 — Settings Page Identity

Target (ADR-047, not yet migrated): Settings follows the shared page location contract, so the bar shows `Settings › {Page}`, "Settings" is plain text because it has no index page, and the page title is not printed again in the content. Current behaviour: every Settings page still uses `PageHeader section="Settings"`, so the bar names the section and the page title is visible beneath it. Forms use the bounded `form` width; pages with tables or catalogues use `fluid`.

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

Marketing Home is a compact operational dashboard: four evidence-backed KPIs scoped by a labelled reporting period, Needs attention showing only categories with items (one sentence when there are none), Running campaigns (drafts awaiting setup are listed under Needs attention, not again), Acquisition in this period (trend and sources together, or one sentence before the first tracked submission), and a Status panel and a Recent activity panel shown only when there is activity. Navigation the sidebar already offers is not repeated as cards. Local Home/Campaigns/Audiences/Leads/Performance navigation preserves the business's contextual workspace sidebar. Campaign detail is deep-linkable; campaign and audience editors and inquiry review use shared PageDrawer primitives. Collection search, review/status/objective/owner/source filters, date bounds and pagination persist in the URL. Table overflow is contained within its panel at narrow widths. Activation expresses Marketing lifecycle, not delivery success; unestablished consent and unavailable promotional delivery are shown explicitly.


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

`CONFIG_TARGETS` and `WORKSPACE_CONFIGURE` retain canonical configuration ownership and authorization. Relevant operational pages link to their configuration roots; entering a workspace shows its own eligible destinations and Configuration, with Home returning to the organization-level directory. Configuration has no landing pages; the sidebar group and the Home's Configure control list its concerns directly. General Settings separately hosts the versioned business words/navigation editor; it does not fold that independent save into business identity.
General Settings is one form, saved once, whose Business identity, Primary business address and
Business contact groups are separate shared cards beneath the existing Settings sidebar; it has no
section navigation. Settings groups use shared surfaces so Appearance shape, density and
elevation reach them. Resolved links use
text labels, hover, selected and focus roles without a repeated generic icon. Page loading uses the
existing organization boundary; missing or unauthorized concerns resolve to not-found before data
reads. No empty configuration root is offered. `WorkspaceConfigure` remains a shortcut to each root.


Platform uses its own authorized registry and shared responsive sidebar. The business switcher changes business context only. `NavigationActivityContext` carries only a retention hint from the persistent telephone owner. During an active call, cross-business and global personal Settings links open a separate tab. Ordinary same-organization configuration, General Settings and workspace navigation reuse the existing telephone runtime. This does not provide call continuation after reload or browser termination.

Channel diagnostics reuse `messagingSenders` and the existing sender/provider facts. The UI distinguishes planned/unentitled/disabled features, missing provider/callback/relay configuration, inactive or non-SMS numbers, missing active identities, and unverified sending domains. Sender configuration does not grant `message.send`; configuration checks passing never asserts provider acceptance or delivery. Outbound email and mailbox synchronization remain separate capabilities.

### CRM Contacts and opportunity Pipeline

Add contacts is CRM's one contact-intake entry point, on the Dashboard, the Contacts directory and their empty states. It opens one centered dialog offering Create manually, Import records and Connect & synchronize. Each choice follows the capability its destination enforces: creation needs `customer.create`; Library import needs `integration.manage`, with `customer.create` for new rows and `customer.update` for updates; synchronized worksheets need `integration.manage`, and connecting a provider is Connections' own door, entitled by the Integrations module. A choice the member cannot complete shows its reason instead of an action, and the trigger is absent when no choice is open. Manual creation happens in that dialog in two stages over one form: Essentials (Person or Company chosen explicitly, then name, email, phone, and for a person an optional company and job title; for a company, its website when the business defines that field) and Additional information (lifecycle, lead temperature, and the business's own fields, industry first). Either stage can save. A person's company can be created inline in the same dialog, and the person's values are kept. Closing a changed form asks before discarding, and focus returns to the trigger. Success offers View contact, Add another and Close. `?create=1&type=person|company` opens straight into manual creation. Imports and synchronization stay Library's: the import is a guided page flow (Choose source, Map fields, Review changes, Apply, Results). Review counts only what staging recorded; local-edit conflicts surface at apply time as failures. Applying needs an explicit confirmation, and Results reports the run's own counters with links to Contacts, problem rows and the saved source. No Google Contacts or Outlook contact-book source is offered.

Contacts leads each row with identity (type icon, name, and company or type) followed by lifecycle, phone, email and actual last visible activity; temperature and custom fields are optional columns. It uses the collection/table grammar with Add contacts as its primary action and a CollectionToolbar: quick scopes All, People, Companies and Needs review (Unspecified identity or no lifecycle), search, sort and display (grouping, columns), with lifecycle, temperature, company, relationship stage, industry, website and added date inside Filters, shown as removable chips with Reset. Group by company shows each company's own record first and its people beneath, then No company and Needs classification; nobody appears twice. Filters, scopes, grouping and pagination stay in the URL and are applied by the database. A filtered empty result retains its controls. Creation and editing share independent Lifecycle and Lead temperature fields; existing optional relationship-stage controls retain their meaning. Contact profiles preserve related operational records and permission-gated actions. The relationship-stage board is reached contextually from Contacts, while the primary Pipeline opens opportunities; the two never share stages. Both boards scroll sideways inside a labelled, keyboard-focusable region, with column names, counts, compact empty columns and identity-first cards; stage changes use the existing persisted controls (no drag-and-drop). Relationship stages are managed in place on their configuration page (ordered list, add/rename dialog, Move up/down, removal only when no contact or audience uses a stage). Board/list controls are page-local views over the same opportunity records. No persistent Follow-ups row or duplicate workspace strip is introduced.

# UI specification

Admitted as a Tier 1 document by D23's trigger, which fired when the second and third surfaces
shipped and went unnoticed until the fifth. `constraints.md` D23 holds the decisions; this
document holds the surface, navigation and control relationships that are too much for one
decision record to carry. Where the two disagree, D23 governs.

Harvested from `tire-app-template/docs/ui-spec.md` the way D1 says to harvest — the reasoning,
cited, never the code, and not all of the reasoning. That source is a single-tenant application,
so **everything it was free to hardcode is exactly what this platform is not**, and its §15
status system is the specific thing D23 refuses.

**This document holds decisions and never values.** Why a colour role exists, why a status is
styled neutrally, which rendering an area gets — those are here. The hex codes, the spacing scale
and the class strings live in `apps/web/app/globals.css` and in the control files, and are cited
from here rather than copied. D23 refuses a design-tokens document under D8's never-write list,
and a spec that starts listing values has become one by a longer route.

**§4 was the empty half and is now filled in**, by the change that wrote the controls rather than
ahead of it. What is recorded there is what was built and what it replaced.

---

## 1. The surfaces

Six. The authenticated operating scopes share shell and Sidebar infrastructure but deliberately
do not share a navigation model. That is the reason this file exists rather than another
paragraph in D23.

| Surface | Whose it is | Navigation | Where |
|---|---|---|---|
| GildOps' front page | a stranger | GildOps' own header and footer (`SiteShell`) | `app/(marketing)/` |
| Operator shell | a business's own staff | full IA, three renderings (§2) | `app/organizations/[organizationId]/` |
| Public booking | a stranger with no account | none — one linear flow | `app/(public)/book/[slug]/` |
| Customer portal | one customer of one business | none — a single page of their own things | `app/(public)/portal/[token]/` |
| Platform tools | GildOps staff operating from GildOps' ordinary organization | Platform section inside the ordinary organization sidebar | `app/organizations/[organizationId]/platform/` (only for GildOps' own organization) |
| Auth | anybody | GildOps' own header and footer (`SiteShell`) | `app/(auth)/` |

Three consequences that are easy to undo.

**The operator shell has one workspace frame.** The tenant model comes from
`lib/navigation.ts`; the global Platform section comes from
`lib/platform-navigation.ts` and appears only for platform staff inside GildOps' organization.
Public, portal and auth surfaces remain flows or single-purpose pages. A customer must
never meet a business-configuration concept or a Platform section.

**Settings has two scopes, and they share a presentation without sharing ownership.** *Account
settings* (`/settings/account`: Profile, Security & sign-in) is the signed-in person's identity —
their email and password belong to them, so no business's Settings ever holds them (D45).
*Business settings* (`/organizations/{id}/settings`) is the selected business's. Both render
through `WorkspaceShell` and `SettingsPageFrame`, and each says whose it is in its own description.
The account menu — the footer of the sidebar, which on a phone is the footer of the Menu sheet — offers *Business
settings* (only where the member may configure something there), *Account settings* and *Sign
out*; switching business is the context switcher's alone, and Settings holds no permanent row of
its own in the sidebar (`lib/shell.ts`'s `businessSettingsOffered`). The link to Account settings
carries the business being left as `?org=`, which the page honours only for a business the caller
belongs to, so Account settings can offer *Back to* it. `/account` redirects here and has no page.
Nothing organization-owned is listed in the Personal sidebar to fill it. Addresses:
`lib/route/personal-settings.ts`.

**`SiteShell` is GildOps' chrome and belongs on GildOps' pages only** — the front page and the four
credential screens, which is why those two rows share a description above. It is a header saying
GildOps and a footer saying GildOps, and on `/book/{slug}` or `/portal/{token}` that would be our
wordmark on somebody else's shop front. D20 keeps the platform out of a tenant's frame entirely,
and `public-profile.test.ts` now fails the build on a `SiteShell` anywhere under `app/(public)/` —
the structural form of the sentence rule the rest of that suite enforces.

**Platform pages never enter tenant `navigation.ts`.** Platform Overview, Organizations,
Products, Modules, Meters, Pricing, Providers and Failures are a separate IA because they govern
GildOps itself, not one business. Both models render through the shared `AppShell` and shadcn
Sidebar primitives — and, since the shell/context correction, through the shared
`WorkspaceShell`/`WorkspaceRightRail` too (`apps/web/components/layout/workspace-shell.tsx`):
two independent panels — Agent, and the page-support rail that Activity, Insights, Configure and every create/edit form
open into — neither modal. Both dock beside the page from 1720px; from 1280px one docks, the one
opened last; between that and 768px one floats over the page from the right; below 768px one
floats from the bottom. Nothing dims or blurs the page behind them. **Workspace-global tools align
to workspace chrome; page-local tools align to page chrome.** Agent runs the full height and its
header is the workspace header's band; the page drawer starts beneath that band, and its title row
lines up with the page's `<h1>`. Every measurement is in `workspace-geometry.ts` — no route sets a
margin to get there. Both
shells also share `WorkspaceHeader` (`apps/web/components/headers/workspace-header.tsx`), the
sticky *global* bar, and `PageHeader` (`components/headers/page-header.tsx`), the page's own
identity and actions — §2a says which owns what. Agent itself is scope-bound rather than shared
data: `TenantAgentRail` answers with
one business's own rows under the caller's RLS; `PlatformAgentRail` takes no organization id at
all and never runs "inside" a tenant, GildOps' own included — a selected organization may appear as
Platform Agent's *context*, never as a switch of its scope. What's shared is presentation only
(`features/agent/agent-shared.tsx`): the conversation header, the transcript, the composer, and the
unavailable-vs-empty distinction described at `lib/domain/assistant/platform-questions.ts`. §2c
holds the grammar.

---

## 2. The three renderings

The information architecture does not change across breakpoints; only its presentation does.
`apps/web/lib/navigation.ts` holds the one set of areas and
`apps/web/app/organizations/[organizationId]/org-shell.tsx` renders it. (This file named
`components/org-shell.tsx` until the path was corrected — that directory is for what more than
one surface needs, and the shell serves one.)

**All three renderings exist.** The tablet rail is M11's: icon-only between `md` and `lg` over the
same `AREAS` list the other two renderings already map, an icon per area from `lucide-react` keyed
by segment in `org-shell.tsx` (`AREA_ICONS`) rather than in `navigation.ts`, which stays what it
was — segments, labels, groups, modules.

| | Navigation | Layout | Overlays | State |
|---|---|---|---|---|
| Phone | bottom bar, fixed: **Home | AI | Menu**, three equal cells, never scrolling; Menu is the sidebar's own sheet, from the right | single column | sheets, sticky action bars | built |
| Tablet | rail, icon-only | two column | sheets or dialogs | built |
| Desktop | persistent sidebar | denser tables | dialogs | built |

**The sidebar is the desktop rendering of the IA, never its source.** Both renderings map the
same `AREAS`; two lists that had to agree eventually would not.

**One shell, projected.** Organization context is the normal operating context. Every renderer —
the desktop sidebar, its collapsed rail, the tablet rail, the phone Menu, and the
Settings map — draws the projection `projectShell` (`lib/shell.ts`) resolves from four independent
facts: the organization's entitlements, the member's capabilities, whether the organization is
GildOps' own, and the member's platform permissions. Hiding an item is courtesy, never
authorization; every page, domain function and policy behind it still refuses independently (I12).

The target information architecture is:

```text
Home

Library
├── Files
├── Media
├── Templates
├── Knowledge
├── Collections
├── Sources
└── Trash

Workspaces
├── CRM
│   ├── Home
│   ├── Customers
│   ├── Pipeline
│   ├── Inbox
│   └── Opportunities / follow-up
├── Communications
│   ├── Home
│   ├── Calls / Voice
│   ├── Email
│   ├── Messaging
│   └── Numbers / routing
├── Marketing
│   ├── Home
│   ├── Campaigns
│   ├── Audiences
│   ├── Content
│   └── Forms / landing-page usage
├── Support
│   ├── Home
│   ├── Cases / Requests
│   ├── Queues
│   ├── Escalations
│   └── Service levels
├── Finance
│   ├── Home
│   ├── Invoices
│   ├── Quotes
│   ├── Payments
│   └── Pricing
├── AI
│   ├── Home
│   ├── Assistants
│   ├── Knowledge
│   └── Tools
├── Automations
│   ├── Home
│   ├── Rules
│   ├── Messages
│   └── Activity
├── Field
│   ├── Home
│   ├── Work
│   ├── Schedule
│   ├── Resources
│   ├── Locations
│   └── Equipment & Assets
└── Studio
    ├── Home
    ├── Website
    ├── Forms
    ├── Brand
    └── Portal

Business
Platform Administration  ← GildOps organization + platform authority only
```

Only implemented, entitled, permitted and reachable destinations are drawn. This target is not a
claim that every row exists on current `main`: CRM still uses the legacy `/sales` Home route;
Marketing and Support have no operating surface; AI is partial; Library has no organization collection.
Insights has real deep routes but is cross-cutting and therefore has no workspace row or permanent
section. Target architecture and current navigation are separate facts (D68).

**Entitlement and permission are separate, and both are required.** A business without
Communications has no calling workspace for its owner; a member without `call.place` does not
operate calling in a business that has it. Business is likewise one item at a time by the
authority for that item — Team by `role.manage`, Connections by `integration.manage` (and the
product), Plan & usage by `billing.manage`. **Configuring is not operating**: a Settings entry is
a `ConfigTarget` that borrows a workspace's entitlement and declares its own configuration
permission, so `field.manage` reaches call outcomes without `call.place`. Setup is kernel;
Agent-assisted drafting is an optional section inside it.

**Platform is a sub-scope of GildOps' own organization** (D60). There are three scopes — a person
(`/settings/account`), an organization (`/organizations/{id}`) and Platform
(`/organizations/{goldId}/platform`) — and the address says which one somebody is working in; it
says nothing about who owns the records on the page. Providers, catalogue and billing stay
platform-scoped whatever the address. `PLATFORM_DESTINATIONS` is the one registry of its
destinations, what each takes (`platform_staff.capabilities`) and how the sidebar nests them:
Catalog holds Products, Meters and Connectors, Commercial holds Plans & Add-ons, Pricing, Portfolio economics and Billing, and
Infrastructure holds Providers and Failures. Platform is a section beneath GildOps' own workspaces,
never a replacement for them, and while somebody is inside it every group is open. A GildOps
salesperson sees GildOps as any business and no Platform; a limited operator sees only the
destinations their row names; nobody sees Platform beside a customer's business. The context
switcher answers one question — *which organization am I operating?* — and offers no Platform
entry, because inside Platform the answer is still GildOps.

**A Plan, Product, Module, Feature, workspace and page are different things.** A Plan or Add-on
grants Features; a Product groups customer-facing capabilities; a workspace composes capabilities
where an operator works; a page is one task inside it. A Product can contribute to several
workspaces and a workspace can compose several Products. Only workspaces and pages are navigation,
and nothing in the sidebar is named for a Plan.

**The phone bar is Home, AI and Menu.** Three equal cells, and nothing in the bar scrolls.
*Home* goes to the organization's projected Home. *AI* toggles the existing workspace-global Agent
(`useWorkspaceRail`'s `toggleAgent`), the same Agent the header's trigger opens from `md` up; on a
phone the open Agent panel stops above the bar, so the same control closes it. *Menu* opens the
sidebar's own phone sheet, from the right (`Sidebar`'s `mobileSide`; the desktop sidebar stays on
the left), and that sheet draws the same `sections` as the desktop sidebar: workspace rows go to
their Home, the chevron expands their pages, and Business and Platform appear there when projected.
Platform is never a bar destination. There is no separate phone projection, so the Menu and the
desktop sidebar are exactly one list; desktop and tablet navigation are unchanged. The bar's height is
`--mobile-nav-height` (`workspace-geometry.ts`), which the page's bottom inset and the phone Agent
panel read. The sidebar trigger is hidden below `md` because the Menu button opens that sheet.

**Sections, ruled apart, in `AREA_GROUPS` order** — Home, Library, Workspaces, Business and
Platform. `navigation.test.ts` fails on an interleaved list: each
section must be one unbroken run, and an operator must never reach today's work by going through
settings (D23).

**The test for a permanent row:** would somebody enter this area to do ongoing work, or are they
configuring how another workspace behaves? The first kind is a row; the second is reached from
Settings (`Area.sidebar: false`, the route, module and capability gating unchanged).

*Module* is the billing axis (D25), and Reports, Assets, Automations and Reception are all
modules — so no section is named for one. These are named for what an operator does.

| Section | Holds | Why |
|---|---|---|
| (Home) | Home | What matters in this business right now — set apart, first |
| Library | Files, Media, Templates, Knowledge, Collections, Sources, Trash | Shared organization infrastructure; current implementation has record-attached Documents but no organization collection |
| Workspaces | CRM, Communications, Marketing, Support, Finance, AI, Automations, Field, Studio | Where an operator does one kind of ongoing work. Current rows are derived only from real reachable pages; the target set is independent of catalogue Products |
| (Settings) | Settings | Where the business is configured — set apart by the rule above it |

**Workspace interaction contract.** The row body opens the workspace's canonical **Home**. The
chevron expands or collapses children only: clicking it never navigates, and clicking the body never
merely toggles. Home summarizes the workspace and routes into real child surfaces; it is never
repeated below the parent, and **Overview** is not a competing page type. A dropdown contains only
real, reachable child pages — never *coming soon*. A `ViewNav` holds sibling views inside one page;
the same destinations are never both navigation grains.

**Activity, Insights and Configure are support modes, not workspace pages by definition.** A
workspace or page exposes only the modes with an honest source. Insights is contextual analysis
over shared reporting aggregates. `/insights` and `/insights/reports` may remain real deep routes,
and the Insights support mode may link there; neither fact creates an Insights workspace. Agent is
the workspace-global assistant rail and is none of these.

**Where each concern lives.**

| Boundary | Rule |
|---|---|
| CRM / Communications | CRM owns the relationship — customer, stage, intent and follow-up. Communications owns the channel — call, thread, email or message. A communication can appear on a customer's timeline without becoming a customer field |
| Work / Schedule | Work owns what is to be done. Schedule alone owns when a resource can commit to it, and is the one engine that says what is free. Neither is a view of the other |
| Finance / GildOps platform economics | Finance is the business's own price book, quotes, invoices, payments and costs. GildOps' Plans, subscription pricing, provider cost and platform margin stay in Platform Administration. Two money directions, never one ledger |
| Studio / Marketing | Studio authors and publishes website, forms, brand and portal experiences. Marketing owns campaign, audience, acquisition and lifecycle intent and consumes Studio content |
| Sidebar / record links | The sidebar answers *what kind of work am I doing*; a record's relationships answer *what is related to this* (D68). A workspace may invoke or summarize a capability owned elsewhere without acquiring it |
| Related-record/projection card | Reads one canonical record, adds only context-specific secondary data or authorized actions, and offers **Open in …** where useful. It has loading, error and empty states and holds no copy of authoritative state or business rule |
| Scope | Organization workspaces run one business; Platform Administration runs GildOps (D60). A Platform page is never a tenant workspace repeated so staff can look inside |
| Library | Shared organization infrastructure: Files, Templates, Media and Knowledge. A file may link to a customer, job, asset or invoice without being owned by it. Templates and Knowledge enter Library only when a real shared collection exists; domain templates retain their domain owner until then |
| Service / pricing / scheduling | A Service (Offering) is the reusable definition of what the business does; a Work Item is one instance; the Price Book prices it; Scheduling says when resources can commit; a Quote or Invoice is the snapshotted result for one transaction. A Service may later supply estimated duration, resource requirements, a pricing rule, a checklist, bookability and a service-specific buffer. `buffer_minutes` remains a scheduling policy, and travel time is a separate, future scheduling input from locations and routes — never the same thing as a fixed buffer |

**Card taxonomy.** A **workspace summary/KPI card** summarizes one child surface, provides a
metric or state, and navigates there. A **related-record/projection card** represents one canonical
record under the contract above. An **area-local widget** is a richer interactive view local to one
area and preserves the existing `?widget=<key>` URL-state contract. These are distinct components,
not interchangeable uses of “card.”

There is no Ask row. The Agent is a rail on every workspace and understands the page and record it
is opened from; the `assistant` module and `assistant.ask` capability are unchanged, and the old
`/ask` address redirects to Home; the old `/today` and `/reports` addresses redirect to Home and
Insights' Reports.

A section whose every area belongs to a switched-off module renders as nothing at all, heading
included — naming a part of the application that is not there for that business would be worse
than the gap.

**Settings is the configuration map, not a second application shell.** `settings-map.ts` groups
every place a business is configured by the concern it answers — Business, Work & scheduling,
Services & pricing, Customers & data, People & access, Brand & public presence, Connections,
Products & features, Plan & usage, Setup & launch — and `SettingsIndex` renders it: one link per
entry, its title stretched over its card. Each entry links to the route that owns the
configuration (Pricing, Custom fields, Team and Apps and files keep their own routes) and is
offered only when the sidebar's own entitlement and capability predicates would offer that area,
so the map cannot show a door the sidebar would hide. Guided setup and the Agent target an entry's
`key`, never a hand-typed URL.

**Setup is a lifecycle with one shell affordance.** A business in SETUP is entered through Setup
(`organizationHomeHref`), and the sidebar (or phone bar) keeps one plain Setup row while it lasts
— no badge, no count, no readiness query on every request. Home carries no setup chrome. After
Launch the row is gone and Setup remains reviewable from Settings' *Setup & launch*, worded so
Launch never sounds available again.

**Automations is a collection with a detail route, not a page of open editors.** `/automations`
holds three URL-backed sibling views — Rules, Messages, Activity (`?view=`, Tabs presentation,
Rules the default) — because a workspace that rendered every rule as a complete WHEN/IF/THEN
editor at once could not scale past a handful. A rule is a complex entity and gets its own route,
`/automations/[ruleId]`, read top to bottom as the sentence it is: WHEN (its trigger, read-only —
the domain layer refuses to change it after creation), IF (its conditions), THEN (its actions),
then its own recent activity. Creating a rule, adding a condition or action, and writing or
editing a message are each bounded enough for a Sheet; deleting a rule goes through the shared
confirmation dialog and says plainly that its runs stay recorded after it is gone.

**Team is the user-facing noun for the `roles` Area — the route and the domain nouns stay what
they are.** `/organizations/[organizationId]/roles` is unchanged; the label a caller reads in the
sidebar and the page heading is "Team" rather than "People and roles". Its own workspace holds
three URL-backed sibling views — Members, Invitations, Roles (`?view=`, Tabs presentation, Members
the default). Members and Roles are the two collections a Sheet full of inline forms used to sit
above; adding a member, whether by inviting an email address or adding an existing account, is one
Add Member Sheet reused from both Members and Invitations, defaulting to invite-by-email because
that works whether or not the person already has a GildOps account — the two remain the domain
layer's two distinct writes, chosen with a segmented control, never merged. Revoking a pending
invitation goes through the shared destructive confirmation dialog. A role's capabilities are
edited in `CreateRoleSheet`/`EditRoleSheet`, both sharing one `CapabilitySelector`; the Roles
collection itself shows only a permission count, never every capability expanded as a badge.

**Custom fields is one URL-backed workspace, not five stacked configuration forms.**
`/organizations/[organizationId]/fields` shows one entity at a time — Customers, Locations,
Resources, Work items, or Assets — selected by `?entity=` with Customers as the fallback. The
active entity's compact registry shows each field's label/key, type and required state. New and
Edit field flows use responsive Sheets; the edit Sheet presents key, type and entity as immutable
metadata while only label, required state, position and choices (where applicable) are editable.

**The desktop sidebar does collapse, to the tablet rail's own icon-only width.** Unlike a phone
drawer this needs none of that machinery — nothing overlays, nothing traps focus, the column
just narrows. `AppShell` uses `@gold/ui`'s `SidebarProvider`; the shared shadcn implementation
persists collapse state in its `sidebar_state` cookie. Each context maps its own navigation
model. The identity block compacts with the labels.

**The sidebar is not a column on a phone; it is the Menu sheet.** Below `md` the column does not
draw, and the persistent chrome is the header and the three-cell bottom bar. The sidebar's own
mobile sheet holds the same content as the desktop column and opens from the Menu button. The
phone bar is `fixed`, and `display: none` on an ancestor takes a fixed descendant with it, so that
bar is a sibling of the sidebar rather than a `<nav>` inside it — `OrgNavBar` beside `OrgSidebar`,
both inside `SidebarProvider`, which is how the bar opens the sheet.

---

## 2a. The header

**Three things, not two, and they answer different questions.** The sticky `WorkspaceHeader`
answers *which application, and where in it* (the breadcrumb trail) and holds global utilities.
`PageLocation` (`components/navigation/page-location.tsx`) is the one thing that publishes a
page's location into that trail — nothing else, no visible chrome. A screen pattern — `PageHeader`
or one of `components/patterns/`'s archetypes (§2d) — answers *which page or record am I on, and
what can I do here*, composing `PageLocation` alongside whatever visible identity the task needs.
They were one bar once, which put *Resources*, *Add resource* and *Configure* — all about one page
— on the same row as *Agent*, which is about the workspace; then `PageHeader` itself became the
one shape every screen was forced through, which produced its own sameness (§2d). A control
belongs to the layer whose scope it has, and a screen's visible identity belongs to the pattern its
task calls for.

**`WorkspaceHeader` — global, sticky.** It carries its own background: the page moves underneath
it, and a transparent bar shows rows sliding through the text. It holds the persistent breadcrumb
location and no title, status or page action.

Ownership is durable, not a page-by-page convention: **every** navigable screen publishes a trail —
`ancestors + current page` — into the workspace bar automatically, through `PageLocation`, even
when it has no ancestors. There is no page with nothing to say here. `PageHeader` composes
`PageLocation` internally, so its callers get this for free; a screen pattern that draws its own
identity (`CollectionHeader`, `WorkspaceHome`, `SettingsHeader`, `StatePage`) composes
`PageLocation` itself instead. The current page is always the trail's final, non-linked segment
(the shared `Breadcrumb` primitives' current-page role); an ancestor is a link only where it names
a real destination someone can navigate to, and plain text otherwise (a heading with no page of its
own, such as a Platform sidebar group). Ancestry itself is read from the existing navigation
registries — `workspaceAncestry` from `WORKSPACES`/`AREAS`, `platformAncestry` from
`PLATFORM_DESTINATIONS`/`PLATFORM_GROUPS` — never a page's own hand-written string, and never a
pathname-to-title lookup. Because publishing is unconditional, location stays visible in the sticky
header while the page beneath it scrolls, on every authenticated route: an organization workspace,
Platform, or Account.

| | What | Which widths |
|---|---|---|
| Left | the sidebar trigger | `md` and up in an unlocked organization shell (which Platform renders inside), where a phone gets the bottom bar's Menu button instead; every width in a **locked** organization (no bottom bar, so this trigger opens `LockedOrgSidebar`, right-side, for Plan & usage and the account menu), in Personal settings and in the fallback frame |
| Left | the compact context switcher — the business's mark and name, opening the same menu the sidebar's own switcher does — nothing about Setup lives in this header at any width | below `md` only, in the organization shell — the sidebar says it above that |
| Left, after the above | the breadcrumb trail — ancestors, then the current page, always published | all |
| Right, furthest | Agent | `md` and up; a phone's AI is the bottom bar's, and a phone header carries no Account control — Account is the Menu sheet's footer. `beforeActions` remains a generic slot, empty in the organization shell |

**`PageHeader` — one available page identity, inside its `AppPage`, not the required one.** The
page's single `<h1>`, an optional metadata line, and the page's actions at the right (wrapping
below the title on a narrow screen). It shares the canvas the content below it sits on; `AppPage`
still owns width. It is a Server Component and knows no domain: a page hands it whatever actions it
offers. **It carries no generic `description` prop.** A sentence restating what a screen is for,
placed under every title whether or not it earned the space, was the single largest cause of
"every screen looks like the same template" (§2d) — explanatory text now gets classified per
screen rather than defaulting into this slot. **One primary action per page is a strong default**,
then secondary ones — Resources is *Add resource* with *Configure* beside it — not a law a task
needing several high-priority controls must contort itself around (§6).

**The page-support rail belongs to the page, with three modes.** A page may offer *Activity*
(what recently changed here), *Insights* (a few numbers, with a link into Insights) and
*Configure*, by passing `activity`, `insights` and `configure` to `PageHeader`; it registers each
mode's content with a `SupportRegistrar` (`ConfigureRegistrar` is its `configure` mode). Only one
mode is open at a time — `WorkspaceRightRail` holds a single `supportMode` — so choosing another
replaces the open one in the same footprint. `WorkspaceRightRail` hosts it beside the page and
beside Agent, and either can be open without the other. Whether to offer a mode is presentation —
its reads and writes are still refused by the database. A mode is offered only where an
authoritative source exists: Activity reads `listRecentActivity` through a named scope; Insights
reuses the reporting aggregates and never computes its own. A Configure panel that would only
repeat a Settings form links to the Settings owner instead.

**The area's `<h1>` is still one string.** `navigation.ts` supplies the navigation entry and the
heading both — an area's root page reads it with `areaLabel(segment)` instead of writing it again,
whichever pattern draws it. A detail route is *in* an area and not *at* it, so it writes its own
title (a job's title is a tenant's words) and passes the way back as crumbs; `RecordHeader` keeps
its older props and renders `PageHeader`. Every page renders exactly one page identity — through
`PageHeader` or one `components/patterns/` archetype, never both, and never none.

**Context switching belongs to the context switcher, and only to it.** One identity, zero or
more memberships, and one current context. The menu's header is the current context and its list
is *where else*: the other businesses, each linking straight to that business's own lifecycle
entry. Platform is not an organization and is not listed; inside Platform the current context
is GildOps. With nowhere else to go it is a label, not an empty menu. There is no directory page: `/organizations` only lands a sign-in (the business last
worked in, else the first) and founds a first business, and the old `?all=1` request is ignored.
It does not manufacture a list or creation action without a server read behind it. **Sign out belongs to the account menu**, in the sidebar footer on desktop and in
the Menu sheet's footer on a phone, where the sheet's header names the current business and offers no second switcher — the header's compact context switcher is the one phone control for that. Neither is an operating action or permanent page-header
command.

**GildOps staff operate GildOps through its ordinary organization workspace when they are real members
of it.** The current `gold_internal` base Plan identifies that workspace, never its name. Platform
Administration is a sub-scope of that same organization (D60), reached from the Platform section of
its sidebar, not from the switcher. Neither authority substitutes for the other. On a phone the bar
is Home, AI and Menu everywhere, Platform included; the Platform section, with the pages under
Catalog, Commercial and Infrastructure, is in the Menu beside GildOps' own workspaces.

**The application canvas has three modes.** `AppPage` owns `fluid` (the default), `form` and
`reading`. Operational and collection pages are `fluid`: header, local navigation, toolbar and
content are children of one `AppPage` and share its left and right edge, and an open support rail or drawer narrows the workspace rather than changing the page. `form` and `reading` are the
deliberate, bounded, centred layouts for one focused task. No page writes a `max-w-*` of its own.

**The support modes are always the last page actions, in one order.** `PageHeader` renders
Activity, Insights, then Configure, after `actions`; `SupportTrigger` is placed nowhere else.
Resources reads *Add resource, Configure*; Customers reads *Import, New customer, Activity,
Insights, Configure*. Agent stays in the workspace header from `md` up; below it the bottom bar's AI control opens the same Agent.

**A drawer's chrome is one compact band** (`DRAWER_HEADER` in `workspace-geometry.ts`), the same
for Configure and every create or edit form.

---

## 2d. Screen patterns, and what retired the universal grammar

**The problem Phase B corrected.** Nearly every screen rendered the same shape — a title, a muted
one-line sentence restating what the screen was for, then whitespace or content — because
`PageHeader`'s `description` prop was the default slot for *any* explanatory text, and every page
reached for it whether or not the sentence earned its place. A workspace Home, a collection, a
settings scope and a 404 all looked like the same template with different words. The fix is not a
richer `PageHeader`; it is recognizing that these are different tasks that should look recognizably
different while sharing tokens, controls and shell geometry.

`components/patterns/` holds the first five archetypes, each a thin composition over
`PageLocation`, `AppPage` and the shared controls — never a second business-rule layer:

| Pattern | File | Owns | Never |
|---|---|---|---|
| Workspace Home | `workspace-home.tsx` | What is happening, what can I do, where can I go — title, actions, then real content (KPIs, widgets, destinations). An empty workspace still renders its structure with a real empty state inside it | A restated-purpose sentence under the title |
| Collection/Board | `collection-header.tsx` | Compact identity and controls, then the collection or board promptly — tighter spacing than `PageHeader`, no description slot at all | A large introductory block above the work surface |
| Record | `headers/record-header.tsx` (renders `PageHeader`) | A record's name, status and metadata via `meta`, actions, relationships | Being forced into the Collection or Workspace Home shape |
| Settings/Configuration | `settings-header.tsx`, via `features/settings/settings-scope-nav.tsx` | The active scope's name as the page's `<h1>`, the scope tabs beneath it as one visual unit | A title followed by a disconnected scope sentence — `description` here is reserved for a scope whose name genuinely does not say enough (Organization vs Account) |
| State/Exception | `state.tsx` (`StatePage`) | A 404, an unavailable business, a refusal, a paused subscription — title, description, media and a recovery action kept in the same centred column | `PageHeader`, or an action pulled to a far edge by `justify-between` |

Each is a **pattern/default**, not a law (`docs/constraints.md` D23's four rule classes): a future
operational canvas, communication workspace or builder is a sixth archetype this layer does not yet
need to name, and nothing here forbids it.

**Explanatory text is classified, not relocated.** Deleting `description` did not create a new
`<PageDescription>` slot immediately beneath every `<h1>` — that would be the same mistake under a
new name. Each sentence that used to live there was judged on its own: deleted where the content
below it already said as much (most collection pages), turned into `meta` where it was really short
factual status (a date, a timezone, a connection's state), moved into a `Hint` beside the specific
control or section it explains (an import's upload instructions, a platform jargon term), or kept
as a pattern's own `description` where a scope's or state's name genuinely does not say enough.

**Empty states carry real content now.** `EmptyState` (`components/surfaces/section.tsx`) renders
plain `Hint` text when given only `children` — "No matching rows" does not deserve a bordered box —
and the full `@gold/ui` `Empty` composition (title, description, media, action) when given a
`title`. Scale follows context: a filtered collection's empty state stays a line of text; a
workspace that has never recorded anything gets the fuller treatment. The former rule — an empty
state may carry no action at all — is retired; what remains is not duplicating a create control the
page already shows continuously.

---

## 2b. Widgets, and what an area opens onto

**An area may present itself as a dashboard of widgets**: tiles you read at a glance, any of
which opens as the screen. `components/display/widget.tsx` holds `WidgetGrid`, `Widget` and
`WidgetPanel`. Calls, Integrations and Platform use them. Home is not built from them: it is
KPI cards over domain reads, and a block whose source a business does not have is not drawn.

**This is not the `dashboards` in `lib/domain/reporting/`, and the two must not converge.** That
one is a business's own arrangement of saved reports, and `CLAUDE.md` refuses to let the platform
seed one — including the four names in `roadmap.md` — because which numbers a business watches is
configuration and not four screens. This is how an *area* draws itself, which has always been the
platform's. A business still builds report dashboards on top of it.

| Rule | Why |
|---|---|
| The grid is CSS Grid, not a draggable layout | A widget grid has product-owned placement. One column on a phone, two from `md`, and four on a very wide canvas gives dense, stable scanning without a persisted personalization model |
| A widget opens to `?widget=<key>`, never to remembered state | It survives a reload, arrives with the back button, can be sent to somebody, and reads its rows on the server under the caller's own RLS. None of that is true of a panel a component remembers |
| The expanded view replaces the grid; it does not cover it | Nothing overlays, so nothing traps focus and nothing needs an escape key. The way out is the way back |
| The title is the link, not the whole tile | A tile whose every pixel navigates cannot hold the rows that make it worth looking at — a link inside a link is invalid, and the overlay that works around it swallows text selection |
| No trend, no comparison, no percentage | The platform cannot tell whether a number moving is good or bad for a business it knows nothing about. Same reasoning as §7's neutral status |

`dashboard.test.ts` holds the second rule from both ends: `widget.tsx` never becomes a client
component, and a page linking to `?widget=` reads `searchParams` — a tile that opens onto nothing
is `navigation.test.ts`'s dead entry in another costume.

---

## 2c. The Agent panel

**The Agent is a conversation, not a set of tabs.** Top to bottom, the panel is four regions:

    Agent header  →  conversation header  →  transcript  →  composer

| Region | Owner | What it holds |
|---|---|---|
| Agent header | `WorkspaceRightRail` | *Agent* and Close. Its geometry and breakpoints are the shell's and this panel never sets them |
| Conversation header | `AgentConversationHeader` | The selected conversation's title (*New chat* while it is unsaved), and **History** and **New chat** on the right |
| Transcript | `AgentTranscript` on `MessageScroller` | The only thing in the panel that scrolls. Questions sit at the end, the Agent's words at the start |
| Composer | `AgentComposer` | A textarea above a toolbar: **Context** and **Configure** on the left, **Send** on the right |

| Rule | Why |
|---|---|
| No Chat / Context / Activity tabs | Context and Configure are things you do while composing, and Activity was an audit list sitting in a place people read answers. The recorded tool facts remain on every run and will feed a Reports surface; the rail no longer draws them |
| History is a Popover, never a page | The bounded list (thirty, newest activity first) is a way to switch, not a destination. Hover is `bg-hover`, the current one `bg-selected`, never `bg-muted` |
| New chat is an unsaved state | It clears the selection and focuses the composer; nothing is written until its first question is sent |
| The transcript is `Message`, `Bubble`, `Marker` inside `MessageScroller` | The shadcn chat set in the current legacy `@gold/ui` package, adapted to GildOps roles: no avatars, reactions, delivery states or regeneration, no `bg-muted`, no demo blue |
| A `Marker` is a concise, non-speech note | *Thinking…*, *Checked 14 records*, *Tool refused*, *Action completed*, *Action failed*. Never a list of tool calls — `run-events.ts` is the one place that decides what is worth a line |
| A proposed action sits directly beneath the response it belongs to | Two shared Buttons, **Decline** and **Approve**. Nothing happens until somebody presses Approve, and then the domain layer does it under their own session (D34) |
| Enter sends, Shift+Enter adds a line, the field grows to a bound | The bound is `COMPOSER_MAX_HEIGHT`; past it the field scrolls inside itself, and the composer never pushes the transcript off screen |
| Context is inspection, not configuration | A popover listing what the next turn is given, using only facts GildOps has: the business, the workspace, the record open on the page, the business's time zone. It follows navigation. A row for something that does not exist (an attachment, a connected source the loop does not read) is not drawn |
| Configure is runtime only | Today one control has a behaviour behind it — whether the open record is named — and a link to *Connections & permissions* for those who may manage them. Durable settings stay in Settings and Platform; a control is added the day something honours it, never before |
| The paperclip attaches text, Markdown, CSV and JSON, up to three files of 1 MB | It is on the left of the toolbar, before Context and Configure, and it exists because the whole path does: choose, upload privately, a card with its state, sent with the question, kept with it, shown again when the conversation is reopened. Anything the Agent cannot read (a PDF, an image) is refused with a sentence saying so, never accepted and ignored |
| Attached files are cards above the textarea, and again beside the question they were sent with | `Attachment` on GildOps roles. They wrap rather than scroll, so at 320px none is hidden; each shows *Uploading…*, *CSV · 12 KB* or the reason it failed, and can be cancelled or removed until the question is sent. Send waits for an upload in flight |
| Popovers never outgrow the rail | `max-w-(--radix-popover-content-available-width)` and collision padding, opening above the composer, so the whole composition holds at the rail's 320px minimum and on a phone |
| Neither popover shows a secret or GildOps' economics | The same rule as every tenant screen (D45) |

`agent-conversations.test.ts` reads the source for each of these; nothing here mounts a component.

---

## 3. Colour roles

The values are in `apps/web/app/globals.css`. What belongs here is which roles exist and why.

That file defined **two** — `--background` and `--foreground` — which is the gap D23's amendment
records: refusing a tokens *document* was read as refusing the tokens, so every border was
`black/10 dark:white/15` written by hand and every hint was `opacity-70`. It now defines seven,
and each one names something the screens were already drawing without a word for it.

| Role | What it is for | What it replaced |
|---|---|---|
| background / foreground | the page, and the text on it | already existed |
| surface | a control or card sitting on the page | equal to the page in light, lifted in dark |
| border | the rule between things | `black/10 dark:white/15`, 24 hand-written spellings |
| muted | hint and help text | `opacity-70` |
| subtle | the quieter weight beneath it | `opacity-60` |
| danger | a refusal, an error, a destructive action | `red-600` in 34 places and `red-700` in 7 |
| success | a state GildOps itself reports as good — Setup ready, a connection live, a feature included; never a tenant's word (§7) | `emerald-*` literals inside `Badge` |
| accent / on-accent | emphasis, and the text on it — the primary button | `bg-foreground text-background` |
| accent-text | the accent used as *text*: a link, a focus ring | nothing; there was no link colour |
| hover | a neutral control or menu item under the pointer — the sidebar's own tint | `bg-muted` (a 70% black text role), `black/5`, `accent` |
| selected | the current / pressed / open neutral state, one step stronger than hover | `bg-muted` again |

**Interaction states.** Neutral default is transparent or surface; neutral hover is `hover`;
selected, pressed and open (`aria-pressed`, `aria-expanded`, `data-open`) is `selected`;
focus-visible is `FOCUS_RING`, independent of hover; primary keeps its own `accent/80` hover and
never takes `hover`; destructive keeps `danger`; disabled is `opacity-50` with no hover. They live
in the shared variants (`Button`, `DropdownMenuItem`, `TableRow`, `Calendar`), and a screen writes
none. `muted` is text and is never a background. A container shades on hover only when the whole
of it is the action: a table row or card that merely holds links does not.

**A static fill is a surface, never `muted`.** `muted` is a text role and is not a background at
any opacity. A quiet non-interactive fill (a table footer, a chat bubble, an avatar, a skeleton)
uses `secondary`; a track or a handle uses `border`. Neither is `hover` or `selected`, which mean
"under the pointer" and "current". `screen-grammar.test.ts` fails on `bg-muted` anywhere in the
workspace or the shared UI.

**Two muted levels rather than one**, because the screens were already making that distinction by
hand and flattening it would have been a design decision disguised as a cleanup. `danger` went
the other way: two reds nobody chose became one role.

Two rules about them.

**A control reads a variable, never a literal.** This is what makes a per-tenant theme a question
of where values come from rather than a second pass over every control — and that promise was
collected: the theme is **built** (D23, amended; `20260904000002`), and not one control changed
to get it. `BrandStyle` overrides the last three roles above on the shell and on both public
surfaces, and everything else on this page stays the platform's.

**The last three are the only ones a tenant may set, and the split is deliberate.** They default
to the platform's own look — `--accent` resolves to `--foreground` and `--on-accent` to
`--background` — so a business that has chosen nothing renders exactly what this application
rendered before brands existed. The first six are never a tenant's: a business overriding its own
page background can make its own text vanish, and a tenant recolouring what a *refusal* looks
like is §7's mistake wearing a brand. What a business gets is its colour, wherever this
application was already drawing emphasis.

**A tenant's colour is never used as written where it is used as text.** `--accent` is the colour
as chosen and is only ever a background under a foreground picked by measurement; `--accent-text`
is that colour moved in lightness until it reads on the page. Both come from
`lib/domain/branding/palette.ts` and nothing else may derive one — there is one contrast
calculation for the reason there is one price calculation.

**No role is named for a tenant's meaning.** No `complete`, no `pending`, no `overdue`. Those are
statuses, the tenant owns them, and §7 is why. `danger` and `success` are the exception because they
are *GildOps'* facts — a refusal, a connection that is live — and neither is a tenant-settable role.

---

## 4. The control set

Built in three layers. `packages/ui` owns generic source-owned primitives. `apps/web/components`
owns shared GildOps application components and chrome. `apps/web/features` owns product-capability
UI. Promotion into a generic layer is decided by whether a responsibility is a stable cross-feature
application contract — call-site count is evidence that an abstraction may be useful, not the
ownership rule. A feature may use a `packages/ui` primitive directly when it genuinely needs
low-level composition and no shared application semantic already covers it; that is not a gap to
be wrapped, it is the intended shape of layer 4.

| Control | File |
|---|---|
| `Button` · `ButtonLink` — four tones, three sizes | `controls/button.tsx` |
| `TextInput` · `SelectInput` · `TextArea` | `controls/inputs.tsx` |
| `FieldLabel` · `Hint` · `ErrorText` | `controls/inputs.tsx` |
| `Section` · `SectionHeading` · `PageHeading` · `GroupHeading` | `surfaces/section.tsx` |
| `PageHeader` · `RecordHeader` | `headers/page-header.tsx` · `headers/record-header.tsx` |
| `DividedList` · `EmptyState` | `surfaces/section.tsx` |
| `DataTable` — responsive; `TableScroll` · `TableHeaderCell` · `TableCell` | `display/table.tsx` |
| `Card` · `Disclosure` | `surfaces/card.tsx` |
| `Dialog` · `ConfirmSubmit` | `controls/confirm-submit.tsx` |
| `Badge` · `DefinitionList` · `Detail` · `Stat` · `StatRow` · `Toolbar` | `display/data.tsx` |
| `cx` | `class-names.ts` |

The operator and platform surfaces have converged on those layers. Dialog, Table, Badge, Card
and Sidebar primitives come from `@gold/ui`; composed controls retain the application behavior
that primitives intentionally do not own. `globals.css` aliases `--card`,
`--card-foreground` and `--muted-foreground` to GildOps' semantic roles, so the platform Card
does not carry an unthemed exception.

**What it replaced, measured before and after.** 23 local style constants across eight names —
`INPUT_CLASS` in ten files, then `INPUT`, `CELL`, `FIELD`, `BUTTON`, `SMALL_INPUT`,
`SELECT_CLASS`, `COORDINATE_INPUT` — are gone, along with every hand-written colour. The most
repeated class string in the application is now `mt-1`. Extraction had been attempted eight
separate times before this one stuck — each attempt looked like tidying up the file it was in,
which is the failure D23's last bullet describes.

**Spacing and layout stayed at the call site**, which is why `mt-1`, `flex-1` and `w-fit` are
still written out and should be. A control carries the rule, the type scale and the colour role.
It never carries a margin, because `mt-8` and `mt-10` were both in use and neither is wrong —
and never a width, because two width utilities on one element have no defined winner.

**The exception list is shorter than it was, and every entry now names a genuinely different
control rather than a file that had not been reached yet.**

- Three file inputs — a document, a logo — whose `file:` pseudo-element classes are a different
  control from a text field.
- `<input type="color">` and `<input type="date">`, on the brand form, the setup review and the
  schedule. Each is a picker the browser draws itself, and wrapping one in `TextInput` would put
  a border and padding around something that is already a control.
- One button on the booking page whose classes are chosen by a ternary per slot.
- `global-error.tsx`'s retry button (M11). The one screen with no access to the design system at
  all — it replaces the whole document on a root-layout failure, and Next does not load
  `globals.css` there, so every class name in `components/` would render unstyled.

**What left the list.** `create-business-form.tsx` spelled four controls by hand for a focus ring
the shared control lacked — this section named that as "a real gap" and it is now closed:
`inputs.tsx` carries the ring and the signup screen uses the set like everything else. Every
hand-written `rounded border border-border p-3` box became a `Card`, and the day controls on the
schedule became `ButtonLink`s.

**The acceptance test is an absence, and `milestone-m11.test.ts` is what re-runs it**: no file
under `app/` may spell a control by hand. The seven above are the whole of the exception list.

---

## 5. Interaction surfaces and layout patterns

Which surface fits a task depends on the task, the attention it demands, whether context should
stay visible, the focus model, available space, interaction complexity and accessibility — not a
fixed table of "X is always Y." The distinctions below are still real and worth keeping apart:

| Kind | Character |
|---|---|
| Inline disclosure | `Disclosure` — progressive reveal in place, no focus trap, nothing leaves the page |
| Non-modal supporting panel | `PageDrawer` — docks beside the page, takes no overlay or blur, moves focus in on open and returns it on close |
| Modal interaction | `Dialog` — traps focus, takes the page behind it out of the interaction |
| Full-page task | the route — complex forms, configuration, record detail |

`PageDrawer` (`components/panels/page-drawer.tsx`) is the current canonical non-modal application
panel — quick-create forms, catalogue editors and Configure panels — and it stacks, newest showing,
closes on Escape, and takes its width from the host. That makes it the default for a page-scoped
supporting interaction, not the only legal one: a different task with a different attention or
space requirement may reach for a different surface, and a route deciding to do so is a design
choice for that screen, not an architecture violation. Do not build a second drawer implementation
for the same job `PageDrawer` already does.

**The outermost container declares its width and not only its margins.** `mx-auto max-w-2xl`
centres a block and does nothing useful in a flex parent, where an automatic side margin absorbs
the free space instead of stretching the item and leaves the box as wide as its longest line.
Every `<main>` outside the operator shell is a direct flex child of `<body>`, so each carries
`w-full` as well; `layout.test.ts` reads the source and fails on one that does not, because jsdom
implements no layout and a test that rendered these pages would have seen nothing wrong. This is a
demonstrated correctness defect, not a style preference, and stays enforced.

**What this replaced was every create form rendering permanently at the bottom of its screen.** A
business with forty customers ended its customer list with a create form, so the answer to *what
is on this page* was whatever fitted above a thing used once a week. A form is now available and
opens in a focused sheet when requested, leaving the list as the stable page context.

---

## 5a. Tables, and what a row is for

**A table is a set of rows somebody scans and then does something to.** The application's lists
were a link and two lines of middle-dot-separated text, so what could be *done* with a row was
never on the row: it was on the page you reached by clicking, or in a form at the bottom. `actions`
is therefore a slot on `DataTable` rather than a column — a row action is tertiary by construction,
which is why §6's one-primary-per-screen rule is not in tension with it.

**`DataTable`'s contract: below `md` a table is a list of cards, never a horizontal scroll.** A
`overflow-x-auto` table on a phone puts the columns that matter off the right edge and asks the
reader to drag a grid sideways to find out what a number refers to, and that is why `DataTable`
chooses cards. This is `DataTable`'s pattern, not a universal law: a different information task —
a report someone scans column-by-column, a purpose-built comparison view — may legitimately choose
column reduction or horizontal scroll instead. §5a's own report table (below) is exactly that case.
Each card is the `primary` columns as a heading and
every other column as a label-and-value pair, so a value is never separated from the word that
says what it is. That is why `header` is required: on a phone it is not a heading, it is the label
on every single row.

Three column properties and no more. `numeric` right-aligns and sets `tabular-nums`, because money
in a ragged column cannot be compared at a glance. `emphasis: 'primary'` is the card's heading
line. `emphasis: 'secondary'` is dropped from the wide table and **kept in the card**, so the
phone shows more about each row rather than less — which is the difference between this and
hiding a column.

**A report is the other kind of table** — fixed columns, a totals row, nothing to do to any line —
and it uses `TableScroll` and the two cell components instead. Forcing it through `DataTable` would
mean an `actions` prop nobody passes and an `emphasis` on every column to say which one is a
heading.

**Sizing is by available space, not by breakpoint.** The boards and the schedule use
`repeat(auto-fill, minmax(…, 1fr))`, so a business with two vans gets two columns and one with
nine gets three, decided by the width there is rather than by a number somebody guessed.

---

## 5b. Collections, and the three navigations

**One word each.** A **Connection** is one organization's configured link to an outside system; a
**Connector** is a type of outside system GildOps supports; a **Provider** is infrastructure GildOps
itself operates. The tenant page is *Connections* (`/integrations`, the route unchanged); the
Platform page is *Connectors*; Providers stay their own page.

**Three navigation primitives, three questions, never one component.**

| Primitive | Changes | Is | Example |
|---|---|---|---|
| `ViewModeSwitcher` | How the same records are drawn | Client state, remembered per browser; toggle buttons, not tabs | Table / List / Grid |
| `ViewNav` | Which sibling subsurface is open | A URL each; links, never a client `Tabs` | Connected, Browse apps, Data sources, Imports |
| Section navigation | Where you are inside one long page | Stacked sections, with anchors only when a page is long enough to want them | General, Fields, Defaults |

No section-navigation component exists: nothing yet needs one, and none is built ahead of a page.

**Configure is contextual configuration for the surface being viewed, and is stacked.** Its parts
are vertical sections, not nested tabs, and it holds no miniature shell. Tabs are for mutually
exclusive sibling views, which is what `ViewNav` is for. Customers' Configure is stacked; Work's
Configure (`work-configuration.tsx`), Platform's family, plan and commercial pages, and the record
detail pages still use `Tabs` and move when their surface is next touched.

**`CollectionView` is the one primitive for a selectable presentation.** A page passes one
rendering per presentation it supports and is never asked for all of them; the choice is kept in
`localStorage` under one key per surface. Density (compact, comfortable) is a separate axis that
joins beside it — never a value of it. `DataTable`'s automatic cards below a container width stay
as they are. Settings is the first consumer (List, Grid); no other surface has been converted.

**What each collection may be.** Entity collections take a representation for how a person browses
them; ledgers, logs and analytical data stay tables, because a card per row throws away the
columns being compared. This is a guide for later slices, not a list of what is built.

| Collection | Presentations |
|---|---|
| Settings | list, grid |
| Customers | table, list, grid; board is the Pipeline view |
| Resources | table, list, grid |
| Locations | list, map (map is its own `ViewNav` view) |
| Assets | table, list, grid |
| Team members | table, list |
| Connections | list, grid |
| Platform Connectors | table, list, grid |
| Organizations (Platform) | table |
| Automations | list |
| AI | none built |
| Usage / metering | table only |
| Billing records | table only |
| Failures / logs | table only |
| Import runs | table only |
| Calls | table, list |

## 6. Action hierarchy

**One primary action per screen is a strong default, not a universal law.** The actual objective
is a clear hierarchy and no competing emphasis — most collection and record screens reach that with
one primary action and secondary/tertiary ones beneath it, and that remains the pattern to reach
for first. A task surface whose job genuinely requires several high-priority controls (an
operational canvas, a communication composer, a builder) is not in violation merely for having
more than one; the thing to avoid is two controls competing for the same emphasis with no way to
tell which matters more.

Destructive actions are confirmed when consequential (M11). `ConfirmSubmit` is the one shape: a
trigger that opens a `Dialog` rather than submitting, and a Confirm button inside it that submits
the original form through the native `form` attribute — used throughout the operator shell, and no
call site holds its own copy of the pattern.

**A row action is tertiary and sits outside this count.** Moving a job on, recording a meter
reading, setting a location's coordinates: each is one row's business rather than the screen's,
and §5a is why they are on the row at all. What the rule still forbids is two primary buttons
competing for the same page — which is what a create form permanently open at the bottom of a
list was, next to whatever the list itself offered.

---

## 7. Status, and why it is neutral

**The sharpest difference from the source, and the one most likely to be undone by somebody being
helpful.** The source fixes a nine-value vocabulary in a `STATUS_LABELS` constant and calls it
the single source. This platform cannot have that constant: `work_item_statuses` holds a `name`
the platform never translates and a `position`, with no `is_terminal` and no colour. A badge
cannot be coloured by what a status means, because the platform does not know what it means —
"Klaar" and "Awaiting parts" are the same shape of row.

**One neutral treatment, legible, the tenant's word rendered as written.** A colour becomes
possible when it is a column a tenant fills, added in the change where a screen reads it, and
never as a lookup keyed to English.

The tenant's own answers about meaning already exist and are deliberately narrow —
`releases_resource` and `marks_complete`, two questions rather than one flag. Neither is a
styling hook.

**`Badge` is where this rule lives, and the line it draws is about who owns the meaning.**
Tenant-authored statuses stay neutral: a work status, a customer stage, a role name is the
tenant's word and GildOps cannot know whether it is good. `tone="accent"` paints a badge in the
*tenant's* colour and says **this one** — who a job is assigned to, on a board somebody is
scanning — never *this one is good*. **GildOps-owned facts may carry a tone**, because GildOps defined
them and knows what they mean: Setup's *Ready* is `success`, a provider connection that failed is
`danger`, a Plan feature that is included is `success`. The tell that the rule has been broken is
still a lookup keyed to an English word a tenant wrote. Both tones are central roles in
`globals.css` (`--success`, `--danger`), consumed by `Badge`; neither is one of the three a tenant
may set, and no screen spells either as a palette literal. Known exception: the automation
rule-review *warning* (`features/automations/review/`) still uses an amber literal inside its own
feature — there is no warning role, and adding one is a design decision, not cleanup.

---

## 8. The words on screen

**Public routes fail publicly; authenticated routes fail inside an authenticated frame.** The root
`not-found.tsx` is the public/marketing 404 and stays so — Next renders it for any address that
matches no route, outside every segment layout, so a segment that wants a frame must own a catch-all
page that throws `notFound()` from inside its layout. Three do: `[organizationId]/[...unmatched]`
(the real organization shell surrounds the missing page), `[organizationId]/platform/[...unmatched]` (Platform
context is kept) and `settings/[[...unmatched]]` (Personal settings renders its own shell, since no
layout above it does). What may be drawn depends on what is proven. **A proven membership** (the
layout rendered) keeps its shell. **An organization that cannot be proven** — missing and not-yours
are one answer — gets `GlobalFallbackShell`: the person's own context (switcher, account menu) and
nothing about the requested business, never its name, brand, areas or existence. The frame is built
without ever receiving the requested id, so it cannot decorate the lobby as the room. Every
fallback is one heading, one sentence and one recovery (`FallbackPage`); the recovery is the
validated landing a sign-in uses, named for what it does (*Return to workspace*), never a list of
businesses.

**An empty state describes the truth and may offer concise, honest guidance toward the next
available step.** *No customers yet.* states the fact. Contextual next-step copy is valid UX where
it helps — the doctrine that all empty-state guidance is "advice the platform has no standing to
give" is retired: it blocked ordinary, useful copy at the architecture level. What remains
refused is misleading advice, unnecessary verbosity, a manipulative call to action, and duplicating
an always-visible primary action without reason — a page whose header already offers *New
customer* does not need the identical control repeated inside the empty state for no reason. The
richer `EmptyState` implementation this enables is a Pattern/default question for a later slice
(Application States), not something this document's architecture layer decides.

**Collection-style screens often compose page header, local view navigation, toolbar and content,
in that order, because that composition matches a common browse/filter/act task.** That is a
pattern worth defaulting to for a browse screen, not a universal screen grammar every page must
obey — a record, a dashboard, an operational canvas, a communication workspace, a builder, a
configuration screen or a wizard each has a different task and may compose differently. Where the
pattern is used: *Page header* carries identity and the page's actions (Configure, create, import),
with one primary. *Local view navigation* (`ViewNav`) holds sibling views of the same workspace as
URLs (Customers' List and Pipeline, Team's Members, Invitations and Roles) and nothing else — never
disguised as an action or stood beside one. *Toolbar* holds search, filter and sort. *Content* is
the table, cards or empty state. A naked underlined link belongs in none of the first three;
navigation between siblings is the second, and an operation is a `Button`/`ButtonLink` in the first
or third. Tables have one grammar: column headers at reading size in full-strength text, cells
centred on the row so a control and the text beside it share a line, and no hover on a row that is
not itself the action.

**Strings describing application state stay in code**: "Loading", "No results", aria labels, and
the sentences `outstandingModuleSetup` produces about what a deployment cannot do.

**Strings a business would make about itself are configuration**, and the public surfaces are
scanned for them — `public-profile.test.ts` reads the source of `app/(public)/` and fails on a
platform sentence appearing there. A business that has configured nothing renders its own name
and stops.

An empty state sits on that line: the fact of the state belongs to the first category, and concise
next-step guidance is now permitted alongside it under the rule above.

---

## 9. Control-plane placement

Platform Context owns catalogue, Product/Module/Feature definitions, Plans, Add-ons, provider
capability inventory, platform-managed bindings, rates, health, drift, usage/cost and
organization-level Subscription inspection. Organization Context owns BusinessOS, Product
settings, tenant-owned provider connections where supported, usage/allowance visibility and the
business's own Financial Operations.

A person who has both contexts uses the context switcher; neither sidebar absorbs the other's
nouns. Product settings are grouped under the Product they configure even when the permanent
tenant navigation links to a smaller set of daily operating areas.

Record surfaces preserve the current asymmetry honestly: Customer, Work Item, Location and Asset
all expose a History section built on the same `ActivityList`; custom field editing is still
surfaced only for Customer and Work Item, and Resource has no domain-level document relationship.
Location and Asset's own timeline readers (`listLocationTimeline`/`listAssetTimeline`) admit only
what the underlying events truthfully snapshot — a job's *current* location or asset is never
joined in, since both are mutable and a current-state join would misattribute history (I8). These
gaps belong to Product work, not new generic controls.

### 9a. The platform provider workspace

`/platform/providers` is a list, not a settings table: each row says whether the provider is
operational and why not, how many organizations depend on it, and how many are failing. A provider
opens a detail workspace only when it has an account model to operate. Twilio's is its own
bespoke workspace (subaccounts, organizations bound beneath it); OpenAI, Anthropic and Google share
one generic account workspace (`GENERIC_ACCOUNT_PROVIDER_KEYS`) with no subaccount or organization
binding — a label, a credential, verification and default status, nothing else. A provider with
neither model gets the plain services-only page.

Twilio's Configure renders `TwilioConfiguration`, and so does its full route
`/platform/providers/twilio/configure`; the generic providers render `ProviderConfiguration` the
same way. Either shape has one set of fields, actions and validation regardless of whether it is
reached from the drawer or the full route. A credential field is write-only and says whether a
value is stored. Disabling an account is confirmed in place and says what it does not touch. A
tenant never sees any of this: it sees phone numbers, routing and recording in its own workspace.

## 10. What this document does not decide

- **The marketing surface.** The tenant site/revision editor, preview and publishing foundation
  exists. Hostname resolution, custom domains, governed media, additional/legal pages and public
  attribution remain active roadmap work. Per-tenant application theming is already built and
  is a separate concern.
- **A component-naming convention.** Refused by D23 under D8's never-write list. Name the file
  after the control.
- **Any value.** See the opening.
- **Desktop packaging.** M10 decides Electron and device integrations. `packages/ui` is already
  extracted and shared; no UI fork is authorized.
- **Exact component order, exact Tailwind classes, or one universal page composition.** Unless a
  section above names something a hard invariant or product contract, it is a pattern/default and
  a screen may compose differently when its task calls for it.
- **Whether every local view looks like tabs, or every table transforms identically.** `ViewNav`'s
  contract is URL-backed sibling navigation, not one visual placement; `DataTable`'s card
  transform is its own contract, not every table's.
- **Whether every action belongs in the same visual region**, or future screen archetypes (record,
  dashboard, operational canvas, communication workspace, builder, configuration, wizard/lifecycle)
  not yet built here.
- **Arbitrary decorative markup.** Not everything under `app/` needs a rule; most of it needs none.

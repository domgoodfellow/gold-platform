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

Six. The two authenticated workspaces share shell and Sidebar infrastructure but deliberately
do not share a navigation model. That is the reason this file exists rather than another
paragraph in D23.

| Surface | Whose it is | Navigation | Where |
|---|---|---|---|
| GOLD's front page | a stranger | GOLD's own header and footer (`SiteShell`) | `app/(marketing)/` |
| Operator shell | a business's own staff | full IA, three renderings (§2) | `app/organizations/[organizationId]/` |
| Public booking | a stranger with no account | none — one linear flow | `app/(public)/book/[slug]/` |
| Customer portal | one customer of one business | none — a single page of their own things | `app/(public)/portal/[token]/` |
| Platform tools | GOLD staff operating from the GOLD Internal workspace | Platform section inside the ordinary GOLD sidebar | `app/organizations/[organizationId]/platform/` (only for GOLD's own organization) |
| Auth | anybody | GOLD's own header and footer (`SiteShell`) | `app/(auth)/` |

Three consequences that are easy to undo.

**The operator shell has one workspace frame.** The tenant model comes from
`lib/navigation.ts`; the global Platform section comes from
`lib/platform-navigation.ts` and appears only for platform staff inside GOLD
Internal. Public, portal and auth surfaces remain flows or single-purpose pages. A customer must
never meet a business-configuration concept or a Platform section.

**Settings has two scopes, and they share a presentation without sharing ownership.** *Personal
settings* (`/settings/account`: Profile, Security & sign-in) is the signed-in person's identity —
their email and password belong to them, so no business's Settings ever holds them (D45).
*Organization settings* (`/organizations/{id}/settings`) is the selected business's. Both render
through `WorkspaceShell` and `SettingsPageFrame`, and each says whose it is in its own description.
The account menu offers *Personal settings* and *Sign out* (switching is the context switcher's); it carries the
business being left as `?org=`, which the page honours only for a business the caller belongs to,
so Personal settings can offer *Back to* it. `/account` redirects here and has no page. Nothing
organization-owned is listed in the Personal sidebar to fill it. Addresses:
`lib/route/personal-settings.ts`.

**`SiteShell` is GOLD's chrome and belongs on GOLD's pages only** — the front page and the four
credential screens, which is why those two rows share a description above. It is a header saying
GOLD and a footer saying GOLD, and on `/book/{slug}` or `/portal/{token}` that would be our
wordmark on somebody else's shop front. D20 keeps the platform out of a tenant's frame entirely,
and `public-profile.test.ts` now fails the build on a `SiteShell` anywhere under `app/(public)/` —
the structural form of the sentence rule the rest of that suite enforces.

**Platform pages never enter tenant `navigation.ts`.** Platform Overview, Organizations,
Products, Modules, Meters, Pricing, Providers and Failures are a separate IA because they govern
GOLD itself, not one business. Both models render through the shared `AppShell` and shadcn
Sidebar primitives — and, since the shell/context correction, through the shared
`WorkspaceShell`/`WorkspaceRightRail` too (`apps/web/components/containers/workspace-shell.tsx`):
two independent panels — Agent, and the page-support rail that Activity, Insights, Configure and every create/edit form
open into — neither modal. Both dock beside the page from 1720px; from 1280px one docks, the one
opened last; between that and 768px one floats over the page from the right; below 768px one
floats from the bottom. Nothing dims or blurs the page behind them. **Workspace-global tools align
to workspace chrome; page-local tools align to page chrome.** Agent runs the full height and its
header is the workspace header's band; the page drawer starts beneath that band, and its title row
lines up with the page's `<h1>`. Every measurement is in `workspace-geometry.ts` — no route sets a
margin to get there. Both
shells also share `WorkspaceHeader` (`apps/web/components/containers/workspace-header.tsx`), the
sticky *global* bar, and `PageHeader` (`components/containers/page-header.tsx`), the page's own
identity and actions — §2a says which owns what. Agent itself is scope-bound rather than shared
data: `TenantAgentRail` answers with
one business's own rows under the caller's RLS; `PlatformAgentRail` takes no organization id at
all and never runs "inside" a tenant, GOLD's own included — a selected organization may appear as
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
| Phone | bottom bar, fixed, scrolls sideways; leads with the current context | single column | sheets, sticky action bars | built |
| Tablet | rail, icon-only | two column | sheets or dialogs | built |
| Desktop | persistent sidebar | denser tables | dialogs | built |

**The sidebar is the desktop rendering of the IA, never its source.** Both renderings map the
same `AREAS`; two lists that had to agree eventually would not.

**One shell, projected.** Organization context is the normal operating context. Every renderer —
the desktop sidebar, its collapsed rail, the tablet rail, the phone bar and its More menu, the
Settings map — draws the sections `projectShell` (`lib/shell.ts`) resolves from four independent
facts: the organization's entitlements, the member's capabilities, whether the organization is
GOLD's own, and the member's platform permissions. The sections are Home, **Workspaces**
(each a Gild Product with a real surface — a workspace with several pages holds them beneath it,
so Gild Field opens onto Overview, Work, Schedule, Resources, Locations and Assets rather than six
rows beside Customers), **Shared** (what every Product reuses: Insights), **Business**
(administration of the current organization: Team, Connections, Plan & usage, Settings) and
**Platform** — only inside GOLD and only with a platform permission — last; a
section with nothing in it is not drawn. Account, a person's own settings, is none of these and sits
in the header's account menu. No renderer names a capability, a module or
a role, and none is a second authorization system — hiding an item is courtesy and every page,
domain function and policy behind it still refuses (I12).

**Entitlement and permission are separate, and both are required.** A business without
Communications has no calling workspace for its owner; a member without `call.place` does not
operate calling in a business that has it. Business is likewise one item at a time by the
authority for that item — Team by `role.manage`, Connections by `integration.manage` (and the
product), Plan & usage by `billing.manage`, Settings when anything at all is configurable by that
member — never a section a role has or lacks. **Configuring is not operating**: a Settings entry is
a `ConfigTarget` that borrows a workspace's entitlement and declares its own configuration
permission, so `field.manage` reaches call outcomes without `call.place`. Setup is kernel;
Agent-assisted drafting is an optional section inside it.

**Platform is a sub-scope of GOLD's own organization** (D60). There are three scopes — a person
(`/settings/account`), an organization (`/organizations/{id}`) and Platform
(`/organizations/{goldId}/platform`) — and the address says which one somebody is working in; it
says nothing about who owns the records on the page. Providers, catalogue and billing stay
platform-scoped whatever the address. `PLATFORM_DESTINATIONS` is the one registry of its
destinations, what each takes (`platform_staff.capabilities`) and how the sidebar nests them:
Catalog holds Plans & Add-ons, Meters and Connectors, Commercial holds Pricing and Billing, and
Infrastructure holds Providers and Failures. Platform is a section beneath GOLD's own workspaces,
never a replacement for them, and while somebody is inside it every group is open. A GOLD
salesperson sees GOLD as any business and no Platform; a limited operator sees only the
destinations their row names; nobody sees Platform beside a customer's business. The context
switcher answers one question — *which organization am I operating?* — and offers no Platform
entry, because inside Platform the answer is still GOLD.

**A Plan, a Product, a workspace and a page are four different things.** A Plan or Add-on grants
capabilities; a Product groups the customer-facing capability; a workspace is where an operator
uses it; a page is one task inside that workspace. Only the last two are navigation, and nothing in
the sidebar is named for a Plan.

**The phone bar is Home, the first workspaces and More.** Frequent work is in the bar
(`projectPhone`); everything else — the remaining workspace pages, Shared, Business and
Platform — is behind **More**, a sheet grouped as the sidebar is. It is a rendering choice over the
same projection, so the bar and More together are exactly what the desktop shows. The sidebar
trigger is hidden below `md` because the bottom bar is the phone's navigation.

**Sections, ruled apart, in `AREA_GROUPS` order** — Home, Workspaces, Shared, Business and
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
| Workspaces | Gild Sales (Customers, Pipeline), Gild Comms (Calls), Gild Automations (Rules, Messages, Activity), Gild Field (Overview, Work, Schedule, Resources, Locations, Assets) | Where an operator uses a Product. One real page is a plain row; several are an expandable one; a Product with no surface has no row |
| Shared | Insights | Cross-Product analytics over the one reporting aggregate; not a Product |
| (Settings) | Settings | Where the business is configured — set apart by the rule above it |

**The operating model.** An organization is *Home*, its *workspaces*, and *Settings*. A workspace
is a place somebody works and follows one contract: an **Overview**, its primary views, an
**Activity** read, a few contextual **Insights**, and **Configure**. Not every workspace has every
part as a page; a part with no honest source is left out and not faked. *Insights* is also a
workspace of its own — the deep, cross-workspace one: `/insights` is saved dashboards and
`/insights/reports` the report builder. A workspace's Insights rail is a handful of numbers with a
link into it; the report builder never sits in a rail. *Agent* is the workspace-global assistant
rail, and is none of these.

**Workspaces are the Gild Products; they are not Plans or SKUs.** A row is where an operator uses
one of the nine registered workspaces (D66) — Sales, Service, Comms, Finance, AI, Automations, Field,
Studio, Insights — and only those with a real surface get one. A Plan grants Features that may compose into
several rows, and there is no row per SKU (D25, D46). **One grain per navigation:** a sidebar
child is a major page of a Product, and a `ViewNav` is for views inside one page; the same three
names are never both. **A dropdown holds only real, reachable pages** — never *coming soon*.
GildOps is the company, Gild Platform the control plane (D60), Gild Admin organization
administration, and Home the cross-workspace cockpit, and the Agent shell and page-support rail shared shell: none
of them is a workspace.

**Where each concern lives.**

| Boundary | Rule |
|---|---|
| Customers / Communications | Customers owns the relationship — the record, the stage, the follow-up. Communications owns the channel — a call, a conversation, a message. A call appears on a customer's timeline; it is not a customer field |
| Work / Schedule | Work owns what is to be done. Schedule alone owns when a resource can commit to it, and is the one engine that says what is free. Neither is a view of the other |
| Financials / GOLD platform economics | Financials is the business's own price book, quotes, invoices, payments and costs. GOLD's Plans, subscription pricing, provider COGS, tenant economics, margin and forecasting stay in Platform Administration. Two money directions, never one screen |
| Website & Portal / Communications | Website & Portal is what a customer meets before and outside a conversation — website, booking, forms, portal, brand. Communications is the conversation itself |
| Library | Documents are shared organization resources, not a sub-feature of Customers, Work or Financials; a document may be linked to a customer, job, asset or invoice without being owned by it. Templates and Knowledge are Library's only when a real shared collection exists; automation message templates and checklist templates stay with their owning domain |
| Service / pricing / scheduling | A Service (Offering) is the reusable definition of what the business does; a Work Item is one instance; the Price Book prices it; Scheduling says when resources can commit; a Quote or Invoice is the snapshotted result for one transaction. A Service may later supply estimated duration, resource requirements, a pricing rule, a checklist, bookability and a service-specific buffer. `buffer_minutes` remains a scheduling policy, and travel time is a separate, future scheduling input from locations and routes — never the same thing as a fixed buffer |

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
that works whether or not the person already has a GOLD account — the two remain the domain
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

**The sidebar is not there at all on a phone.** It used to be, which put the business's identity
and the shell's own actions in a band above every screen while the same areas sat in the bar at
the bottom — two pieces of chrome and one duplicated list before any content. Below `md` the
areas are the bottom bar and everything else is the header, so `AppShell` hides the column
outright. The phone bar is `fixed`, and `display: none` on an ancestor takes a fixed descendant
with it, so that bar is a sibling of the sidebar rather than a second `<nav>` inside it —
`OrgNavBar` beside `OrgNav`, both mapping the one `AREAS` list.

---

## 2a. The header

**Two layers, and they answer different questions.** The sticky `WorkspaceHeader` answers *which
application, and where in it* (the breadcrumb trail) and holds global utilities. The `PageHeader` inside the page answers *which
page or record am I on* and holds that page's controls. They were one bar once, which put
*Resources*, *Add resource* and *Configure* — all about one page — on the same row as *Agent*,
which is about the workspace. A control belongs to the layer whose scope it has.

**`WorkspaceHeader` — global, sticky.** It carries its own background: the page moves underneath
it, and a transparent bar shows rows sliding through the text. It holds the breadcrumb trail and
no title, status or page action. The page writes the trail (`PageHeader`'s `crumbs`) and it
renders here, through a slot, so a page never draws its own.

| | What | Which widths |
|---|---|---|
| Left | the sidebar trigger | `md` and up in the organization shell (which Platform renders inside), where a phone gets the bottom bar instead; every width in Personal settings and the fallback frame, whose only phone navigation is the sidebar sheet |
| Left | the compact context switcher — the business's mark and name, opening the same menu the sidebar's own switcher does — nothing about Setup lives in this header at any width | below `md` only, in the organization shell — the sidebar says it above that |
| Left, after the above | the breadcrumb trail — ancestors only, on a page that passes `crumbs` | all |
| Right, before Agent | account menu | below `md`; desktop account controls live in the sidebar footer |
| Right, furthest | Agent | all — always the last control in the row |

**`PageHeader` — the page's identity, inside its `AppPage`.** The page's single `<h1>`, an optional description and metadata line, and the page's actions at the
right (wrapping below the title on a narrow screen). It shares the canvas the content below it
sits on; `AppPage` still owns width. It is a Server Component and knows no domain: a page hands it
whatever actions it offers. **One primary action per page**, then secondary ones — Resources is
*Add resource* with *Configure* beside it, and the empty state does not repeat it (§8).

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
heading both — an area's root page reads it with `areaLabel(segment)` instead of writing it again.
A detail route is *in* an area and not *at* it, so it writes its own title (a job's title is a
tenant's words) and passes the way back as `PageHeader` crumbs; `RecordHeader` keeps its older
props and renders the same `PageHeader`. Every page renders exactly one page identity.

**Context switching belongs to the context switcher, and only to it.** One identity, zero or
more memberships, and one current context. The menu's header is the current context and its list
is *where else*: the other businesses, each linking straight to that business's own lifecycle
entry. Platform is not an organization and is not listed; inside Platform the current context
is GOLD. With nowhere else to go it is a label, not an empty menu. There is no directory page: `/organizations` only lands a sign-in (the business last
worked in, else the first) and founds a first business, and the old `?all=1` request is ignored.
It does not manufacture a list or creation action without a server read behind it. **Sign out belongs to the account menu**, in the sidebar footer on desktop and in
the compact header menu on a phone. Neither is an operating action or permanent page-header
command.

**GOLD staff operate GOLD through its ordinary organization workspace when they are real members
of it.** The current `gold_internal` base Plan identifies that workspace, never its name. Platform
Administration is a sub-scope of that same organization (D60), reached from the Platform section of
its sidebar, not from the switcher. Neither authority substitutes for the other. On a phone the bar
presents Platform while the address is inside it — a way back to Home and the Platform
destinations, with the pages under Catalog, Commercial and Infrastructure and GOLD's own workspaces
behind More — and the business's own places otherwise.

**The application canvas has three modes.** `AppPage` owns `fluid` (the default), `form` and
`reading`. Operational and collection pages are `fluid`: header, local navigation, toolbar and
content are children of one `AppPage` and share its left and right edge, and an open support rail or drawer narrows the workspace rather than changing the page. `form` and `reading` are the
deliberate, bounded, centred layouts for one focused task. No page writes a `max-w-*` of its own.

**The support modes are always the last page actions, in one order.** `PageHeader` renders
Activity, Insights, then Configure, after `actions`; `SupportTrigger` is placed nowhere else.
Resources reads *Add resource, Configure*; Customers reads *Import, New customer, Activity,
Insights, Configure*. Agent stays in the workspace header.

**A drawer's chrome is one compact band** (`DRAWER_HEADER` in `workspace-geometry.ts`), the same
for Configure and every create or edit form.

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
| The transcript is `Message`, `Bubble`, `Marker` inside `MessageScroller` | The shadcn chat set in `@gold/ui`, adapted to GOLD roles: no avatars, reactions, delivery states or regeneration, no `bg-muted`, no demo blue |
| A `Marker` is a concise, non-speech note | *Thinking…*, *Checked 14 records*, *Tool refused*, *Action completed*, *Action failed*. Never a list of tool calls — `run-events.ts` is the one place that decides what is worth a line |
| A proposed action sits directly beneath the response it belongs to | Two shared Buttons, **Decline** and **Approve**. Nothing happens until somebody presses Approve, and then the domain layer does it under their own session (D34) |
| Enter sends, Shift+Enter adds a line, the field grows to a bound | The bound is `COMPOSER_MAX_HEIGHT`; past it the field scrolls inside itself, and the composer never pushes the transcript off screen |
| Context is inspection, not configuration | A popover listing what the next turn is given, using only facts GOLD has: the business, the workspace, the record open on the page, the business's time zone. It follows navigation. A row for something that does not exist (an attachment, a connected source the loop does not read) is not drawn |
| Configure is runtime only | Today one control has a behaviour behind it — whether the open record is named — and a link to *Connections & permissions* for those who may manage them. Durable settings stay in Settings and Platform; a control is added the day something honours it, never before |
| The paperclip attaches text, Markdown, CSV and JSON, up to three files of 1 MB | It is on the left of the toolbar, before Context and Configure, and it exists because the whole path does: choose, upload privately, a card with its state, sent with the question, kept with it, shown again when the conversation is reopened. Anything the Agent cannot read (a PDF, an image) is refused with a sentence saying so, never accepted and ignored |
| Attached files are cards above the textarea, and again beside the question they were sent with | `Attachment` on GOLD roles. They wrap rather than scroll, so at 320px none is hidden; each shows *Uploading…*, *CSV · 12 KB* or the reason it failed, and can be cancelled or removed until the question is sent. Send waits for an upload in flight |
| Popovers never outgrow the rail | `max-w-(--radix-popover-content-available-width)` and collision padding, opening above the composer, so the whole composition holds at the rail's 320px minimum and on a phone |
| Neither popover shows a secret or GOLD's economics | The same rule as every tenant screen (D45) |

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
| success | a state GOLD itself reports as good — Setup ready, a connection live, a feature included; never a tenant's word (§7) | `emerald-*` literals inside `Badge` |
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
are *GOLD's* facts — a refusal, a connection that is live — and neither is a tenant-settable role.

---

## 4. The control set

Built in three deliberate layers. `packages/ui` owns generic shadcn primitives.
`apps/web/components` owns generic composed application controls and containers.
`apps/web/features` owns product-capability UI. A repeated product concept does not move into
the generic layers merely because it has multiple call sites.

| Control | File | Call sites |
|---|---|---|
| `Button` · `ButtonLink` — four tones, three sizes | `controls/button.tsx` | 88 · 4 |
| `TextInput` · `SelectInput` · `TextArea` | `controls/inputs.tsx` | 92 · 31 · 5 |
| `FieldLabel` · `Hint` · `ErrorText` | `controls/inputs.tsx` | 10 · 113 · 50 |
| `Section` · `SectionHeading` · `PageHeading` · `GroupHeading` | `containers/section.tsx` | 35 · 53 · 8 · 5 |
| `PageHeader` · `RecordHeader` | `containers/page-header.tsx` · `containers/record-header.tsx` | every operator page — see §2a |
| `DividedList` · `EmptyState` | `containers/section.tsx` | 31 · 37 |
| `DataTable` — responsive; `TableScroll` · `TableHeaderCell` · `TableCell` | `display/table.tsx` | the lists and the reports |
| `Card` · `Disclosure` | `containers/card.tsx` | the boards and every create form |
| `Dialog` · `ConfirmSubmit` | `containers/dialog.tsx` | 10, every destructive action in the operator shell |
| `Badge` · `DefinitionList` · `Detail` · `Stat` · `StatRow` · `Toolbar` | `display/data.tsx` | the detail screens |
| `cx` | `class-names.ts` | the others |

The operator and platform surfaces have converged on those layers. Dialog, Table, Badge, Card
and Sidebar primitives come from `@gold/ui`; composed controls retain the application behavior
that primitives intentionally do not own. `globals.css` aliases `--card`,
`--card-foreground` and `--muted-foreground` to GOLD's semantic roles, so the platform Card
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

## 5. Containers

Not every interaction is a dialog.

| Use | For | Built as |
|---|---|---|
| Cards | lists of jobs, customers, resources, invoices | `Card` |
| Page drawers | filters, quick actions, status changes, small forms, and inspecting one record from a browse list | `PageDrawer` (`components/containers/page-drawer.tsx`) |
| Full screens | complex forms, configuration, job and customer detail | the route |
| Dialogs | confirmation, and destructive actions only | `Dialog` · `ConfirmSubmit` |

**One drawer implementation.** Organization quick-create forms, platform catalogue editors and
every Configure panel use `PageDrawer`. It is not modal: it takes no overlay, no blur and no focus
trap, docks full height beside the page, and takes its width from the host, never from the form
that opened it. It moves focus in on open, returns it on close, and closes on Escape. Drawers
stack, the newest showing. Use `Disclosure` for inline progressive disclosure, not as a drawer
substitute. Do not reintroduce the modal `Sheet` for page work, and do not introduce another
drawer pattern.

`OrgNav` refused a drawer on the
grounds that one "needs state, a toggle, a focus trap and an escape key to be correct", and the
same argument supports a single accessible sheet primitive for drawer interactions.

**What this replaced was every create form rendering permanently at the bottom of its screen.** A
business with forty customers ended its customer list with a create form, so the answer to *what
is on this page* was whatever fitted above a thing used once a week. A form is now available and
opens in a focused sheet when requested, leaving the list as the stable page context.

**The outermost container declares its width and not only its margins.** `mx-auto max-w-2xl`
centres a block and does nothing useful in a flex parent, where an automatic side margin absorbs
the free space instead of stretching the item and leaves the box as wide as its longest line.
Every `<main>` outside the operator shell is a direct flex child of `<body>`, so each carries
`w-full` as well; `layout.test.ts` reads the source and fails on one that does not, because jsdom
implements no layout and a test that rendered these pages would have seen nothing wrong.

---

## 5a. Tables, and what a row is for

**A table is a set of rows somebody scans and then does something to.** The application's lists
were a link and two lines of middle-dot-separated text, so what could be *done* with a row was
never on the row: it was on the page you reached by clicking, or in a form at the bottom. `actions`
is therefore a slot on `DataTable` rather than a column — a row action is tertiary by construction,
which is why §6's one-primary-per-screen rule is not in tension with it.

**Below `md` a table is a list of cards, never a horizontal scroll.** A `overflow-x-auto` table on
a phone puts the columns that matter off the right edge and asks the reader to drag a grid
sideways to find out what a number refers to. Each card is the `primary` columns as a heading and
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
**Connector** is a type of outside system GOLD supports; a **Provider** is infrastructure GOLD
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

**One primary action per screen**, secondary and tertiary beneath it.

Destructive actions are confirmed when consequential (M11). `ConfirmSubmit` is the one shape: a
trigger that opens a `Dialog` rather than submitting, and a Confirm button inside it that submits
the original form through the native `form` attribute — ten call sites across the operator shell
use it and none holds its own copy of the pattern.

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
tenant's word and GOLD cannot know whether it is good. `tone="accent"` paints a badge in the
*tenant's* colour and says **this one** — who a job is assigned to, on a board somebody is
scanning — never *this one is good*. **GOLD-owned facts may carry a tone**, because GOLD defined
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

**An empty collection explains state; it does not repeat the page's primary action.** *No customers
yet.* is state. A second *New customer* under a header that already offers one is the same control
twice, and *Add your first customer to get started* is advice the platform has no standing to
give. `EmptyState` and `DataTable` therefore carry no action at all — the prop was removed when its
last caller went. That holds for a page whose `PageHeader` creates the record (Customers, Team,
Resources, Locations, Assets) and for a drawer or view whose create control is always visible beside
the count (a Configure drawer's field list, Automations' rules and messages).

**Inside a page, four layers in one order.** *Page header* — identity and the page's actions
(Configure, create, import); one is primary. *Local view navigation* — sibling views of the same
workspace as URLs (`ViewNav`: Customers' List and Pipeline, Team's Members, Invitations and
Roles); it holds nothing but views and is never disguised as an action or stood beside one.
*Toolbar* — search, filter, sort. *Content* — the table, cards or empty state. A naked underlined
link belongs in none of the first three; navigation between siblings is the second, and an
operation is a `Button`/`ButtonLink` in the first or third. Tables have one grammar: column
headers at reading size in full-strength text, cells centred on the row so a control and the text
beside it share a line, and no hover on a row that is not itself the action.

**Strings describing application state stay in code**: "Loading", "No results", aria labels, and
the sentences `outstandingModuleSetup` produces about what a deployment cannot do.

**Strings a business would make about itself are configuration**, and the public surfaces are
scanned for them — `public-profile.test.ts` reads the source of `app/(public)/` and fails on a
platform sentence appearing there. A business that has configured nothing renders its own name
and stops.

An empty state sits on that line and belongs to the first category. *No customers yet* is
application state. *Add your first customer to get started* is advice the platform has no
standing to give.

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

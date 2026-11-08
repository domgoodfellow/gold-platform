# Application shell and navigation surfaces

Workspace and feature surface specifications. System-wide rules, including **Core rules**, are in [docs/ui-system.md](../ui-system.md). Before changing a surface here, check `docs/decisions/` for ADRs that name it.

## Sidebar destinations and configuration, by workspace

- **Marketing:** Campaigns, Audiences, Leads and Performance (`marketing.read` or `marketing.manage`; changes still need `marketing.manage`).
- **AI:** Agent activity and Evaluations, for any member. Agents, Channel deployments, Knowledge and Tools stay `organization.manage` configuration targets in AI's Configuration branch.
- **Finance:** Catalog & Pricing (the operating price book; `price.manage`, `work_item.price` or `organization.manage`), Quotes, Invoices, Payments and Financial reports (`report.read`), each behind the billing module. Finance has no Configuration row, Configure control or configuration landing: trading currency belongs to Organization Settings → General (Regional settings) and payment collection to Organization Settings → Customer payments (`settings/payments`, whose card section keeps the `#getting-paid` anchor), and Finance shows no platform link.
- **Communications:** Numbers and Configuration stay under Configure.
- **Work:** Dashboard, Work items, Schedule, Resources, Locations and Equipment & Assets as eligible. Work has no Configuration row: Work types & workflow open from Work items and Scheduling & hours from Schedule (each page's Configure control), and that page stays selected while its editor is open. `field/configuration` still redirects to the first editor the member may open.

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

## Workspace Configure doors

The control, the sidebar row and the breadcrumb are labelled "Settings", and each area's page title is "X settings" (Work Order 4, docs/ui-system.md → Words we use); routes and code names keep `configuration`.

No workspace has a settings landing page. Every other workspace Home reaches its configuration through `WorkspaceConfigure`, which renders `ConfigureMenu` over the doors `workspaceConfigureItems` grants the member: nothing, one link named for its page, or a Settings menu of direct links. Finance, Marketing and Automations register no doors, so their Homes show no Settings control and their sidebars no Settings row (Finance's price book is its Catalog & Pricing destination; currency is a General setting and payment collection is Settings → Customer payments). A door that configures one of its own workspace's destinations (`destination` in `CONFIG_TARGETS`: Work types → Work items, scheduling hours → Schedule, Support's Queues and Service levels) draws no Settings row; it is reached from that page's Settings control and the destination stays selected while it is open. Work therefore has no Settings row; another workspace may still link the same editor (Communications' Business hours). The Dialer offers only its calling doors (Calling & routing, Numbers & assignments). In the sidebar, a workspace's Settings row is a direct link when the member has one door, and otherwise a heading button that expands and collapses the doors; on the collapsed rail it opens the navigation with the group expanded. "Settings" is a plain-text ancestor in the breadcrumb, and the phone's Up control skips it. Work has no such level: its editors sit under the page they configure (Work items, Schedule), and Work pages name that parent with the business's own label for it. Each old `{home}/configuration` address (`sales`, `comms`, `support`, `field`, `finance`, `studio`, `ai`) redirects on the server to the first door the member may open, or shows not-found when there is none; `finance/configuration` instead redirects to Customer payments (General for a member who may not open it). A configuration-only member's workspace row opens that first door directly. Customers registers no Settings panel, and the Relationship pipeline links straight to Relationship stages for members who may open it.

## Agent rail

Below 768 px, Agent is a fullscreen native modal dialog, with the shared header-height band, safe-area padding and visual-viewport height/offset so its composer follows the visible viewport. The browser isolates background focus and interaction; nested Radix History and Context popovers portal inside the dialog. Menu closes before handing focus to Agent; closing Agent restores the visible Menu trigger. Escape dismisses a nested popup first, then Agent. Tablet (768–1279 px) keeps the right overlay; desktop (1280 px and above) keeps docking, resizing and persisted width, including the wide layout at 1720 px.

One dialog element and conversation subtree remain in place across layout changes and stay mounted after first opening. Native modal activation changes browser presentation without reparenting React content; lazy organization-keyed bootstrap, drafts, uploads, selections and pending actions remain with the existing controller. Page-support panels retain their separate nonmodal geometry. The permanent operator identity/scope banner is omitted; recoverable errors remain. Context is the one composer popover: it lists what the Agent sees, holds the one per-conversation control (include the open record) and, for people who manage the business, links to Agent settings in the AI workspace. There is no separate Configure and no model choice: GildOps chooses the model. Answers render as formatted text with Copy and Ask again beneath them, and a question in flight waits in an Agent bubble.

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

## Platform navigation and the business telephone

Platform uses its own authorized registry and shared responsive sidebar. The business switcher changes business context only. `NavigationActivityContext` carries only a retention hint from the persistent telephone owner. During an active call, cross-business and global personal Settings links open a separate tab. Ordinary same-organization configuration, General Settings and workspace navigation reuse the existing telephone runtime. This does not provide call continuation after reload or browser termination.

# Studio surfaces

Workspace and feature surface specifications. System-wide rules, including **Core rules**, are in [docs/ui-system.md](../ui-system.md). Before changing a surface here, check `docs/decisions/` for ADRs that name it.

## Studio as the creation context

Studio's responsibility is authoring and evaluating reusable systems — experiences (website, forms, customer portal, templates), agents and workflows — around a common lifecycle: create, experiment, evaluate, version, publish, observe. In the unified layout (ADR-056) Studio's sidebar gathers them: Overview (Studio Home), Experiences, the AI workspace's agent tools, the Automations workspace's workflow tools, Interface design for GildOps staff, and links to shared Settings. Studio is the authoring experience, not a new backend: agent drafts, published versions, tools, knowledge and deployments stay with AI; rules and runs stay with Automations (ADR-019, ADR-055); website and portal revisions keep their own publication contracts. Each tool keeps its route and breadcrumb, and only tools the member may open are listed.

Not built yet, and not shown: a unified Projects index across website, forms, portal, agents and workflows; shared versions, components and releases. A Projects index would read each owner's existing records and permissions; it must not become another store of them.

## Interface design

GildOps' own development tools, never a business's branding: Studio → Interface design → Navigation compares and previews the application's sidebar layouts (`docs/surfaces/shell.md` → *Unified navigation preview*). Reached only by GildOps staff with the interface-design platform permission in GildOps' own business; `organization.manage` grants nothing here.

## Website previews and editors

Every private picture of a website draws it through `ExperienceView`, the renderer the live site uses for that site's experience (`docs/public-web.md`, ADR-058), inside `components/display/preview-frame.tsx`: an isolated viewport at a reference width, scaled to its space and centred, whose document never scrolls. Public breakpoints and container queries follow the reference width, not the application's.

- **Visual previews** (website, page and section templates) open `components/display/preview-surface.tsx`: a full-screen dialog with the title, page list, Desktop/Tablet/Mobile widths, any action on the previewed thing and Close outside the rendered content, and the preview body scrolling vertically. Escape closes it and returns focus to the trigger; the collection keeps its filters and search; previewing creates nothing. The page drawer stays for forms beside the page and is not enlarged for previews.
- **The website editor's canvas** draws the working page at the chosen width, with selection outlines wrapped around each section; links inside do not navigate.
- Consumers still to move to the preview surface: the Customer portal editor's Preview drawer and historical revision drawer, the portal template preview under Templates, and form previews. The Interface design navigation preview stays an interactive frame by design.

Studio's website, form and portal editors share one workbench, `features/studio/editor-layout.tsx`: Structure | Canvas | Inspector. On a wide workbench the side panels are columns, resizable between their minimum and maximum by pointer or keyboard (arrows by 16px, Shift for 64px, Home/End, Enter collapses), each collapsible and restorable on its own, and Maximize gives the canvas the full width and restores the panels as they were; the workbench is one screen tall and each pane scrolls itself. Below 896px of workbench width the canvas fills the width, the page scrolls, and the same controls open the panels as page drawers. Widths and collapsed panels are remembered per editor in the browser. Editing state belongs to the editor, so resizing, collapsing, maximizing or changing layout never discards it.

The website toolbar names the working revision and its state, whether edits are unsaved or when the draft was saved, and which revision is published (and whether a GildOps release published it). A stale draft (`docs/public-web.md`) carries a persistent alert with the published revision one click away; Publish on a stale revision asks to replace the newer one by number. Discard draft asks first and says the draft stays in history. History lists every revision with the live and working ones marked, opens each as a private preview, and restores any other revision once no draft is open; `?panel=history` opens it from a link. The revision preview's banner names the revision, where it stands against the published one and, for GildOps' site, the build that drew it.

## Studio Home

Studio Home's website overview draws the published revision (or the working draft when nothing is published) as a thumbnail: its home page through the site's experience at a 1440px desktop width, one 900px screen tall, scaled to the panel, inert and without preview banner or editor controls, labelled with its state and revision, with Open preview and Open editor beside it. Review publishing & history opens the website with history open. A stale draft is a Needs attention item. Studio Home retains a contained website overview, four factual summaries, Forms/content, recent submissions, creation shortcuts and a supporting publishing/attention/public-surface/activity column even when empty. Public website links require both a ready managed hostname and a published revision. A published site can simultaneously have an unpublished working revision. Booking readiness consumes usable module access, published bookable types and a public slug; portal invitations remain in CRM and brand/public-address configuration remains in Organization Settings.

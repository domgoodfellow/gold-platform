# Studio surfaces

Workspace and feature surface specifications. System-wide rules, including **Core rules**, are in [docs/ui-system.md](../ui-system.md). Before changing a surface here, check `docs/decisions/` for ADRs that name it.

## Studio as the creation context

Studio's responsibility is authoring and evaluating reusable systems — experiences (website, forms, customer portal, templates), agents and workflows — around a common lifecycle: create, experiment, evaluate, version, publish, observe. In the unified layout (ADR-056) Studio's sidebar gathers them: Overview (Studio Home), Experiences, the AI workspace's agent tools, the Automations workspace's workflow tools, Interface design for GildOps staff, and links to shared Settings. Studio is the authoring experience, not a new backend: agent drafts, published versions, tools, knowledge and deployments stay with AI; rules and runs stay with Automations (ADR-019, ADR-055); website and portal revisions keep their own publication contracts. Each tool keeps its route and breadcrumb, and only tools the member may open are listed.

Not built yet, and not shown: a unified Projects index across website, forms, portal, agents and workflows; shared versions, components and releases. A Projects index would read each owner's existing records and permissions; it must not become another store of them.

## Interface design

GildOps' own development tools, never a business's branding: Studio → Interface design → Navigation compares and previews the application's sidebar layouts (`docs/surfaces/shell.md` → *Unified navigation preview*). Reached only by GildOps staff with the interface-design platform permission in GildOps' own business; `organization.manage` grants nothing here.

## Website previews and editors

Website template previews use `components/display/preview-frame.tsx` to render the canonical website sections in an isolated, scaled viewport. Public responsive breakpoints must follow the preview width rather than the application's width. Studio website and form editors share `features/studio/editor-layout.tsx`; secondary panes respond to the available editor container width and open as page drawers on compact layouts. Editing state remains in the workbench owner when a drawer closes.

## Studio Home

Studio Home retains a contained website overview, four factual summaries, Forms/content, recent submissions, creation shortcuts and a supporting publishing/attention/public-surface/activity column even when empty. Public website links require both a ready managed hostname and a published revision. A published site can simultaneously have an unpublished working revision. Booking readiness consumes usable module access, published bookable types and a public slug; portal invitations remain in CRM and brand/public-address configuration remains in Organization Settings.

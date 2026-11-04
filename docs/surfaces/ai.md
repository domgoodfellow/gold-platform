# AI surfaces

Workspace and feature surface specifications. System-wide rules, including **Core rules**, are in [docs/ui-system.md](../ui-system.md). Before changing a surface here, check `docs/decisions/` for ADRs that name it.

The AI Home route and workspace icon are stated with Support's in [support.md](support.md#support-home).

## AI Home

AI Home follows the dashboard reference with a compact action/filter toolbar, four exact KPI drilldowns, agent/deployment/activity previews and a contextual readiness, handoff and allowance rail. Empty panels retain useful actions; provider health, missing usage and unavailable runtimes are explicit. Local collection navigation stays inside the AI workspace context. Agent details use section navigation, a central draft editor and a readiness inspector; phones use a section selector and agent cards. Save checks draft concurrency, Publish creates an immutable version, and deployment version changes are deliberate. Unsaved editor changes survive section navigation and can be recovered after reload/back navigation from per-actor tab storage; recovery retains the original draft revision for conflict detection. Channel drawers never expose provider credentials. Knowledge sources are published websites; tests and evaluation verdicts are personal. Execution inspectors link to Communications rather than duplicating public transcripts. Visual targets and interaction evidence live in `docs/design/ai/`.

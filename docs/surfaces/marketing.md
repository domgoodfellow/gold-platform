# Marketing surfaces

Workspace and feature surface specifications. System-wide rules, including **Core rules**, are in [docs/ui-system.md](../ui-system.md). Before changing a surface here, check `docs/decisions/` for ADRs that name it.

The Marketing Home route and workspace icon are stated with Support's in [support.md](support.md#support-home).

## Marketing workspace

Marketing Home is a compact operational dashboard: four evidence-backed KPIs scoped by a labelled reporting period, Needs attention showing only categories with items (one sentence when there are none), Running campaigns (drafts awaiting setup are listed under Needs attention, not again), Acquisition in this period (trend and sources together, or one sentence before the first tracked submission), and a Status panel and a Recent activity panel shown only when there is activity. Navigation the sidebar already offers is not repeated as cards. Local Home/Campaigns/Audiences/Leads/Performance navigation preserves the business's contextual workspace sidebar. Campaign detail is deep-linkable; campaign and audience editors and inquiry review use shared PageDrawer primitives. Collection search, review/status/objective/owner/source filters, date bounds and pagination persist in the URL. Table overflow is contained within its panel at narrow widths. Activation expresses Marketing lifecycle, not delivery success. Campaign detail states, in its Delivery readiness panel, that sending promotional messages is not available yet, with no implementation detail.

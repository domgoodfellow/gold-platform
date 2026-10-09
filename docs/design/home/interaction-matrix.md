# Global Home reference and interaction contract

The generated [desktop composition](desktop-reference.png) and [13-state sheet](states-reference.png) guide geometry, hierarchy, density, agenda rows, contained attention, drawers and the supporting column. Their illustrative text, figures, navigation labels and health claims are not product data. Implementation uses the canonical GildOps tokens, nine flat workspace rows and genuine authorized projections.

| Clickable surface | Classification | Destination / behavior |
|---|---|---|
| Reporting period | URL filter | Home: organization-local Today, rolling 7 days, calendar month |
| All / Mine / Urgent / Overdue | URL filter | Home: normalized scope and exception filter |
| Refresh | Read refresh | Existing server projection; no background mutation or polling |
| KPI | Owning collection | Its supported exact filter, stated dates and real scope |
| Attention category | Owning collection | Exact category queue; totals may overlap |
| Subject / Open | Owning detail | Canonical Customer/Case/Work/Call/Inquiry/Rule/Form record |
| Pending Agent approval | Existing global rail | Review in Agent; existing approval boundary |
| Expand previews | Inline disclosure | More bounded records, never presented as the entire queue |
| My priorities / workload | Detail / URL filter | Real member or Resource assignments only |
| Today / upcoming | Detail | Existing Work, Follow-up and Case authorities |
| Open schedule | Workspace | Existing Work Schedule; no Home calendar backend |
| Performance figure | Owning workspace | Canonical Finance or Marketing query scope; current indicators say current |
| Currency / daily amounts | Local presentation | Separate real payment series; accessible amounts table |
| Recent activity | Owning detail | Bounded metadata; no private notes, prompts, answers or transcripts |
| Search | Shared PageDrawer | Launcher to authorized workspace search; no claimed universal search index |
| Quick actions | Shared PageDrawer | Authorized links to owning creation drawers and Inbox compose |
| New invoice | Canonical Finance drawer | Reused FinanceWorkflow with its existing actions and validation |
| Customize | Shared PageDrawer | Optional panels; browser-local preferences scoped to actor and Organization |
| Workspace health | Workspace / configuration | Recorded readiness or explicit unavailable/unverified state |
| Agent prompt | Existing global rail | Supported prompt, date/timezone context; no dashboard records sent |

The state sheet covers desktop/mobile, attention, Mine/Organization, operations, actions, readiness, performance, activity, Agent, empty and partial availability. Local Playwright captures the 16 requested browser states plus lower-page views in `apps/web/test-results/home/`. Fixtures are loopback-only and excluded from production routes. Browser assertions and rendered screenshot inspection are separate verification steps.

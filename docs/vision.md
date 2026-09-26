# Vision

GOLD is the operating platform for service businesses: one tenant-safe system in which a
business can understand demand, serve customers, organize work, communicate, collect money and
learn from what happened.

The product promise is not “many small apps in one login.” It is one shared business model,
configured for each organization and delivered through coherent Products. The platform should
replace brittle handoffs among a CRM, calendar, inbox, phone, quoting tool, payment tool,
automation service and reporting spreadsheet without replacing them with a new maze.

## Product model

Every organization receives the shared Foundation: identity and membership, Customers,
Locations, Assets, Resources, Work Items, Documents/Files, Events/Timeline, custom fields,
configuration, audit, notifications, usage and provider connections.

Eight customer-facing Gild Products build on it (D61):

| Product | Customer outcome |
|---|---|
| Gild Sales | Know customers, contacts, relationships and sales context. |
| Gild Service | Planned — no operational surface yet. |
| Gild Comms | Conduct and preserve Voice, SMS and Email conversations. |
| Gild Finance | Price tenant work, quote, invoice, take payment and understand job economics. |
| Gild AI | Assistants and the Agent tool loop and drafting, reached from the page-support rail. |
| Gild Automations | Turn events into reliable actions with review where judgment is required. |
| Gild Field | Plan and perform work with Scheduling, Resources, Assets and Locations. |
| Gild Studio | Publish the business and let customers book, submit forms and use a portal. |

**Gild Insights** — dashboards, reports and analytics — is the shared analytical workspace every
Product reads from, and the Agent is a rail on all of them.

Products contain Modules; Modules contain concrete Features. Plans package Products, Modules,
Features, allowances and defaults. Add-ons extend them. Each organization's Subscription and
overrides resolve into Entitlements and Limits. Permission still belongs to RBAC: having bought
a Feature and being allowed to operate it are separate facts.

GOLD's own Plans and subscription billing are not Financial Operations. Financial Operations
is the tenant's economic system for serving its customers.

## Shared business context

BusinessOS is the product-facing name for the shared semantic and operating context all Products
consume: identity, purpose, audience, Business Offerings, voice and messaging, policies, brand
direction and operating configuration. It must extend the precise Organization, profile, brand,
hours and offering owners already present rather than introduce a duplicate context store.
It supplies context, not deterministic rules: Pricing, Scheduling, Financial Operations and
Automation retain ownership of their calculations and execution.

Business Offerings explain what the business offers and how it describes those services.
Financial Operations' Price Book expresses what it charges and the pricing rules. Customer
Experience projects approved BusinessOS context onto public pages; it does not own the source.

## Intelligence and providers

Intelligence is a horizontal runtime, not a separate vertical that absorbs every AI experience.
It provides model bindings, routing, fallback, budgets, quotas, concurrency, metering, cost,
health, audit, tools, safety and agents. Product intelligence remains close to its business
context. GOLD Intelligence may package several capabilities commercially, and an AI
Receptionist is a cross-product Solution composed from Communications / Voice, Automation, CRM
and Intelligence.

Products depend on provider capabilities, not supplier brands. A provider binding configures
who supplies a capability for an organization; provider resources are the concrete numbers,
domains, accounts or endpoints. The runtime records normalized usage, provider cost and health.
GOLD may initially operate local models in Platform Context as managed infrastructure; tenants
do not configure local endpoints, models or secrets until that isolation and control model is
deliberately built.

## Architectural promise

- One tenant model and one authorization path, including GOLD dogfooding as an ordinary tenant.
- One event history for operational truth, automation, reporting and AI context.
- One Scheduling engine for time and resource commitment; Booking, Maintenance and Dispatch are
  policies and experiences over it.
- One Pricing calculation for tenant work, separate from GOLD's own catalogue and subscriptions.
- One Automation runtime behind every workflow authoring experience.
- Configuration before forks, reusable Products before custom applications.
- Provider adapters behind capabilities, with usage, cost, health and failure visible.
- Consequential AI actions pass through the same domain rules and permissions as people.
- Routine platform operation is possible through product control surfaces, without source-code,
  database-studio, environment-file or provider-console intervention.

The result should feel specific to each business without becoming a separate codebase for each
business. That is the practical meaning of the 80% platform, 15% configuration, 5% custom
development principle.

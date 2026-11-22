# ADR-057 — GildOps' commercial administration is its operating Organization's Finance

**Date:** 2026-11-20 (completed 2026-11-21)
**Status:** Accepted and implemented
**Supersedes:** ADR-051 points 6 and 7; ADR-014 (remainder: Platform ownership of plans, subscriptions, retail rates, provider costs and margin); ADR-056 point 4 (Administration's separate shell)
**Superseded by:** None

## Context

ADR-051 made organization Finance the owner of selling and named GildOps' operating Organization as the seller of GildOps, but it migrated nothing. Platform Administration kept a second financial application — Plans & Add-ons, Pricing, Usage & economics, Vendor rates, Package economics, Portfolio economics, Billing and each business's Commercial tab, all behind the `platform.commercial` permission — and drew it in a second application shell at `/platform`.

The owner's finance consolidation work order (2026-11-19) and the work order eliminating the parallel Platform application (2026-11-21) end that transition: GildOps operates GildOps with the same application, workspaces and Finance every business uses, and Administration is a privileged context of GildOps' own organization.

## Decision

1. **Finance is the only place money is managed.** Catalog items and prices, plans and add-ons, subscriptions, agreed prices, supplier rates, recorded costs, cost to serve, package economics and portfolio economics belong to organization Finance. Administration has no financial destination.
2. **GildOps sells through its operating Organization.** The Organization named by `platform_settings.operating_organization_id` is the seller of every GildOps plan, add-on, usage price and subscription. Records the platform keys by the buying business (plan assignments, agreed prices, the billing provider's subscription copy, usage costs) take that Organization as their seller; the seller is derived from the operating-Organization setting (`app.platform_seller_id()`), not copied onto every row.
3. **A plan is a catalog item plus a switch list, created once.** A GildOps plan or add-on is created only in GildOps' Catalog & Pricing, as a recurring item (`create_plan_item`, pricing permission in the operating Organization). Its name, description, prices, add-ons, usage prices and billing-provider references are that item's. What it switches on — products, modules, features and allowances — stays a platform record, edited in a section of the same item that only members also holding `platform.catalogue` can change. There is no Plans destination in Administration and no other door that creates a plan.
4. **A subscription is a Finance record; an entitlement is a platform record.** GildOps' Finance → Subscriptions lists every business it serves and opens each business's subscription record: plan and add-ons, agreed price, allowance changes, per-product terms, the billing provider's state and, for members who may see costs, its economics. Recording or changing a subscription writes the business's plan assignment through the platform's existing provisioning core. Nothing infers access from a price, an invoice or a payment.
5. **Every GildOps buyer is a GildOps customer.** Each business with a plan assignment or platform subscription is linked to a customer in GildOps' CRM through a client–tenant relationship; the subscription record and the Administration record link to that customer for members who may read it.
6. **Finance permissions, held in GildOps' organization, are the only authority over its money.** `subscription.read` sees subscriptions; `subscription.manage` changes them; `cost.read` sees supplier rates, costs, cost to serve and margins; `cost.manage` records them; `price.manage` prices and creates plans. A customer business never reads GildOps' costs, other customers' records or GildOps' billing-provider references.
7. **Platform authority grants no Finance access.** The `platform.commercial` permission is retired: removed from the permission list, from every staff row, from the column default and from every database function, policy and view. A member of GildOps who holds every platform permission and no Finance permission sees no subscription, agreed price or cost.
8. **Administration keeps infrastructure.** Organization provisioning and lifecycle, support sessions, the feature registry and the plan switch lists, entitlement enforcement (which plan a business holds and whether service is locked — readable with `platform.organizations`), provider accounts and credentials, AI answering, metered usage in units, billing-webhook delivery health and platform reliability stay in Administration.
9. **One shell.** Administration is served at `/organizations/{goldId}/administration/**`, inside the organization shell, as an entered context like a workspace; it has its own registry (`lib/platform-navigation.ts`) and guard (`requirePlatformScope`). There is no standalone `/platform` application or `PlatformShell`.
10. **Records are kept, not rebuilt.** Plan prices, add-on links and billing-provider price references moved under the price book by renaming their tables; no amount was recalculated. Retired doors were dropped, not rewritten; retired addresses are not redirected.

## Consequences

- Finance gains Subscriptions, Costs (Supplier rates, Usage costs, Infrastructure) and Economics (Portfolio, Packages, cost to serve per business). They belong to the unlisted `operator` catalogue Product that only GildOps' own plan includes, because they describe reselling the platform; recurring items stay in Gild Finance for every business.
- Package economics records margin targets and usage assumptions in Finance (`cost.manage`); an agreed price is prepared for checkout from the subscription record.
- Plan & usage reads a buyer-only projection of its own package and prices.
- A plan's usage price is appended, never rewritten backwards, as the retired retail-rate door required.
- Platform staff who are not members of GildOps reach no Administration and read no plan price; plan definitions stay readable to every business member and to `platform.organizations` and `platform.catalogue` staff.
- Subscriptions for a business's own (non-GildOps) recurring items are not built: a business records recurring items, and recurring billing of its own customers remains future work.

## Rejected alternatives

- **Moving the Platform pages into Finance unchanged.** It would keep a second financial application under a new address.
- **Fully organization-owned plans that include feature grants.** Finance would edit platform feature switches without Product Registry's authority; the switch list stays a platform record.
- **Keeping provider costs in Platform as infrastructure cost.** What a supplier charges is a business cost; the credentials used to reach the supplier are the infrastructure.
- **Copying platform plans into new tables.** Copies would break billing-provider references and leave two price histories.
- **Redirects from the retired Platform addresses.** The hosted application is development-only; a redirect would keep a dead interface alive.

## Relationship to earlier decisions

Supersedes ADR-051 point 6 (GildOps' wholesale economics platform-private) and point 7 (records held in Platform during transition), the remainder of ADR-014's Platform ownership, and ADR-056 point 4 (Administration unchanged as a separately drawn context). ADR-051 points 1–5 stand, including separate money directions and the buyer-side Plan & usage view. ADR-013 (entitlement independent of authorization), ADR-020 (one usage ledger), ADR-021 (historical terms preserved), ADR-025 (proposals provision through the normal path), ADR-033 (entitlement checked at the point of spend) and ADR-037 (tenant settlement) stand.

## Enforcement / current owners

`docs/product.md` (*Two finance planes*, *Plan & usage*), `docs/domain-model.md` (*Platform commercial model*), `docs/architecture.md` (*Finance architecture*), `docs/security.md` (platform permissions), `docs/surfaces/finance.md`, `docs/surfaces/shell.md`. `tests/architecture/static/finance-boundary.test.ts` enforces the ownership; `tests/integration/database/finance-gildops-commercial.test.ts`, `platform-permissions.test.ts` and `finance-recurring-items.test.ts` enforce the authority at the database boundary.

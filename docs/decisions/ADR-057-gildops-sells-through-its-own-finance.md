# ADR-057 — GildOps' commercial administration is its operating Organization's Finance

**Date:** 2026-11-20
**Status:** Accepted
**Supersedes:** ADR-051 points 6 and 7; ADR-014 (remainder: Platform ownership of plans, subscriptions, retail rates, provider costs and margin)
**Superseded by:** None

## Context

ADR-051 made organization Finance the owner of selling and named GildOps' operating Organization as the seller of GildOps, but it migrated nothing. Platform Administration kept a second financial application: Plans & Add-ons, Pricing, Usage & economics, Vendor rates, Package economics, Portfolio economics, Billing and each business's Commercial tab, all behind the `platform.commercial` permission. GildOps' provider costs and margin were declared platform-private and unreadable from any Finance.

The owner's finance consolidation work order (2026-11-19) ends that transition. GildOps operates GildOps with the same Finance every business uses, and Platform Administration keeps only what operating the platform requires.

## Decision

1. **Finance is the only place money is managed.** Catalog items and prices, subscriptions, supplier costs, cost to serve, package economics and portfolio economics belong to organization Finance. Platform Administration has no financial destination.
2. **GildOps sells through its operating Organization.** The Organization named by `platform_settings.operating_organization_id` is the seller of every GildOps plan, add-on, usage price and subscription. Records the platform keys by the buying business (plan assignments, agreements, the billing provider's subscription copy, usage costs) take that Organization as their seller; the seller is derived from the operating-Organization setting rather than copied onto every row.
3. **A plan is a catalog item plus a switch list.** What GildOps sells — name, description, prices by currency and billing interval, add-ons and the billing provider's price reference — is a recurring item in GildOps' Catalog & Pricing. What the plan switches on — products, modules, features and allowances — stays a platform record in Product Registry, linked to that item. Any business can sell recurring items; only items linked to a platform plan provision platform features.
4. **A subscription is a Finance record; an entitlement is a platform record.** Every business records its customers' subscriptions in Finance. When GildOps records or changes a subscription to a plan-linked item for a business it serves, the platform's existing provisioning core writes that business's plan assignment. Nothing infers access from a price, an invoice or a payment, and no new cancellation rule is introduced: changing a plan records a new period, as before.
5. **Every GildOps buyer is a GildOps customer.** Each business with a plan assignment or platform subscription is linked to a customer in GildOps' CRM through a client–tenant relationship. Businesses that had none receive one, recorded with the origin `migration`.
6. **Costs and margin are restricted Finance records.** GildOps' provider rates, provider cost components, infrastructure costs, package economics and margin belong to GildOps' Finance and are readable only by its members holding the new `cost.read` permission; recording them takes `cost.manage`. Subscriptions are changed with the new `subscription.manage` permission. A customer business never reads GildOps' costs, and Plan & usage never shows them.
7. **Platform authority grants no Finance access.** Platform staff permissions do not open GildOps' Finance. Access comes only from membership of GildOps' operating Organization and its Finance permissions. The `platform.commercial` permission is retired.
8. **Platform keeps infrastructure.** Organization provisioning, the feature registry and plan switch lists, entitlement enforcement, provider accounts and credentials, usage metering and its counts without money, billing-webhook delivery health, and platform security stay in Platform Administration.
9. **Records are kept, not rebuilt.** Plan prices, add-on links and billing-provider price references move under the price book by renaming their tables, so every identifier, amount, currency, interval, effective date and provider reference stays as it was. No amount is recalculated. Former Platform addresses redirect to the Finance page that replaced them, where Finance's own permissions decide access.

## Consequences

- Finance gains recurring items, Subscriptions, Costs and Economics. Subscriptions, Costs and Economics are offered through catalogue features granted to GildOps' own plan, not by checking which Organization is open.
- Plan & usage reads a buyer-only projection of its own package and prices.
- Product Registry gains Plans, holding only switch lists.
- The finance boundary test now refuses any Finance import of Platform Administration code and any financial destination in Platform, instead of protecting the transitional split.

## Rejected alternatives

- **Moving the Platform pages into Finance unchanged.** It would keep a second financial application under a new address.
- **Fully organization-owned plans that include feature grants.** Finance would edit platform feature switches; the switch list stays a platform record.
- **Keeping provider costs in Platform as infrastructure cost.** What a supplier charges is a business cost; the credentials used to reach the supplier are the infrastructure.
- **Copying platform plans into new tables.** Copies would break billing-provider references and leave two price histories.

## Relationship to earlier decisions

Supersedes ADR-051 point 6 (GildOps' wholesale economics platform-private) and point 7 (records held in Platform during transition), and the remainder of ADR-014's Platform ownership. ADR-051 points 1–5 stand, including separate money directions and the buyer-side Plan & usage view. ADR-013 (entitlement independent of authorization), ADR-020 (one usage ledger), ADR-021 (historical terms preserved), ADR-025 (proposals provision through the normal path), ADR-033 (entitlement checked at the point of spend) and ADR-037 (tenant settlement) stand.

## Enforcement / current owners

`docs/product.md` (*Two finance planes*, *Plan & usage*), `docs/domain-model.md` (*Platform commercial model*), `docs/architecture.md` (*Finance architecture*), `docs/security.md` (platform permissions), `docs/surfaces/finance.md`, `docs/surfaces/shell.md`. `tests/architecture/static/finance-boundary.test.ts` and the database integration tests for Finance commercial permissions enforce it.

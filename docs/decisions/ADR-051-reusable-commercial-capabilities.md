# ADR-051 — Organization Finance owns reusable commercial capabilities; GildOps sells through its own Finance

**Date:** 2026-10-25
**Status:** Accepted
**Supersedes:** ADR-014 (in part: who owns GildOps' own selling records)
**Superseded by:** None

## Context

ADR-014 separated tenant Finance (customer → Organization) from a Platform commercial control plane (Organization → GildOps → provider) that owned GildOps' Plans, subscriptions, retail usage pricing, provider costs and margin. At that time the only subscription, usage-pricing and allowance machinery belonged to GildOps selling itself, so selling and platform control were one plane.

The owner's GildOps Finance V2.0 and V2.1 work orders accepted a different direction: selling is an ordinary business capability. Every Organization, including GildOps, should sell through the same organization Finance, while privileged platform operations and GildOps' private provider economics stay platform-controlled.

## Decision

1. **Organization Finance owns reusable commercial capabilities.** Selling capabilities (catalog items and prices, quotes, invoices, payments, and later subscriptions, recurring charges, metered usage and prepaid balances) belong to organization Finance. Every Organization sells its own products and services to its own customers through its own Finance, scoped by RLS like any other tenant record.
2. **GildOps sells its platform through its operating Organization's Finance.** GildOps uses the same capabilities, exposed through the Finance of GildOps' operating Organization (ADR-002). The seller-side records of a GildOps sale (the customer, the agreement, invoices and payments) belong to that Organization's Finance. No separate selling ledger is designed for GildOps alone.
3. **A purchase of GildOps appears under Business Settings → Plan & usage.** The buying Organization sees what it bought from GildOps (plan, seats, usage, allowances, payment methods and GildOps invoices) as a buyer-side view in its own Business Settings. That view is not the buyer's revenue and not part of the buyer's Finance, and it never exposes GildOps' provider costs or margin.
4. **Money directions and settlement stay distinct.** A customer paying an Organization and an Organization paying GildOps are different money directions with different settlement owners. Each seller's customers pay through that seller's own payment-processing relationship (ADR-037); GildOps' own sales settle through GildOps' processing relationship. No record nets amounts across directions or between Organizations.
5. **Privileged operations stay platform-controlled.** Provisioning tenants, defining global features, enforcing entitlements, operating provider accounts and infrastructure, and platform security remain Platform Administration actions under explicit platform permissions (ADR-003, ADR-013). Selling through Finance, including GildOps' own, grants no platform permission; an entitlement follows from a sale only through the platform's own enforcement.
6. **Supplier costs belong to each business; GildOps' wholesale economics stay private.** Every business may model its own supplier and job costs in its Finance. GildOps' wholesale provider rates, provider cost components, package economics and platform margin remain platform-private and are never readable from any Organization's Finance or Plan & usage, including through reusable capabilities.
7. **Historical platform-billing records are protected during transition.** Existing Plans and Add-ons, plan assignments and agreements, commercial terms and proposals, platform subscriptions, usage events and the platform-billing webhook ledger are retained unchanged. This decision migrates no records and removes no Platform Administration surface; moving GildOps' selling onto its operating Organization's Finance is a later, separately reviewed migration that preserves those records (ADR-021).

## Consequences

- Platform Administration keeps privileged control (provisioning, entitlement enforcement, providers, infrastructure, platform economics) and, during transition, the existing platform-billing records.
- New selling capabilities are designed once, for organization Finance, and GildOps adopts them as an ordinary Organization.
- The price book (`price_book_items`) is the first reusable capability. It is not the platform capability registry (`platform_catalog_*`, `platform_plans`, `platform_products`), which describes what the platform can enable and which Features an Organization is entitled to.
- Entitlement enforcement continues to read only platform-owned state.
- Finance must still never import or read platform economics (`tests/architecture/static/finance-boundary.test.ts`).

## Rejected alternatives

- **One ledger for every money direction.** Rejected for the reasons in ADR-014 and ADR-037: opposite directions, different settlement owners, private provider costs.
- **A separate selling system for GildOps alone.** Duplicates capabilities every business needs and leaves GildOps as a special case (ADR-002).
- **Exposing GildOps' purchase records inside the buyer's Finance.** A purchase is not the buyer's revenue; it belongs in Business Settings → Plan & usage.
- **Moving platform-billing tables into tenant Finance now.** They hold platform authority, provider references and cost data; a reviewed migration is required first.

## Relationship to earlier decisions

Supersedes ADR-014 in part: GildOps' own selling (Plans as products sold, subscriptions sold, retail usage pricing charged to customers) moves, as a target, from the Platform plane to GildOps' operating Organization's Finance. ADR-014's separation of money directions, its private provider economics and its rejection of one shared ledger stand. ADR-005 (workspaces independent of the catalogue), ADR-025 (proposals provision through the normal Organization path) and ADR-037 (tenant settlement) stand in full.

## Enforcement / current owners

`docs/product.md` (*Two finance planes*, *Plan & usage*), `docs/domain-model.md` (*Platform commercial model*), `docs/architecture.md` (*Finance architecture*). `tests/architecture/static/finance-boundary.test.ts` continues to refuse Finance imports from the platform commercial and economics planes.

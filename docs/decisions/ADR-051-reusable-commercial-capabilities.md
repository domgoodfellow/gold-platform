# ADR-051 — Commercial capabilities are reusable in tenant Finance; ledgers, settlement and platform authority stay separate

**Date:** 2026-10-25
**Status:** Proposed
**Supersedes:** None while proposed; on acceptance, part of the Finance planes decision (see *Relationship to earlier decisions*)
**Superseded by:** None

## Context

ADR-014 separated tenant Finance (customer → Organization: price book, quotes, invoices, payments, job economics) from the Platform commercial control plane (Organization → GildOps: Plans, Add-ons, subscriptions, retail usage pricing, provider costs, margin). That separation was written while the only subscription, usage-pricing and allowance machinery in the product belonged to GildOps selling itself.

The GuildOps Finance V2.0 work order states a newly approved direction: commercial capabilities — subscriptions, recurring charges, metered usage, prepaid balances — should be reusable by any Organization selling to its own customers, rather than designed only around GildOps' platform business. GildOps would then sell to Organizations with the same capability an Organization uses to sell to its customers.

The same work order keeps three things that ADR-014, ADR-037, ADR-005 and ADR-025 established: separate financial records per money direction, each Organization's own payment settlement, and explicit platform authority. This record states the new direction without rewriting those decisions' history.

## Decision (proposed)

1. **Capabilities are shared; instances and records are not.** Commercial concepts — a sellable item and its price, a recurring plan, a metered allowance, a usage charge, a prepaid balance — are modelled once as capabilities. Each Organization holds its own instances in its own tenant Finance, scoped by RLS like every other tenant record. GildOps' own sale of the platform is one such Organization's use of those capabilities (ADR-002 dogfooding), not a special schema.
2. **Ledgers stay per money direction.** A tenant's customer invoices, payments and balances remain tenant Finance records. What an Organization owes GildOps remains a separate record set, readable by that Organization under Settings → Plan & usage. No ledger row is shared between the two directions, and no amount is netted across them.
3. **Settlement stays with the seller (ADR-037 unchanged).** An Organization's customers pay through that Organization's own payment-processing relationship; GildOps' subscription billing keeps its separate provider path, webhooks and credentials.
4. **Provider economics stay platform-private (ADR-014 consequence unchanged).** Wholesale provider rates, cost components, margin and package economics are never part of the reusable capability and never reach tenant Finance.
5. **Platform authority is unchanged.** Defining global features, provisioning tenants, enforcing entitlements and operating providers remain Platform Administration actions under explicit platform permissions (ADR-003, ADR-013). A tenant using subscriptions for its own customers gains no platform permission.
6. **Navigation stays independent of the catalogue (ADR-005 unchanged).** Reusing a commercial capability does not generate navigation rows; Finance destinations remain registered operating pages.
7. **Proposal provisioning is unchanged (ADR-025).** An accepted GildOps proposal still provisions through the normal Organization path.

## Consequences

- The tenant price book (`price_book_items`) is the first reusable capability and remains a simple per-unit catalogue today. It is explicitly **not** the platform capability registry (`platform_catalog_*`, `platform_plans`, `platform_products`), which describes what GildOps sells and which Features an Organization is entitled to.
- Subscriptions, seats, metered usage and prepaid credits for tenant customers need new tenant-scoped records; none of today's platform tables (`organization_plan_assignments`, `organization_commercial_terms`, `organization_platform_subscriptions`, `usage_events`, allowance functions) are moved into tenant Finance or reused in place, because each carries GildOps-specific authority, provider references or cost columns.
- Historical commercial terms, plan agreements, commercial proposals and platform subscription records are retained unchanged (ADR-021).
- Entitlement enforcement continues to read only the platform plane.

## Rejected alternatives

- **One ledger for both directions.** Rejected again for the reasons in ADR-014: opposite money directions, different settlement owners and private provider costs.
- **Moving platform plan and usage tables into tenant Finance.** They hold GildOps authority, provider price references and cost data; relocating them would expose or entangle platform-private state.
- **Keeping commercial capability exclusive to the platform.** Contradicts the approved direction and would force each business to model recurring revenue outside GildOps.

## Relationship to earlier decisions

When accepted, this record supersedes only ADR-014's statement that subscriptions and retail usage pricing are exclusively Platform concepts. ADR-014's separation of planes, ledgers and provider economics stands, as do ADR-005, ADR-025 and ADR-037 in full. ADR-014 is not edited until acceptance; then it is marked *Superseded in part by ADR-051* in its header and in the decisions index.

## Proposed canonical amendments (apply on acceptance)

- `docs/product.md` → *Two finance planes*: under Tenant Finance add "subscriptions, recurring charges, metered usage and prepaid balances an Organization sells to its own customers (planned; capability shared with the platform plane, records separate)". Under Platform commercial control plane, qualify "GildOps subscription billing" as "GildOps' own instances of the shared commercial capabilities, plus provider rates, costs and margin". Keep "A Finance workspace must never become a back door into GildOps platform economics."
- `docs/domain-model.md`: name *commercial capability* (shared concept) versus *commercial record* (tenant- or platform-owned instance), and state that the price book is not the platform capability registry.
- `docs/architecture.md`: record that platform-billing, commercial and catalogue domains keep their own tables and authority; future tenant subscription domains live under tenant Finance ownership.
- `docs/security.md` and `docs/integrations.md`: no change beyond referencing ADR-037 for settlement and noting that tenant subscription billing, when built, uses the tenant's payment account.

## Enforcement / current owners

`docs/product.md`, `docs/domain-model.md`, `docs/architecture.md`, `docs/integrations.md`, `docs/security.md` on acceptance. Until then the current rules in those documents and ADR-014 remain authoritative, and `apps/web/tests/architecture/static/finance-boundary.test.ts` continues to refuse imports from the commercial and platform planes into Finance.

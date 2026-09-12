# Market

This document describes demand and commercial hypotheses. It does not report repository status;
the roadmap and changelog do that.

## Buyer and problem

GOLD is aimed first at owner-led and operations-led service businesses whose customer, work,
communication and cash workflows are split across spreadsheets and several disconnected SaaS
tools. The strongest early buyer:

- has enough volume that missed calls, duplicate entry, scheduling friction and slow follow-up
  cost real money;
- lacks a dedicated internal software team;
- needs flexibility in terminology and workflow but cannot fund a bespoke system;
- wants one accountable operating partner instead of assembling and maintaining an integration
  stack;
- can adopt in stages while preserving evidence, permissions and financial history.

Field service, property and asset service, professional service, maintenance, installation and
similar businesses are promising starting segments. These are hypotheses to validate through
sales conversations and observed use, not a claim that one vertical defines the platform.

## Jobs customers hire GOLD to do

1. Capture and understand every customer interaction, especially a call that would otherwise be
   missed or forgotten.
2. Turn demand into correctly scoped, scheduled and assigned work.
3. Keep customer, site, asset, work, document and communication context together.
4. Quote, invoice, take payment and understand whether work was economically worthwhile.
5. Automate repeatable follow-up without inventing business language or bypassing approval.
6. Publish an accurate public presence and let customers take approved self-service actions.
7. Make operating performance visible without rebuilding a spreadsheet every week.

The wedge is a reliable front desk: a placed or answered call becomes an attributable recording,
transcript and analysis on the relevant timeline, and approved proposed actions execute through
the normal domain layer. The larger product is the operating system around that loop.

## Commercial model

The canonical commercial chain is Product catalogue → Plans and Add-ons → organization
Subscription → Entitlements and Limits → measured Usage. GOLD should sell customer outcomes and
normalized usage, not expose a vendor's token, minute or infrastructure vocabulary as the
product model.

A Plan is a reusable package; an Add-on is an optional capability or bundle; a Subscription is
the customer's active commercial relationship. Entitlements answer what may be used. RBAC
capabilities answer who may operate it. Limits and allowances constrain use, and meters preserve
the usage evidence required for billing, margin and capacity decisions.

The GOLD Financial Model in the owner's connected Drive supports this shape as planning
evidence: it separates recurring packages, optional AI/voice capabilities, usage, implementation
and support, and models provider costs and margins by meter. Its prices, vendors, conversion
rates, volume assumptions and target margins remain hypotheses. They do not authorize hardcoded
prices, promise a feature, or prove a provider is integrated.

GOLD's subscription revenue and provider costs are a platform financial control plane. A
tenant's Price Book, quotes, invoices, payments and job economics are the separate Financial
Operations Product.

## Packaging principles

- Package coherent outcomes, not route access.
- Preserve a usable base experience; do not manufacture dependency traps between Products.
- Make metered use, included allowance, overage policy and operational limits explicit.
- Offer managed Intelligence without making tenants administer model infrastructure.
- Treat AI Receptionist as a Solution assembled from Voice, Automation, CRM and Intelligence,
  not as a new isolated Product.
- Let GOLD dogfood through an ordinary Plan and Subscription with full Entitlements and normal
  metering; never create a tenant-zero or unmetered exception.
- Keep implementation and migration work visible as services when it is materially distinct
  from recurring software value.

## Adoption and displacement

A prospect does not switch because GOLD has more menu items. It switches when the path from its
current system is credible and the first operating loop is measurably better. Adoption therefore
requires:

- a clear inventory and mapping of source data;
- repeatable import with reconciliation and rollback evidence;
- parity for the workflows that cannot stop on cutover day;
- staged activation, health checks and recoverable provisioning;
- a reason to switch expressed in fewer missed interactions, faster work-to-cash, lower
  administrative effort or better operating visibility.

NextFund is the first named migration program, but it begins only after the platform-hardening
gate in the roadmap. Its needs are evidence for reusable Products and migration tooling, not
permission for a customer-specific fork.

## Evidence discipline

Commercial decisions should distinguish:

- **Observed:** behavior in a real organization, a sales conversation, a signed commitment or
  measured cost/usage.
- **Modeled:** the financial spreadsheet's scenarios and vendor assumptions.
- **Proposed:** packaging, positioning or pricing awaiting validation.

No durable document should turn modeled values into facts. Record actual usage and provider cost,
compare actuals with estimates, and revise packaging from evidence while preserving the
catalogue/Plan/Subscription/Entitlement boundaries.

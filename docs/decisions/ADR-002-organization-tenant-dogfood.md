# ADR-002 — Organization is the tenant boundary and GildOps dogfoods normally

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

GildOps must operate its own business while also operating the SaaS control plane. A special tenant-zero path would make internal use incomparable to customer use.

## Decision

An Organization is the tenant boundary. GildOps' own business uses an ordinary Organization for tenant operations and receives no product/data-isolation exemption.

## Consequences

- Internal use exercises the same Membership, entitlement, usage and domain paths as customers.
- Platform authority remains a separate fact.

## Rejected alternatives

- Tenant zero.
- Unmetered or authorization-bypassing internal Organization.

## Enforcement / current owners

- `docs/product.md`
- `docs/domain-model.md`
- `docs/architecture.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.

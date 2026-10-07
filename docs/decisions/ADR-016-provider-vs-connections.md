# ADR-016 — Platform Provider infrastructure and tenant Connections are different axes

**Recorded:** 2026-10-07
**Status:** Accepted
**Origin:** Formalizes architecture already present before the documentation reset; exact implementation history remains in Git.

## Context

GildOps-managed infrastructure credentials and a customer's delegated external account have different owners, authority and lifecycle.

## Decision

Provider/Provider Account/Binding/Resource are Platform infrastructure. Connector/Connection/Credential/Integration Resource represent an Organization connecting its own external system.

## Consequences

- Credentials and UI ownership remain separate.
- A provider may exist without a tenant Connection and vice versa.

## Rejected alternatives

- One generic integrations table for every external credential.
- Tenant users reading GildOps parent-provider credentials.

## Enforcement / current owners

- `docs/domain-model.md`
- `docs/integrations.md`

Executable schema, tests and source remain authoritative for implementation details. If a later accepted ADR changes this decision, update the canonical document and mark this record superseded.

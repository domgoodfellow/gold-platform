# Architecture Decisions

## Purpose

This directory records **material architectural and product decisions whose rationale must survive the implementation that introduced them**.

Use this model:

```text
Canonical document
= what is true now

ADR
= why a durable choice was made, its tradeoffs, and what it displaced

CHANGELOG
= what shipped and when

Git
= exact implementation history
```

ADRs do not replace current canonical documentation.

A current rule must still appear in the document that owns the concern.

---

## Authority model

Each kind of rule has one owner. Another document may link to it, but must not restate it in its own words.

| Owner | Defines | Does not define |
| --- | --- | --- |
| `docs/product.md` | Approved product behavior and information architecture: scopes, workspaces, which destinations exist and how they are grouped | Presentation details, module layout |
| `docs/ui-system.md` | Presentation, interaction and composition contracts: archetypes, page identity, surfaces, responsive behavior, accessibility | Which destinations exist or how they are grouped |
| `docs/architecture.md` | Layers, dependency direction, module ownership, including which projection modules own navigation data | Product behavior, presentation |
| Other canonical docs (see `CLAUDE.md`) | Their named concern | Concerns owned above |
| ADRs (this directory) | Why a durable choice was made, its tradeoffs and what it displaced; supersession history | Current detail beyond the decision itself |
| `CLAUDE.md` | How agents interpret, implement and change these contracts | Product, UI or architecture rules |
| Tests (`test-manifest.json`) | Executable checks derived from approved contracts | New contracts. A test that passes after its expectation was edited proves nothing about authorization |

Accepted product decisions define intended behavior. Current canonical specifications express those decisions. ADRs explain decisions and historical changes. Tests enforce current behavior. Existing code is evidence of implementation, not justification for redefining requirements.

When a conflict appears, reconcile the current specification against the accepted decision before modifying tests or implementation. An explicitly approved work order supplies authorization for its stated decisions; unresolved product decisions still follow the protocol below.

---

## Contract-change protocol

**Ordinary implementation** preserves approved contracts:

1. identify the applicable contract and its owner (table above);
2. inspect current callers and the regression tests that protect the behavior;
3. implement within the contract;
4. add coverage for new behavior;
5. verify that existing protected behavior still holds.

An implementation that differs from a contract is not a reason to change the contract.

**Regression correction:** when code violates an approved contract, correct the code. Do not rewrite the contract to describe the defect.

**Intentional change:** when a proposed implementation conflicts with an approved contract or Accepted ADR:

1. identify and explain the conflict;
2. stop the conflicting implementation;
3. present the proposed decision, alternatives and consequences;
4. obtain explicit owner authorization for the changed behavior;
5. record it: a superseding ADR when the decision is material (see *When to create an ADR*), otherwise the owning canonical document;
6. update implementation and tests against the newly approved contract;
7. provide evidence of the changed behavior (rendered evidence for user-visible change).

A contradiction between documents is not permission to follow the most convenient one. Canonical documentation changes only to correct a factual inaccuracy or to record an explicitly approved change.

Commits and pull requests that touch protected contract paths (listed in `.github/CODEOWNERS`) carry a `Contract-Change:` line; removed or skipped tests and newly mocked features carry a `Coverage-Change:` line. `scripts/contract-guard.mjs` checks for them. See `docs/testing.md` → *Test-change discipline* and *CI contract*.

---

## When to create an ADR

Create an ADR when a decision:

- changes system or domain ownership;
- establishes a cross-domain pattern;
- changes tenant/platform/security boundaries;
- introduces a long-lived runtime/infrastructure dependency;
- changes a canonical persistence strategy;
- deliberately refuses an attractive competing architecture;
- is likely to be reopened incorrectly without preserved rationale.

Do not create an ADR for ordinary implementation choices, local refactors, one-off bug fixes or styling.

---

## Status

Use one status:

- **Proposed**
- **Accepted**
- **Deprecated**
- **Superseded**
- **Rejected**

When one ADR replaces another, both records name the relationship explicitly.

---

## Metadata

Future ADRs use:

```markdown
# ADR-NNN — Title

**Date:** YYYY-MM-DD
**Status:** Proposed | Accepted | Deprecated | Superseded | Rejected
**Supersedes:** ADR-NNN | None
**Superseded by:** ADR-NNN | None
```

The baseline ADRs below were formalized during the 2026-10-07 documentation reset after their architecture already existed. They therefore use **Recorded** plus an explicit historical-origin statement rather than inventing a false original decision date.

---

## Required sections

Every ADR contains:

1. Context
2. Decision
3. Consequences
4. Rejected alternatives, when relevant
5. Enforcement / current owners

A useful ADR records the tradeoff.

It is not a duplicate specification.

---

## Accepted baseline

| ID | Decision | File |
| --- | --- | --- |
| ADR-001 | Person, Organization and Platform Administration are separate scopes | [`ADR-001-scopes.md`](ADR-001-scopes.md) |
| ADR-002 | Organization is the tenant boundary and GildOps dogfoods normally | [`ADR-002-organization-tenant-dogfood.md`](ADR-002-organization-tenant-dogfood.md) |
| ADR-003 | Platform authority is explicit and independent | [`ADR-003-platform-authority.md`](ADR-003-platform-authority.md) |
| ADR-004 | Canonical operator workspaces | [`ADR-004-operator-workspaces.md`](ADR-004-operator-workspaces.md) |
| ADR-005 | Workspace taxonomy is independent of the commercial catalogue | [`ADR-005-workspace-catalogue-separation.md`](ADR-005-workspace-catalogue-separation.md) |
| ADR-006 | Workspace visibility requires a real surface and Home is the parent. **Superseded by ADR-046** | [`ADR-006-workspace-visibility-home.md`](ADR-006-workspace-visibility-home.md) |
| ADR-007 | Insights, Library and Settings are shared surfaces, not operator workspaces | [`ADR-007-shared-surfaces.md`](ADR-007-shared-surfaces.md) |
| ADR-008 | One canonical owner per business fact | [`ADR-008-canonical-ownership.md`](ADR-008-canonical-ownership.md) |
| ADR-009 | CRM, Communications and Support own different lifecycles | [`ADR-009-crm-communications-support.md`](ADR-009-crm-communications-support.md) |
| ADR-010 | Work and Scheduling are separate authorities | [`ADR-010-work-scheduling.md`](ADR-010-work-scheduling.md) |
| ADR-043 | A Library file is organization-owned; records reference it | [`ADR-043-library-files-and-references.md`](ADR-043-library-files-and-references.md) |
| ADR-044 | Stored bytes are removed only by their uploader, and only while nothing names them | [`ADR-044-storage-bytes-removal.md`](ADR-044-storage-bytes-removal.md) |
| ADR-011 | Resource and Asset are role-based concepts | [`ADR-011-resource-asset.md`](ADR-011-resource-asset.md) |
| ADR-012 | Settings has five independent scopes | [`ADR-012-settings-scopes.md`](ADR-012-settings-scopes.md) |
| ADR-013 | Entitlement and authorization are independent | [`ADR-013-entitlement-authorization.md`](ADR-013-entitlement-authorization.md) |
| ADR-014 | Tenant Finance and Platform commercial control are separate | [`ADR-014-finance-planes.md`](ADR-014-finance-planes.md) |
| ADR-015 | Providers sit behind capability adapters | [`ADR-015-provider-adapters.md`](ADR-015-provider-adapters.md) |
| ADR-016 | Platform Provider infrastructure and tenant Connections are different axes | [`ADR-016-provider-vs-connections.md`](ADR-016-provider-vs-connections.md) |
| ADR-017 | Files are artifacts and import sources, not Connections | [`ADR-017-files-not-connections.md`](ADR-017-files-not-connections.md) |
| ADR-018 | AI acts only through authorized domain tools | [`ADR-018-ai-domain-tools.md`](ADR-018-ai-domain-tools.md) |
| ADR-019 | Automations owns durable orchestration | [`ADR-019-automations-orchestration.md`](ADR-019-automations-orchestration.md) |
| ADR-020 | One commercial Usage Event ledger supports multiple provider cost components | [`ADR-020-usage-cost-ledger.md`](ADR-020-usage-cost-ledger.md) |
| ADR-021 | Historical committed terms are preserved | [`ADR-021-historical-terms.md`](ADR-021-historical-terms.md) |
| ADR-022 | Compatibility does not define target architecture | [`ADR-022-compatibility-target-architecture.md`](ADR-022-compatibility-target-architecture.md) |
| ADR-023 | GildOps naming migrates forward without rewriting history | [`ADR-023-naming-migration.md`](ADR-023-naming-migration.md) |
| ADR-024 | Discovery produces durable handoff evidence | [`ADR-024-discovery-handoff.md`](ADR-024-discovery-handoff.md) |
| ADR-025 | Accepted proposals provision through the normal Organization path | [`ADR-025-proposal-provisioning.md`](ADR-025-proposal-provisioning.md) |
| ADR-026 | Shared-schema multi-tenancy is enforced with RLS | [`ADR-026-rls-multitenancy.md`](ADR-026-rls-multitenancy.md) |
| ADR-027 | Web and Python are two serverless runtimes with one domain model | [`ADR-027-web-python-runtimes.md`](ADR-027-web-python-runtimes.md) |
| ADR-028 | Schema evolves through forward SQL migrations with generated types | [`ADR-028-sql-migrations-generated-types.md`](ADR-028-sql-migrations-generated-types.md) |
| ADR-029 | Public external actors use narrow sessions rather than Membership | [`ADR-029-external-actor-sessions.md`](ADR-029-external-actor-sessions.md) |
| ADR-030 | Communications is multi-channel with one conversation ownership model | [`ADR-030-communications-multichannel.md`](ADR-030-communications-multichannel.md) |
| ADR-031 | A Call is one business fact over provider legs | [`ADR-031-call-provider-legs.md`](ADR-031-call-provider-legs.md) |
| ADR-032 | Studio publishes a whole site revision | [`ADR-032-site-revision-publishing.md`](ADR-032-site-revision-publishing.md) |
| ADR-033 | AI runtime selection, entitlement and metering are centralized | [`ADR-033-ai-runtime-entitlement-metering.md`](ADR-033-ai-runtime-entitlement-metering.md) |
| ADR-034 | Organization Secret References are write-only and machine-resolved | [`ADR-034-secret-references.md`](ADR-034-secret-references.md) |
| ADR-035 | Connector readiness is derived by the runtime that can know it | [`ADR-035-connector-readiness.md`](ADR-035-connector-readiness.md) |
| ADR-036 | Travel is derived per Resource as scheduling feasibility | [`ADR-036-travel-feasibility.md`](ADR-036-travel-feasibility.md) |
| ADR-037 | Tenant payment processing keeps customer money out of GildOps | [`ADR-037-tenant-payment-settlement.md`](ADR-037-tenant-payment-settlement.md) |
| ADR-038 | Platform provider credentials are private control-plane state | [`ADR-038-provider-credentials.md`](ADR-038-provider-credentials.md) |
| ADR-039 | Setup is a lifecycle over canonical configuration | [`ADR-039-setup-lifecycle.md`](ADR-039-setup-lifecycle.md) |
| ADR-040 | Opportunities close independently of Customer relationships | [`ADR-040-independent-opportunities.md`](ADR-040-independent-opportunities.md) |
| ADR-041 | Import open-source connector packages | [`ADR-041-imported-open-source-connectors.md`](ADR-041-imported-open-source-connectors.md) |
| ADR-042 | Studio customer Portal publication and host delivery | [`ADR-042-studio-customer-portal-publication.md`](ADR-042-studio-customer-portal-publication.md) |
| ADR-045 | Foundational scope, terminology and voice options. **Part B flat-sidebar rendering superseded by ADR-046** | [`ADR-045-foundational-options.md`](ADR-045-foundational-options.md) |
| ADR-046 | Entered workspaces use contextual navigation over one canonical projection. **Point 3 (Overview) superseded by ADR-047; point 6 (header presentation) by ADR-048** | [`ADR-046-contextual-workspace-navigation.md`](ADR-046-contextual-workspace-navigation.md) |
| ADR-047 | One page location and identity contract | [`ADR-047-page-location-and-identity.md`](ADR-047-page-location-and-identity.md) |
| ADR-048 | The sidebar owns workspace navigation; the header owns page identity and actions. **Point 4 (header Calendar shortcut) superseded by ADR-050** | [`ADR-048-sidebar-owns-workspace-navigation.md`](ADR-048-sidebar-owns-workspace-navigation.md) |
| ADR-049 | Explicit workspace Dashboard; supersedes ADR-047 point 1 | [`ADR-049-explicit-workspace-dashboard.md`](ADR-049-explicit-workspace-dashboard.md) |
| ADR-050 | The organization header carries no workspace Calendar shortcut; supersedes ADR-048 point 4 | [`ADR-050-no-calendar-in-organization-header.md`](ADR-050-no-calendar-in-organization-header.md) |

---

## Adding a new decision

1. allocate the next unused number;
2. write the ADR before or with the architecture-changing implementation;
3. update the canonical document that owns the new current truth;
4. mark any displaced ADR as Superseded/Deprecated;
5. add a changelog entry when user/operator-visible behavior actually ships.

Do not renumber existing ADRs.

---

## Legacy `docs/constraints.md`

The retired `docs/constraints.md` mixed:

- current architecture;
- superseded architecture;
- implementation diaries;
- milestones;
- test evidence;
- unresolved proposals.

Its durable current decisions have been folded into canonical docs and the ADRs in this directory.

During the **code-comment/reference sweep**, references such as `D68`, `D71`, and `D83` must be replaced by either:

- the applicable canonical document;
- the corresponding ADR; or
- no comment at all when the code already explains the rule.

Do not keep the old constraints document as a permanent lookup table solely to support stale comments.

Git preserves the original decision text and chronology.

---

## Review rule

When requested work conflicts with an Accepted ADR, follow the *Contract-change protocol* above. The goal is explicit evolution, not frozen architecture.

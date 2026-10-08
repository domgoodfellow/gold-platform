# GildOps Roadmap

## Purpose

This document defines the **current product and engineering sequence for GildOps**.

It answers:

- What is active now?
- What is next?
- Which capabilities depend on which others?
- What must be true before customer migration or broader rollout?
- Which ideas are deliberately deferred?

This is not a historical diary.

Shipped work belongs in `CHANGELOG.md`.

Architecture belongs in:

- `docs/product.md`
- `docs/domain-model.md`
- `docs/architecture.md`
- `docs/decisions/`

Detailed implementation tasks belong in issues, work orders or the active execution system.

---

## Status vocabulary

Use only:

| Status | Meaning |
| --- | --- |
| **ACTIVE** | Work is currently being executed or is the immediate engineering focus. |
| **NEXT** | Begins after the ACTIVE gate is satisfied. |
| **PLANNED** | Required, but not immediately next. |
| **DEFERRED** | Intentionally waiting for stronger evidence or prerequisite work. |
| **DONE** | Acceptance criteria are demonstrably satisfied. |

A capability is not `DONE` because:

- a route exists;
- a schema exists;
- a component exists;
- a test exists;
- a provider account was configured.

It is done when the stated outcome is usable and verified end to end at the required boundary.

---

## Current position

GildOps already has substantial platform capability across:

- multi-tenant identity, membership and authorization;
- CRM/customer relationships;
- work, scheduling, resources and locations;
- Communications foundations across calls, messaging and email;
- tenant Finance;
- Platform catalogue, commercial and provider foundations;
- Automations;
- AI/model runtime and usage foundations;
- Studio forms, website publishing and customer-facing experiences;
- public booking and portal flows;
- Connections and provider infrastructure;
- usage/cost accounting;
- organization provisioning and setup foundations.

The primary problem is no longer absence of code.

The primary problem is **coherence**:

```text
product ownership
+
navigation
+
settings
+
UI grammar
+
control-plane boundaries
+
commercial enforcement
+
provider operability
+
documentation
```

must agree.

The current program therefore prioritizes consolidation and operational completeness before adding broad new surface area.

The operational CRM pass now provides Customers, independent Opportunities, Follow-ups and their calendar, an actionable Home, per-stage pipeline previews, currency-safe expected-close forecast and event-backed conversion. Communications now has an operational Home, canonical Inbox/Calls/Numbers destinations and visible configuration; provider provisioning and deeper two-way Communications completion remain in R3. Contacts, probability-weighted forecasting, marketing lead acquisition and deeper sales analytics remain later expansions.

---

## Program sequence

```text
R0  Documentation reset
↓
R1  UI recovery and application coherence
↓
R2  Commercial / entitlement hardening
↓
R3  Provider control plane + Communications front desk
↓
R4  Missing operator domains earn real surfaces
↓
R5  GildOps dogfood + provisioning hardening
↓
R6  NextFund onboarding / migration rehearsal
↓
R7  Broader customer rollout
```

Desktop remains outside this sequence until demand justifies it.

---

## R0 — Documentation reset

**Status: ACTIVE**

### Outcome

The repository has a small, coherent documentation system in which each concern has one authoritative owner.

Canonical set:

```text
README.md
CLAUDE.md
CHANGELOG.md

docs/
  product.md
  domain-model.md
  architecture.md
  ui-system.md
  security.md
  data.md
  integrations.md
  public-web.md
  testing.md
  development.md
  deployment.md
  operations.md
  roadmap.md
  decisions/
    README.md
    ADR-*.md
```

Legacy documents that duplicate or contradict these owners are retired after the replacement set is bridged into the repository.

### Acceptance criteria

R0 is done when:

1. every canonical document exists;
2. every document has one clear responsibility;
3. the canonical documents agree on:
   - GildOps naming;
   - workspace taxonomy;
   - Person / Organization / Platform scope;
   - Settings ownership;
   - Provider vs Connection;
   - Finance vs Platform commercial control;
   - AI/Automation ownership;
4. stale documents are removed or explicitly archived;
5. repository instructions point only to canonical documents;
6. there is no live document that still directs implementation toward the retired Sales/Service/Insights workspace model;
7. the changelog uses actual dates;
8. a code-comment sweep is planned separately rather than preserving stale documentation through comments.

---

## R1 — UI recovery and application coherence

**Status: NEXT**

### Outcome

The application stops behaving like a collection of individually authored pages and uses one coherent UI grammar.

This phase begins from evidence, not redesign-by-instinct.

### Workstreams

#### 1. UI rule audit

Audit all UI-affecting documentation and code contracts.

Classify rules as:

```text
CANONICAL
STALE
CONTRADICTORY
AMBIGUOUS
UNIMPLEMENTED
DUPLICATE
IMPLEMENTATION DETAIL
```

Do not silently reconcile contradictions.

---

#### 2. Surface inventory

Inventory every reachable application surface:

- route;
- scope;
- workspace/domain owner;
- source file;
- surface archetype;
- layout chain;
- header;
- navigation context;
- primary task;
- primary action;
- responsive state;
- permission/entitlement behavior;
- implementation state.

Include:

- Organization;
- Account;
- Access;
- Connections;
- Plan & usage;
- Platform Administration;
- public/customer;
- auth;
- onboarding/setup;
- error/state surfaces.

---

#### 3. Shared UI inventory

Inventory:

- primitives;
- application components;
- patterns;
- feature-local duplicates;
- page-local duplicates.

Pay particular attention to:

- page/header systems;
- Settings navigation;
- sidebars;
- workspace disclosure;
- DataTable/collection behavior;
- sections;
- forms;
- drawers/panels;
- Activity/Insights/Configure;
- breadcrumbs/back behavior;
- page width and spacing.

---

#### 4. Pattern inconsistency measurement

Measure structural and visual divergence.

High-priority inconsistencies include:

- repeated title/description blocks;
- arbitrary card usage;
- route-local width constraints;
- spacing drift;
- duplicate Settings paths;
- duplicate local navigation systems;
- mismatched action placement;
- inconsistent empty/error states;
- desktop-only composition;
- controls whose appearance and behavior disagree.

---

#### 5. Screenshot audit

Use an exhaustive browser capture harness for **audit**, not as canonical visual regression.

Capture:

- desktop;
- tablet/compact;
- phone;
- route/runtime errors;
- failed requests;
- unreached dynamic routes.

The purpose is to find drift.

Do not bless every existing screen as a visual baseline.

---

#### 6. Canonical archetypes

Every routed surface maps to one primary archetype from `docs/ui-system.md` or is explicitly specialized.

The key correction is:

> **Card is not an archetype.**

Neither is:

```text
Title
Description
Random bordered containers
```

---

#### 7. Migration dependency map

Map:

```text
surface
↓
archetype
↓
shared pattern
↓
primitive
↓
layout / navigation dependency
```

Refactor high-fan-out foundations before migrating dozens of pages independently.

---

### Priority defects

R1 explicitly includes the Settings/navigation defects already identified:

- Settings landing and ownership must remain five independent scopes;
- Organization must not duplicate Access;
- `Members`, `Invitations`, `Roles` belong only to Access;
- Account profile must be actually editable;
- email change must use secure identity proof;
- signed-in password change must verify the current password / required fresh proof;
- account-menu disclosure/chevron state must behave correctly;
- Connections navigation must have one real canonical set;
- configuration links must point to the authoritative owner;
- Settings rows/sections must use consistent spacing and hit targets;
- Platform Administration must remain visibly and permission-wise distinct from ordinary business administration.

Recent fixes improve these areas but do not remove the need for the full UI-system audit.

---

### Acceptance criteria

R1 is done when:

1. every reachable surface is inventoried;
2. every shared surface primitive/pattern is classified;
3. inconsistency is measured rather than described vaguely;
4. the screenshot audit can capture the application deterministically;
5. each major surface maps to a canonical archetype;
6. the migration dependency graph exists;
7. Settings has no duplicate ownership paths;
8. workspace navigation follows one interaction contract;
9. representative desktop/tablet/phone surfaces satisfy `docs/ui-system.md`;
10. new UI work can be implemented without inventing another page grammar.

---

## R1.5 — Code-comment and stale-reference sweep

**Status: PLANNED**

This begins after R0 is complete and the new documentation names are stable.

### Outcome

Source comments explain local non-obvious reasoning without acting as a second architecture document.

### Remove or rewrite

- references to retired `docs/constraints.md`;
- references to old D-numbers where the current rule is now obvious from canonical docs/ADRs;
- milestone archaeology;
- comments that repeat the code;
- comments that describe a previous implementation rather than the current one;
- branding comments that say GOLD where human-facing GildOps is intended;
- stale “future” comments for already-built behavior;
- huge comments that should be tests, ADRs or documentation.

### Preserve

Comments that explain:

- non-obvious provider behavior;
- security-sensitive reason;
- database edge case;
- protocol quirk;
- intentional compatibility behavior;
- reason an apparently simpler implementation is unsafe.

The rule is:

> Comment the **why that cannot be recovered from the code**, not the what.

---

## R2 — Commercial and entitlement hardening

**Status: PLANNED**

### Outcome

GildOps can sell, activate, meter and enforce product capability through one commercial model.

Canonical chain:

```text
Catalogue
↓
Product / Module / Feature
↓
Plan + Add-ons
↓
Subscription / Commercial Terms
↓
Entitlements
↓
Limits / Allowances
↓
Usage
↓
Customer charge
```

Authorization remains separate.

---

### Required completion

#### Catalogue

Platform staff can manage the actual sellable capability model without editing code.

The catalogue must not drive operator navigation directly.

---

#### Plans and Add-ons

Reusable packages must resolve into explicit Features, allowances and limits.

Do not model each Organization's commercial state as a hand-written permission list.

---

#### Subscription

Provider-backed subscription state must reconcile to the package the Organization actually agreed to.

Historical commercial terms remain explainable.

---

#### Entitlement enforcement

Every consequential optional capability must answer both:

```text
Is the Organization entitled?
Is the actor authorized?
```

Enforcement must exist at the trusted write boundary.

Navigation gating alone is insufficient.

---

#### Usage

Every metered capability writes to the one normalized Usage Event model.

Provider cost remains separately attributable.

---

### Acceptance criteria

R2 is done when:

1. catalogue management is operable through Platform Administration;
2. Plans/Add-ons are reusable data;
3. subscriptions reconcile to commercial terms;
4. resolved entitlements/allowances are inspectable by Platform and the Organization where appropriate;
5. applicable writes cannot bypass missing entitlement through RPC, automation, API or UI;
6. usage is normalized and auditable;
7. Platform provider cost and tenant retail charge remain separate;
8. GildOps' own Organization can use the same commercial model without exemption.

---

## R3 — Provider control plane and Communications front desk

**Status: PLANNED**

### Outcome

Provider-backed Communications can be provisioned and operated through GildOps itself, and the front-desk workflow reaches useful end-to-end completion.

The provider control plane is proved through Communications/Voice before being generalized further.

---

### Provider control plane

Platform staff must be able to:

- configure supported Provider Accounts;
- verify credentials;
- create/inspect Organization bindings;
- inspect provider resources;
- detect missing/drifted resources;
- retry/reconcile operations;
- inspect normalized health;
- see usage and provider cost attribution.

Routine operation must not require opening the provider console for every customer.

---

### Twilio / telephony

Per-Organization telephony must use the intended provider-binding/resource model.

A customer should not inherit another customer's Twilio scope because of shared platform credentials.

---

### Front-desk loop

The target loop is:

```text
call received/placed
↓
one canonical Call
↓
recording where allowed/configured
↓
transcription
↓
analysis / structured understanding
↓
Customer/Conversation/Timeline context
↓
proposed follow-up/domain actions
↓
authorized approval/execution
```

The exact AI/speech provider is an adapter/runtime decision, not the business model.

---

### Browser calling

Browser phone capability must move from token boundary to real operator surface before it is treated as complete.

---

### Two-way Communications

Email, SMS and Voice should converge at the Communications ownership layer without erasing their channel-specific data.

Support/CRM may consume the same conversation context.

They do not own copies.

---

### Acceptance criteria

R3 is done when:

1. an entitled Organization can be provisioned for Communications without code edits;
2. provider resources are visible and diagnosable in Platform;
3. provider drift/retry/reconciliation has an operational path;
4. calls/messages/email preserve canonical domain ownership;
5. a controlled Voice journey works against real provider credentials;
6. recording/transcription/analysis/proposed-action flow is demonstrated where enabled;
7. usage/cost/health are captured;
8. no tenant needs access to the platform provider credential.

---

## R4 — Operator-domain completion

**Status: PLANNED**

Canonical workspaces are:

```text
CRM
Communications
Marketing
Support
Finance
AI
Automations
Field
Studio
```

Registration does not mean visibility.

A workspace earns navigation only when it has a real reachable operating surface.

Marketing, Support and tenant AI now have authenticated first-stage Homes with honest starting states. Their operating domains remain planned; these Homes add no campaigns, cases, AI activity records or provider configuration.

---

### Studio and public distribution

Studio already has substantial authored website and Form capability, but public distribution is complete only when the full public-web contract in `docs/public-web.md` is operable.

Remaining hardening includes, where not already proven in the running environment:

- public hostname/domain readiness and reconciliation;
- governed public Media rather than reuse of operational Assets;
- legal-document publication where required;
- safe public authentication/context preservation;
- attribution and consent that use canonical domain ownership;
- browser verification of published/draft/unknown-host behavior.

Do not create a separate public-web data model for Customers, Work or Finance.

## Support

Support must become a real operating domain for:

- Cases;
- Requests;
- Queues;
- assignment;
- priority;
- service targets;
- escalation;
- resolution.

Rule:

```text
Communications owns the conversation.
CRM owns the relationship.
Support owns the problem being resolved.
```

Do not build Support as another inbox.

---

### Marketing

Marketing's Home establishes acquisition scope. Deeper workflow remains planned for:

- audience;
- segmentation;
- campaign intent;
- acquisition;
- attribution;
- lifecycle/promotional consent.

Studio owns authored public/customer content.

Communications owns delivery.

CRM owns the relationship.

---

### AI

Tenant AI's Home establishes the business's AI operating scope separately from the global Agent and Platform AI Runtime. Deeper operating features remain planned.

Do not add a workspace row merely to satisfy the canonical taxonomy.

---

### Insights

Insights remains cross-cutting.

It may have deep report routes and contextual entry points.

Do not reintroduce it as a global operator workspace.

---

### Acceptance criteria

R4 is done when each visible workspace:

1. has a real Home;
2. has at least one meaningful operating surface;
3. owns a distinct lifecycle/problem;
4. uses canonical cross-domain records instead of copies;
5. obeys entitlement/permission projection;
6. is verified across relevant viewport classes.

---

## Cross-cutting hardening obligations before R5

The retired point-in-time audits identified several still-live architecture obligations that must not disappear merely because the audit documents are removed.

### AI / Automation operation boundary

Before dogfood readiness:

- Automation actions that mutate business state must call canonical domain operations rather than maintain private copies of status, schedule, create-work or message behavior.
- AI/tool/action declarations must not remain several competing lists that disagree on capability, entitlement or approval requirements.
- connected-resource grants must be enforced by the tools that consume connected resources;
- an approved AI action must leave an auditable link from the originating Agent run to the resulting domain mutation/event;
- approval remains explicit for consequential actions according to the security/domain policy.

Do not solve this by creating a general unrestricted agent executor.

### Scheduling privacy boundary

Travel feasibility is already part of staff scheduling for configured mobile Resources.

Public booking travel remains incomplete until GildOps can evaluate surrounding private schedule/location context on a trusted boundary and return only the public feasibility answer.

A visitor must never receive another customer's coordinates merely to calculate a booking slot.

Other scheduling improvements such as closures/holidays, service areas, traffic refinement, route optimization and dispatch are driven by demonstrated product need rather than assumed as one giant scheduling engine.

## R5 — GildOps dogfood and provisioning hardening

**Status: PLANNED**

### Outcome

GildOps operates its own business through the same product boundaries a customer uses.

GildOps is:

```text
an ordinary Organization for tenant operations
+
a separately authorized Platform operator
```

No tenant-zero exemption.

---

### Provisioning chain

The intended customer transition is:

```text
accepted proposal
↓
Organization
↓
owner Membership
↓
Plan / agreement
↓
Entitlements
↓
initial configuration
↓
readiness
↓
launch
```

Sales discovery must seed onboarding.

Known information is confirmed or corrected, not asked from scratch.

---

### Required hardening

Routine operations must be possible without:

- Claude;
- VS Code;
- GitHub edits;
- Supabase Studio;
- manual SQL;
- provider-console work for ordinary provisioning;
- environment editing for ordinary customer setup.

This does not mean provider consoles cease to exist.

It means the product has a supported operational path.

---

### Readiness

Provisioning must expose real readiness for:

- identity/access;
- commercial entitlement;
- organization configuration;
- required Connections;
- provider resources;
- Communications;
- public experiences;
- payment/billing when required for launch.

Readiness must distinguish:

```text
not required
not configured
configured
verification pending
ready
degraded
failed
```

---

### Acceptance criteria

R5 is done when:

1. GildOps uses an ordinary Organization;
2. Platform authority remains independently permissioned;
3. GildOps has a real Plan/Subscription/Entitlements/usage history;
4. a new customer can be provisioned through product controls;
5. discovery data seeds setup;
6. required readiness can be inspected and retried;
7. provider/config drift is visible;
8. routine support/provisioning does not require source/database edits.

---

## R6 — NextFund onboarding and migration rehearsal

**Status: PLANNED**

### Important boundary

**NextFund is not currently a GildOps tenant by assumption.**

It becomes an Organization/customer only through the normal provisioning path.

Do not seed architecture with:

```text
NextFund already exists as tenant
```

unless the actual environment proves that state.

---

### Outcome

NextFund can adopt GildOps without creating a customer-specific fork.

The immediate high-value reusable capability remains its Communications/dialer workflow and provider configuration.

---

### Migration sequence

```text
inventory source workflows/data
↓
map to canonical GildOps domains
↓
identify real platform gaps
↓
close reusable gaps
↓
provision NextFund normally
↓
configure provider resources
↓
rehearse data/workflow migration
↓
reconcile
↓
cut over
↓
retain rollback evidence
```

---

### First migration scope

Do not automatically migrate all legacy data.

Prioritize:

- Communications/dialer behavior;
- Twilio/provider resources;
- call routing;
- numbers;
- permissions;
- required customer/lead context;
- workflows required for parity.

Expand data migration only from explicit business need.

---

### Acceptance criteria

R6 is done when:

1. NextFund is provisioned through the normal customer path;
2. no NextFund-specific product fork exists;
3. provider resources are isolated to its Organization;
4. indispensable workflows have parity;
5. migration mapping is documented;
6. rehearsal is repeatable;
7. reconciliation proves expected counts/state;
8. rollback/cutover evidence exists;
9. the migration reveals reusable capability, not hidden customer exceptions.

---

## R7 — Broader customer rollout

**Status: PLANNED**

Broader rollout begins after GildOps can repeatedly provision, operate, support and meter customers without engineering intervention for routine cases.

Key evidence:

- more than one real Organization shape;
- repeatable onboarding;
- measurable customer outcomes;
- stable provider operations;
- understandable pricing/usage;
- supportability;
- controlled migrations;
- reliable Production operations.

The product should expand from observed customer work, not speculative completeness.

---

## Deferred — Desktop application

**Status: DEFERRED**

Desktop becomes justified when the browser cannot provide a required operational capability such as:

- headset/device behavior;
- tray operation;
- local printing;
- global hotkeys;
- persistent local integration.

The desktop client must reuse the same product/domain model and UI system.

Do not create it merely because a desktop shell could exist.

---

## Cross-cutting gates

Every roadmap phase must satisfy the following.

### Product ownership

The feature has one canonical owner.

### Tenant/platform scope

Organization and Platform responsibilities are not mixed.

### Authorization

The actor's authority is enforced at the trusted boundary.

### Entitlement

Commercial access is enforced independently where applicable.

### Data

Tenant integrity and history rules are preserved.

### UI

The surface uses a canonical archetype and shared grammar.

### Provider

External vendors remain behind adapters/control-plane contracts.

### Testing

Evidence matches the risk and actual boundary.

### Operations

Failures can be understood and recovered from.

---

## What does not belong in this roadmap

Do not add:

- every implementation task;
- every route;
- every migration;
- every bug;
- completed slice diaries;
- giant “done” inventories;
- old architecture preserved for history.

Use:

```text
issues / work orders
→ implementation tasks

CHANGELOG.md
→ shipped changes

docs/decisions/
→ architectural history

Git
→ exact change history
```

This roadmap should remain readable as the current sequence of outcomes.

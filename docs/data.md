# GildOps Data & Persistence

## Purpose

This document defines the **canonical data-modeling, persistence, integrity, migration and query rules for GildOps**.

It answers:

- Which information is authoritative?
- How should tenant-owned data be represented?
- Which constraints belong in the database?
- How are identifiers, relationships, time and money modeled?
- When should state be snapshotted, derived, cached or appended?
- How are schema changes introduced safely?
- How should read/write models avoid becoming competing sources of truth?

Canonical domain meaning belongs in `docs/domain-model.md`.

Security and authorization rules belong in `docs/security.md`.

System layering belongs in `docs/architecture.md`.

Implementation status belongs in `docs/roadmap.md`.

---

## Data objective

The data model should:

> **Represent reality accurately, preserve important history, make invalid states difficult, and keep authoritative ownership explicit.**

A database is not merely storage.

It is one of the primary places where GildOps enforces:

- tenant isolation;
- referential integrity;
- uniqueness;
- lifecycle constraints;
- transactional correctness;
- historical evidence.

Application code should not repeatedly compensate for ambiguity that the data model could remove.

---

## Sources of truth

### CRM Follow-up persistence and operating reads

`crm_follow_ups` stores future/actionable CRM work. Organization-leading foreign keys enforce Customer and owner scope; `(organization_id, customer_id, opportunity_id)` also enforces the Opportunity's Customer. RLS requires tenant membership and `follow_up.manage` for writes. Column grants protect identity, creator and completion evidence. An invoker trigger stamps completion and records created/updated/completed/cancelled Events in the existing log atomically. Completed/cancelled records cannot be edited or deleted. Customer activity uses snapshotted Customer attribution.

The security-invoker `opportunity_worklist` derives the earliest open Follow-up and future-open existence. `crm_pipeline_preview` partitions records by stage, including null/Unstaged, and returns at most ten per stage for the board; `opportunity_stage_summary` supplies exact counts and currency-safe totals. `crm_dashboard_summary` computes exact operating counts, grouped text minor-unit totals, and selected-month closure metrics under caller RLS. These are projections, not parallel persistence.

### CRM Opportunity persistence

CRM Opportunities use `opportunities` and `opportunity_stages` as canonical storage. Composite Organization-leading foreign keys bind Customer, stage and owner Membership to the same tenant. Value and currency are jointly nullable; each stored value is a non-negative, JavaScript-safe integer in minor units. Aggregate sums return decimal integer text and remain separate per currency. Expected close is a calendar `date`, not a timestamp.

Opportunity writes and their existing-log events commit together through an invoker trigger. Event snapshots preserve title, stage name/classification, value, currency, owner and expected close. Used stage classifications cannot change, including after Opportunities move away. Opportunity/stage deletion is not offered. The security-invoker `opportunity_stage_summary` SQL projection retains empty configured stages and counts unstaged records separately; it is not another persistence model.

Different kinds of truth live in different places.

### Domain meaning

Canonical meaning belongs in `docs/domain-model.md`.

The schema should implement that meaning.

---

### Schema truth

The authoritative database structure is the current PostgreSQL schema produced by forward migrations.

Applied migrations are historical evidence.

Do not rewrite them.

---

### Current business state

Current entity state belongs in canonical domain tables/records.

Examples:

- Customer current stage;
- Work Item current status;
- Connection current lifecycle;
- Subscription current provider-backed state.

---

### Historical facts

Historical facts belong in immutable or append-oriented structures where later configuration must not rewrite their meaning.

Examples:

- Events;
- Usage Events;
- payment records/corrections;
- invoice lines;
- historical rates;
- provider cost components;
- accepted commercial terms.

---

### Derived/read state

Derived state may exist for:

- reporting;
- performance;
- enforcement;
- search;
- UI composition.

It is not automatically authoritative.

Every derived representation needs a known upstream source and refresh/synchronization rule.

---

## Finance operating reads

Finance operating reads use `finance_invoice_records`, `finance_quote_records` and `finance_payment_records` as security-invoker projections over canonical records. They persist no alternative financial state. Invoice standing projects immutable line totals less signed payments; quote values project snapshotted Work pricing. Collection filters, exact counts and pagination run in PostgreSQL. `finance_dashboard_summary` additionally enforces tenant membership and `report.read`, groups money by stored currency, and applies Organization timezone to selected-period payment boundaries. Receivables aging uses actual due instants and retains a separate no-due-date bucket. No FX conversions, payment-method inference or historical rewrites occur. Aggregate amounts cross the JSON boundary as integer strings; supported-display-range checks refuse unsafe JavaScript integers. Canonical invoiced/incurred report reads retrieve every ordered result page before calculating per-currency totals. Preview limits never define dashboard aggregates.

## Tenant ownership

Tenant-owned business data belongs to one Organization.

The normal representation is:

```text
organization_id
```

on the tenant-owned row.

This is both:

- domain ownership;
- security scope.

---

### Organization-scoped references

A relationship between two tenant-owned entities must preserve Organization consistency.

Prefer database relationships that make this invalid state impossible:

```text
organization A record
linked to
organization B record
```

Where practical, use composite foreign keys including `organization_id`.

Do not rely only on application pre-checks.

---

### Tenant-scoped uniqueness

Uniqueness that is business-local should generally include Organization scope.

Examples:

```text
(organization_id, invoice_number)
(organization_id, configured_key)
(organization_id, external_resource_identity_when_tenant_local)
```

Do not accidentally impose global uniqueness on values each business reasonably controls independently.

---

### Global identifiers

Some identifiers must be globally unique because the caller arrives without an Organization context.

Examples can include:

- public invitation token;
- public access token;
- active hostname/domain claim;
- another opaque externally presented locator.

These exceptions should be deliberate.

---

## Identifiers

Use stable opaque identifiers for durable records unless the domain requires another identity.

Avoid making:

- display name;
- mutable slug;
- provider label;
- email address;
- phone formatting;

the primary internal identity of a record.

Public slugs or human-readable identifiers may coexist with an opaque internal ID.

---

## Keys and relationships

### Primary keys

Every durable entity has one stable primary identity.

Prefer surrogate UUID-style keys unless a strong natural-key reason exists.

---

### Foreign keys

Use foreign keys for durable relationships when the referenced record exists in the same authoritative database.

Do not replace explicit relationships with free-form JSON IDs merely for convenience.

---

### Composite keys

Use composite tenant-aware references where needed to enforce cross-tenant integrity.

The database should reject mismatched tenant relations even if the caller bypasses normal application code.

---

### Polymorphic relationships

Polymorphic identifiers such as:

```text
entity_type
entity_id
```

should be used sparingly because they weaken ordinary foreign-key enforcement.

Prefer typed relationships when ownership/integrity matters.

Event/timeline infrastructure may be an intentional exception when the product needs cross-domain subjects, but the event must still carry sufficient context for correct projections.

---

## Nullability

`NULL` should mean a real domain state.

Good examples:

```text
currency = NULL
→ organization has not chosen a currency yet

last_verified_at = NULL
→ verification has never happened
```

Do not use `NULL` to mean several unrelated things.

Do not introduce a default value merely to avoid handling “unknown” or “not configured.”

Unknown is not zero.

Unconfigured is not a fake default.

---

## Enums, checks and reference tables

Choose the representation based on lifecycle.

### Check constraints / closed values

Use when:

- the vocabulary is truly application-defined;
- values change only through code/schema changes;
- invalid values must be structurally impossible.

Examples:

- narrow system lifecycle states;
- actor kinds;
- implementation states.

---

### Reference/configuration tables

Use when:

- each Organization configures its own vocabulary;
- labels/order/policy may change;
- records refer to configured definitions.

Examples:

- Work statuses;
- Work Types;
- CRM stages;
- Role definitions;
- custom field definitions.

---

### Do not use a generic status field

A generic `status` column is not automatically a domain model.

Define:

- what lifecycle it represents;
- allowed values;
- who changes it;
- whether transitions matter;
- whether provider observations differ from business state.

---

## Money

Money must not use floating-point arithmetic.

Canonical representation:

```text
amount_minor: integer/bigint
currency: explicit ISO-style currency code
```

Examples:

```text
1250 CAD
= 12.50 CAD

1250 JPY
= 1250 JPY
```

Formatting uses the currency's fraction-digit rules.

---

### Currency ownership

Organization currency is configuration.

Do not assign a silent global currency merely because the first market uses one.

When an Organization has not chosen a required currency, money-creating operations should fail clearly rather than invent one.

---

### Historical currency

A committed money record carries the currency required to interpret it later.

Do not join historical amounts to the Organization's current currency and reinterpret them.

---

### Cross-currency arithmetic

Do not sum amounts across currencies without an explicit conversion model.

Where reporting conversion exists:

- preserve source amount/currency;
- preserve selected FX evidence/rate;
- preserve reporting amount separately;
- represent missing conversion as unknown.

Missing FX is not zero.

---

## Time

Time modeling must distinguish absolute instants from recurring local business time.

---

### Absolute instants

Persist event timestamps and scheduled instants with timezone-aware types.

Use UTC/`timestamptz` semantics for absolute time.

Rendering uses the relevant Organization/user timezone.

Automations operating aggregates use `automation_operating_summary`, a security-invoker function over RLS-protected canonical rules history and message deliveries. Runs, failures, local-date trends and delivery-state counts use explicit half-open period boundaries; latest execution metadata retains lifetime scope. Current rule/configuration collections are read in ordered pages, while monitoring previews and history pages remain bounded. Rule deletion and template editing do not rewrite historical run names or resolved delivery content. Authorized condition/action edits update only configuration columns atomically; tenant, rule identity, creation attribution, action position and immutable trigger columns cannot be reassigned through that grant.

---

### Organization timezone

Organizations own an IANA timezone.

The timezone controls interpretation/rendering of business-local schedules where appropriate.

Do not rely on the application server timezone.

---

### Recurring local time

Recurring concepts such as:

- operating hours;
- resource working hours;

are local-time policy.

They are not absolute timestamps until resolved for a particular date/timezone.

---

### Time ranges

Scheduling ranges should use explicit bounded semantics.

For work occupancy, half-open intervals are generally preferred:

```text
[start, end)
```

so back-to-back work can meet at one instant without overlap.

---

## Historical integrity

GildOps must distinguish current configuration from committed historical facts.

Use the appropriate strategy.

---

### Snapshot

Copy the necessary terms onto the committed record.

Use when later source edits must not rewrite history.

Examples:

- invoice line;
- priced work line;
- checklist instance;
- import mapping snapshot.

---

### Effective dating

Use when a rule/rate legitimately changes over time and historical records need to resolve the version effective at the event time.

Examples:

- retail rate;
- provider rate;
- FX rate;
- commercial term.

---

### Append-only correction

Use when an original record is evidence and should not be overwritten.

Examples:

- payment reversal/correction;
- provider cost reconciliation;
- usage adjustment where applicable;
- audit/event history.

---

### Current mutable state

Use ordinary updates where the domain concept genuinely represents present state rather than historical evidence.

Examples:

- Customer current stage;
- Work Item current status;
- Connection current status.

The lifecycle still needs event/audit evidence where required.

---

## Events

Events record that something meaningful happened.

They are useful for:

- timeline/activity;
- automation;
- reporting;
- AI context;
- audit.

An Event does not replace canonical entity state unless the architecture explicitly adopts event sourcing for that domain.

GildOps is not generally event-sourced.

---

### Event requirements

A consequential Event should carry enough information to answer:

- what happened;
- when;
- which Organization;
- which actor;
- which entity/entities;
- relevant immutable context needed by consumers.

Events should not require a future mutable join to determine basic historical meaning if that meaning needs preservation.

---

## Usage and commercial ledgers

There is one canonical tenant-facing commercial Usage Event ledger.

A Usage Event represents:

```text
what the Organization consumed
how much
when
which meter
how allowance/retail treatment applied
```

Do not create parallel usage ledgers per provider.

---

### Provider cost decomposition

A Usage Event may have multiple Provider Cost Components.

This separates:

```text
customer-facing usage concept
from
provider-billed fulfilment ingredients
```

Provider cost components preserve:

- provider;
- cost meter;
- quantity;
- effective rate/version;
- native amount/currency;
- conversion evidence where applicable;
- reconciliation/adjustment state.

---

## Provider lifecycle data

Provider-observed resources must distinguish:

- GildOps-owned local record;
- external/provider identifier;
- observed lifecycle;
- last verification/reconciliation.

A tenant must not be able to forge provider-observed resource facts by writing ordinary table rows.

---

## Integration data

Connector catalogue state and Organization Connection state are different data sets.

Canonical separation:

```text
platform connector definition
≠
organization connection
≠
external resource
≠
import run
```

See `docs/integrations.md`.

---

## Custom fields

Custom fields extend selected canonical entities.

A custom-field system should include:

- definition;
- key;
- label;
- type/kind;
- options where applicable;
- required policy;
- position/order;
- Organization scope.

Stored custom values must conform to the Organization's active field definitions.

---

### Custom-field constraints

Do not use custom fields for a concept that has become core product semantics.

If every customer/workflow begins to depend on the same field, promote it to a canonical domain field/model rather than hiding product logic in configurable JSON.

---

## JSON and JSONB

Use JSON/JSONB for:

- provider metadata;
- deliberately flexible payloads;
- event context;
- bounded configuration whose shape is validated elsewhere;
- external payload snapshots where preserving source data is useful.

Do not use JSONB to avoid modeling:

- important foreign keys;
- tenant ownership;
- monetary amounts;
- core lifecycle state;
- frequently queried canonical attributes.

JSONB still requires input validation and ownership rules.

---

## Transactions

Use a transaction when several changes form one logical operation.

Examples:

- schedule a Work Item and commit resource assignments;
- accept a proposal and create the canonical handoff state;
- write a provider result plus reconciliation evidence;
- perform a lifecycle transition plus its required event.

If partial success would create an invalid business state, the operation should be atomic.

---

## Concurrency

Do not rely on:

```text
read
if free
write
```

for race-sensitive invariants.

Examples:

- scheduling overlap;
- uniqueness;
- one-active-record constraints;
- idempotent provider processing.

Use:

- constraints;
- row/table locking where necessary;
- atomic RPCs;
- unique indexes;
- exclusion constraints;
- conflict-safe insert/update patterns.

---

## Idempotency

Operations that can be retried must define an idempotency strategy.

Common cases:

- webhooks;
- provider callbacks;
- recurring usage emission;
- imports;
- provisioning;
- billing reconciliation.

Use stable external keys or operation keys where the same real-world event can arrive more than once.

---

## Deletion, archive and retention

Deletion semantics are domain-specific.

Choose deliberately among:

- hard delete;
- soft delete;
- archive;
- revoke;
- disable;
- release;
- anonymize.

Do not add `deleted_at` universally without a lifecycle reason.

---

### Preserve referenced history

Financial, audit, usage and provider evidence often must survive the deletion of a related operational record.

Prefer lifecycle/reference rules that preserve interpretability.

Example:

Deleting/archiving a Customer relationship must not make old invoices/payments historically meaningless.

---

## Data access patterns

### Lists

Collections should support bounded retrieval.

Use:

- pagination;
- cursoring;
- bounded limits;
- indexed filters;

according to expected scale.

Do not load an unbounded organization's full history merely because the demo dataset is small.

---

### Detail reads

Detail read models may compose several canonical sources.

The composition can live in the application layer.

Do not denormalize every related fact into the entity merely to simplify one page.

---

### Reports

Reports may use:

- views;
- aggregates;
- reporting queries;
- materialized structures where justified.

Reporting data must remain traceable to canonical operational sources.

A report definition/aggregate is not permission to expose rows the user could not otherwise read unless the report has its own explicit disclosure permission.

---

## Indexes

Indexes exist for actual access patterns and integrity.

Candidates include:

- foreign-key join/filter paths;
- common Organization-scoped collection filters;
- ordering/pagination;
- uniqueness;
- exclusion constraints;
- provider external identifiers;
- event/time queries.

Do not index every column reflexively.

Indexes increase:

- write cost;
- storage;
- migration complexity.

---

## Database functions / RPCs

Use database functions when they provide a meaningful authoritative boundary, such as:

- narrow privileged write;
- atomic multi-row transition;
- data operation requiring database-side enforcement;
- scoped reporting aggregate;
- public/machine operation with deliberately restricted grants.

Functions should:

- have a clear domain name;
- take the minimum required input;
- resolve authoritative facts server/database-side where possible;
- return only necessary output;
- have deliberate volatility/security settings;
- have explicit grants.

Avoid giant “do anything” RPCs.

---

## RLS and data access

RLS is part of the data model for multi-tenancy.

Tenant tables should define policies that align with domain ownership and capabilities.

Schema review must include:

- is RLS enabled?
- is it forced where required?
- who can SELECT?
- who can INSERT?
- who can UPDATE?
- who can DELETE?
- which columns are writable?
- which functions can bypass ordinary table grants?

See `docs/security.md` for authorization rules.

---

## Column-level grants

Use column grants when the security/domain model requires callers to update only selected attributes.

This can prevent accidental or malicious mutation of immutable identity/history fields.

Example categories:

- custom-field definition attributes whose key/kind must remain stable;
- provider-observed values;
- system-managed counters/state.

---

## Read models and caches

A read model exists to improve consumption.

It must declare:

- source;
- refresh mechanism;
- staleness expectations;
- scope/security;
- whether it can be rebuilt.

A cache is disposable if the canonical source remains intact.

Do not store an opaque derived cache whose loss would destroy business truth.

---

## Search

Search indexes should point back to canonical records.

Search results are projections.

Search does not own duplicated records.

Tenant identity/scope must be encoded/enforced in search retrieval.

---

## Files and storage

File metadata and storage bytes must have explicit ownership.

A stored object should be resolvable to:

- Organization;
- artifact/document record;
- access policy.

Do not rely only on a storage path string to define authorization.

Public assets should be public intentionally, not because a bucket was made broad for convenience.

---

## Database migrations

All schema changes happen through forward migrations.

Rules:

1. migration files are immutable after application;
2. never rewrite history to rename branding or clean comments;
3. one migration should have one coherent purpose;
4. migration names should explain the invariant/change;
5. destructive changes require explicit compatibility/migration thinking;
6. data backfills must be deterministic and bounded;
7. grants/RLS must be updated with schema changes;
8. generated database types must be refreshed after schema changes;
9. tests must prove new invariants.

---

### Expand / migrate / contract

For risky live changes, prefer staged evolution:

```text
expand schema
↓
write/read compatibility
↓
backfill/migrate
↓
switch callers
↓
verify
↓
remove old path
```

Avoid destructive “rename and hope every caller changed” migrations when compatibility matters.

---

## Generated database types

Generated database types are checked-in representations of the current schema for application use.

They are generated artifacts, not the source of schema truth.

After schema changes:

```text
migration
↓
database reset/apply
↓
regenerate types
↓
typecheck/tests
```

Do not hand-edit generated database types to make TypeScript pass.

---

## Seed/demo data

Demo and test seeds should exercise real domain paths where practical.

Seed data must not become hidden production defaults.

A demo's assumptions do not define the canonical domain.

---

## Environment separation

Development, test, preview and production databases are distinct operational contexts.

Do not:

- run destructive reset tooling against production;
- let local test credentials become production credentials;
- infer production schema state solely from local files without migration verification.

Operational procedures belong in `docs/deployment.md` and `docs/operations.md`.

---

## Data-quality rules

When ingesting external/imported data:

- preserve source evidence where useful;
- validate type/domain constraints;
- normalize deliberately;
- do not silently coerce ambiguous values into false certainty;
- report rejected/unmapped data;
- make retries/reconciliation explicit.

Examples:

```text
invalid phone
unknown currency
unmapped stage
ambiguous date
missing customer owner
```

should not become invented valid facts.

---

## Unknown, zero and absent

These are different states.

```text
0
= known numeric zero

NULL / unknown
= no reliable value

not applicable
= concept does not apply

not configured
= configuration absent
```

Do not convert unknown into zero for convenience.

This rule is especially important for:

- provider costs;
- FX;
- rates;
- usage economics;
- external readings.

---

## Modeling a new entity

Before creating a table, answer:

1. What domain owns the concept?
2. Is it canonical or a projection?
3. What is its stable identity?
4. Is it Organization-owned, Person-owned or Platform-owned?
5. What lifecycle does it have?
6. Which relationships are required?
7. Which invariants belong in constraints?
8. What must be historically preserved?
9. Which fields are current mutable configuration?
10. Who can read/write it?
11. Does it need event/audit evidence?
12. What queries will access it at expected scale?
13. Can it be represented by an existing canonical model instead?

If the ownership/lifecycle is unclear, the table design is premature.

---

## Data anti-patterns

Do not introduce:

- tenant-owned rows without an explicit tenant boundary;
- application-only cross-tenant integrity checks;
- money as floating point;
- timestamps without timezone for absolute instants;
- current configuration joined to reinterpret historical amounts/terms;
- provider-specific IDs used as primary business identity;
- mutable audit/history rows where append-only evidence is required;
- generic JSONB bags for canonical relationships;
- one global default currency silently assigned to every Organization;
- unbounded collection queries;
- duplicate ledgers for the same business fact;
- derived data with no known authoritative source;
- `0` used for unknown cost/rate/FX;
- hand-edited generated database types;
- schema changes performed outside forward migrations;
- soft-delete fields added automatically to every entity;
- a universal generic status model without domain lifecycle semantics.

---

## Data verification

A data-model change is complete only when the relevant invariants are proven.

Depending on the change, verify:

- migration applies from a clean database;
- schema constraints exist;
- RLS/grants are correct;
- cross-tenant write/read is refused;
- valid domain operations succeed;
- invalid state cannot be inserted directly;
- transaction rollback is atomic;
- retries are idempotent;
- historical snapshots remain stable after configuration edits;
- generated types are current;
- expected collection queries are indexed/bounded.

Where the invariant belongs to PostgreSQL, test it against real PostgreSQL.

---

## Document boundaries

This document owns:

- persistence conventions;
- tenant data modeling;
- identifiers/relationships;
- money/time representation;
- history/snapshot rules;
- events and ledgers;
- transactions/concurrency;
- indexes/query patterns;
- migrations;
- database functions;
- generated schema types;
- data-quality rules.

It does not own:

- canonical business definitions;
- UI;
- authentication journeys;
- provider API contracts;
- deployment commands;
- roadmap status.

Those belong to the respective canonical documents.

## Marketing persistence

Marketing persistence uses organization-bound composite foreign keys for Campaign, Audience, Form, submission, Customer and Membership references. Campaigns and inquiries preserve history and have no authenticated deletion grants. Dynamic audience definitions are typed version 1 filters, not materialized copies of CRM identities. Acquisition provenance snapshots only historical source names and bounded UTM context; submitted answers and immutable revision definitions remain Studio-owned. Tenant/submission uniqueness and a private request fingerprint ledger enforce acquisition idempotency; inquiry row locks enforce canonical CRM handoff idempotency. Landing page associations retain tenant-bound published Studio revision and page references. Reporting calendar boundaries use the organization timezone. Campaign/inquiry period, state and association indexes support exact database aggregates and bounded paginated collections. The Marketing migration follows the repository's latest migration sequence, whose existing timestamps extend beyond the workstation date.

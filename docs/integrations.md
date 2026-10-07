# GildOps Integrations & Providers

## Purpose

This document defines the **canonical architecture and terminology for external systems, provider infrastructure, tenant Connections, credentials, synchronization, imports, webhooks and adapters in GildOps**.

It answers:

- What is a Provider?
- What is a Provider Account?
- What is a Connector?
- What is a tenant Connection?
- Where do credentials live?
- How do webhooks, OAuth, retries and reconciliation work?
- How are external resources represented?
- How should new integrations be added without leaking vendor semantics into domains?
- How are file imports different from connected applications?

Canonical domain definitions belong in `docs/domain-model.md`.

Security requirements belong in `docs/security.md`.

Persistence conventions belong in `docs/data.md`.

System layering belongs in `docs/architecture.md`.

Implementation status belongs in `docs/roadmap.md`.

---

## Core principle

External systems are dependencies, not owners of the GildOps domain model.

Use:

```text
GildOps domain
↓
capability / connector contract
↓
adapter
↓
external provider/system
```

Do not allow:

```text
external vendor SDK
↓
domain model
```

A vendor may supply a capability.

The vendor's vocabulary should not automatically become GildOps' business vocabulary.

---

## Two integration axes

GildOps has two fundamentally different external-system axes.

They must remain separate.

---

### Axis 1 — Platform Provider infrastructure

This represents infrastructure GildOps operates or buys to deliver product capability.

Canonical concepts:

```text
Provider
↓
Provider Account
↓
Provider Binding
↓
Provider Resource
```

Examples:

- GildOps' telephony provider account;
- GildOps' email-delivery provider account;
- GildOps' AI model provider account;
- GildOps' payment/platform-billing provider account;
- Organization-specific provider subaccounts/resources provisioned beneath those accounts.

This axis is controlled through **Platform Administration**.

---

### Axis 2 — Tenant Connections

This represents an Organization choosing to connect its own external application/account/data source to GildOps.

Canonical concepts:

```text
Connector
↓
Connection
↓
Connection Credential
↓
Integration Resource
↓
Import / Sync / Tool capability
```

Examples:

- one Organization's Google account;
- one Organization's Microsoft account;
- one Organization's GitHub account;
- one Organization's supported CRM/document/source system.

This axis is controlled through **Settings → Connections**.

---

## Do not conflate the axes

These are not synonyms:

```text
Provider Account ≠ Connection
Provider Binding ≠ Connection
Provider Resource ≠ Integration Resource
Connector ≠ Provider
```

Example:

```text
Twilio
  may be a Provider used by GildOps

GildOps Twilio account
  = Provider Account

Organization Twilio subaccount / provisioned number
  = Provider Binding / Provider Resource

Organization connecting its own Google account
  = Connection
```

Different trust, credential and lifecycle rules apply.

---

## File intake is a third concept

A file is not an integration merely because it can import data.

A file upload may be used as a one-time input.

Examples:

- CSV;
- PDF;
- Markdown;
- TXT;
- supported spreadsheet/document formats.

Canonical flow:

```text
File
↓
File intake/parser
↓
Mapping/validation
↓
Import Run
↓
Canonical domain writes
```

Do not create fake Connector catalogue entries called:

```text
CSV
Spreadsheet
PDF
Markdown
```

unless an actual external application/system relationship exists.

---

## Platform Provider model

### Provider

A **Provider** is an external supplier of a technical capability.

Examples of capability classes include:

- telephony;
- messaging;
- email delivery;
- payments;
- platform billing;
- AI inference;
- geocoding;
- routing;
- domains/DNS;
- hosting/deployment;
- source control.

Providers are identified in Platform infrastructure.

Business domains consume capabilities rather than depending directly on provider brands.

---

### Provider Service

Where one vendor supplies several distinct capability classes, the Platform may model provider services separately.

Example:

```text
one vendor
├── SMS
├── Voice
├── Number provisioning
└── Recording
```

A Provider Service describes what the provider can supply.

It does not itself grant an Organization entitlement.

---

### Provider Account

A **Provider Account** is a GildOps-controlled relationship/account/credential set with a Provider.

It may include:

- platform-side label;
- provider-side external account identifier;
- credential kind/reference;
- status;
- verification state;
- default/selection policy;
- provider-specific metadata.

Provider Account credentials are Platform-private.

Tenant users must not read them.

---

### Provider Account lifecycle

Provider Accounts should have explicit state.

Typical concerns:

- active/disabled;
- credential present/absent;
- verified/unverified/error;
- last verification;
- default account policy.

Disabling a Provider Account should not silently delete historical bindings/resources.

It prevents or changes future operation according to the relevant capability policy.

---

### Provider Binding

A **Provider Binding** associates an Organization or platform function with the provider scope used to fulfil a capability.

Examples:

- Organization → telephony subaccount;
- Organization → provider-managed sending scope;
- Organization → managed provider project/account scope.

A binding may contain:

- Organization;
- Provider key;
- Provider Account;
- provider external account/scope identifier;
- lifecycle;
- verification/reconciliation state.

A binding does not expose the parent Provider Account secret.

---

### Provider Resource

A **Provider Resource** is a concrete external resource observed or provisioned within a Provider Binding.

Examples:

- phone number;
- sending domain;
- subaccount;
- API resource;
- endpoint.

Store:

- stable local ID;
- binding;
- provider external ID;
- resource type;
- lifecycle/status;
- non-secret configuration/metadata;
- verification timestamps.

Provider-observed facts must not be tenant-forgeable ordinary fields.

---

### Provider Resource secret

A resource may have generated or associated secret material.

The ordinary application should not read the secret.

Use a narrow write/resolve boundary.

Example:

```text
Platform operation stores generated secret
↓
secret reference stored privately
↓
machine operation resolves it later
```

---

## Tenant Connector model

### Connector

A **Connector** is the Platform-owned catalogue definition describing an external application GildOps knows how to connect to.

It may describe:

- key;
- name;
- category;
- suite/vendor grouping;
- status;
- authentication method;
- connection method;
- capabilities;
- app/sub-product definitions;
- marketing metadata;
- implementation/readiness state.

A Connector is not an Organization's connection.

---

### Connector lifecycle

Canonical catalogue states may include:

```text
planned
beta
live
```

These are product/catalogue facts.

Operational readiness is a separate fact.

A connector can be:

```text
catalogue = beta/live
adapter missing
configuration missing
operational
```

Do not overload “planned” to mean “someone forgot to configure OAuth.”

---

### Connector readiness

Readiness should derive from independent facts such as:

- connector catalogue state;
- adapter implemented;
- deployment/provider registration configured.

Tenant-facing availability should only offer a Connect action when the deployment can actually honour it.

Platform operators may see more detailed reasons:

```text
upcoming
adapter missing
needs setup
operational
unknown
```

A tenant should not be asked to diagnose Platform infrastructure.

---

### Connector capability

A Connector may advertise supported capability classes, such as:

- app connections;
- data mapping;
- scheduled sync;
- triggers/actions;
- agent tools;
- external resources.

These capabilities are descriptive integration capability.

They are not Organization entitlement grants.

---

### Connector app

A suite connector may expose multiple apps/products.

Example:

```text
Google
├── Drive
├── Calendar
├── Gmail
└── Maps
```

Each supported app may have its own:

- implementation state;
- vendor availability;
- docs/reference;
- Feature relationships.

Do not imply every app in a suite is implemented because the parent Connector exists.

---

## Connection

A **Connection** is one Organization's durable relationship with a Connector.

A Connection should have:

- Organization;
- Connector;
- lifecycle/status;
- authorization/credential reference;
- creation/update timestamps;
- relevant connection metadata.

Connection state is tenant-owned.

The Connector definition is Platform-owned.

---

### Connection lifecycle

Use explicit lifecycle states appropriate to the implementation.

Conceptually distinguish:

```text
connecting
connected
needs attention
disconnected
failed
```

Do not represent all failures as “not connected.”

Preserve enough state to explain recovery.

---

### Multiple Connections

Do not assume one Organization can have only one connection to a Connector unless the product intentionally enforces that rule.

Real cases may require:

- multiple Google accounts;
- multiple repositories;
- multiple external business units;
- separate environments/accounts.

If cardinality is constrained, encode the reason explicitly.

---

## Connection credentials

A Connection may use:

- OAuth 2;
- API key;
- another supported delegated authentication method;
- no credential for public/read-only integrations.

Credentials belong to the Connection boundary.

They must not be rendered back as ordinary application fields.

---

### OAuth

OAuth flow:

```text
User starts Connect
↓
GildOps creates/binds state
↓
Browser goes to provider
↓
Provider redirects to fixed callback
↓
GildOps verifies state
↓
Token exchange
↓
Credential stored privately
↓
Connection becomes usable
```

Required properties:

- anti-CSRF state;
- state bound to intended Organization/Connector;
- fixed/validated redirect URI;
- no open redirects;
- provider errors handled safely;
- tokens stored server-side;
- refresh lifecycle supported where needed.

---

### API key Connection

API-key connectors should use a write-only credential flow.

The application may show:

```text
Credential configured
Last verified
Needs attention
```

It should not show the stored API key again.

Verification should use a trusted server operation.

---

## Organization Secret References

Some Organizations need to provide private values that are not full app Connections.

Examples:

- partner API key;
- specialized customer-owned credential for a stated workflow.

Represent these as **Secret References**, not fake Connections.

A Secret Reference has:

- key/name;
- label;
- purpose;
- status;
- created/updated/rotated metadata;
- last-use metadata.

The ordinary web runtime may manage the reference and replace/rotate the value without reading it back.

---

## Integration Resources

A Connection may expose external resources.

Examples:

- repositories;
- calendars;
- drives;
- folders;
- accounts;
- workspaces;
- lists.

An **Integration Resource** is an external object visible through a Connection.

It must preserve:

- Connection/Organization ownership;
- external identity;
- resource type;
- display metadata;
- lifecycle/availability where relevant.

It is not automatically imported into a GildOps canonical entity.

---

## Resource grants to AI

An Organization may allow AI to use selected connected resources.

This is an explicit grant layer.

Do not treat:

```text
Connection exists
```

as:

```text
AI may read everything in the connected system
```

Resource/tool grants should be:

- Organization-scoped;
- explicit;
- revocable;
- permission-aware.

AI tool access remains subject to the actor's own authority.

---

## Imports

### Import Run

An Import Run is one auditable ingestion attempt.

It should preserve:

- Organization;
- source type;
- source Connection/resource/file reference;
- mapping snapshot;
- input metadata;
- execution state;
- row counts;
- errors/rejections;
- result/reconciliation metadata.

---

### Mapping

Mappings translate source vocabulary into canonical GildOps fields/entities.

A mapping used by an Import Run should be snapshotted or versioned so a later mapping edit does not rewrite what an earlier import claims it did.

---

### Validation

Imported data must pass canonical domain validation.

An import does not gain permission to create invalid records because the source system contained them.

---

### Idempotency and reconciliation

Repeated imports should define how duplicates are detected.

Possible keys include:

- external source ID;
- stable source row identity;
- import-specific dedupe key.

Never infer deduplication from display name alone when data integrity depends on it.

Import results should report:

```text
created
updated
skipped
rejected
needs review
```

as appropriate.

---

## Synchronization

A persistent Connection may support synchronization beyond one-time import.

Sync must define:

- direction;
- source of truth per field/entity;
- polling/webhook trigger;
- checkpoint/cursor;
- conflict policy;
- deletion policy;
- retry policy;
- reconciliation behavior.

Do not implement “two-way sync” as an unspecified feature.

Two-way synchronization requires explicit conflict ownership.

---

### One-way inbound sync

External system is authoritative for selected source fields.

GildOps ingests according to mapping policy.

Canonical GildOps-owned fields remain protected.

---

### One-way outbound sync

GildOps is authoritative and publishes selected state externally.

External failures do not silently mutate GildOps canonical state.

---

### Bidirectional sync

Use only where business requirements justify the complexity.

Define per-field/per-entity authority and conflict resolution.

Avoid timestamp-wins as a default unless it is actually correct for the domain.

---

## Adapter architecture

Provider/vendor-specific implementation lives in adapters.

Canonical shape:

```text
index / capability contract
registry / resolver
provider implementation
```

Example:

```text
lib/adapters/payments/
  index.ts
  registry.ts
  stripe.ts
```

Domain code imports the capability contract, not the provider implementation.

---

### Adapter responsibilities

An adapter may own:

- provider SDK calls;
- provider request/response translation;
- provider-specific identifiers;
- provider-specific error mapping;
- provider retry semantics;
- authentication/signing;
- capability verification.

It should return GildOps capability/domain-shaped results.

---

### Registry responsibilities

The registry selects which implementation fulfils a capability.

Selection may depend on:

- Platform provider policy;
- Provider Account;
- Organization Provider Binding;
- runtime assignment;
- environment/configuration.

Do not scatter provider-selection `if vendor === ...` branches across domain code.

---

## Internal APIs

Important runtime boundaries are contracts even when internal.

Examples:

```text
web → api
agent → tool
automation runner → domain command
web → provider-operation API
```

Contracts should define:

- operation;
- input schema;
- output schema;
- authentication;
- authorization;
- failure model;
- idempotency where applicable.

Do not expose persistence tables directly as the API contract merely because PostgREST exists.

---

## Commands and queries

Prefer contracts that express intent.

Examples:

```text
PlaceCall
SendMessage
VerifyProviderAccount
BeginProviderBinding
ImportCustomers
RefreshConnection
```

over generic low-level mutation endpoints.

Queries should be read-only in intent.

Commands may mutate.

A GET/read operation should not carry hidden consequential side effects.

---

## Webhooks

Provider webhooks are untrusted until verified.

Canonical processing:

```text
Receive
↓
Verify authenticity
↓
Parse/validate
↓
Deduplicate
↓
Resolve local provider/account/resource
↓
Apply canonical operation
↓
Record processing/reconciliation
```

---

### Verification

Use the provider-supported authenticity mechanism:

- signature;
- shared secret;
- asymmetric signature;
- authenticated callback;
- another documented provider method.

Do not invent custom verification where the provider already supplies a secure standard.

---

### Target resolution

Prefer resolving Organization/business context from a stored trusted relationship:

```text
provider resource external ID
↓
Provider Resource / Binding
↓
Organization
```

instead of trusting an arbitrary `organization_id` in the payload.

---

### Ordering

Provider events may arrive late or out of order.

Lifecycle updates should prevent stale events from regressing newer known state.

Where provider ordering/version identifiers exist, preserve/use them.

---

## Idempotency

Anything providers or jobs may retry must be idempotent.

Examples:

- webhook event;
- checkout callback;
- recurring phone-number usage event;
- provisioning;
- import execution;
- scheduled sync;
- OAuth callback finalization.

Use stable operation identifiers rather than “check if it looks similar.”

---

## Retries

Retry only operations likely to succeed later.

Classify errors:

```text
transient
rate limited
provider unavailable
auth expired
invalid request
permission denied
not found
conflict
permanent policy failure
```

Do not endlessly retry:

- invalid credentials;
- unsupported operation;
- malformed data;
- authorization refusal;

without state change.

---

### Backoff

Use provider-appropriate exponential/backoff behavior with jitter where relevant.

Respect `Retry-After` and provider rate-limit guidance.

Do not coordinate all workers to retry at the same instant.

---

## Reconciliation

Webhooks and synchronous requests are not enough to guarantee external consistency.

Where the provider controls durable external state, support reconciliation.

Examples:

```text
Provider Binding exists locally
but remote subaccount is missing

Connection says connected
but token is revoked

Phone Number is active locally
but provider reports released
```

Reconciliation state should distinguish:

```text
in sync
remote missing
remote changed
unknown
needs attention
```

Do not silently overwrite discrepancies without a defined authority rule.

---

## Readiness

Readiness is a derived operational fact.

It may combine:

- catalogue status;
- adapter implementation;
- provider registration/configuration;
- credential presence;
- verification;
- binding/resource state.

Readiness should be reported honestly.

Do not show “Available” merely because a Connector row exists.

Do not show “Healthy” when no health/verification action has actually occurred.

---

## Provider health

Health and verification are different from configuration existence.

Possible facts:

```text
credential configured
last verified successfully
last verification failed
not verified yet
provider unavailable
```

The UI should present the strongest fact actually known.

---

## Rate limits and quotas

External providers may impose:

- requests per second;
- concurrency limits;
- daily quotas;
- per-account limits;
- per-resource limits.

Adapter/runtime design should account for those constraints.

Where GildOps sells a normalized limit or allowance, do not expose raw provider quota semantics as the product model unless they intentionally match.

---

## Provider costs and usage

Provider cost belongs to Platform economics.

Domain/provider integration code may emit enough evidence to calculate:

- normalized Usage Event;
- provider cost components;
- provider resource attribution.

Tenant users see their customer-facing usage/charges, not GildOps wholesale/provider cost.

---

## AI/model providers

AI providers follow the same provider architecture.

Canonical flow:

```text
Product AI capability
↓
Platform runtime assignment
↓
Provider Account
↓
provider adapter
↓
model
```

Domain/product code should not hard-code:

```text
OpenAI
Gemini
Anthropic
```

when it needs:

```text
answer
draft
extract
classify
tool-use model
```

Provider/model metadata may be visible in Platform Administration for operations/cost/health.

---

## Communications providers

Telephony/messaging providers require special care because external resources and callbacks are stateful.

Use:

- Provider Account;
- Organization Provider Binding;
- provider-observed Phone Number/resources;
- server-decided sender identity;
- callback verification;
- canonical Call/Conversation/Message state.

Do not let browser input assert the authoritative sending number/address.

---

## Email providers

Distinguish:

```text
Platform email
  GildOps → its own users
  invitations/security/product mail

Tenant email
  Organization → its customers

Sending-domain management
  proving/configuring Organization domain
```

These may use the same vendor but are different capabilities and security boundaries.

Do not merge them because the provider brand is shared.

---

## Payment providers

Distinguish:

```text
Tenant payment processing
  Customer → Organization

Platform billing
  Organization → GildOps
```

Use separate provider configuration, webhook verification and domain write paths where the money direction differs.

Do not let one payment webhook role gain the other's authority.

---

## DNS/domain/hosting providers

Public hostname/domain flows may involve:

- DNS provider;
- deployment/hosting provider;
- domain verification;
- certificate/route provisioning.

The Organization-facing concept remains its Domain/Hostname/Public Site.

Provider details remain infrastructure behind that concept.

---

## Source-control integrations

Source control is a tenant Connection when an Organization connects its own repository/account.

A repository is an Integration Resource.

It is not automatically an importable customer-data source.

Capability labels and UI should reflect what the connected resource is actually used for.

---

## MCP and agent connectors

A Connector may be implemented through:

- native adapter;
- MCP;
- automation;
- custom bridge.

The connection method is implementation strategy.

It does not change:

- tenant ownership;
- credential rules;
- resource grants;
- authorization;
- audit requirements.

MCP tools exposed to AI remain tools under the security model.

---

## Observability

Every important external operation should emit enough structured evidence to troubleshoot without exposing secrets.

Record or log as appropriate:

- operation/request ID;
- Provider/Connector;
- Provider Account/Connection ID;
- Organization where applicable;
- external event/resource ID;
- attempt count;
- latency;
- normalized result;
- safe error category;
- retry/reconciliation state.

Do not log plaintext credentials or token-bearing URLs.

---

## Failure ownership

An integration failure must be attributable to the correct layer.

Examples:

```text
catalogue planned
adapter missing
platform registration missing
credential expired
provider unavailable
remote resource missing
tenant permission denied
mapping invalid
domain validation rejected
```

Do not collapse all of these into:

> Integration failed.

Different failures require different owners and recovery actions.

---

## UI ownership

Tenant-facing Connections UI belongs under:

```text
Settings → Connections
```

Platform provider infrastructure belongs under:

```text
Platform Administration → Providers / Integrations
```

Do not expose parent provider-account credentials in tenant Settings.

Tenant-facing pages may show the Organization's resulting provider-backed resources/readiness where the user needs to operate them.

Presentation does not transfer control-plane ownership.

---

## Adding a Provider

Before implementing a new Provider:

1. identify the capability it supplies;
2. define/confirm the capability contract;
3. determine whether GildOps owns the provider account;
4. define credential storage;
5. define Provider Account lifecycle/verification;
6. define Organization Binding requirements;
7. define provider resources;
8. define callbacks/webhooks;
9. define idempotency/reconciliation;
10. define provider rates/cost meters if commercially relevant;
11. add Platform operational surfaces;
12. add tests at adapter/provider/security boundaries.

Do not begin by importing the vendor SDK into a domain module.

---

## Adding a Connector

Before implementing a new Connector:

1. define the external application/system;
2. define Connector catalogue metadata;
3. define auth method;
4. define connection method;
5. define actual supported apps/capabilities;
6. implement readiness reporting;
7. define Connection lifecycle;
8. define credential storage/refresh;
9. define external resources;
10. define import/sync/tool behavior;
11. define permissions and AI grants;
12. add tenant Connections UI;
13. add Platform support/operational view where needed;
14. test OAuth/API-key failure and revocation.

Do not advertise a Connect control until the deployment is genuinely connectable.

---

## Adding an import format

Before adding a file import:

1. define supported MIME/content formats;
2. define size/parser limits;
3. define parsing;
4. define mapping;
5. define domain validation;
6. define dedupe/idempotency;
7. define Import Run evidence;
8. define rejection/review UX;
9. define permission;
10. verify tenant isolation.

Do not add a Connector tile for the file format.

---

## Integration anti-patterns

Do not introduce:

- vendor SDK imports in domain code;
- provider names used as core domain concepts;
- Provider Accounts represented as tenant Connections;
- tenant Connections stored as Platform Provider Bindings;
- CSV/PDF/file formats as fake Connectors;
- plaintext credential readback;
- OAuth state not bound to Organization/Connector intent;
- open OAuth redirect URLs;
- webhook processing before signature/authentication;
- webhook organization ownership trusted from payload fields;
- non-idempotent provider callbacks;
- infinite retries on permanent failures;
- two-way sync without a conflict/authority model;
- “connected” status that ignores expired/revoked credentials;
- “available” connector UI when the adapter/configuration is missing;
- “healthy” status when no verification occurred;
- one generic integration error for every layer;
- raw provider quotas/pricing exposed as the product model;
- external resource IDs used as tenant business primary keys;
- AI access to all Connection resources merely because the Connection exists.

---

## Integration verification

A provider/integration change should prove the relevant layers.

### Contract tests

Prove:

- DTO/schema shape;
- error normalization;
- capability contract.

### Adapter tests

Prove:

- provider translation;
- auth/signing behavior;
- retry classification;
- provider-specific parsing.

### Database/integration tests

Prove:

- Organization ownership;
- credential metadata protection;
- RLS/grants;
- import mapping snapshots;
- idempotency;
- reconciliation state.

### API tests

Prove:

- OAuth state;
- webhook verification;
- malformed payload refusal;
- duplicate event handling;
- authorization.

### Provider-live tests

Use only when intentionally configured.

They prove the external vendor contract.

They are not a replacement for deterministic tests.

### Browser/E2E tests

Prove:

- Connect flow;
- reconnect/needs-attention state;
- browse availability;
- connection detail;
- import workflow;
- permission/entitlement behavior.

---

## Document boundaries

This document owns:

- Provider vs Connector taxonomy;
- Provider Accounts/Bindings/Resources;
- tenant Connections;
- credentials and secret-reference distinctions;
- OAuth;
- webhooks;
- imports and sync;
- adapter contracts;
- retries/idempotency/reconciliation;
- readiness and provider health;
- adding integrations/providers.

It does not own:

- domain entity definitions outside integrations;
- general authentication policy;
- schema DDL;
- commercial packaging;
- deployment-specific credential values;
- UI layout details;
- roadmap status.

Those belong to the respective canonical documents.

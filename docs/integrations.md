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

### Prospect CSV imports

Uploaded CSVs use the existing Customer import mapping, staging, source links and
commit functions. CSV intake retains every row within the file-size policy and
refuses malformed columns or quoting. Empty values and literal `null`, `none` and
`nan` normalize to missing values; email is optional. A missing business name stays
invalid for review instead of becoming an invented Customer.

The upload prepares optional tenant Customer fields for recognized contact,
website, industry, classification and company-size columns through the existing
field registry; this requires `field.manage` in addition to import authority.
Existing definitions and their kinds are preserved. Location mappings use the
existing Locations and Customer-location links; a province alone creates no site.
Unmapped source columns remain in raw staging metadata. Historical contact dates
do not create Calls, and a source do-not-call value is not permission to call.

Staging appends 100-row batches under a locked run and can replay identical batches.
Resume uses the frozen mapping and stored source. Application refuses incomplete
staging and commits at most 100 ready rows per invocation; a Running run can resume.
Completed runs are repeat-safe. Source IDs are scoped by the source filename; when
no ID exists, the canonicalized raw row supplies the key. Reordering records with
source IDs does not change identity. Renaming the source file changes its namespace;
keep the filename stable for repeat imports. Conflicting duplicate source keys are
refused rather than silently dropping rows. The source-link check is repeated at
commit under a tenant/source lock so concurrent runs cannot create duplicate Customers.

`20261215000001_prospect_import_batches.sql` replaces only the two existing import
functions and adds a read-only pipeline-version check. The app refuses imports
until that check confirms the repaired database contract. Hosted application
requires explicit migration approval; importing data
through a local web server connected to hosted Supabase still writes hosted data.

### Imported application library

GildOps imports pinned Activepieces community npm packages without an Activepieces account or hosted integration service (ADR-041). The installed catalogue currently contains 36 products and 64 reviewed read/search actions. Google and Microsoft products share their respective canonical connections. Metadata comes from the installed packages, including names, icons, schemas and authentication declarations; the web uses a generated projection and the API exposes authenticated, filtered, paginated discovery at `/integrations/library`.

The customer App Library supports search, category, workspace, connected-account filtering and pagination. Catalogue visibility is independent of deployment readiness. Connect is offered only when the runtime and supported authentication are configured. Custom authentication and unreviewed actions remain blocked. Native and MCP connection authorities are preserved.

API keys are verified against the vendor before storage in Supabase Vault. Supported OAuth uses the existing signed-state connection lifecycle and credential refresh. Imported read operations pass through canonical capability permissions and execution auditing; assistants and automations require existing grants. Neither action outputs nor catalogue metadata expose credentials. Imported triggers are discovered but are not subscribed or executed.

### Resource synchronization

The Resource Library retains `integration_resources` as the source-selection authority. `integration_resource_syncs` stores configuration, scheduling, source cursors and short leases. `integration_resource_records` stores tenant-scoped metadata or rows keyed by stable source identifiers. Only the integration machine role writes synchronization results; tenant RLS also checks the relevant workspace permission for record reads. Cursor and lease columns are unavailable to tenant sessions.

Google Drive and Calendar use change/sync tokens; OneDrive and Microsoft Calendar use Graph delta links. Initial discovery follows bounded pagination and fails rather than replacing selections with an incomplete result. Drive synchronization stores file metadata; calendar synchronization stores event metadata. Sheets and Excel reconcile a selected range of at most 500 data rows, using its first row as headers and a configured unique key column. Missing keys and duplicate keys fail the page. Snapshot completion tombstones removed rows; incremental feeds apply source deletion markers. Unchanged rows retain their source update time.

`resource_sync` configures or manually runs a selected resource. `/tasks/integration-sync` reconciles due selections every 15 minutes under `CRON_SECRET`; concurrent claims are refused and parameter changes are blocked during a live lease. Failures retain the cursor and expose a bounded error. A provider HTTP 410 starts a new snapshot with a fresh generation before reconciling removals. Source webhooks are not implemented.

Completed worksheet snapshots feed the existing customer import mapping, preview, staging and commit flow; no CRM data is written by synchronization itself. Library Sources consumes the same canonical resource list. Ledger, booking and document ingestion are not automatic. Calendar write-back, file-byte import, worksheet export, accounting writes and subscribed event triggers require additional reviewed contracts and live acceptance tests.

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

`assistant_resource_grants` is the per-resource reading gate. A tool grant that is limited to one resource
also requires that gate for an assistant (`assistant_may_read_resource`), so being granted a tool never
widens what the assistant may read.

---

## Tool grants and execution

A Connection says an external system is connected. It does not say who may use it, and nothing about how it
is connected changes that.

Five concepts stay apart, each in its own place:

| Concept | Owner | Meaning |
| --- | --- | --- |
| Capability | declared in code (`app.connectors`) | A read operation a native connector supports, with its inputs and the workspace that uses it |
| MCP server | `integration_mcp_servers` (one per Connection) | An external endpoint that offers tools |
| MCP tool | `integration_mcp_tools` | A tool a server lists, reviewed and enabled by the Organization |
| Grant | `integration_tool_grants` | One agent (or automation rule) may use one capability or tool, optionally on one resource |
| Execution | `integration_executions` | One invocation: who asked, which target, the decision and the outcome |

### Rules

- **Discovered is not enabled is not granted.** A listed tool starts unreviewed and disabled. A person with
  `integration.manage` reviews it (reads, or can change things) and enables it; only then can it be
  granted. A tool whose name, description or schema later changes returns to unreviewed and disabled; a tool
  the server stops listing is marked removed and disabled. Rediscovery never enables a tool or widens a grant.
- **An MCP tool always needs a person's approval in this slice.** A server's `readOnlyHint` is its own claim.
  The platform cannot enforce that a remote tool is read-only, so the reviewer's classification is recorded
  but never removes the approval step. The table refuses an MCP grant that does not require approval.
- **Both the agent's grant and the asking member's own permission must hold.** A grant is the agent's right.
  For a native capability, the member who asked the agent must also hold the permission that already says
  they work with that kind of data (`integration_capability_permissions`: customers, the diary,
  documents and files, messaging, the business's technical setup). A capability with no row is refused. An
  MCP tool has no such mapping, because what it does is unknown; a person approves each use instead.
  Automations have no asking member, so the grant and the rule being on are what hold.
- **Approval repeats the whole authorization.** A request and its approval ask the same function
  (`app.integration_execution_blocker`): grant, target, agent, resource limit, the agent's reading gate and
  the requester's permission, all as they stand at that moment.
- **Native capabilities only read.** No native capability that writes is declared, and the executor refuses
  one if it appears. A write needs its own permission and approval design.
- **The principal and the Organization come from the runtime, never from arguments.** The execution context is
  built only by `ExecutionContext.for_assistant` (a verified bearer token and the assistant resolved for that
  caller) or `for_automation` (a rule id). Postgres derives the Organization from the caller's membership or
  from the rule's own row, and refuses a business the caller is not in.
- **A model sees handles, not targets.** Each live grant is offered under an opaque handle. A name the model
  invents resolves to nothing; a grant revoked after the list was built is refused at the moment of the call.
- **Descriptions, schemas and results from a third party are untrusted.** They reach a prompt shortened and
  stripped, a schema reduced to its shape, and a result as bounded data. A credential used for a call is
  removed from anything returned.

### Execution sequence

```text
caller (agent or automation, on a verified session / its own rule)
↓
authorize (database): grant exists, belongs to this principal, target is live,
principal is active, resource limit holds, approval required?
↓ records the execution (allowed / refused / waiting for approval)
↓
allowed → read credential → native adapter or MCP client → bounded, redacted result
waiting → a person approves or rejects; approval re-checks everything, then runs what was stored
↓
outcome recorded (status, error class, duration, size)
```

A request made inside a conversation that a person later approves has its result held for that member,
bounded and for at most a day, until the conversation's next turn takes it once (`take_integration_results`).
The agent then reads it as quoted data at the start of that turn; a request that was declined or lapsed is
stated plainly. Taking it deletes it. A call that ran straight away returns its result to the caller and
nothing is held.

Authorization is asked before a credential is read. Approval is tied to one request: this principal, this
target, these arguments, an expiry; a client-supplied `approved` flag does not exist.

### What is recorded

Facts, not content: principal, target, decision and reason, approval state, outcome, error class, duration,
result size and a hash of the arguments. Arguments are held only while a request waits for a decision or is
running, and are cleared afterwards. A result is never part of this record; the one exception is the bounded
result of an approved request made inside a conversation, held in a column no signed-in role can read, until
the conversation takes it or a day passes. `purge_integration_executions` runs from the automation tick: it
fails calls that never reported back, expires requests nobody decided, drops undelivered results and deletes
terminal history past the retention window.

### Who can be granted

The operator agent (the assistant with an enabled `operator_copilot` deployment) is granted tools in
Connections. Public and website assistants are never given external tools.

An automation is granted a tool by adding a **"use a connected tool"** action to its rule
(`add_automation_tool_action`), which creates the rule's own grant and the action together and needs both
`automation.manage` and `integration.manage`. Removing the action ends the grant. Native read capabilities
only: an MCP tool needs a person to approve each use, and a rule has nobody to ask.

### Automations running tools

A rule carrying a `run_tool` action does not call anything itself. `app.run_automation` queues one call per
action and subject (`integration_action_queue`); the automation tick claims the queue through the integration
runtime's doors (the scheduler's own role gains nothing) and runs each call through the same executor under
the rule's identity. Outcomes are kept apart: a success is one row of the rule's history; a refusal or a
request that was never valid is recorded once and not repeated; only an app that could not be reached is tried
again, up to three attempts. Every attempt is its own execution record. What a call read is not stored, and
nothing downstream in a rule reads it yet, so today a tool action records that a read worked or why it did
not.

### Known limits

- Capability permissions use the nearest existing permission (for example `customer.update` for CRM data);
  there is no read-only permission in the role vocabulary today. The mapping is a platform-owned table and can
  be refined without touching any grant.
- An MCP tool's effect is unknown, so the asking member's permission is not checked for it; a person's
  approval of each use is the control. The person who triggered a request may approve it, and a business with
  one administrator will.
- An approved request runs when it is approved. Its result reaches the conversation's next turn, not the turn
  that asked; agent runs are not resumable.
- Automations read but do not yet use what they read; MCP tools are not offered to automations.
- MCP servers authenticate with a bearer token only.

### Health

`sync` verifies a connection as a whole and writes its health. An execution never marks a connection healthy,
and one refused operation (for example a scope never granted) does not mark it unhealthy; only a sign-in
that can no longer be renewed does.

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

### MCP servers

An MCP server is an ordinary Connection (`mcp_server`, method `mcp`), so its access token lives in the same
Vault path as any other credential and is disconnected, revoked and health-checked the same way. It has its
own screen (Settings → Connections → MCP servers) and is not offered through Browse apps, whose Connect
starts a vendor sign-in.

Registering a server (`mcp_connect`, `apps/api`) checks the address, stores the optional bearer token, then
initializes the server and lists its tools. It enables nothing.

Supported: remotely hosted servers over Streamable HTTP (protocol versions `2025-06-18` and `2025-03-26`),
authenticated by a bearer token or not at all. Not supported: stdio servers, OAuth for MCP servers, and
using a server's resources or prompts. Each is a separate piece of work.

### MCP transport safeguards

- HTTPS only; no credentials in the address; loopback, private, link-local, metadata and other non-public
  addresses are refused, including after DNS resolution (IPv4-mapped IPv6 included).
- The address is resolved once, checked, and then **connected to** with the original hostname carried as the
  `Host` header and the TLS server name, so a name that resolves differently later has nothing to change.
- Redirects are never followed.
- Responses are read as a bounded stream (1 MB), event streams are parsed as they arrive and read no further
  than the reply, and there is a total deadline per request. Discovery is bounded in pages, items and bytes.
- Replies that are not well-formed JSON-RPC are rejected. Protocol version is negotiated; an unknown one is
  refused.
- Credentials are never in a response, a log line, a discovery record or an error message: a server's own
  error text has the bearer token removed before it is kept.

**These are not a network control.** Address checks and pinning remove specific bypasses; they do not stop a
compromised runtime from reaching internal addresses. A deployment that lets a business name an endpoint must
filter outbound traffic from `apps/api` at the network (block private, link-local and metadata ranges), and
declares that by setting `GILDOPS_MCP_CUSTOM_ENDPOINTS=enabled-behind-egress-controls`. Without it, MCP
registration is refused, existing servers are not called, and Connections says custom servers are not
available. Vercel's Python functions do not give this control by themselves; do not set the variable on a
deployment that cannot enforce it.

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
14. test OAuth/API-key failure and revocation;
15. declare each read operation as a `Capability` on the connector (inputs, the workspace that uses it, and the
    resource it works on if any), with a test case in `test_integration_capabilities.py`. A connector that
    declares none offers nothing to an agent, and a capability that writes is refused until a write design
    exists.

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

# GildOps Security & Identity

## Purpose

### Imported connector execution boundary

Imported connector packages execute only whitelisted read/search operations. The Node worker accepts timestamped HMAC requests from the Python command layer; public callers cannot supply a usable credential or choose an arbitrary module. Normal requests reference an expiring single-use database job. Claiming rechecks connection state, tenant membership, permissions or assistant/automation grants before retrieving Vault credentials. Verification requests carry a candidate API key only after caller membership and `integration.manage` have been checked. Raw upstream diagnostics are not returned.

Synchronization configuration is tenant and workspace permission checked. Machine functions claim short leases and compare the lease on commit, refusing inactive connections and concurrent configuration changes. Tenant sessions cannot write synchronized records or read cursor/lease columns. Graph source cursors are constrained to HTTPS, the Microsoft Graph host and the selected source path. Results are bounded and known credential strings are redacted before returning them. Imported triggers and writes are disabled.

This document defines the **canonical security, identity, authorization, tenant-isolation and trust-boundary rules for GildOps**.

It answers:

- Who or what is acting?
- How is identity proven?
- Which scope is the actor operating in?
- What may the actor do?
- What may the Organization use?
- What data may be read or changed?
- Which trust boundaries require validation or verification?
- How are secrets and machine credentials handled?
- How do public users, providers, AI and automation interact with protected state?

This document defines current security requirements.

Product ownership belongs in `docs/product.md`.

Domain terminology belongs in `docs/domain-model.md`.

System boundaries belong in `docs/architecture.md`.

Deployment-specific secret placement and hosted-provider setup belong in `docs/deployment.md`.

Public websites, portal/proposal session architecture and hostname behavior belong in `docs/public-web.md`.

Security history belongs in `docs/decisions/`.

---

## Security objective

Customer service email requires mailbox confirmation and purpose-specific consent independently
of CRM identity and Portal bearer access. Confirmation codes are random, hashed for comparison,
session/customer bound, single-use, expire after 20 minutes and allow five guesses. Requests are
limited to one per minute and five per customer/hour. Restrictive message/detail read policies
hide confirmation bodies from tenant operators and Portal sessions; private challenge/job tables
have no human grants. Only a leased notification worker receives server-authored content.

Recipient operations derive organization/customer from live PortalContext; web actions also check
the request hostname. A different Portal session must confirm the mailbox again before modifying
preferences. Withdrawal records its actor and time, cancels queued notices and blocks pre-send
authorization of leased notices. Already accepted sends cannot be recalled. Concurrent withdrawal
after final send authorization may race an in-flight provider request; delivery history is retained.

Notification worker identity has no table grants and only claim, pre-send authorization and fenced
finish RPCs. Sender choice requires customer.update plus message.send; all sender/recipient/target
relationships carry organization scope. Canonical email suppression applies across sender identities
within the selling organization. Bounce, complaint and provider suppression observations block that
address; a generic synchronous API refusal does not. None of these observations becomes consent.
Provider callbacks continue to require the existing signed tenant-email webhook; clients cannot
write provider observations. No customer notification uses the platform invitation sender/key fallback.

Every meaningful operation must be performed:

```text
by a known or deliberately narrow actor
within an explicit scope
against an authorized resource
through a controlled trust boundary
with evidence appropriate to the risk
```

Security is not a UI feature.

Security is a property of the entire system.

---

## Core security principles

### Managed-service boundaries

Selling-Organization Membership admits relationship and engagement history, not the receiving tenant's private content. Commercial management uses `customer.update`. Linking an existing tenant additionally requires a live `platform_staff` row and independently granted receiving-tenant `organization.manage`. The signed action is tenant-manager approval; its agreement note is audit context, not authorization. Platform staff with no receiving-tenant management authority cannot forge consent through a note or a tenant UUID. Platform staff without selling-Organization management authority cannot link on that Organization's behalf. `existing_client_tenant_options` repeats those checks and lists only eligible tenants. Ending/relinking never grants or revokes Membership or cancels a subscription.

`client_tenant_summaries` exposes only already-linked tenant identity and Setup/Live state to selling-Organization members. Operational artifact selectors and summaries separately require target Membership, `organization.manage` for Studio/AI manager summaries, and canonical Automations module access for rule summaries. Platform staff is not an alternative to Membership at this boundary. Reference attachment rechecks ownership, permission, active relationship and non-terminal engagement inside the database transaction. The API uses the caller's authenticated database client; no service-role reader or generic cross-tenant data API is introduced.

Restricted references expose no tenant artifact names/content/status. Relationship ending immediately disables managed-service status projections and new artifact attachment while retaining references. Portal, proposal-session and public identities do not change. The browser never asserts ownership: typed foreign keys and RPC authorization refuse forged Customer, relationship, Opportunity and artifact identifiers independently.

### 1. Identity, membership, authorization and entitlement are different

The following questions are independent:

```text
Who is this actor?
Which organizations are they related to?
What may they do?
What may this organization use commercially?
```

Do not collapse them.

Authentication does not imply organization access.

Organization membership does not imply every permission.

Permission does not create commercial entitlement.

Commercial entitlement does not grant every person permission.

---

### 2. The browser is not trusted

The browser may:

- display permission state;
- hide unavailable actions;
- validate input for usability;
- preserve UI state.

It is not the authoritative enforcement boundary.

Every sensitive read and write must be refused independently by the trusted server/database boundary.

---

### 3. Tenant isolation is structural

Tenant isolation applies to:

- table reads;
- mutations;
- RPCs;
- files;
- provider resources;
- integrations;
- background jobs;
- AI context;
- exports;
- reports;
- caches;
- logs where tenant data appears.

Knowing an identifier must never grant access.

---

### 4. Platform authority is explicit

Platform Administration is more privileged than ordinary organization administration.

Membership in GildOps' own Organization is not Platform authority.

Platform permission must be checked explicitly.

---

### 5. Use narrow privileged doors

Privileged operations should be represented as narrow operations with the minimum required grant.

Prefer:

```text
verified webhook
↓
specific machine identity
↓
specific RPC/function
```

over:

```text
provider webhook
↓
general service-role client
↓
unrestricted database
```

---

### 6. Secrets are not application data

A secret may be accepted, stored and used.

It should not be casually readable back through the application.

Where possible:

```text
write secret
↓
store by reference
↓
machine resolves when needed
```

rather than:

```text
store
↓
list plaintext
↓
render in UI
```

---

### 7. External input is untrusted

Treat as untrusted:

- form input;
- route/query parameters;
- headers;
- webhook bodies;
- OAuth callbacks;
- uploaded files;
- provider responses;
- AI-generated text/tool arguments;
- imported data.

Validation must happen at the appropriate trusted boundary.

---

## Actor model

Canonical actor categories are:

### Account user

A non-anonymous authenticated Person.

May hold one or more Organization Memberships.

May also hold explicit Platform authority.

---

### Anonymous/external user

A narrowly scoped authenticated or public actor used for flows such as:

- public booking;
- proposal review;
- customer portal;
- public form submission.

An anonymous Supabase session is authenticated at the identity-provider level, but it is **not** an operator account.

It must never be treated as a normal Organization member merely because `auth.uid()` exists.

---

### Machine actor

A narrowly scoped machine identity used for a specific trusted operation.

Examples:

- payment webhook;
- platform billing webhook;
- voice webhook;
- automation runner;
- integration operator;
- provider operator.

A machine actor should hold only the database/API capability required for its operation.

---

### Provider caller

An external provider calling a webhook or callback.

Provider identity must be proven using the provider's supported authenticity mechanism before privileged processing.

A provider-supplied tenant ID is not authorization.

---

### AI agent

An AI model is not an independent authority.

The effective actor is the person/system context under which the tool is invoked.

AI tools must preserve that scope and permission boundary.

---

## Authentication

Authentication proves identity.

GildOps uses Supabase Auth as the primary human authentication authority.

Do not introduce a duplicate application user table to become a competing identity source.

---

### Supported authentication concepts

The identity architecture may support:

- password;
- OAuth;
- email verification/code flows;
- password recovery;
- future MFA/passkey capabilities where implemented completely.

The application must distinguish:

```text
normal authenticated session
recovery proof
fresh reauthentication proof
anonymous session
provider/OAuth account
```

These are not interchangeable security states.

---

## Password policy

Current password policy should enforce a strong minimum while allowing long passphrases.

Canonical requirements:

- minimum length: **15 characters**;
- accept long passwords/passphrases of at least **64 characters**;
- do not impose composition rules that encourage predictable substitutions unless a provider forces one;
- do not expose whether a login email exists through sign-in/recovery error wording;
- use leaked-password protection on hosted environments where available.

Exact hosted-provider toggles belong in `docs/deployment.md`.

---

## Sign in

Password sign-in should return one generic rejection for:

```text
unknown account
wrong password
```

Do not expose account enumeration through different messages.

OAuth sign-in redirects must use application-controlled return addresses.

Do not accept an arbitrary request-controlled redirect destination without validation against an explicit allowlist.

---

## Password recovery

Password recovery must:

- avoid revealing whether the address exists;
- use a provider-issued recovery/email-code proof;
- require fresh recovery authority before setting a new password;
- reject ordinary authenticated sessions as recovery proof;
- use fixed/validated redirect destinations.

A recovery link is not equivalent to knowing the current password.

---

## Signed-in password change

Changing a password from Account settings is a sensitive operation.

Required behavior:

```text
current password
new password
new password confirmation
```

The application must verify the current password against the acting account.

Do not rely solely on session age or a rendered password form.

Where the auth provider also supports secure password-change/reauthentication enforcement, enable it.

A temporary verification session must not replace the actor's active session or widen authority.

---

## Email change

Email is part of identity.

Changing it requires stronger proof than editing cosmetic profile metadata.

Required behavior:

1. verify the current actor;
2. obtain fresh proof tied to the current identity;
3. propose the new email;
4. use secure provider confirmation;
5. keep the existing address authoritative until the change completes;
6. issue security notifications according to provider capability.

Return URLs must be application-controlled or strictly validated.

User-editable profile metadata must not authorize the change.

---

## Personal profile

Personal appearance follows the same cosmetic ownership boundary. The dedicated
`account_appearance_preferences` table enables and forces RLS. SELECT/INSERT/UPDATE/DELETE
require `user_id = (select auth.uid())` and a JWT explicitly reporting a non-anonymous account;
missing or anonymous claims fail closed. `anon` receives no privileges. Ownership cannot be
reassigned to another account. Domain actions derive the account from verified `getUser`, accept
no caller-supplied user ID, and use the session client rather than service authority. Appearance
never decides membership, permissions, billing, branding or published website design.

Personal display-name/profile metadata is cosmetic.

It may improve UI presentation.

It must never decide:

- organization membership;
- role;
- capability;
- Platform authority;
- billing authority.

Organization-specific names belong to Membership/business context.

---

## Sessions

A session represents authenticated continuity.

Security-sensitive behavior must account for:

- session creation;
- expiration;
- renewal;
- logout;
- privilege changes;
- recovery/step-up proof;
- anonymous vs account identity.

A long-lived active session should not automatically satisfy every high-risk operation forever.

Sensitive actions may require fresh proof.

---

### MFA and session-management features

MFA, device/session listing, sign-out-other-sessions and recovery flows must be implemented as complete security journeys.

Do not expose an MFA enrollment switch and describe the account as MFA-protected unless:

- sign-in actually challenges appropriately;
- recovery is defined;
- sensitive operations enforce the required assurance level;
- loss/recovery behavior is safe.

Current implementation status belongs in `docs/roadmap.md`, not here.

---

## Organization authorization

CRM Opportunity creation requires `opportunity.create`; editing and stage movement require `opportunity.update`. Customer permissions grant neither. Stage configuration requires `field.manage`. Application actions check these capabilities, and tenant RLS plus column grants enforce them for direct authenticated database writes. Read access follows ordinary Organization Membership, with no new commercial module gate. Existing administrators with `organization.manage` receive the two Opportunity capabilities through a forward backfill; newly provisioned full roles use the canonical capability registry. No Opportunity or stage deletion grant is provided.

CRM Follow-up creation, editing, completion and cancellation require `follow_up.manage`, checked in server actions and RLS. Administrators receive the authority through a forward backfill; reduced roles receive no implied authority from Customer or Opportunity permissions. Follow-up routes and actions also check resolved feature entitlement/activation. Database column grants protect tenant/Customer identity, creator and completion attribution; the invoker trigger owns completion evidence and Events. Completed/cancelled records are immutable to authenticated callers, and deletion is not granted. Composite references enforce tenant scope and the attached Opportunity's Customer independently of application checks.

Organization access flows through:

```text
Person
↓
Membership
↓
Role / capabilities
↓
requested operation
```

Membership answers whether the Person belongs to the Organization.

Capabilities answer what they may do.

---

### Roles

Roles group capabilities.

Roles are organization-owned.

A role assignment is not a global Person attribute.

The same Person may have different Roles in different Organizations.

---

### Capabilities

Capabilities describe operations, not UI placement.

Prefer concepts like:

```text
customer.manage
role.manage
integration.manage
billing.manage
call.place
message.send
report.read
```

over concepts such as:

```text
sidebar.settings.access
show_button_x
```

UI projection consumes authorization state.

It does not define it.

---

## Server-side enforcement

Every protected route/action must establish authoritative context on the server/trusted boundary.

A client-visible check may improve UX, but direct requests must still fail without authority.

Examples of protected boundaries:

- server actions;
- route handlers;
- domain mutations;
- database functions;
- table policies;
- API endpoints.

---

## Row Level Security

RLS is a primary tenant-isolation control.

For tenant-owned data, policies should derive access from authenticated tenant relationships rather than browser-supplied claims.

Critical rules:

- RLS enabled and forced where the model requires it;
- tenant reads/writes restricted by Organization;
- capability-sensitive operations checked by policy/function;
- cross-tenant references structurally prevented;
- public/external policies deliberately narrow.

Do not treat a filtered application query as tenant isolation.

---

## Tenant-scoped schema rules

Tenant-owned rows normally carry `organization_id`.

Tenant-sensitive uniqueness and exclusion constraints should include Organization scope unless the identifier must be globally unique by design.

Examples of legitimate globally unique public identifiers may include:

- invitation token;
- public hostname;
- other externally presented opaque locator.

Such exceptions must be explicit.

---

## Cross-tenant relationships

If a row relates two tenant-owned records, persistence must ensure they belong to the same Organization.

Do not rely on:

```text
load record A
load record B
compare organization IDs
insert relation
```

alone where a database-level composite relationship can prevent the invalid state.

---

## Platform Administration security

Platform is a distinct privileged scope.

Access requires:

```text
GildOps organization context
+
explicit platform permission
```

Both conditions matter.

---

### Platform staff permissions

Platform authority should be granular.

Examples of control-plane areas include:

- organizations;
- providers;
- catalogue;
- commercial/pricing;
- billing;
- AI runtime;
- failures/operations.

A person who can sell or operate GildOps' business should not automatically gain provider credentials or global tenant administration.

---

### Support access

Cross-tenant support should be explicit and auditable.

A Platform staff member inspecting or assisting an Organization should use a defined support/control-plane mechanism.

Do not implement “staff bypasses RLS everywhere” as the ordinary support model.

---

## Entitlement security boundary

Entitlement answers whether the Organization may use a commercial capability.

Authorization answers whether the actor may operate it.

A protected mutation may therefore need both:

```text
organization entitlement
+
actor capability
```

UI gating alone does not satisfy either.

---

## Machine identities

Machine writes must be attributable and least-privileged.

Use distinct machine roles/identities where operations have different authority.

Examples:

```text
payment webhook
platform billing webhook
voice webhook
automation runner
integration operator
provider operator
```

Do not let one machine role inherit unrelated grants merely because both run in `apps/api`.

---

### Machine token/signing material

Credentials capable of minting trusted machine tokens are highly sensitive.

They belong only in trusted server environments.

They must never enter:

- browser bundles;
- `NEXT_PUBLIC_*`;
- committed source;
- user-visible responses.

Migration away from legacy signing mechanisms should preserve narrow role semantics rather than replacing them with a general privileged key.

---

## Secrets and credentials

Different secret classes have different owners.

### Platform provider credential

Owned by GildOps Platform Administration.

Example:

- API key for a GildOps-managed provider account.

Tenant users must not read it.

---

### Tenant Connection credential

Owned by an Organization's relationship with an external Connector.

Example:

- OAuth token for the Organization's Google account.

The credential is used only for that Connection/Organization.

---

### Secret Reference

A private value explicitly given by an Organization for a stated application purpose.

A Secret Reference is not:

- a Provider Account credential;
- an OAuth Connection;
- a generated provider resource secret.

The ordinary application may list:

- name;
- purpose;
- status;
- last-use metadata;

without reading the secret value back.

---

### Generated provider resource secret

A secret generated/provisioned for a concrete provider resource.

Only the machine/provider operation that needs it should resolve it.

---

## Secret handling rules

- never log secret values;
- never return plaintext secrets from list/read APIs;
- never store a secret in UI state longer than required to submit it;
- use write-only/rotate operations where possible;
- distinguish credential existence from credential value;
- support disable/rotation without disclosing old material;
- avoid placing secrets in URLs;
- scrub provider/database error messages if they might echo secret input;
- reject browser-public environment prefixes for private credentials.

---

## OAuth

OAuth is a trust boundary.

Required properties:

- state/CSRF protection;
- fixed/validated redirect URI;
- organization/connection intent bound to the OAuth transaction;
- callback verifies expected state;
- provider errors handled without leaking secrets;
- tokens stored through the credential boundary;
- browser receives success/failure state, not provider secrets.

An OAuth callback does not become trusted solely because it arrives at the correct path.

---

## Webhooks and provider callbacks

Every provider ingress follows:

```text
receive
↓
authenticate/verify provider
↓
validate payload
↓
deduplicate/idempotency check
↓
resolve authoritative target
↓
execute narrow canonical operation
↓
record result
```

Provider signatures/tokens must be verified before privileged mutation.

Do not trust:

- organization ID;
- customer ID;
- amount;
- currency;
- sender;
- resource ownership;

solely because a provider payload supplied them.

Where possible, resolve authoritative facts from a previously stored provider/resource relationship.

---

## Replay and idempotency

External providers retry.

A webhook or callback may arrive:

- twice;
- out of order;
- late;
- after local state changed.

Handlers must be safe under retries.

Use:

- provider event IDs;
- resource IDs;
- idempotency keys;
- monotonic lifecycle rules;
- reconciliation state;

as appropriate.

A delayed callback must not regress a lifecycle that has already advanced beyond it.

---

## Public and anonymous access

Public access should be task-scoped.

Examples:

- booking;
- form submission;
- portal;
- proposal review;
- public website.

Public access must not infer broad tenant authority.

---

### Public locators

Externally presented identifiers should be:

- unguessable where secrecy is part of the control;
- globally resolvable when the caller cannot know Organization first;
- lifecycle/revocation bounded where applicable.

A token that identifies a portal/proposal session should cease granting access when revoked/expired according to its domain lifecycle.

---

### Anonymous sessions

An anonymous identity may be useful so RLS/event attribution still has an actor.

It is not an operator account.

Anonymous actors must be prevented from:

- founding Organizations;
- accepting operator privileges they are not eligible for;
- entering operator shell;
- using membership-only functions.

---

## File and import security

Uploaded files are untrusted input.

Enforce:

- allowed type/format policy;
- size limits;
- parsing limits;
- organization ownership;
- storage isolation;
- safe filename/path behavior;
- no executable interpretation unless deliberately sandboxed;
- output escaping.

Do not trust MIME type or file extension alone when content matters.

Imported rows remain untrusted until validated against domain rules.

---

## AI security

Tenant agent commands require `organization.manage`; operator execution additionally requires `assistant.ask` and entitlement. Published versions are immutable to clients. Configuration cannot grant the actor additional capabilities, add unregistered tools or activate unsupported channel runtimes. The loop dispatches only tools explicitly supplied for that request; public turns and safe previews cannot reach the global private-tool registry. Retrieved website text and incoming messages are untrusted reference data.

Public reply persistence is machine-only. Visitors may record inbound messages and request a fixed configured handoff message, but cannot forge assistant or staff reply text. Staff replies require `message.send` and a claimed conversation owned by the caller. Automated replies lock the conversation and refuse handoff/claimed threads. Public history requires the opaque visitor key and site, is rate-limited at the web boundary, and excludes private notes and staff identities. Inbound appends enforce the canonical rate limit inside the database command as well, so a direct anonymous RPC cannot bypass the write limit. Tenant evaluation reads are personal; public conversation oversight stays in Communications. Provider credentials and vendor costs remain platform-controlled.

AI output is untrusted application input.

A model can:

- hallucinate identifiers;
- generate malformed arguments;
- request unauthorized operations;
- follow malicious instructions embedded in retrieved content.

The tool boundary must enforce:

- allowed tool set;
- input schema;
- actor scope;
- Organization scope;
- authorization;
- entitlement;
- domain validation.

---

### Prompt injection and connected content

Content from:

- files;
- websites;
- email;
- connected apps;
- customer messages;

may contain instructions hostile to the agent.

Treat retrieved content as data, not authority.

Do not allow retrieved prose to redefine:

- system policy;
- permissions;
- tool availability;
- approval requirements.

---

### Connected tools

An agent may use a connected app's capability or an MCP tool only through a grant that names that agent and
that target. A grant is created by someone with `integration.manage`, is revocable, and stops working when
its connection, server, tool, resource or the agent itself is no longer live. An MCP tool always needs a
person's approval. For a native capability the member who asked the agent must also hold the permission for that
kind of data, so the agent cannot read more through a grant than its asker could. Approval repeats the whole
authorization at the moment it is given. The identity and Organization of an execution come from the runtime and the database,
never from model-supplied arguments. A third party's tool description, schema and result are untrusted data.
Outbound requests to a customer-chosen MCP address are limited by address checks and a pinned connection, and
by network egress controls the deployment must declare; see `docs/integrations.md`.

---

### Consequential actions

Where approval is required, record the intended action separately from execution.

The model must not be able to turn a proposed action into an executed write by changing textual output.

---

## Automation security

Automations are machine actors operating under Organization-defined rules.

Actions must:

- use canonical domain operations;
- respect entitlement;
- respect the authority granted to the automation runtime;
- preserve attribution;
- avoid general unrestricted credentials.

Automation rule authorship/management and automation execution are different privileges.

---

## Logging and audit

Logs should provide operational evidence without becoming a data leak.

Do log:

- request/event IDs;
- operation names;
- safe actor identifiers;
- Organization identifier where appropriate;
- provider event/resource references;
- success/failure category;
- timing;
- retry/reconciliation state.

Do not log:

- passwords;
- access tokens;
- refresh tokens;
- OAuth authorization codes;
- API keys;
- secret values;
- complete payment credentials;
- sensitive customer content without an operational reason.

---

## Security events

Material security-relevant actions should be auditable.

Examples:

- membership/role changes;
- invitation lifecycle;
- credential rotation;
- email/password changes where provider events are available;
- provider credential changes;
- Platform permission changes;
- support-session activity;
- entitlement/commercial changes with access consequences.

Audit evidence must be attributable.

---

## Error handling

Security errors should reveal enough to recover without leaking protected facts.

Examples:

Prefer:

> That email and password do not match.

over:

> No account exists with that email.

Prefer:

> Your role cannot manage connections.

over:

> RLS policy integration_connections_update failed for organization abc...

Provider/internal errors may be logged safely server-side while the UI receives a controlled message.

---

## Rate limiting and abuse prevention

Internet-facing and high-cost operations should define abuse controls appropriate to risk.

Candidates include:

- sign-in;
- password recovery;
- email proof;
- public forms;
- booking;
- proposal/portal access;
- message/call initiation;
- AI requests;
- imports;
- provider operations.

Rate limiting is not a replacement for authorization.

---

## Security verification

Security-sensitive work is not verified by source review alone.

Use the appropriate proof.

### Unit/domain tests

Prove deterministic validation and security-state classification.

### Database/integration tests

Prove:

- RLS;
- grants;
- tenant isolation;
- cross-tenant refusal;
- constraints;
- machine-role limits.

Use real PostgreSQL/RLS for policies whose behavior depends on the database.

### API/provider tests

Prove:

- signature/authentication;
- idempotency;
- malformed payload refusal;
- replay/out-of-order handling where applicable.

### Browser/E2E tests

Prove:

- authentication journeys;
- unauthorized navigation behavior;
- Account security flows;
- public/anonymous boundaries;
- permissions reflected correctly in UI.

---

## Security review checklist

Before shipping a new capability, answer:

1. Who are the possible actors?
2. How is each actor authenticated?
3. Which scope does the operation target?
4. Which capability/permission is required?
5. Is Organization entitlement also required?
6. Which data may be read?
7. Which data may be changed?
8. What prevents cross-tenant references?
9. Does the browser supply any fact that should instead be resolved server-side?
10. Does the flow cross a provider/webhook/OAuth/file/AI trust boundary?
11. Is replay/idempotency relevant?
12. Are secrets involved?
13. What is logged?
14. Which security events need audit evidence?
15. What test proves the enforcement, not merely the UI?

If these answers are unclear, the security model is not complete.

---

## Security anti-patterns

Do not introduce:

- authorization based on hidden buttons;
- tenant isolation based only on `.eq('organization_id', routeId)` in application code;
- service-role clients in ordinary product runtime;
- Platform authority inferred from GildOps Membership;
- user-editable metadata used for permission decisions;
- arbitrary redirect URLs in auth flows;
- plaintext secret readback;
- one machine role with broad unrelated grants;
- provider payload fields accepted as authoritative ownership without reconciliation;
- duplicated local session tables when the identity provider already owns sessions;
- anonymous users treated as operator accounts;
- AI tools with direct unrestricted database access;
- integration tokens in browser-visible environment variables;
- detailed authentication errors that enumerate accounts;
- “MFA enabled” UI without assurance enforcement;
- security comments that contradict the actual RLS/grants.

---

## Global Home authorization

Global Home uses the signed-in actor's tenant client and resolves optional sources from canonical feature availability and capabilities before querying them. Finance aggregates require `report.read` and supported Finance availability; Support requires its workspace read capability; private operator Agent metadata retains actor RLS. Shared activity excludes private notes, prompts, answers, message content and transcripts. The Studio metadata RPC reuses the existing tenant manager guard rather than granting direct revision reads. Financial totals invoke the canonical report's database capability check and RLS. Local personalization is scoped to actor and Organization; it cannot alter read authorization. Source failures disclose unavailable status, not substituted zero totals. All creation and resolution paths retain owning domain checks.

## Document boundaries

This document owns:

- identity classes;
- authentication requirements;
- authorization model;
- session security;
- tenant isolation;
- Platform authority;
- machine identities;
- secret handling;
- public/external trust boundaries;
- webhook/OAuth security;
- AI/automation security;
- security verification principles.

It does not own:

- exact database DDL;
- provider setup steps;
- environment-variable inventories;
- UI composition;
- roadmap status;
- incident runbooks.

Those belong to the respective canonical documents.

## Support authorization

Support requires `support.read`; `support.case.create`, `support.case.update`, `support.case.assign`, `support.case.resolve` and `support.configure` independently authorize commands. Creating with a queue or owner additionally requires assignment authority. Resolution authority covers resolve, close and explicit reopen; update alone cannot change those states. Configuration authority covers queues and elapsed service levels. Founding roles receive the registry capabilities; a forward migration grants them to existing organization managers.

All Support tables force tenant RLS and deny direct authenticated writes. Commands require a signed-in member, read authority and the command-specific capability, use a pinned search path, and validate same-organization references through composite keys. Case history and internal notes use a dedicated read-protected append-only store because the general tenant event feed is broader. No public/customer-portal projection exposes these records. Linking creates only an association and grants no authority over the linked domain's lifecycle or messages.

## Marketing authorization

Marketing uses `marketing.read` to inspect campaigns, dynamic audiences, acquisition inquiries and aggregates; `marketing.manage` additionally permits campaign/audience edits and inquiry review. Manage includes read behavior. Founding roles receive both through the capability registry; existing organization managers receive them through a forward migration. These are actor authorities, not a separately sellable Marketing entitlement. Organization service access remains enforced by operational routes and actions.

Marketing tables have tenant RLS and authenticated SELECT grants only. Capability-checked RPCs own writes and sensitive submission inspection. CRM creation additionally requires `customer.create` and calls canonical `create_customer`; Marketing management grants no message delivery or CRM stage authority. Public acquisition resolves the tenant from the canonical Form public key, validates an opaque Campaign/Form token in that same tenant, publication and campaign state, and bounds/allowlists UTM fields. Browser-supplied organization IDs are never accepted by public acquisition. Request retries and CRM handoffs are transactionally idempotent. Raw answers stay in Studio and are excluded from tables, event payloads and logs.

## Configuration review and launch

Proposal mutations bind both proposal ID and organization ID, including when an actor administers
multiple organizations. Application atomically changes a draft to `applying` before any configuration
write; racing requests cannot both execute the sequence. RLS requires `configuration.propose` for the
claim and outcome updates. A database trigger freezes the claimed document and refuses replay or
discard. Each operational write still requires its existing domain capability. Historical terminal
outcomes remain immutable and interrupted claims are inspected rather than automatically retried.

Untrusted proposal structure is validated before document persistence and canonical application;
individual feature activations are checked for actual catalogue availability and entitlement.
Feature enablement explicitly checks `feature.manage` even when no activation override exists,
because an unauthorized RLS DELETE may return no rows without an error. Database launch blockers
consume canonical entitlement/activation and refuse direct launch past required domain setup.
Connection projections do not send raw provider diagnostics to the browser.

### Customer service disclosure authorization

`service_disclosures`, `service_disclosure_revisions` and `service_disclosure_deliverables` force RLS.
Authenticated actors have internal seller-membership SELECT only; direct mutations are denied.
Composite keys bind Organization, Customer, Engagement, Disclosure, revision and typed deliverable.
Version-checked save/publish/withdraw commands require live seller `customer.update`; platform staff
alone is insufficient. Approval snapshots are immutable, including at the database trigger boundary.
Draft saving and approval are independent operations. Customer Portal identities cannot read drafts,
history, accepted terms, reference IDs, tenant configuration or staff attribution.

The narrow `portal_service_disclosures` RPC uses current PortalContext, activation, entitlement,
published navigation/module exposure, customer ownership and an explicit approved revision. Its
closed projection returns at most 100 records with at most 20 deliverable presentations each. Detail
IDs never override customer scope. No private tenant content is read to construct the live response.
Publication requires independent current artifact authority and an active relationship; URLs are
server-derived HTTPS public destinations with no query strings, fragments, tokens or credentials.
The live response rechecks public hostname association. Termination suppresses tenant presentations;
seller-approved summary history remains an explicit communication, never a tenant access grant.
Internal previews use the operator's existing scope and never mint a customer session.

### Customer service review authorization

`service_reviews` forces RLS, denies direct client writes and permits seller `customer.update` reads only. Release/withdraw commands require the same live capability and complete customer/engagement tuple. Release pins the current approved revision and an optional member of its approved deliverable set. Neither platform authority alone nor a receiving-tenant Membership grants seller review authority.

`portal_service_reviews` and `respond_service_review` derive Organization/Customer from current PortalContext; supplied review/disclosure IDs never override it. Every read/response rechecks published Services navigation, Portal activation/entitlement and live invitation/session validity. Server actions separately re-resolve request hostname against PortalContext using the existing separate Portal cookie. Responses require the pending request version and still-current approved revision. Ended relationships make tenant review material unavailable. Row locking and immutable final decisions prevent replay, double-click Cases and conflicting concurrent finals. Narrow parameters accept no owner, priority, queue, SLA, tenant ID or deployment instruction.

Support intake is a private non-callable helper invoked only after authorized review response validation. It creates the canonical same-seller/same-customer Case with server-chosen normal priority and no assignment/queue. `support_service_review` independently requires `support.read` and exposes source prose only to authorized Support staff; no Portal projection exposes private Case history. Review event payloads omit prose. Approval conveys no signature authority, tenant Membership, artifact mutation or deployment authorization.

### Studio Portal publication and hostname authorization

Portal draft/history reads require Organization membership and `organization.manage`; direct table writes are denied. Version-checked commands require independent management, and publication additionally requires current entitlement/activation and the reviewed draft. The no-argument published projection derives identity from live PortalContext. Revocation, expiry, unpublishing and disabled activation/entitlement fail closed. Form submissions and payment initiation also check published navigation/module exposure before delegating to canonical customer/placement/revision/payment authority. No service-role client is used by runtime or editor.

Hosted Portal exchanges validate the verified hostname organization before binding; hosted pages and actions freshly resolve hostname/context agreement, without relying on the routing cache. Only verified custom Portal or the organization's managed origin can serve it; custom Website, foreign, unverified, released and unknown hosts fail closed. Application hosts come from deployment configuration. Exchanges remain same-origin, with host-only HttpOnly `gold-portal` cookies scoped to `/portal`, separate from operator/proposal/public Form sessions. Portal responses are private/no-store, no-referrer and noindex. Services use the independent CRM disclosure approval boundary; typed deliverables still require independent tenant management and an active Client/Tenant relationship.

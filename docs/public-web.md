# GildOps Public Web

## Purpose

Service notification preferences are a contextual disclosure in the authenticated customer Portal.
Mailbox confirmation establishes notification consent, never Portal authorization. Confirmation
codes are entered in the same host-scoped Portal session that requested them. Notices contain no
invitation bearer token, session token or automatic cross-origin login link. The minimum re-entry
contract links to a currently resolved verified custom Portal hostname, otherwise the existing
managed hostname where available. The link has no credential: an existing session works only on
its own host. The email explains that a customer whose session has ended must use the existing
invitation, or ask the service organization to resend it. If no hostname resolves, only that
explanation is included. A public Portal hostname alone does not authenticate a customer. Forms, payments, review
decisions and their hostname/session enforcement retain their existing contracts.

This document defines the **canonical architecture for GildOps-owned and organization-owned public web experiences**.

It owns the rules for:

- GildOps' public marketing site;
- organization websites published through Studio;
- public forms;
- public booking;
- proposal review;
- customer portal entry;
- public hostnames and custom domains;
- published revisions;
- public media;
- search/metadata behavior;
- attribution and public intake;
- legal-document publishing boundaries.

It does not own private operator UI, tenant authorization generally, provider internals, or deployment procedure.

Related documents:

- `docs/product.md`
- `docs/domain-model.md`
- `docs/architecture.md`
- `docs/security.md`
- `docs/integrations.md`
- `docs/deployment.md`

---

## Public surface classes

GildOps has several different public-facing surfaces.

They must not be collapsed into one generic "public app."

### GildOps marketing

Purpose:

> Explain GildOps, qualify demand, and create attributable inquiry/discovery context.

The marketing site speaks in GildOps' voice.

It may create narrow CRM/intake records in GildOps' own Organization through controlled public writes.

It does not expose tenant operating state.

### Organization website

Purpose:

> Publish an Organization's approved public identity and authored content.

Studio owns authoring and publishing.

The website consumes approved organization/domain records but does not become a second source of truth for the business.

### Booking

Purpose:

> Offer customer self-service against the authoritative Scheduling, Work and policy model.

Booking does not own availability.

Displayed availability is advisory until the authoritative scheduling write accepts the commitment.

### Public forms

Purpose:

> Collect structured input using a published Form revision.

Studio owns the Form.

The destination domain owns any Customer, Work Item, Support Case or other record produced from the submission.

### Proposal review

Purpose:

> Allow an intended external recipient to review and respond to one commercial proposal.

Proposal access is not Membership and is separate from Portal access.

### Customer portal

Purpose:

> Expose a narrow authenticated projection of an Organization's records to its customer.

The Portal does not own Customers, Work Items, Invoices or Payments.

Studio → Customer portal owns a typed, organization-scoped definition with pages, stable module instances, navigation and settings. Work, Invoices (including authorized Payments) and offered Forms share presenters between the live Portal, editor, templates and labelled-example preview. The Structure | Canvas | Inspector editor supports narrow-screen drawers. Managers save, send the exact saved version for review, publish immutable revisions, inspect history and restore into a draft. Publication requires current Portal entitlement and activation.

Existing invitations retain the default until first publication; private edits do not strand customers. Unpublishing pauses access without revoking links or deleting records. The legacy activation-only default is retained only for organizations without Plan or Portal commercial history; expiry, activation overrides and custom publication always use authoritative entitlement facts. Published navigation determines accessible pages at `/portal/p/{path}`; unknown or excluded pages are not found. Form placement remains `portal_forms`, with the exact published Form revision. Direct Form submissions and payment initiation require published module exposure in addition to their domain guards.

Portal Form submissions carry the revision actually opened by the customer. A newer publication
refuses the stale response even when its answer shape still fits, and offers the existing Form
reload flow. The Portal does not define a separate Forms module activation: canonical placement,
current Form publication, Portal entitlement/exposure and customer authorization are the guards.

The deliberate default retains the predecessor's full authorized record lists, subject to the
existing source-query bounds. Configured module record limits apply after custom publication;
creating a draft does not silently truncate an existing customer's history.

Services is an opt-in typed module in the canonical Portal registry, with heading, List/Cards/Summary
presentation and a 1–100 record limit. The Managed Services Portal template creates independent Home,
Services, Billing and Forms pages; the legacy default and existing templates do not add Services.
`portal_service_disclosures` derives Organization and Customer solely from the live PortalContext,
requires current Portal activation/entitlement and published navigable Services exposure, and returns
only approved disclosure fields. No customer-supplied ownership IDs or raw engagement/artifact rows
are accepted. An optional disclosure ID remains customer-scoped and fails after withdrawal.

Saving seller disclosure drafts does not alter approved content or republish the Portal layout.

Services can additionally present explicit Customer Review requests pinned to an approved disclosure revision and optional approved deliverable presentation. The customer inspects the shared material, confirms an operational acknowledgement, or submits a written change description of at most 3000 characters. The UI states that this does not sign a contract or authorize deployment. Pending, Approved, Changes requested, Withdrawn, Superseded and unavailable-material states reflect persisted records; failed responses remain visible for correction. Saving a disclosure draft never changes the review target. Publishing a replacement supersedes pending reviews; withdrawing material blocks response. Final decisions remain historical.

Review actions use the existing Portal session, hostname binding and current published Services exposure. Customer/Organization ownership is never accepted from form input. Changes requested creates a same-customer Support Case through bounded external intake, without allowing priority, assignment, queue, SLA or resolution fields. Request text is retained in the immutable review response, not copied into multiple ticket/history records. Internal CRM shows attribution, original review reference, current state and an authorized Support link; Support shows the original source alongside its own resolution lifecycle.
Removing Services in a Portal draft retains live access until layout publication; publishing removal
blocks direct service RPCs. Withdrawal takes effect on the next uncached request. Portal responses
retain private/no-store headers. Approved descriptions and progress remain seller snapshots, rather
than live tenant configuration reads. Relationship ending suppresses deliverables while retaining
the deliberately published seller summary. Empty Services means no updates are currently shared,
without making a claim about the customer's commercial relationship.

---

## Public shell boundary

Public/customer surfaces do not inherit the authenticated operator shell.

They must not expose:

- operator navigation;
- Platform Administration;
- tenant configuration;
- provider credentials;
- internal commercial economics;
- unrelated Organization records.

Auth and access behavior must be designed for the public task rather than borrowing operator Membership.

---

## Organization website model

A website is published as **one site revision**.

The revision contains the pages, navigation and ordered section content that must be reviewed and published together.

Publishing moves one canonical pointer to one immutable published revision.

This prevents a visitor from seeing:

```text
navigation from revision N
+
page content from revision N+1
```

### Stable identity

A page or section is identified by a stable internal ID.

Its path or display label is mutable presentation.

Internal navigation should reference the page identity rather than depend on a mutable path string as identity.

### Homepage

The homepage is declared explicitly.

Do not infer homepage identity from an empty path or special route accident.

### Typed section vocabulary

Public sections use a closed, validated vocabulary with a corresponding:

- schema;
- editor;
- renderer;
- validation rule.

Do not allow arbitrary component names, executable scripts or unrestricted HTML to become the normal Studio content model.

A new section kind is complete only when authoring, validation and rendering all understand it.

### Draft and published state

Editing published content produces or updates draft state.

Drafts remain private.

Public rendering reads only published state.

AI may assist with draft content.

AI does not bypass the publish decision.

### Restore

Restoring an older site state copies it forward into a new draft.

Historical revisions are not rewritten.

---

## Templates and starters

A starter/template is copied into Organization-owned authored state.

The Organization does not remain permanently coupled to a mutable Platform template.

This rule applies to:

- site starters;
- page templates;
- section patterns;
- Form templates.

Later edits to the Platform starter must not silently modify an existing Organization website.

---

## Forms

A Form is authored once and placed by reference.

Studio response review reads `list_form_submission_page` in pages of 50. This bounded manager-only RPC returns the authoritative total, customer/booking associations and the exact submitted revision definitions. It orders by submission timestamp and id so responses with identical timestamps do not overlap adjacent pages. The existing `list_form_submissions` latest-responses RPC remains available for bounded summaries. Selecting a response changes only local review state; pagination retains the owning form route.

Studio exposes copyable public links and embed snippets only while a form has a published revision and is not archived. Unpublished forms retain placement configuration and a publishing explanation. Archiving requires confirmation that public responses stop; historical responses and revisions remain available under the existing archive semantics.

Form History inspects a single saved definition through the manager-only `read_form_revision` RPC, scoped by Organization, Form and revision. It uses the canonical form renderer with disabled controls. Inspection does not restore content, edit history or replace the published revision. This also permits inspecting revisions with no submissions.

The consuming surface owns the placement.

The Form owns its fields/revision.

The destination domain owns the record created from a response.

Conceptually:

```text
Studio Form
↓
placement on booking / site / portal
↓
Form Submission
↓
authorized destination-domain operation
```

Do not copy the Form definition into every surface that uses it.

A submission must remain interpretable after later Form edits, so published/revision context must be preserved.

---

## Public hostnames and domains

A public hostname resolves to:

```text
hostname
↓
verified binding
↓
Organization
↓
public surface
↓
published revision/content
```

The hostname selects context.

It does not grant authorization.

### Managed subdomain

A GildOps-managed Organization hostname may be derived from Organization identity plus the configured platform public domain.

Do not persist a second copy if the hostname is already deterministically derived from canonical state.

### Custom domain

A custom domain claim is a durable Organization-owned public-domain relationship with provider-observed verification/configuration state.

Separate:

- claim;
- verification;
- provider configuration;
- certificate/readiness;
- primary/redirect policy;
- release/removal.

A tenant must not be able to write provider-observed verification state directly.

### Fail closed

Unknown, unverified, released or invalid hostnames must not resolve to arbitrary Organization content.

### Provider ownership

Hosting/DNS provider credentials remain Platform infrastructure.

An Organization owns the public domain relationship, not the GildOps provider account credential.

---

## Public authentication and external sessions

Public/customer access uses narrow external identity.

It does not create Organization Membership.

### Portal

A portal link may be exchanged into a dedicated external session.

Subsequent requests use the session rather than repeatedly carrying the bearer link.

Revocation must invalidate the access according to the portal lifecycle.

### Proposal review

Proposal access uses its own external session/identity context.

A signed-in operator account must not silently become the proposal recipient.

Responses apply to the exact proposal version the recipient reviewed.

### Host preservation

Authentication initiated on a tenant/customer hostname must preserve safe intended context where the product supports that flow.

Return destinations must be normalized application-controlled paths.

Do not accept caller-supplied absolute redirect URLs.

---

## Public writes

Anonymous/external public writes use narrow operations.

The browser should not choose authoritative:

- Organization ownership;
- provider resource ownership;
- commercial amounts;
- internal status;
- sender identity.

Derive these from trusted stored relationships wherever possible.

Public functions/RPCs should accept the minimum information required for the task.

---

## Booking privacy

Public booking may consume Scheduling feasibility without exposing another customer's private work.

A visitor may see:

```text
available time
unavailable time
policy explanation appropriate for the visitor
```

A visitor must not receive:

- another customer's address;
- assigned private Resource identity unless the product deliberately exposes it;
- internal schedule rows;
- private travel context.

Where feasibility requires private surrounding schedule data, calculate it on a trusted server/database boundary and return only the public answer.

---

## Public media

Public media is a Library/public-content concern.

It is not the same concept as operational Assets.

A public media record should preserve appropriate metadata such as:

- Organization ownership;
- storage object reference;
- MIME/kind;
- title;
- alt text;
- dimensions where relevant;
- source/provenance;
- rights/license note where relevant;
- visibility;
- archived state.

Storage owns bytes.

The database owns business metadata and access relationships.

A public renderer may use only media approved for public use.

An external drive can be an import source.

The live public site should not require the source drive to remain online.

---

## GildOps marketing information architecture

Marketing navigation should be driven by real content and proof.

Do not create thin pages merely to fill a sitemap.

Typical durable public destinations may include:

```text
/
platform
solutions
demo
about
contact
legal
authentication
```

Industry, resource, integration-directory or pricing pages should be published only when they have:

- distinct useful content;
- an owner;
- accurate product/commercial facts;
- enough evidence to justify the page.

Public marketing language such as "Sales" or "Customer Service" does not redefine the operator workspace taxonomy.

---

## Metadata and search

Public pages should intentionally manage:

- page title;
- description;
- canonical URL;
- robots behavior;
- sitemap inclusion;
- social metadata;
- structured data only where the visible page supports the claim.

Do not emit structured-data claims that are not true in visible content.

Private or transactional surfaces should normally be excluded from search indexing.

Examples include:

- auth;
- portal;
- proposal sessions;
- booking confirmation;
- draft preview.

---

## Draft preview

Preview must not make draft content discoverable as published content.

Where preview uses a token/session, it should be:

- unforgeable;
- scoped to the intended site/revision;
- expiring where appropriate;
- `noindex`.

Draft preview and public rendering should reuse the same rendering implementation where practical so preview does not become a second website renderer.

---

## Attribution

Public acquisition/intake should preserve enough evidence to understand how the inquiry arrived.

Potential attribution facts include:

- first landing path;
- referrer;
- campaign/UTM fields;
- form/source identity;
- submission time.

Attribution belongs to the inquiry/marketing/CRM relationship according to domain ownership.

Do not make analytics cookies or third-party scripts the only source of operational attribution.

---

## Consent and privacy

Public intake should collect only information needed for the stated task.

Where consent is required, record the specific purpose/context rather than one universal boolean.

Do not silently reuse transactional contact permission as promotional consent.

Retention and legal text must reflect actual business/legal policy rather than generated placeholder claims.

---

## Legal documents

Legal content should be publishable as explicit versioned documents when GildOps reaches the point where accepted/effective versions matter.

A legal-document model should preserve:

- type;
- version;
- effective date;
- published body;
- supersession relationship;
- acceptance evidence where acceptance is required.

Do not treat repository Markdown as the long-term acceptance ledger.

Legal wording itself requires appropriate review outside the software architecture.

---

## Performance

Public experiences should prioritize:

- fast first render;
- stable layout;
- optimized media;
- caching of immutable published revisions;
- bounded third-party scripts;
- no unnecessary operator application bundle.

A public website should not require loading the entire authenticated GildOps operator application.

---

## Accessibility

Public surfaces follow the same accessibility baseline as operator UI.

Pay particular attention to:

- form labels and validation;
- keyboard navigation;
- focus management;
- heading hierarchy;
- image alt text;
- color contrast;
- responsive reading order.

---

## Public-web verification

For a public-web change, verify the relevant combination of:

- hostname resolution;
- published vs draft behavior;
- unknown-route behavior;
- noindex behavior;
- external-session access;
- public write scoping;
- responsive rendering;
- form submission;
- booking privacy;
- metadata/canonical output;
- provider/domain readiness.

Browser verification is required for user-visible public flows.

---

## Anti-patterns

Do not introduce:

- a separate Customer/Organization copy owned by the website;
- public table grants broader than the task requires;
- tenant-controlled provider verification state;
- arbitrary HTML/script as the default Studio content model;
- mutable published revisions;
- path string as the only page identity;
- public preview accidentally indexed;
- custom-domain resolution that trusts an Organization ID from the browser;
- live websites that depend on Google Drive or another import source being reachable;
- operator shell/navigation on public customer pages;
- marketing vocabulary that silently changes canonical operator ownership.

---

## Document boundaries

This document owns:

- public-surface architecture;
- Studio website publication model;
- public domains/hostnames at the product boundary;
- public media boundary;
- public authentication/session context;
- SEO/indexing/metadata rules;
- attribution/privacy architecture;
- legal-document publishing architecture.

Provider implementation details belong in `docs/integrations.md`.

Security enforcement belongs in `docs/security.md`.

Hosted configuration belongs in `docs/deployment.md`.

## Marketing acquisition

Tracked Marketing Form links append `campaign_token` and optional `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` to the canonical `/f/{publicKey}` URL. Hosted, website and embed Form clients forward these values through the existing public submission action. The database validates the token against the owning Form and active Campaign, writes the exact published revision through `app.record_form_submission`, preserves attribution context and creates one inquiry in a single transaction. A per-attempt request UUID is reused on retries and rejects mismatched payload reuse. A forged or inactive token refuses the submission without partial writes. Untracked Forms continue their existing submission path; no historical reclassification occurs.

## Website agent conversations

A website agent deployment resolves from the published site and an active agent's explicitly selected version. The widget records the inbound message in Communications before requesting a reply. The Python runtime resolves the effective thread version, published knowledge and bounded visitor history; it executes no private business tools. Only the provider machine role can persist generated replies. Missing runtime, runtime failure or an explicit visitor request records a human handoff rather than claiming a delivered AI answer.

The Communications Website inbox supports claim, staff reply and resolution. Handoff and claim stop automated responses; an open widget polls bounded public history for staff replies. Visitors remain anonymous; this flow does not silently create Customers or Support Cases. The live widget preview in agent configuration sends real messages and says so. Enabling a deployment is configuration evidence, not proof that a model/provider has passed an integration test.

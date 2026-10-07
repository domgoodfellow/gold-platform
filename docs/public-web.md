# GildOps Public Web

## Purpose

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

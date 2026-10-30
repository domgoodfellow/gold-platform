# GildOps Product

## Purpose

This document defines **what GildOps is, who it is for, the outcomes it provides, and the product boundaries that must remain stable as the implementation evolves**.

It describes the product model, not repository history.

- Current implementation status belongs in `docs/roadmap.md`.
- Shipped changes belong in `CHANGELOG.md`.
- Technical structure belongs in `docs/architecture.md`.
- Canonical business concepts belong in `docs/domain-model.md`.
- Material architectural decisions and their history belong in `docs/decisions/`.

If another document contradicts this one on product identity or ownership, resolve the contradiction rather than maintaining two versions of the product.

---

## Product thesis

**GildOps is an operating platform for service businesses.**

It gives one organization a coherent system to:

- capture demand;
- understand customers;
- communicate across channels;
- organize and schedule work;
- coordinate people and resources;
- quote, invoice, collect and understand money;
- publish customer-facing experiences;
- automate repeatable operations;
- use AI within the same permissions and business rules as people;
- understand performance across the business.

The product is not a collection of unrelated applications behind one login.

The product promise is:

> **One business model, many operating surfaces.**

GildOps should reduce the handoffs among a CRM, phone system, inbox, calendar, field-service tool, quoting system, payment system, automation service, website builder, document store and reporting spreadsheet without replacing them with a new maze.

The system should feel specific to each organization through configuration, terminology, connected systems, entitlements and workflow policy—not through a separate codebase for each customer.

---

## Primary customer

GildOps is designed first for owner-led and operations-led service businesses that have outgrown fragmented tools but do not want to build and maintain custom internal software.

Typical characteristics include:

- customer and operational data spread across several systems;
- customer communication split across phone, email, messaging and individual staff;
- missed or poorly tracked follow-up;
- manual movement of information from inquiry to quote to scheduled work to invoice;
- resource or scheduling coordination that cannot be represented by a simple calendar;
- growing need for roles, permissions, reporting and auditability;
- enough operational volume that duplicated entry and missed handoffs cost real money;
- no dedicated software team capable of maintaining a bespoke platform;
- a need to adopt incrementally rather than replace every existing system in one cutover.

Field service, maintenance, installation, professional service, property and asset service, mobile service and similar businesses are strong early use cases.

These are market priorities, not schema boundaries. GildOps must remain a configurable platform rather than hard-coding one vertical.

---

## Customer outcomes

Customers hire GildOps to improve operating loops, not to acquire menu items.

The core outcomes are:

1. **Capture demand**
   - inquiries, calls, forms and referrals become attributable business context;
   - important interactions do not disappear in personal inboxes or memory.

2. **Understand the relationship**
   - customer history, stage, intent, related work and follow-up are coherent;
   - teams do not maintain competing customer records for different departments.

3. **Communicate consistently**
   - calls, messages and email are preserved as business communication;
   - identities, routing and delivery state are controlled rather than improvised.

4. **Turn demand into work**
   - the business knows what needs to be done, where, for whom, by whom and under what requirements.

5. **Commit time and resources correctly**
   - scheduling uses one availability and feasibility model rather than several contradictory calendars.

6. **Move work to cash**
   - pricing, quotes, invoices, payments and job economics remain connected to the work that produced them.

7. **Automate repeatable operations**
   - automation executes durable business rules;
   - consequential actions still use the same domain and authorization boundaries as human actions.

8. **Publish accurate customer experiences**
   - websites, forms, booking and portals project approved business information rather than creating another source of truth.

9. **Use AI safely**
   - AI can understand authorized business context, invoke approved tools and propose actions without becoming an alternate authority.

10. **See what is happening**
    - reporting and Insights analyze shared operational facts rather than reconstructing them in separate spreadsheets.

---

## Product structure

### Operator workspaces

A **workspace** is where an operator performs a coherent kind of ongoing work.

The canonical operator workspaces are exactly:

| Workspace | Canonical responsibility |
| --- | --- |
| **CRM** | Customer relationships, leads, relationship state, qualification, pipeline, opportunities, intake context and relationship follow-up. |
| **Communications** | Business conversations and channels: calls, voice, messaging, email, threads, delivery state, communication identities, numbers and routing. |
| **Marketing** | Audience, segmentation, acquisition, campaigns, attribution, promotional consent and lifecycle intent. |
| **Support** | Customer problems and requests: cases, queues, assignment, priority, escalation, service targets and resolution. |
| **Finance** | Customer-to-business money: price book, quotes, invoices, payments, adjustments and operational economics. |
| **AI** | Assistants, intelligence interactions, knowledge/tool use and operator-facing AI capabilities. |
| **Automations** | Durable orchestration: triggers, conditions, rules, sequences, actions and execution history. |
| **Field** | Operational work, scheduling, resources, locations, assets, assignment, feasibility and execution context. |
| **Studio** | Authoring and publishing customer-facing experiences: websites, forms, brand, booking presentation and portal experiences. |

These workspaces are an **operator taxonomy**, not a commercial taxonomy.

A workspace may compose capabilities from several Products or domains. A Product may contribute capabilities to several workspaces.

Therefore:

> **Plan ≠ Product ≠ Module ≠ Feature ≠ Workspace ≠ Page.**

Do not derive the operator navigation from the billing catalogue.

Do not create a workspace because a commercial Product exists.

Do not create a commercial Product because a workspace exists.

---

### Workspace visibility

Registration does not guarantee navigation.

A workspace earns a visible navigation row only when the organization and user have at least one real, reachable operating surface for it.

The product must not expose:

- workspace rows without a real Home;
- “coming soon” workspace rows;
- placeholder children;
- configuration pages pretending to be operating workspaces.

### Workspace navigation

This is the approved information architecture (ADR-046). `docs/ui-system.md` owns its presentation; `docs/architecture.md` owns the projection modules.

- Outside a workspace, the organization sidebar shows the shared destinations (Home, Search, Library) and the workspace directory, one row per eligible workspace. The row opens the workspace's canonical **Home**.
- Entering a workspace changes the contextual sidebar to that workspace's navigation: its Home, its eligible operating destinations and its applicable configuration entry points.
- Inside each accessible workspace, Dashboard is the first explicit destination and links to the existing canonical landing route. It uses Gauge and the normal selected state. The workspace heading identifies the context without a competing link or selected state (ADR-049 supersedes ADR-047 point 1). The page header never reproduces the workspace's destinations; the sidebar owns them (ADR-048). A member who may only configure the workspace gets no operating Home link.
- Workspace destinations are never flattened into the organization-level list.
- Labels, routes, hierarchy, visibility and permissions derive from the canonical projections. A business profile may relabel destinations and reorder a workspace's operating destinations after Dashboard, except CRM retains Contacts then Pipeline; it never grants access, adds destinations or moves a destination to another workspace.
- The page header communicates location and offers page-specific actions; it never defines workspace navigation of its own.
- Phone, tablet and desktop present the same authorized hierarchy.

CRM's canonical routes are Dashboard (`/crm`), Contacts (`/crm/contacts`), contact detail (`/crm/contacts/[contactId]`), Pipeline (`/crm/pipeline`) and opportunity detail (`/crm/opportunities/[opportunityId]`), under the organization. Contacts is one directory for independently identifiable People and Companies, with All, Companies and People views, flat or company-grouped presentation and lifecycle/temperature/affiliation filters. Existing ambiguous identities remain Unspecified / Needs classification; manual creation requires Person or Company. Affiliations connect people and companies with title, primary designation and active/historical state. Lifecycle (Lead, Prospect, Customer), temperature, relationship stages and opportunity stages remain independent; company affiliation never copies classification. Tasks are obligations; activities record what happened; follow-up is contextual task behavior, without a sidebar destination. Library retains intake ownership. Legacy CRM URLs are temporary redirects, never competing pages (see docs/data.md for retirement criteria).

Contacts Import and Library sources/files enter the same Library-owned mapping, duplicate review, confirmed import and report workflow. Library owns source resources, mappings, runs and source synchronization; CRM owns canonical contacts; Connections owns provider access. CSVs are snapshots. Connected worksheets may save a one-way CRM synchronization mapping: Sync now refreshes through the existing connector and opens the same review process. Automatic CRM scheduling is not enabled. Source removal never deletes canonical contacts. Conflicting local edits refuse the incoming row and remain visible in the import report.

Marketing (`/marketing`) is an operational workspace for Campaigns, dynamic Audiences, attributed acquisition inquiries, explicit CRM handoff and Performance. It requires `marketing.read` or `marketing.manage`, retains organization service-access enforcement, and introduces no independently sellable module gate. Its destinations belong to its entered-workspace navigation. Support (`/support`) operates Cases, queue assignment, priority, escalation, internal notes, elapsed resolution targets and reporting under six dedicated capabilities. CRM, Inbox, Call and Work contexts can explicitly create or inspect related Cases without changing their own lifecycle. Tenant AI (`/ai`) retains an authenticated starting Home.

---

## Shared organization surfaces

Not every important surface is a workspace.

### Organization Home

Organization Home is the cross-workspace cockpit.

It answers:

> **What matters in this business right now?**

It may summarize work owned by several workspaces, but it does not acquire ownership of those records.

---

### Library

Library is shared organization infrastructure.

Its product role is to provide reusable organization-level access to artifacts such as:

- files;
- media;
- templates;
- knowledge;
- collections;
- sources;
- trash/archive.

Library is **not** an operator workspace.

A Library section appears in production navigation only once it has working behaviour; a section without it keeps its route but is not offered (ADR-047). This is the approved target; the placeholder sections are still listed today.

A file can relate to a customer, work item, asset, invoice or other record without becoming owned by that record's workspace.

A domain-specific template remains domain-owned until multiple real consumers justify a shared canonical template model.

---

### Insights

Insights is cross-cutting reporting and analysis over shared operational facts.

It is not an owner of the records it analyzes and is not a canonical operator workspace.

Insights may have deep routes, saved reports, dashboards and contextual entry points from workspaces.

A page or workspace may expose contextual Insights without creating a second reporting engine.

---

### Settings

Settings configures the environment in which work happens.

It is not a workspace and is not a second application shell.

Settings is one contextual navigation of the shell, grouped as **Personal** (Profile, Security & sign-in, Appearance), **Organization** (General, Customer payments, Branding, Domains, Email sending, Features, Words & navigation) and **Administration** (Team & access, Connections, Plan & usage). Settings, Help & documentation and Contact GildOps Support are destinations in the Account menu; product support remains separate from the organization Support workspace. Account owns person/session information and Sign out. Opening Settings lands on the first destination the member may use. The five scopes below keep their separate owners.

Configuration that controls how one workspace performs its work is configured in that workspace, never in Settings. Settings search reaches it and routes to its owner.

#### Organization

Organization owns business-wide configuration:

- business identity: name, legal name, industry;
- the primary business address, which is private;
- general business contact details;
- regional settings: time zone and trading currency, suggested from the business location and never replaced by a later suggestion;
- customer payments: how this business's own customers pay it (manual recording and card collection), never the GildOps subscription, which is Plan & usage;
- business words and workspace page labels (Words & navigation);
- brand and domains;
- enabled product features.

Each setting has one editor. General holds identity, address, contact and regional settings; Customer payments and Words & navigation are their own pages.

#### Account

Account belongs to the signed-in person, independent of the selected organization.

It owns:

- personal profile;
- verified email changes;
- password and sign-in security;
- future person-level authentication controls.

#### Access

Access belongs to the organization but concerns who may work there and what they may do.

It owns:

- Members;
- Invitations;
- Roles.

#### Connections

Connections owns persistent relationships with external systems.

It includes:

- connected apps;
- connector configuration;
- external data sources;
- imports associated with those connections;
- organization-owned credentials and connection readiness.

A file format is not a Connection.

#### Plan & usage

Plan & usage represents the organization's commercial relationship with GildOps: the buyer's view of what it bought. The seller-side records belong to GildOps (ADR-051), and this view never exposes GildOps' provider costs or margin.

It includes:

- active Plan/package;
- Add-ons;
- subscription state;
- entitlements;
- allowances and limits;
- metered use;
- customer-facing GildOps charges.

It does not expose GildOps' provider costs or platform margin.

---

## Platform Administration

Platform Administration is the privileged GildOps SaaS control plane.

It is neither:

- a tenant workspace;
- a special “tenant zero”;
- a section that appears in every organization;
- ordinary organization administration.

There are three distinct operating scopes:

```text
Person
Organization
Platform Administration
```

Platform Administration is available only when:

1. the current organization context is GildOps' own organization; and
2. the signed-in person has the required platform authority.

Membership in GildOps' own business does not itself grant Platform authority.

Platform Administration owns cross-organization and SaaS concerns such as:

- organization portfolio administration;
- product/catalogue administration;
- Plans and Add-ons;
- GildOps retail pricing;
- subscriptions and platform billing;
- provider accounts and provider infrastructure;
- platform AI runtime assignments;
- usage economics and provider costs;
- platform failures and health;
- control-plane policy.

GildOps' own business uses the ordinary organization product like any other customer.

Platform Administration is rendered at `/platform` in its own guarded shell. GildOps' ordinary business remains organization-scoped; the control plane is platform-owned.

---

## Canonical ownership rules

### One record, one canonical owner

A business fact exists canonically once.

A record may appear in several workspaces through projections, summaries, timelines, related-record panels or actions.

Those projections do not:

- duplicate authoritative state;
- acquire ownership;
- implement their own version of the business rules;
- create a second lifecycle.

Examples:

- CRM may show a customer's open Support cases.
- Support may communicate with a customer through Communications.
- Finance may send an invoice through Communications.
- Marketing may use Studio-authored content and Communications delivery.
- AI may invoke tools owned by other domains.
- Automations may trigger actions across every domain.

**Invocation does not transfer ownership.**

---

### CRM, Communications and Support remain distinct

These three domains frequently overlap in the user's workflow, but they answer different questions.

```text
CRM            → Who is this relationship and what is its commercial/customer state?
Communications → What was said, through which channel, and what happened to the conversation?
Support        → What problem or request is being resolved, by whom, under what service expectations?
```

A communication does not automatically become a Support case.

A Support case does not own a copy of the conversation.

A customer relationship does not own the support lifecycle.

---

### Studio and Marketing remain distinct

Studio owns authored and published customer-facing experiences.

Marketing owns acquisition and lifecycle intent.

Examples:

- Studio can own a form.
- CRM can own the lead/customer record created from a form submission.
- Marketing can own the campaign that distributed the form.
- Communications can own the email or message that delivered it.

---

### Work and Schedule remain distinct

Work owns **what must be done**.

Scheduling owns **when resources may commit to it**.

Calendar is a shared capability accessed within each workspace, with no standalone sidebar entry. Its day/week time grid supports creating and editing native events independently of CRM. Workspace scope is the default, with an explicit All workspaces option. CRM follow-ups and scheduled Work are additional feeds; they do not define Calendar. Native events do not reserve resources. Source domains retain record ownership and editing authority, and Work Schedule retains resource availability and dispatch.

Booking, dispatch and resource assignment consume the same scheduling and feasibility rules rather than creating competing availability calculations.

---

### Resource and Asset remain distinct

A **Resource** is capacity used to perform work.

Examples:

- person;
- crew;
- vehicle;
- machine used to execute work.

An **Asset** is a subject of work or something the business tracks or services.

A vehicle can be either depending on the business relationship:

- service van used by the business → Resource;
- customer's vehicle being repaired → Asset.

The model must follow the role the thing plays, not its physical category.

---

## Commercial product model

The commercial system answers a different question from operator navigation.

The canonical chain is:

```text
Catalogue
  ↓
Product / Module / Feature
  ↓
Plan + Add-ons
  ↓
Subscription / commercial terms
  ↓
Entitlements
  ↓
Limits and allowances
  ↓
Measured usage
  ↓
Customer charge and platform economics
```

### Product

A Product groups sellable customer-facing capability.

It does not define the sidebar.

### Module

A Module is a configurable or commercially meaningful capability group.

A Module may support several Features and may not have a direct operator surface.

### Feature

A Feature is a concrete capability the system can entitle, activate, enforce or expose.

### Plan

A Plan is a reusable commercial package.

It is not an organization-specific hand-written list of permissions.

### Add-on

An Add-on extends a Plan with optional capability, capacity or usage allowance.

### Subscription

A Subscription is one organization's active commercial relationship with GildOps and its billing provider.

### Entitlement

An Entitlement answers:

> **May this organization use this capability?**

It does not answer:

> **May this person perform this operation?**

That is authorization.

### Limit and allowance

Limits constrain operation.

Allowances define included quantities over a period.

### Usage

Usage records what the organization actually consumed.

GildOps should meter normalized product concepts rather than make vendor-specific units the primary customer product vocabulary.

---

## Two finance planes

GildOps contains two economic systems and they must remain separate (ADR-014, ADR-051).

### Organization Finance

Direction:

```text
customer → organization
```

Organization Finance owns the reusable commercial capabilities every Organization sells with:

- price book;
- quotes;
- invoices;
- payments;
- credits/adjustments;
- work and supplier costs;
- job economics;
- later: subscriptions, recurring charges, metered usage and prepaid balances.

Every Organization sells its own products and services through its own Finance. GildOps sells its platform the same way, through its operating Organization's Finance: the seller-side records of a GildOps sale belong there. Each seller's customers pay through that seller's own payment-processing relationship.

Financial reports (`/finance/reports`) also owns Economics & pricing planning: up to three unsaved delivery scenarios for a member with `report.read`, under the same billing/feature availability as reports. Operators enter currency, labor hours and cost per hour, materials, supplier and other estimated costs, and a target gross margin. A current price-book unit may be compared beside the suggestion. Recorded Work costs remain historical report context; entering an estimate neither copies back to Work nor changes a catalog price, quote, invoice or payment. This capability creates no persistence or publishing operation and exposes no platform economics or buyer-side Plan & usage.

### Platform control plane

Direction:

```text
GildOps → provider
```

Platform Administration owns what only the platform may do or know:

- tenant provisioning and global feature definitions;
- entitlement enforcement;
- provider accounts, provider rates and provider costs;
- platform margin, package economics and infrastructure economics;
- platform security and diagnostics.

During transition, the existing platform-billing records (Plans and Add-ons, plan assignments and agreements, commercial terms, platform subscriptions and usage events) remain in Platform Administration, protected and unchanged, until a reviewed migration moves GildOps' selling onto its operating Organization's Finance.

An Organization's purchase of GildOps is shown to that Organization under Business Settings → Plan & usage, never as its revenue.

A Finance workspace must never become a back door into GildOps platform economics.

---

## Providers and Connections

GildOps integrates with external systems without allowing vendor brands to become the domain model.

### Provider

A Provider supplies a technical capability to GildOps.

Examples include payment processing, telephony, email delivery, model inference, geocoding, routing and hosting infrastructure.

The business domain depends on capabilities, not provider SDKs.

### Connection

A Connection is a durable organization-owned relationship with an external application or system.

Examples include an organization's Google, Microsoft, GitHub or other supported external account.

A Connection is not:

- a CSV file;
- a PDF;
- a generic upload format;
- a provider account owned by GildOps.

The detailed provider and connection model is defined in `docs/domain-model.md` and `docs/integrations.md`.

---

## AI and automation

### AI

AI is an operator capability and reasoning layer.

It may:

- read business context the current actor is authorized to read;
- answer questions;
- summarize;
- draft;
- use approved tools;
- propose consequential actions.

AI does not become an alternate database or alternate domain layer.

A model response is not authority.

Consequential AI actions must pass through the same business rules, entitlements and authorization boundaries as equivalent human actions.

Where explicit approval is required, a proposed action remains pending until an authorized person approves it.

### Automations

Automations owns durable orchestration.

A durable business rule belongs in Automations even when one of its actions uses AI.

AI may reason inside an automation.

That does not make the automation AI-owned.

Likewise, an AI assistant may invoke an automation capability without acquiring ownership of its state or execution history.

---

## Core customer journey

The product lifecycle begins before an organization is provisioned.

### 1. Marketing and inquiry

```text
Visitor
↓
Marketing site / referral / outreach
↓
Inquiry
↓
Lead/customer context in GildOps' own organization
```

### 2. Sales discovery

In GildOps' operating organization, platform-authorized viewers capture prospect facts:

- how customers contact them;
- how work is booked;
- who answers;
- users and roles;
- operating hours;
- locations;
- resources;
- services/work types;
- current tools;
- website/public presence;
- quoting and invoicing;
- scheduling requirements;
- automation opportunities.

The **Discovery Snapshot**, configuration/proposal tabs and catalogue loads require this scope.

### 3. Proposed configuration

Discovery informs a proposed GildOps configuration and commercial proposal.

The proposal may describe:

- recommended product capabilities;
- required setup;
- implementation or migration work;
- commercial package;
- assumptions and unresolved questions.

### 4. Acceptance and handoff

An accepted proposal creates a durable handoff into provisioning.

Sales does not provision by silently creating an improvised tenant.

The handoff carries forward known information.

### 5. Provisioning and onboarding

```text
Accepted proposal
↓
Organization
↓
Owner membership
↓
Plan / commercial agreement
↓
Entitlements
↓
Initial configuration
↓
Readiness
↓
Launch
```

Onboarding begins by confirming what sales already learned.

It must not ask the customer to re-enter known information merely because ownership moved from Sales to onboarding.

### 6. Operation

Once launched, the organization operates through the normal product:

- workspaces;
- shared infrastructure;
- Settings;
- public/customer surfaces;
- connected systems;
- metering and entitlements.

There is no separate “post-onboarding product.”

---

## Customer-facing experiences

GildOps also produces surfaces for people who are not organization operators.

Examples include:

- public website;
- forms;
- booking;
- proposal review;
- customer portal;
- payment flows;
- invitation and authentication flows.

These surfaces must use the organization's approved identity and context where appropriate.

A customer-facing surface must not expose:

- Platform Administration;
- internal business configuration concepts;
- provider credentials;
- staff-only economics;
- unrelated tenant data.

Public/customer experiences are projections over canonical organization state and dedicated public-domain records, not independent copies of the business.

---

## Adoption principles

A customer does not adopt GildOps because it has more screens.

A credible adoption path requires:

- understanding the existing operating system;
- preserving the workflows that cannot stop during cutover;
- clear source-data mapping;
- repeatable import where needed;
- reconciliation;
- staged activation;
- health/readiness checks;
- recoverable provisioning;
- visible evidence that the new loop is better.

Migration work must strengthen reusable platform capability.

A named customer is evidence for the platform, not permission to create a permanent customer-specific fork.

---

## Product principles

### One shared model

Prefer one canonical record and explicit relationships over copies maintained by different workspaces.

### Configure before forking

Business variation should be expressed through:

- configuration;
- vocabulary;
- policies;
- connected systems;
- features;
- entitlements;
- automation;
- authored content.

Custom code is the exception.

### The business speaks; the platform does not

Never hardcode a word or a claim a business makes about itself. Statuses, stages, prices, business hours, buffers, guarantees, trust points, service assertions, section headings, greetings, email signatures and AI prompt defaults are the business's configuration, never platform defaults. Copy is configuration.

The platform does not decide what a business trades in, what currency it uses or what country it calls from. When an answer is missing, ask or raise a gap rather than guess.

On a business's public and customer-facing surfaces, the only platform-authored text is neutral application state: "Loading", "No results" and accessible labels.

### Workspaces follow operator intent

Navigation should represent the kind of work a person is doing, not internal package structure or billing vocabulary.

### Configuration is not operation

A page that configures how a workspace behaves belongs in Settings or an explicit Configure surface, not as a permanent operating destination merely because it is important.

Setup remains a readiness view over saved canonical configuration (ADR-039), including for a Live business and for GildOps' operating Organization. A Work type with no starting stage is an optional setup gap and cannot create Work of that type; Setup links directly to its Workflow. Optional relationship stages, resources and opening hours never become universal launch requirements. The database's existing launch blockers remain authoritative. Authorized editor links carry a bounded `setupStep` navigation hint and offer Return to setup; the hint stores no completion or configuration state.

Calling-number gaps lead to Communications → Numbers & assignments, while provider accounts and credentials remain Platform responsibilities. Finance setup includes Catalog & pricing and Customer payments; customer collection setup remains separate from the business's GildOps subscription.

New quote preserves the priced-Work contract. An empty business is led to Catalog & pricing when prices are missing, or to canonical New work when Work is missing. The explicit quote entry carries `returnTo=quote`; successful Work creation opens that Work's Financials. Its existing missing-type/starting-stage recovery remains available. Unmatched searches and permission restrictions have distinct messages. Relationship stages do not gate quotes, and nothing is created automatically.

### AI follows the system

AI uses the same records, permissions, tools and business rules as people.

It does not bypass them.

### Provider brands stay behind capabilities

Vendor changes should not force domain rewrites.

### History remains explainable

Committed commercial and operational history must remain understandable after configuration changes.

### GildOps dogfoods normally

GildOps' own organization uses the product through ordinary organization boundaries.

Platform authority is separate.

### Unfinished product is not navigation

Do not manufacture completeness with placeholder rows, fake data or nonfunctional controls.

### Evidence beats assumption

Product, packaging and operational decisions should distinguish:

- **Observed** — demonstrated by real use, a real buyer, measured behavior or committed agreement;
- **Modeled** — a forecast, spreadsheet, cost scenario or financial assumption;
- **Proposed** — a direction not yet validated.

Modeled or proposed values must not silently become product facts.

---

## Global Home

Global Home is the organization's cross-workspace operating starting point: current exceptions, three personal priorities, dated obligations, canonical creation shortcuts, recorded business figures, recent activity and workspace readiness. It composes existing domain authorities and sends users back to them to act. Personal work requires real Membership/Resource ownership. Reporting periods and current queues are separate scopes; empty, restricted, unavailable and runtime-unverified states remain distinguishable. Search launches authorized workspace search, customization affects optional presentation panels, and supported prompts use the existing global Agent.

## Non-goals

GildOps is not intended to become:

- a separate application fork for every customer;
- a set of disconnected mini-products sharing authentication;
- a provider console exposed directly to customers;
- a second database of records already owned by connected systems without a product reason;
- a generic no-code builder with no domain ownership;
- an AI agent that can bypass business rules;
- a navigation tree generated from commercial catalogue rows;
- a reporting system that reimplements operational calculations;
- a configuration system that duplicates operating screens;
- a place where “future” functionality appears as if it already works;
- accounting software: GildOps records what a business quotes, charges and is paid, but does not keep its books.

---

## Naming

The human-facing product name is **GildOps**.

The canonical public domain is `gildops.com`.

Legacy technical identifiers such as:

- `@gold/*`;
- `gold_*`;
- `Gold*`;
- `gold-platform`;

may remain in the live repository until a bounded migration changes them safely.

Do not rewrite applied migrations or historical evidence merely to modernize branding.

New human-facing documentation should use **GildOps** unless it is quoting or identifying a live legacy technical symbol.

---

## Document boundaries

This document owns:

- product identity;
- product outcomes;
- workspace taxonomy;
- shared product surfaces;
- product-level ownership boundaries;
- commercial concepts at product level;
- customer lifecycle at product level;
- product principles and non-goals.

It does not own:

- database schema;
- implementation status;
- route-by-route UI rules;
- security mechanics;
- provider credentials;
- test commands;
- deployment procedure;
- historical change logs;
- detailed public-web publishing, hostname, SEO and external-session architecture.

For those, use the canonical document responsible for that concern, including `docs/public-web.md` for public-web behavior.


Operating destinations are workspace navigation rows. Configuration of an existing destination is reached from that page (its Configure control) and draws no Configuration row of its own: Work's types and workflow configure Work items, and its scheduling hours configure Schedule, so Work has no Configuration row. A workspace whose configuration is a substantial standalone editor (CRM stages and fields, Communications calling and messaging, AI agents, Studio) keeps one Configuration destination. Shared organization settings live in Settings. Legacy configuration addresses keep redirecting. Its own page sections remain reachable when the application sidebar collapses. A configuration-only member may enter a configuration area without gaining operating capabilities; the underlying domain's existing prerequisites still apply. Communications owns calling, numbers, messaging and Inbox email (which addresses receive into the Inbox); Organization Settings → Email sending owns the business's sending domains, sender addresses and default sender, because Inbox, automations and service notifications all send from them; CRM owns relationship/opportunity stages and customer fields; Finance owns pricing/payment policies; Work owns its types/workflows and scheduling hours. AI retains its agent configuration owners. Marketing and Automations do not invent policy editors for operational features. Studio links to shared organization branding and domain owners.

Platform Administration remains independently authorized system administration. GildOps staff reach it from GildOps' own navigation (the Administration row, and a staff-only link from AI to AI Runtime; Finance carries no platform link), outside tenant workspace selection, while GildOps stays the selected organization. Switching away from a business with an active call opens a separate context so its telephone retains its business scope. Personal Settings remain user-owned. Channel configuration and sending are distinct: precise blockers describe what is missing, and actual message delivery requires provider-confirmed evidence. Outbound email does not promise mailbox synchronization.

## Business vocabulary and destination choices

An organization may save singular/plural nouns, authored destination labels and an ordered workspace page labels in one versioned business profile. Setup and Settings → Words & navigation edit the same record. An absent profile retains neutral labels; it does not assert onboarding completion. Canonical permissions, entitlements, routes and stored record names remain independent. Platform lives at `/platform` with its own privileged shell.

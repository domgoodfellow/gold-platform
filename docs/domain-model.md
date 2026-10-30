# GildOps Domain Model

## Purpose

This document defines the **canonical business concepts, ownership boundaries, relationships and invariants** used by GildOps.

It answers:

- What is this thing?
- Who owns it?
- What is it related to?
- What is authoritative?
- What is only a projection?
- What must never be confused with it?

This document is intentionally smaller than a schema reference.

The database schema remains the executable persistence contract. The domain model defines the meaning that the schema and application must preserve.

Implementation status belongs in `docs/roadmap.md`.

Historical rationale belongs in `docs/decisions/`.

---

## Modeling rules

### 1. A fact has one canonical owner

A business fact should exist canonically once.

Other workspaces may display it, summarize it, link to it or act on it through authorized domain operations.

They do not create their own authoritative copy.

```text
canonical record
      ↓
projections / related views / summaries
```

A projection may contain context-specific presentation or derived data.

It must not:

- become a second lifecycle;
- copy the authoritative business rule;
- silently fork status;
- require two updates to keep one fact correct.

---

### 2. Ownership does not follow invocation

A domain does not acquire another domain's state merely because it invokes it.

Examples:

- CRM may ask Communications to contact a customer.
- Support may reply through Communications.
- Marketing may send through Communications.
- Finance may send an invoice through Communications.
- Automations may invoke CRM, Communications, Finance, Field or Studio operations.
- AI may invoke approved tools from any domain.

The invoked domain remains the owner.

---

### 3. Tenant state is organization-scoped

Tenant-owned business state belongs to one Organization.

Cross-tenant access is not a UI convention. It is an authorization and database boundary.

A caller must not gain access to another organization by:

- knowing an identifier;
- constructing a URL;
- changing a request parameter;
- being Platform staff without using an explicitly privileged path;
- belonging to GildOps' own organization.

---

### 4. Entitlement and authorization are different

Two independent questions must be answered:

```text
Is this organization entitled to use the capability?
Is this actor allowed to perform this operation?
```

An organization buying a capability does not grant every member permission to operate it.

A role having a capability does not create a commercial entitlement that the organization has not purchased or activated.

---

### 5. Historical facts do not silently follow today's configuration

When a business commits to a financial or operational fact whose historical meaning matters, the committed record should preserve the relevant terms.

Examples include:

- invoice lines;
- priced work;
- recorded costs;
- commercial terms;
- usage pricing;
- provider cost attribution;
- checklist instances where later template edits must not rewrite completed work.

Configuration answers how the business operates now.

It must not rewrite history unless the domain explicitly models a correction.

---

### 6. Derived state is not a second source of truth

A value may be cached or projected for enforcement or performance.

That does not make it authoritative.

Every derived value must have a clear source and synchronization rule.

---

### 7. Public identity does not imply tenant membership

A public customer, booking visitor, proposal reviewer or portal user is not automatically an organization member.

Public access is narrow and task-specific.

Organization membership is explicit.

---

## Scope model

GildOps has three human operating scopes.

### Person

A Person is the signed-in human identity.

Person-owned concerns include:

- personal profile;
- sign-in email;
- password/authentication state;
- person-level security settings.

A Person may belong to several Organizations.

A Person is not a Role.

A Person is not a Membership.

---

### Organization

An Organization is one business operating in GildOps.

It owns tenant business state, including its:

- memberships;
- business configuration;
- customers;
- work;
- communications;
- resources;
- locations;
- assets;
- financial operations;
- automations;
- public experiences;
- connections;
- entitlements and usage.

An Organization is the tenant boundary.

GildOps' own business is an ordinary Organization for tenant product behavior.

---

### Platform Administration

Platform Administration is the privileged SaaS control plane operated by GildOps.

It is a scope, not a tenant and not a workspace.

Platform authority is independent of ordinary organization membership.

Platform Administration may inspect or manage platform-owned facts across organizations only through explicitly authorized platform operations.

---

## Identity and access

### Person

**Definition:** A human identity authenticated by the identity provider.

**Canonical authority:** authentication identity.

**Owns:**

- authentication credentials;
- verified email;
- person-level profile metadata.

**Does not own:**

- organization role;
- organization-specific display name;
- tenant business permissions.

---

### Organization profile

**Definition:** The business's own identity and operating metadata.

Typical facts include:

- business name;
- locale;
- timezone;
- currency;
- public identity;
- operating configuration.

Organization profile data belongs to the Organization, not to the owner's personal profile.

---

### Membership

**Definition:** The relationship between one Person and one Organization.

A Membership answers:

> This person participates in this organization.

It may include organization-specific information such as:

- display name;
- assigned Role;
- membership lifecycle.

A Membership does not replace the Person.

Deleting or changing a Membership must not rewrite the Person's global identity.

---

### Role

**Definition:** A reusable organization-owned grouping of permissions/capabilities.

A Role belongs to one Organization.

Roles describe what a member may do in that organization.

Roles are not commercial entitlements.

---

### Capability

**Definition:** An authorization-level permission to perform or manage a class of operation.

Examples include the ability to:

- place calls;
- send messages;
- manage roles;
- manage integrations;
- manage billing;
- read reports.

Capabilities are enforced by server/database authorization.

Hiding a UI control is not enforcement.

---

### Platform authority

**Definition:** Explicit permission to operate part of the GildOps control plane.

Platform authority is separate from:

- tenant Membership;
- tenant Role;
- ownership of GildOps' own Organization.

Platform authority must be checked explicitly.

---

### Invitation

**Definition:** A time/lifecycle-bounded invitation for a person to join an Organization.

An invitation is not a Membership until accepted under the rules of the access system.

Invitation state should move through an explicit lifecycle and remain auditable.

---

### External actor

**Definition:** An identity or narrow access context used for a customer/public task without organization membership.

Examples include:

- portal access;
- proposal review;
- public booking;
- anonymous/public form submission.

External actors receive only the minimum access required for their specific flow.

---

## CRM

### Customer

**Definition:** The canonical organization-owned business relationship record, presented as a Contact in CRM. It may represent an individual or business at Lead, Prospect or Customer lifecycle. The existing `customers` table remains its persistence owner.

CRM owns the Customer relationship. Lifecycle (`lead`, `prospect`, `customer`) is independent of optional lead temperature (`unrated`, `cold`, `warm`, `hot`), configurable relationship stage and each associated opportunity stage. Legacy NULL lifecycle means unclassified; no payment, stage or name is used to infer it. Classification never replaces the record or its associated history.

A Customer may be related to:

- communications;
- locations;
- work items;
- proposals;
- quotes;
- invoices;
- payments;
- documents;
- support cases;
- form submissions;
- discovery information.

Those related records remain owned by their respective domains.

A Customer should not be copied into each workspace.

---

### Lead

**Definition:** A CRM lifecycle concept representing a potential customer relationship that has not yet reached the organization's chosen qualification/relationship state.

A Lead is not automatically a second person/customer table.

Unless a later accepted domain decision introduces a separate canonical Lead entity, lead state belongs to the Customer/relationship lifecycle.

---

### Client/Tenant relationship

CRM's `client_tenant_relationships` connects one service Organization's Customer to an independently provisioned Organization. GildOps Internal uses this ordinary organization-owned model. A relationship is commercial provenance, never Membership, impersonation, or authority over tenant records.

One Customer may have multiple tenants, and different service Organizations may serve the same tenant. At most one active relationship exists per service Organization/Customer/tenant tuple. Ending preserves history; relinking creates a new period. Proposal-handoff relationships retain their originating immutable handoff. Retrying that handoff returns its original tenant and never reactivates an ended period.

Existing-tenant linking through `link_existing_client_tenant` requires selling-Organization `customer.update`, live `platform_staff` authority, and independent receiving-tenant `organization.manage` permission. The authenticated tenant manager explicitly approves the association through that signed action; a free-text approval note cannot replace tenant authority. Existing Membership/invitation operations establish that authority before linking. The operator records the verified agreement basis, and the row retains approving actor/time. Selectors expose only eligible managed tenants. No name, email, domain or slug matching infers the association. Ending requires selling-Organization `customer.update` and changes only the relationship.

### Service Engagement

`service_engagements` is CRM's durable service commitment to one Customer, optionally tied to one active Client/Tenant relationship. Kinds are Website, AI, Automation, Integration, Implementation and Managed operations. Planned may become Active, Completed or Cancelled; Active may become Completed or Cancelled. Completed and Cancelled are terminal. An engagement can precede tenant provisioning; an open unbound engagement can subsequently associate with an active relationship for that same Customer. Binding is one-time so historical references cannot be reassigned to another tenant. An engagement can optionally reference its Customer's Opportunity and accepted Commercial Proposal. Accepted terms are snapshotted at creation, including accepted add-on terms.

`engagement_deliverables` holds explicit tenant-bound references to Studio `public_sites` and `forms`, AI `ai_assistant_deployments`, and Automations `automation_rules`. These identify stable artifacts, not revisions. Each kind has its own composite foreign key; one reference holds exactly one supported artifact, and duplicates within an engagement are refused. No artifact content, instructions, secrets or credentials are copied. Live summaries require independent tenant Membership and owning-domain permissions. Without access, the reference remains visible as restricted; ending the relationship removes its status projection immediately.

`engagement_work_items` references selling-Organization Work Items for the same Customer. Work owns tasks, assignment, scheduling and execution lifecycle. Engagement status never changes an artifact or Work status. Service engagements create no subscription, entitlement, invoice, payment or hosting operation. Platform subscription billing, service-Organization Finance and tenant Finance remain separate.

### Customer Service Disclosure

CRM owns `service_disclosures`: a bounded customer-facing draft for one seller Organization, CRM Customer and Service Engagement. Existing engagements have no disclosure by default. Saving changes only the draft. An authorized `customer.update` operator explicitly approves and releases the saved version through `publish_service_disclosure`; immutable attributed `service_disclosure_revisions` preserve prior approvals. Withdrawal clears the live revision and retains history. Every command checks the customer/engagement tuple and expected version; concurrent edits/releases cannot silently overwrite one another.

Save, publication and withdrawal also appear in the existing Customer Activity timeline with its canonical actor attribution. They do not create another communications or task lifecycle.

Approved title, category, description and progress are deliberate seller communications. They do not inherit internal lifecycle, accepted terms, Work names, provider details or tenant configuration. `service_disclosure_deliverables` snapshots bounded presentations of existing typed references with composite engagement ownership keys. Selecting/publishing them requires an active relationship and independent artifact authority. Safe links are derived from published resources and verified, configured HTTPS custom origins; arbitrary URLs, credentials and editor destinations are unsupported. AI and Automation presentations have approved text, without inferred operating health or management actions.

Ending a relationship suspends all associated deliverable presentations and links in the customer projection. The explicitly published seller summary remains visible until withdrawn; history, engagements and artifacts remain intact. A seller may release a new summary without tenant presentations after termination. Lifecycle changes flag the approved update for operator review rather than rewriting customer copy. Portal definition publication independently controls whether Services is exposed, under the existing Portal entitlement. The PortalContext identifies the customer; commercial relationships confer no tenant Membership or private read grant.

---

### Customer Service Review

CRM owns `service_reviews`, an explicit operator request for an operational customer acknowledgement of one immutable approved disclosure revision, optionally narrowed to one of that revision's typed deliverable presentations. The release records the selling Organization, Customer, Engagement, revision, target, operator and time. It immediately becomes Pending; no separate prepared-content store exists. A revision/target can be requested once. A subsequent decision requires a newly published revision.

Pending may become Approved, Changes requested, Withdrawn or Superseded exactly once. Replacing a live disclosure supersedes its pending reviews; withdrawing it withdraws pending reviews. Final decisions retain their original target and attribution across later disclosure or engagement changes. Customer responses record the Portal user, invitation and customer-name snapshot. This identifies the responding invited Customer; it establishes neither corporate signing authority nor a legal signature, commercial acceptance or deployment permission. The approved object is the disclosure/presentation snapshot; a public destination remains a live resource, not an archived copy of its contents.

A Changes requested response stores bounded immutable request prose once and atomically creates a normal unassigned Support Case for that same selling Organization and Customer. Support reads the original request through a capability-protected source projection; Case descriptions/events do not copy the prose. Support owns assignment, queue, priority, service level, resolution and reopening. Work owns implementation tasks through existing Case/engagement Work associations. Resolving a Case does not rewrite the review decision. No customer action edits an artifact, creates tenant Membership or deploys anything.

### Opportunity

**Definition:** One organization-owned potential piece of business with a Customer, with an independently closing lifecycle.

Opportunity semantics belong to CRM.

An Organization has Customers; each Customer may have many Opportunities. `Customer.stageId` and `customer_stages` remain relationship lifecycle vocabulary. An Opportunity's nullable stage belongs to `opportunity_stages`; stages explicitly classify potential business as Open, Won or Lost. Unstaged is separate from Open. No stages are seeded.

Opportunity owns its title, optional owner Membership, optional integer minor-unit value with explicit currency, and optional expected-close calendar date. Unknown value is not zero. Owner is a same-Organization Membership, not a free-text name or resource assignment.

Stages have tenant-defined names and ordering. At most one Won and one Lost stage exist per Organization. Once a stage has been used, its classification is protected even after all Opportunities move away; names and ordering may still change. Events snapshot title, stage name/classification and commercial terms so configuration edits do not rewrite history.

CRM Home, the Opportunity collection/pipeline and the Customer's Opportunities tab project the same canonical records. The next action is the earliest open attached Follow-up, including overdue work; it is not a separate Opportunity text field. Opportunity does not imply a Commercial Proposal, quote, invoice or fulfillment handoff.

### Task and Follow-up

A Task is an actionable obligation. A Follow-up is an optional task purpose or workflow; an Activity records something that happened. The current CRM task model remains specialized: every task requires one Contact and a due instant, optionally references an Opportunity for that same Contact, and has kind Call, Email, Meeting or Task, an optional owner Membership, and Open, Completed or Cancelled status. It is not a general organization task system.

Contact and Opportunity detail, Pipeline, dashboard attention and the shared Organization Calendar project the same `crm_tasks` records. The old Follow-ups API and URLs remain compatibility adapters. Neither Follow-ups nor Tasks is a primary CRM navigation destination. Calendar does not copy task records or own their pipeline stages or resource scheduling. Completed and cancelled tasks remain historical. Broader task architecture is deferred.

CRM Home forecasts currently Open Opportunity values with an expected-close date in the selected month, unweighted and grouped by currency. Win rate is Won / (Won + Lost), using the last recorded closed transition per Opportunity in the selected month, including creation in a terminal stage. Reclosures count once per Opportunity in that month. Later reopening does not erase recorded closure evidence. A period with no closures has no defined win rate.

---

### Relationship stage

**Definition:** The organization's configured vocabulary for where a Customer relationship currently sits in its CRM process.

Stages are organization-owned configuration.

Changing stage configuration must not silently falsify historical activity.

---

### Discovery Snapshot

**Definition:** A durable record of what GildOps learned about a prospect or customer during discovery.

It may capture facts such as:

- business shape;
- people/resources;
- operating hours;
- locations;
- current tools;
- communication channels;
- scheduling needs;
- quoting/invoicing needs;
- automation requirements;
- website/public needs.

A Discovery Snapshot is evidence captured at a point in time.

It is not the Organization configuration itself.

It may seed a configuration proposal or provisioning handoff after acceptance.

---

### Commercial Proposal

**Definition:** A durable proposal offered to a prospect/customer describing a proposed GildOps commercial and implementation arrangement.

A proposal is not a Subscription.

Acceptance may create a handoff into provisioning.

The resulting Organization, Plan, Entitlements and configuration are canonical in their own domains after provisioning.

---

## Support

### Support Case

The implemented lifecycle is New, Open, Waiting, Resolved and Closed. Resolution requires a meaningful summary; Closed follows Resolved. Explicit reopening requires a reason and retains earlier resolution evidence. Priority is Low, Normal, High or Urgent. Escalation records an attributed reason and can route ownership without inventing another Case status.

An elapsed resolution policy matches queue and priority, with a priority fallback. Creation snapshots its policy and deadline. Subsequent policy, queue, priority and ownership changes and reopening retain that historical deadline. Reports count the latest resolution of currently Resolved/Closed Cases, excluding reopened Cases until resolved again. Resolution duration includes all elapsed time from initial creation through that latest resolution.

**Definition:** The canonical record for a customer problem, request, complaint or service issue that requires managed resolution.

Support owns:

- case lifecycle;
- assignment;
- priority;
- queue;
- escalation;
- service target/SLA policy;
- resolution state.

A Support Case may relate to:

- Customer;
- Conversation;
- Call;
- Work Item;
- Invoice;
- Asset;
- Location.

It does not own copies of those records.

---

### Request

A request may be represented by a Support Case when it needs durable ownership, assignment, service expectations or resolution tracking.

Not every message is a request.

Not every request requires a Support Case.

---

## Communications

### Conversation

**Definition:** A durable business conversation over a supported messaging channel.

A Conversation owns channel-level continuity.

Examples include:

- SMS thread;
- email thread.

A Conversation may relate to a Customer without becoming CRM-owned.

Channel-specific addressing belongs to communication identities.

---

### Message

**Definition:** One inbound or outbound communication event within a Conversation.

A Message includes channel-relevant delivery state and addressing context.

The carrier/provider's delivery vocabulary may be preserved as observed state, while business presentation may normalize it.

A Message is not an Automation run even when sent by an Automation.

---

### Call

**Definition:** One business-level voice interaction.

The business Call is distinct from provider legs/participants used to fulfil it.

A Call may include:

- inbound/outbound direction;
- customer relationship;
- business number/identity;
- participants;
- events;
- recording metadata;
- outcome/disposition;
- follow-up context.

Provider callbacks update the same Call rather than creating competing business records.

---

### Call participant / provider leg

**Definition:** One participant or provider-level leg used to fulfil a Call.

This is execution detail under the Call.

It should not be presented as a second business Call.

---

### Communication identity

**Definition:** An organization-controlled identity used to send or receive through a communication channel.

Examples:

- Phone Number;
- Email Identity.

A communication identity is not the same as a provider account.

The server resolves authoritative sender/address information from the selected identity rather than trusting a browser-supplied address.

---

### Phone Number

**Definition:** An organization-facing telephony identity backed by provider-observed/provisioned state.

A Phone Number may have:

- lifecycle/readiness;
- inbound/outbound capability;
- routing configuration;
- provider resource reference.

The organization must not forge provider-observed facts.

---

### Customer delivery notifications

CRM owns notification purpose and its exact service review/publication target. Customer identity
does not establish inbox ownership. One independently verified notification address per Customer
may consent to service_review_requested, service_update_published and service_review_status_changed.
PortalContext scopes preference operations; mailbox confirmation establishes consent separately.
Communications owns the sender identity, message, queue, suppression and provider observations.
Portal owns access; notifications never grant Membership or carry Portal bearer credentials.
Canonical Events provide bounded Customer Activity references rather than copies of email bodies.

Release/publication/optional withdrawal records intent even when email was not requested or is
ineligible. Failed sender setup can be retried after remediation without recreating the review.
Provider acceptance comes from the send response; Sent and Delivered require correlated signed
provider observations. Delayed, Bounced, Rejected, Failed and Suppressed remain distinguishable.
Delivery and open/click events establish neither human reading nor an operational review decision.
Consent changes preserve prior challenge/event attribution and delivery history. Reconfirmation
invalidates notices from the prior consent; opting in again never revives those notices.

### Email Identity

**Definition:** An organization-facing email sending identity.

It is distinct from the sending domain that proves the organization controls the domain.

One sending domain may support one or more email identities according to provider/domain policy.

An organization may name one ready identity as its default sender. Every email the organization
originates — Inbox, automation messages including booking confirmations, and service notifications —
resolves its sender through one path: an explicit identity (a conversation's address or a
Customer's chosen notification sender) must belong to the organization and be ready, otherwise the
default applies, otherwise the email is refused with the reason. The send uses the platform provider
account recorded as holding that identity's sending domain: domain setup records the account that
answered for the domain, and a domain with no recorded account cannot send until it is checked again.
No other account, and no installation credential, is used in its place. GildOps' own transactional sender and
installation credentials never stand in for an organization's sender. A refused confirmation never
undoes the booking or change that requested it.

An organization may also name where replies go: only one of its own identities on a domain it has
verified, never a typed address. Mail received at an identity is read only through the account
recorded as holding that identity's domain; until that account is confirmed, the provider retries.
An automation delivery that may have reached the provider but was never confirmed is Uncertain: it is
shown to the organization and never sent again automatically. A provider report tagged with the
delivery records it as sent, so a late report settles it without a second send. A manager may send a
test email from the default sender to their own confirmed sign-in address, a few times an hour.

---

### Routing policy

**Definition:** Organization-owned Communications policy determining how inbound/outbound communications are handled.

Routing belongs to Communications.

Provider-specific implementation belongs behind an adapter/control-plane boundary.

---

## Field and work

### Service / Offering

**Definition:** A reusable definition of what the business offers or performs.

A Service/Offering describes the work concept.

It is distinct from:

- one Work Item instance;
- its price;
- its schedule.

A Service may eventually reference:

- expected duration;
- resource requirements;
- checklist/template;
- bookability;
- scheduling policy;
- pricing rule.

Do not collapse these concerns into one record without explicit ownership.

---

### Work Type

**Definition:** Organization-owned configuration describing a class of Work Item and its operational behavior.

Work Type may determine:

- available statuses;
- transitions;
- whether work is schedulable;
- requirements;
- checklist/template policy.

A Work type is not ready to create Work until it has a starting stage. Setup observes this from the existing type and stage records and reports an optional gap; naming a type alone does not complete that area. The first stage is always an explicit authorized operation. A URL explicitly requesting a configuration tab retains it; a zero-stage type otherwise opens Workflow. Naming and scheduling behavior remain separately saved operations.

---

### Work Item

**Definition:** One instance of work to be performed.

Work owns:

- what must be done;
- customer/subject context;
- type;
- status/lifecycle;
- requirements;
- execution-related facts.

Work does not own the calculation of availability.

A Work Item may be related to:

- Customer;
- Location;
- Asset;
- one or more Resources;
- Schedule;
- priced lines;
- Invoice;
- Documents;
- Events.

---

### Work status

**Definition:** The current configured operational state of a Work Item.

Status transition validity belongs to the organization's configured Work Type transition model.

A status change must be validated authoritatively.

---

### Work transition

**Definition:** An allowed movement between two statuses for a Work Type.

A Work Type with configured transition rules does not become unconstrained merely because the UI fails to show a control.

---

### Checklist Template

**Definition:** Reusable configuration for checklist content applied to work.

Where historical meaning matters, a Work Item receives a snapshot/copy rather than permanently depending on a mutable template.

---

### Resource

**Definition:** Capacity used to perform work.

Examples:

- technician;
- crew;
- service vehicle;
- room;
- machine used by the business.

A Resource can have:

- class;
- capabilities;
- availability/working-hours policy;
- routing base;
- travel mode;
- membership relationship where applicable.

A Resource is not a Person, though a Resource may represent a member's capacity.

---

### Resource assignment

**Definition:** The relationship between a Work Item and a Resource committed or proposed to perform it.

Assignment is organization-scoped and participates in scheduling feasibility.

---

### Location

**Definition:** A physical or service location relevant to the Organization.

A Location may relate to:

- Customer;
- Work Item;
- Resource routing;
- public/service context.

Coordinates/geocoding are attributes or derived provider observations, not a replacement for the Location record.

---

### Asset

**Definition:** A thing the business tracks, maintains, services or performs work about.

An Asset may be customer-owned or organization-owned.

An Asset is the **subject** of work.

A Resource is **capacity used to perform** work.

---

### Asset reading

**Definition:** A time-stamped measurement or counter associated with an Asset.

Examples include mileage, hours or another configured measure.

Readings can inform maintenance/automation policy without turning the Asset into an Automation record.

---

## Scheduling

### Calendar event

A native Calendar Event is an Organization-owned appointment with workspace context, title, start/end instants, optional notes, creator and Scheduled/Cancelled status. It is independent of Customers, Follow-ups and Work. Calendar events can overlap and do not reserve Resources or imply scheduling feasibility. Each workspace reads its events by default; All workspaces broadens the view explicitly. Follow-ups and Work remain projections from their own canonical records, never copied into Calendar Events.


### Schedule

**Definition:** The projection of committed or candidate work over time and resources.

Scheduling owns:

- when work may occur;
- resource commitment;
- feasibility;
- availability.

Work owns the Work Item itself.

---

### Availability

**Definition:** The answer to whether one or more Resources can accept work in a time window under current scheduling constraints.

There must be one authoritative availability model.

Public Booking, internal Schedule and automation must not invent separate opinions.

Displayed availability is advisory until the authoritative write/constraint accepts the commitment.

---

### Feasibility

**Definition:** Whether a proposed scheduling choice satisfies all required scheduling constraints.

Feasibility may include:

- resource availability;
- required capabilities;
- operating hours;
- resource working hours/exceptions;
- travel/routing constraints;
- work requirements;
- scheduling policy.

---

### Operating Hours

**Definition:** Organization-local recurring business operating windows.

Operating Hours are local-time policy, not absolute timestamps.

---

### Resource Hours / Exceptions

**Definition:** Resource-specific availability policy that further constrains organization operating time.

---

### Booking Policy

**Definition:** Rules controlling what a public/customer booking experience may offer or accept.

Booking policy is distinct from scheduling feasibility.

Policy may restrict what is allowed to be offered even when a technically feasible slot exists.

---

## Finance

### Price Book

**Definition:** The organization's reusable tenant-facing pricing configuration.

It answers what the Organization charges for its own services/work.

It is separate from GildOps' SaaS catalogue.

---

### Price Book Item

**Definition:** One reusable price definition in the organization's Price Book.

When applied to committed work, historical pricing should be snapshotted rather than resolved forever against the mutable Price Book row.

---

### Priced Work Line

**Definition:** A snapshotted price applied to a Work Item.

It captures the commercial meaning required to preserve the agreed amount even if the Price Book changes later.

---

### Quote

**Definition:** A commercial offer from the Organization to its Customer.

A Quote is tenant Finance.

It is not a GildOps subscription proposal.

---

### Invoice

**Definition:** A financial claim by the Organization against its Customer.

An Invoice owns:

- invoice identity/number;
- currency;
- line snapshots;
- status/standing;
- customer relationship.

An Invoice total is derived from its lines and related financial facts rather than maintained as an independently editable truth.

---

### Invoice Line

**Definition:** A historical/snapshotted charge represented on an Invoice.

It must remain understandable after upstream pricing changes.

---

### Payment

**Definition:** A recorded movement or correction against an Invoice.

Provider settlement may be observed through a payment provider, but the tenant financial record remains canonical in Finance.

Corrections should preserve history rather than rewriting the original payment into a different event.

---

### Work Cost

**Definition:** A cost attributable to performing Work.

A Work Cost carries its own monetary/currency context.

---

### Job Economics

**Definition:** A derived financial reading connecting tenant revenue and work costs.

Job Economics is analysis over canonical pricing/invoice/cost facts.

It is not a separate ledger.

---

### Pricing Scenario

**Definition:** An unsaved tenant Finance estimate of delivering one item or service, distinct from recorded financial facts and from a suggested selling price. `lib/domain/pricing/planning.ts` owns its single pure calculation; it does not replace `priceWorkItem`, `jobEconomics` or reporting aggregates.

- **Recorded:** prices, invoice snapshots, payments and Work costs actually entered. Their amounts and currency snapshots retain their existing semantics. A margin on recorded costs does not prove all delivery costs have been entered.
- **Estimated:** labor hours (up to three decimal places), cost per hour, materials, supplier and other costs in one explicitly selected currency. Blank means unknown. Every zero contribution requires a written assumption, including a zero labor contribution; an all-zero estimate is valid when documented.
- **Suggested:** estimated cost divided by `(1 - target margin)`. Margin is profit divided by selling price, distinct from markup on cost. Targets range from zero to less than 100%, with two decimal places. Suggestions are forecasts, never realized margin or recorded prices.

Money is integer minor units with currency-specific precision. Decimal inputs are parsed exactly; excess precision, negative values, unsupported currencies and unsafe ranges are refused. Labor extension rounds half up once to a minor unit. Suggested prices round upward to meet the target after rounding; forecast profit and margin use that rounded price. An all-zero suggested price has undefined margin. Different cost currencies cannot be summed and a foreign-currency catalog item cannot be compared without conversion evidence; E1 introduces no FX model. Catalog comparisons mean one unit before tax, with its unit displayed so the operator can align the delivery scope. Changing scenario currency clears monetary assumptions rather than reinterpreting them.

---

## Platform commercial model

A **commercial capability** (a sellable item and its price, a quote, an invoice, a payment, and later a subscription, metered usage or prepaid balance) is owned by organization Finance and reused by every Organization, including GildOps selling its platform through its operating Organization (ADR-051). A **commercial record** is one Organization's instance of a capability and belongs to that Organization. The organization price book is a commercial capability; the platform capability registry below (Catalogue Products, Modules, Features, Plans) describes what the platform can enable and entitle, and is not a price book. Provider rates, costs and platform margin are never commercial capabilities.

### Catalogue Product

**Definition:** A customer-facing commercial grouping of GildOps capability.

It is not a workspace.

---

### Module

**Definition:** A commercially/configurationally meaningful capability group.

A Module may map to one or more Features and may support multiple workspace surfaces.

---

### Feature

**Definition:** A concrete capability that can be represented in catalogue/entitlement state.

---

### Plan

**Definition:** A reusable package of GildOps commercial capability and defaults.

A Plan may include:

- Features;
- allowances;
- limits;
- recurring price.

---

### Add-on

**Definition:** An optional package that extends the base Plan.

---

### Subscription

**Definition:** The provider-backed and GildOps-recorded commercial lifecycle for one Organization's recurring GildOps package.

A Subscription is not the same as Entitlement.

Subscription state is an input to commercial/service-access resolution.

---

### Commercial Term

**Definition:** Effective-dated evidence of what GildOps has agreed/sold for a period.

Terms preserve historical commercial meaning.

---

### Entitlement

**Definition:** Resolved organization-level permission to use a Feature/capability.

Entitlement combines the relevant commercial state and activation rules.

It remains separate from member authorization.

---

### Allowance

**Definition:** A resolved quantity included for an Organization over a defined period or reset policy.

An allowance is not descriptive marketing text. It must resolve to an enforceable/measurable quantity where the product depends on it.

---

### Limit

**Definition:** A constraint on operation or capacity.

Limits may be commercial or operational.

They must have a clear enforcement point.

---

### Meter

**Definition:** The normalized product concept used to measure usage.

Meters should represent what GildOps sells/measures rather than directly exposing provider billing vocabulary.

---

### Usage Event

**Definition:** One immutable commercial reading of what an Organization consumed.

A Usage Event may include:

- meter;
- quantity;
- moment/period;
- allowance application;
- retail charge state;
- fulfilment/provider attribution.

There should be one commercial usage ledger.

---

### Retail Rate

**Definition:** Effective-dated GildOps pricing for a tenant-facing Meter.

Changing a rate must not reinterpret historical Usage Events.

---

### Provider Cost Component

**Definition:** One provider-billed ingredient used to fulfil a Usage Event.

One Usage Event may have several independently reconciled cost components.

Provider cost is platform-private.

---

### Provider Rate

**Definition:** Effective-dated provider cost information used to estimate/record fulfilment cost.

---

### FX Rate

**Definition:** Effective-dated conversion evidence used for reporting across currencies.

Missing conversion data is unknown, not zero.

---

## Automations

### Automation Rule

**Definition:** A durable organization-owned orchestration rule.

A Rule defines:

```text
Trigger
Conditions
Actions
```

It may be enabled/disabled and has execution history.

A rule is not a one-off AI suggestion.

---

### Trigger

**Definition:** The event or condition that begins rule evaluation.

Triggers should reference canonical domain events or scheduled/external conditions through explicit contracts.

---

### Condition

**Definition:** A predicate evaluated against the rule's allowed context.

---

### Automation Action

**Definition:** An approved operation the automation runtime may invoke.

Actions should call canonical domain operations rather than reproducing business logic.

---

### Automation Run

**Definition:** One execution attempt/history record for an Automation Rule.

The run records what happened.

It is not the canonical business record changed by the action.

---

## AI

### Agent Conversation

**Definition:** A durable interaction between an authorized actor and a GildOps AI assistant.

It contains conversational context, not business truth.

---

### Agent Run

**Definition:** One model/tool execution lifecycle within an AI interaction.

A run may produce:

- an answer;
- tool observations;
- a proposed action;
- a refusal/error.

---

### Tool

**Definition:** A narrow operation through which AI may read or act on GildOps capability.

Tools must respect:

- current actor;
- organization scope;
- entitlement;
- authorization;
- canonical domain rules.

A tool is not a direct unrestricted database handle.

---

### Intended / Proposed Action

**Definition:** A consequential action suggested by AI but not yet executed when approval is required.

The action remains pending until an authorized human explicitly approves it.

The execution then uses the normal domain operation.

---

### Configuration Proposal

**Definition:** A structured proposed Organization configuration produced from discovery or guided setup.

A Configuration Proposal is not authoritative configuration.

Applying it invokes the same canonical configuration operations used by a person.

---

### AI runtime assignment

**Definition:** Platform-owned policy determining which supported model/runtime fulfils a GildOps AI capability.

It is Platform Administration state.

Tenants consume the capability; they do not thereby own the platform runtime assignment.

---

## Studio and public experiences

### Brand

**Definition:** Organization-owned visual/public identity configuration.

Brand is source context consumed by public/customer-facing surfaces.

It is not a separate public-site copy of the Organization.

---

### Domain / Hostname

**Definition:** A public hostname claim/configuration associated with the Organization's published experiences.

Domain verification/provisioning may depend on providers, but the organization-facing domain relationship remains canonical in GildOps.

---

### Public Site

**Definition:** A publishable customer-facing website owned by Studio.

The public renderer reads the current published state.

Drafting and publishing must preserve a distinction between editable draft and public revision.

---

### Site Revision

**Definition:** A versioned authored state of a Public Site.

Publishing selects approved revision state rather than making every editor keystroke public.

---

### Form

**Definition:** A reusable authored form owned by Studio.

A Form may be placed in:

- website;
- standalone/public route;
- booking flow;
- portal;
- other supported experiences.

Placement references the Form; it should not create uncontrolled copies.

---

### Form Revision

**Definition:** Versioned published form definition.

A submission must remain interpretable even after the Form is edited later.

---

### Form Submission

**Definition:** One immutable submission against a published form context.

A submission may create or update records owned elsewhere.

Example:

```text
Studio owns Form
CRM owns resulting Customer/intake state
```

---

### Portal

**Definition:** A customer-facing authenticated experience exposing a narrow projection of the Organization's records to the customer.

The Portal does not become owner of:

- Customer;
- Work Item;
- Invoice;
- Payment.

It reads/acts through those domains.

Studio owns one stable `portal_definitions` identity per Organization. Typed version-2 definitions contain settings, pages with stable IDs and unique paths, ordered configured module instances, navigation referencing page IDs and a default-page identity. Work, Invoices/Payments and offered Forms are the initial registry; Services use the independent CRM disclosure approval boundary. `portal_revisions` records immutable coherent releases with publisher and review attribution. Drafts and history are private; publishing changes presentation, never identity or source-domain ownership. A Portal remains a typed Engagement deliverable by stable identity, with independent tenant authority checks.

History uses bounded descending pages, with authorized reads of older revisions. A fifty-row
editor preview is not a retention limit; older publications remain inspectable and restorable.

---

### Proposal Review Session

**Definition:** A narrow external-access session allowing the intended prospect/customer to review a commercial proposal.

It is not organization membership.

---

## Marketing

Marketing is a canonical workspace/domain boundary even where the concrete data model is still evolving.

Marketing owns:

- audiences;
- segmentation;
- campaigns;
- acquisition intent;
- attribution;
- lifecycle/promotional consent and intent.

Marketing consumes but does not own:

- Studio content;
- Communications delivery;
- CRM customer state.

Marketing's operating records have these source-of-truth contracts:

- `marketing_campaigns` owns name, objective, notes, planned dates, optional Membership owner and intended channels. Draft may activate or archive; Active may pause, complete or archive; Paused may activate, complete or archive; Completed may archive. Archived is terminal and retains evidence. Activation enables tracked acquisition; it does not purchase ads, schedule posts or send messages.
- `marketing_audiences` stores version 1 dynamic CRM filters: optional relationship stage and inclusive Customer creation-date bounds. Membership is calculated from canonical Customers, never copied. Saved/matching audiences establish neither consent nor channel eligibility.
- Campaign audience and Form associations reference their canonical organization-scoped records. Landing page associations reference a published Studio revision and its actual page; Marketing owns no page content. Form publication remains Studio's responsibility. Public acquisition tokens identify one Campaign/Form association; only an Active campaign and currently published, unarchived Form accept attributed interest.
- `marketing_inquiries` represents one explicit tracked Form acquisition, not a Customer. New may enter review; New and In review may be explicitly handed off or disqualified after inspection. Handed off and disqualified are terminal. Linking a Customer is explicit; handoff may use an existing Customer or call canonical `create_customer` with separate `customer.create` authority. It creates no Opportunity and changes no CRM stages.
- Studio retains the original submission, revision and answers. An inquiry references them and snapshots source names and bounded UTM evidence at capture. Renaming campaigns and Forms does not reinterpret captured source context. Untagged submissions keep their existing Studio behavior and are not automatically reclassified as Marketing inquiries.
- Public submission and acquisition are one database transaction. A request UUID plus content fingerprint prevents duplicate responses on retries; one inquiry per tenant/submission is enforced structurally. Handoff locks the inquiry and returns its existing result on retry, so concurrent attempts cannot create duplicate Customers.
- Canonical append-only events record campaign changes, association changes, acquisition, review, linking and handoff. Marketing introduces no competing activity or automation engine.

Reporting counts acquisition by its occurred timestamp and handoffs by their handoff timestamp. The handoff rate uses the acquisition cohort in the selected period and its current handed-off state. Linked Form submission totals include untracked responses and are explicitly distinguished from campaign-attributed inquiries. Unknown source is preserved; visitor counts, ad spend, ROI, revenue and delivery claims are absent without supporting evidence.

Promotional sending is unavailable. Existing Communications suppression and sender readiness do not establish purpose-specific promotional consent; no Marketing broadcast path is provided.

---

## Library and documents

### Document / File

**Definition:** An organization-owned artifact with metadata and explicit relationships to canonical records.

A Document may relate to:

- Customer;
- Work Item;
- Location;
- Asset;
- Invoice;
- other supported records.

The related record does not acquire file ownership merely because the file appears in its UI.

---

### Media

**Definition:** A file/artifact used primarily as reusable visual/audio/public content.

Media remains a Library concern unless a domain has a more specific canonical object.

---

### Template

**Definition:** Reusable authored content or configuration intended to instantiate or support more than one use.

Do not create a universal Template entity merely because several domains each use the word “template.”

A shared Template model requires shared semantics.

---

### Knowledge

**Definition:** Organization-level material intended for retrieval/reference by operators or AI.

Knowledge is not automatically trusted business state.

Using knowledge does not bypass canonical record ownership.

---

### Collection

**Definition:** A reusable Library grouping when the product has a real organization-level collection model.

A navigation placeholder is not proof that the canonical data model exists.

---

## Integrations and providers

### Provider

**Definition:** An external vendor/service that supplies a technical capability to GildOps.

Provider names belong at adapter/control-plane boundaries.

Domain code depends on capability contracts.

---

### Provider Account

**Definition:** A platform-controlled account/credential relationship with a Provider.

Examples may include GildOps-owned API accounts or provider parent accounts.

Provider Accounts are Platform Administration state.

They are not tenant Connections.

---

### Provider Binding

**Definition:** The relationship determining which provider account/capability fulfils service for an Organization or platform function.

A binding may scope provider service without exposing credentials to the tenant.

---

### Provider Resource

**Definition:** A concrete provider-side object observed or provisioned through a Provider Account.

Examples:

- phone number;
- sending domain;
- subaccount;
- endpoint.

Provider-observed facts must not be forgeable by tenant input.

---

### Connector

**Definition:** A catalogue definition describing an external application GildOps knows how to connect to.

A Connector describes capability/readiness.

It is not an Organization's active relationship.

---

### Connection

**Definition:** One Organization's durable relationship with a Connector/external system.

A Connection may have:

- authorization state;
- credential reference;
- resources;
- readiness;
- lifecycle.

---

### Connection credential

**Definition:** Sensitive authorization material used to operate a Connection.

Credentials are stored through the approved secret/credential boundary.

They are not rendered back as ordinary application data.

---

### Integration Resource

**Definition:** A discoverable external object made available through a Connection.

Examples may include repositories, calendars, drives or other connector-specific resources.

---

### Import Run

**Definition:** One auditable ingestion attempt from a file or connected source into GildOps.

An Import Run should snapshot:

- source;
- mapping;
- execution state;
- reconciliation/result.

Changing the mapping later must not rewrite what an old import claims it did.

---

### File Intake

A file is an artifact/input.

It is not a Connector merely because it can be imported.

Supported file formats belong to file-intake policy and parsing, not the connection catalogue.

---

## Events, activity and audit

### Domain Event

**Definition:** A durable record that something meaningful happened in the business.

Events support:

- timeline/activity;
- automation triggers;
- reporting context;
- AI context;
- audit.

An Event is not necessarily the canonical state itself.

Example:

```text
Customer stage changed
```

The Customer/stage relation is canonical current state.

The Event records that the change happened.

---

### Actor attribution

Consequential writes should be attributable to an actor.

Actors may include:

- signed-in human;
- narrowly scoped machine identity;
- approved automated execution.

Avoid anonymous sentinel attribution for privileged machine actions.

---

## Shared configuration concepts

### Custom Field Definition

**Definition:** Organization-owned configuration extending supported canonical entities with declared structured fields.

Custom fields must preserve:

- declared key;
- type;
- allowed values where applicable;
- required/optional policy;
- organization scope.

A custom value not declared by that Organization is invalid.

Custom fields extend a domain entity.

They do not replace a proper canonical field when the product itself needs the concept.

---

### Lifecycle state

A durable entity should have an explicit lifecycle only when the business needs one.

Do not invent generic status fields as a substitute for modeling.

When a lifecycle exists:

- allowed transitions must be clear;
- terminal states must be defined where relevant;
- external/provider observations must not silently regress authoritative state.

---

## Cross-domain relationship map

The high-level relationship model is:

```text
Person
  └─ Membership ── Organization
                     │
                     ├─ Customer
                     │   ├─ Discovery Snapshot
                     │   ├─ Commercial Proposal
                     │   ├─ Conversation / Call
                     │   ├─ Support Case
                     │   ├─ Location
                     │   ├─ Work Item
                     │   ├─ Quote / Invoice / Payment
                     │   └─ Document
                     │
                     ├─ Work Type
                     ├─ Work Item
                     │   ├─ Resource Assignment ── Resource
                     │   ├─ Location
                     │   ├─ Asset
                     │   ├─ Checklist instance
                     │   ├─ priced work
                     │   └─ costs
                     │
                     ├─ Communications identities
                     ├─ Automation Rules / Runs
                     ├─ Connections
                     ├─ Brand / Public Site / Forms
                     ├─ Documents / Library
                     └─ Entitlements / Usage
```

Platform-owned state sits above organizations:

```text
Platform Administration
  ├─ Catalogue
  │   ├─ Product
  │   ├─ Module
  │   ├─ Feature
  │   ├─ Plan
  │   └─ Add-on
  ├─ Provider Accounts
  ├─ Provider Rates / Cost Meters
  ├─ Retail Rates
  ├─ AI runtime policy
  ├─ Platform billing
  └─ Organization portfolio
```

---

## Core invariants

The detailed executable invariants belong in schema/domain tests.

This document defines the semantic rules they must enforce.

1. **Every tenant-owned business fact belongs to one Organization.**
2. **Knowing another organization's identifier grants nothing.**
3. **UI visibility is never authorization.**
4. **Entitlement and actor permission are independent.**
5. **A canonical record has one owner even when several workspaces display it.**
6. **Provider SDK concepts do not become domain concepts without a product reason.**
7. **Historical committed terms are not silently reinterpreted by current configuration.**
8. **Money is represented with explicit currency and non-floating arithmetic.**
9. **Time instants are absolute; business recurring times are interpreted in the appropriate local timezone.**
10. **Availability and resource commitment have one authoritative enforcement model.**
11. **A public/customer identity is not organization membership.**
12. **AI tools do not bypass domain authorization or business rules.**
13. **Automation actions use canonical domain operations.**
14. **Platform authority is explicit and separate from tenant membership.**
15. **Tenant Finance and GildOps platform economics never become one ledger.**
16. **A file is not a Connection.**
17. **A Provider Account is not a tenant Connection.**
18. **Unknown price/cost/FX data is not zero.**
19. **Corrections preserve evidence rather than rewriting history where the domain requires auditability.**
20. **Compatibility routes do not create competing ownership or information architecture.**

---

## Terminology rules

Prefer the canonical terms in this document.

Avoid ambiguous legacy terms where a canonical term exists.

Examples:

| Avoid as canonical vocabulary | Use |
| --- | --- |
| tenant user | Person + Membership |
| team as a scope | Access |
| Sales workspace | CRM |
| Customer Experience workspace | Studio / Marketing / Support as appropriate |
| Insights workspace | Insights as cross-cutting analysis |
| platform tenant | Organization or Platform Administration, whichever is meant |
| integration for a file upload | File intake / Import |
| provider connection | Provider Binding or tenant Connection, whichever is meant |
| AI owns the action | AI proposes/invokes a domain-owned action |
| Finance for GildOps SaaS billing | GildOps operating Organization Finance (seller side) and Business Settings → Plan & usage (buyer side); provider economics stay in the platform control plane (ADR-051) |
| Overview as a workspace page type | Workspace Home |

Legacy routes and symbols may retain legacy names until migrated safely.

Display terminology may later be organization-configurable.

Canonical keys and ownership must remain stable underneath presentation.

---

## Document boundaries

This document owns:

- canonical domain definitions;
- ownership;
- conceptual relationships;
- semantic invariants;
- canonical terminology.

It does not own:

- database DDL;
- route layout;
- UI component rules;
- deployment;
- testing procedure;
- implementation status;
- historical rationale.

When a new concept is introduced, define it here if it becomes part of the durable product language.

## Business Profile and voice session

`organization_business_profiles` owns versioned business nouns, labels and destination keys. It is organization configuration, not permission or record identity. `voice_receptionist_configs` references a published external deployment with explicit duration and monthly voice budget. `voice_agent_sessions` pins the admitted call, organization, route, provider account, runtime and deployment revision; provider-reported usage and signed events belong to that session. Unknown duration reserves the maximum admitted duration. An uncertain carrier transfer is not a completed transfer.

## Canonical CRM identity (approved V1.1)

Contact is the organization-scoped identity of an external Person or Company, never a synonym for paying Customer. Each has its own stable contact ID. Unspecified is an explicit legacy classification state, never inferred from names or domains. Typed details describe identity; affiliations link a Person to Companies with title, primary designation and active/historical state. Lifecycle and temperature belong to each independent organization relationship. Opportunities are potential transactions linked to Contacts; Tasks are obligations and Activity is recorded history. Company membership does not propagate lifecycle, duplicate identity or merge records.

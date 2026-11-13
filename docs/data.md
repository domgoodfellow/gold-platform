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

`dialer_contact_candidates` exposes only the canonical contact-point match for one organization and requires current membership plus `call.place` before its privileged read. It returns at most two candidates to distinguish a unique match from ambiguity; it never links or creates a contact. Call-list additions retain the existing atomic task insert, including composite same-organization owner references, with the chosen due instant, owner and note.

`20261110000001_conversations_feed.sql` adds a security-invoker, authenticated-read-only view over existing message conversations and website threads. It carries tenant IDs through every join and preserves website claim state and an unknown read state. It creates no new conversation authority or write path.

`calendar_events` stores only native calendar appointments: Organization, workspace, title, start/end instants, notes, Scheduled/Cancelled status and creator attribution. A positive-duration check and constrained workspace/status vocabulary apply. Domain projections such as Follow-ups and Work are never duplicated into this table. Events may overlap; creating one does not reserve resources or bypass canonical scheduling feasibility. Tenant RLS and restricted column grants protect scope and attribution.

Personal appearance is an account-owned exception to organization-owned operating records.
`account_appearance_preferences.user_id` references `auth.users(id)` with cascade deletion;
it has no organization column and is not part of `account_profiles` or `brand_settings`.
Migration `20261012000002_account_appearance_preferences.sql` adds closed text checks for
appearance, preset, density, shape and motion, plus `updated_at`. Nullable overrides inherit;
absence is the established platform default. Reads never manufacture rows, Save upserts the
verified account, and Reset deletes its overrides. Organization defaults and Studio design
remain typed future contracts without persistence changes in Slice B.
Migration `20261025010000_brand_palette_and_background.sql` adds a nullable, checked
`background` (none, gradient, grid, ambient3d) to the same table; null keeps the neutral surface.

Personal Dashboard layout is presentation owned by one person in one organization, for one
workspace. `dashboard_layout_preferences` (migration `20261025201138_dashboard_layout_preferences.sql`)
is keyed by user, organization and workspace (`finance` only today), stores a versioned `layout`
(ordered widgets with width, height, presentation, density and hidden flags) and a `revision`.
RLS limits every row to its own person in an organization they currently belong to. A save names
the revision it started from and a stale one is refused, never merged; Reset deletes the row and
the product default applies. The application validates the layout against the workspace's widget
registry before writing, and checks bound the stored shape and size. It is never authorization,
never an organization report dashboard (`dashboards`, `dashboard_reports`) and never appearance.

An organization's processor customer for GildOps' own billing (`platform_billing_customers`) is
written only through commands (migrations `20261031000001_billing_customer_identity_is_claimed_once.sql`
and `20261031000002_billing_customer_identity_has_no_direct_writers.sql`). Ordinary sessions hold no
insert, update or delete grant. `begin_platform_billing_customer` reserves one row per organization
and environment with a `pending:` placeholder for a billing manager, for the `stripe` provider only.
`finalize_platform_billing_customer` is executable only by the `platform_billing_provisioner` machine
role, worn by `apps/api`'s `/platform-billing/customer` after it asked the processor itself with
GildOps' own key; it refuses any other caller identity, requires the requesting person to still hold
`billing.manage`, replaces exactly the reserved placeholder once under a row lock, and refuses an
overwrite, a stale placeholder or a reference already held. No human session can name a processor
customer reference. A finalized reference is unique per provider and environment; placeholders are
excluded and never match an event. The subscription and notice webhook functions resolve the
organization from a finalized reference in the signed event's own provider and environment
(Stripe's `livemode`), ignore an unknown or pending one, and refuse an ambiguous one. The portal
lookup is environment-specific. The migration stops, rather than repairs, if two organizations
already hold one finalized reference.
The same migration adds nullable, hex-checked `secondary` and `highlight` columns to
`brand_settings` (`accent` stays the primary, so existing brands are unchanged), column grants for
them, and the security-invoker `set_brand_palette` write, which records `organization.brand_updated`.

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

### Client/Tenant and engagement persistence

`20261022000070_client_tenant_relationships.sql` adds organization-leading relationship keys, partial active-tuple and originating-handoff uniqueness, explicit Active/Ended lifecycle, actor attribution and immutable provenance. An `AFTER INSERT` handoff trigger creates the relationship in the existing provisioning transaction. `app.backfill_handoff_relationships` uses only authoritative handoff rows, preserves actor/time, deterministically uses the handoff UUID for the initial relationship period, safely repeats and refuses conflicting provenance. No second application write follows provisioning.

`20261022000071_service_engagements.sql` adds engagements, typed deliverable references and Work references. The relationship composite key binds engagement Organization, Customer and target tenant; the deliverable's engagement key binds its target tenant before artifact-specific composite keys verify ownership. This deliberately crosses to the linked tenant's `organization_id`, rather than pretending that artifacts belong to the selling Organization. The schema-conformance test checks the exact supported source/target column pairs. Artifact deletion is restricted while referenced, preserving historical identities; archiving remains in the owning domain.

All four tables force RLS and grant authenticated actors only SELECT. Narrow RPCs own mutations; direct INSERT/UPDATE/DELETE is unavailable. Relationship-ending and reference-attachment commands lock the relationship row, preventing a concurrent attach after ending. Engagement commands lock their row, preserve terminal history and record existing canonical Customer Events. Accepted commercial terms are stored once and never recomputed for display from mutable proposals. No copied operational status is persisted.

Generated types come from `pnpm db:types`. Migration file names follow the version rule in Database migrations.

`20261022000072_tenant_reference_baseline_alignment.sql` reconciles an existing clean-gate violation: library jobs now reference execution through `(organization_id, execution_id)` and use organization-leading execution uniqueness. It preserves execution lookup and cascading cleanup; inconsistent legacy jobs fail the new foreign key rather than being reassigned. This changes no provider operation or connector credential authority.

### Customer service disclosure persistence

`20261022000076_customer_service_disclosures.sql` introduces private versioned drafts, immutable
attributed approval revisions and typed-reference presentation snapshots. Organization-leading
composite foreign keys bind each Customer/Engagement and revision/deliverable pair. No migration
backfills or publishes existing engagements. Table mutations are unavailable to API roles; narrow
RPCs lock rows, compare expected versions and record canonical Customer Events in the same transaction.
Publish revalidates active relationship and independent artifact authority. Withdrawal changes only
the live revision pointer. Termination and engagement transitions do not mutate historical copy,
canonical artifacts, Work, subscription or Finance records. TypeScript and PostgreSQL enforce the
same bounded draft and Services configuration contracts. Generated types use `pnpm db:types`.

### Contact classification and intake ownership

`20261022000098_contact_lifecycle_temperature.sql` extends `customers` with a nullable closed lifecycle and closed lead temperature. Existing lifecycle values stay NULL (Unclassified). The column default remains Lead for intake paths that rely on it (booking, inbound calls, forms), but since `20261024040000_contact_lifecycle_explicit.sql` manual creation (`create_contact`, `create_crm_contact`) stores only a chosen lifecycle, and imports resolve a new row's lifecycle as row-level mapped value, then the reviewer's source-wide default for new rows (`default_lifecycle`), then Unclassified; updates change lifecycle only from a row-level mapped value. `20261024050000_relationship_stage_delete.sql` adds `delete_relationship_stage`, which refuses while any contact or marketing audience uses the stage, and `relationship_stage_usage`. Unrated records absence of a temperature rating. No existing identifiers, stage assignments, foreign keys or relationships are rewritten. `create_contact` and `update_contact` extend the established customer commands transactionally, with exact organization capability checks and classification audit events; existing command signatures remain usable. Types are generated from the local schema using `pnpm db:types`.

`20261022000099_crm_source_sync_review.sql` extends the existing Library mapping `sync_mode` to import/sync, guarded by `configure_crm_import_sync`; only active connected worksheets may select sync. Existing CSV identity remains scoped by filename and explicit source ID (or content fingerprint). Worksheet identity uses the immutable resource ID and provider external row ID. Runs preserve the saved mapping and external-record provenance. For fields with a previous applied source value, updates compare current CRM values with that snapshot and the incoming value. Divergent local edits fail the row with a reconciliation message; the contact and previous source link remain intact. Reconcile the spreadsheet with the local value, or leave the contact unchanged and stop synchronization, then review a fresh run. Missing source rows only change Library reconciliation state; no contact delete command is involved. CRM scheduling remains manual and reviewed.

### CRM Follow-up persistence and operating reads

`20261113000001_one_call_list_entry_and_explicit_removal.sql` holds one open Call task per contact with the partial unique index `crm_tasks_one_open_call_per_contact`. Before creating it, the migration cancels (never deletes) any extra open Call tasks per contact, keeping the one due first (then created first, then the lowest id). Each cancellation is logged with reason `duplicate_call_list_entry` under the data migration account `00000000-0000-4000-8000-0000000000a3` (a real `auth.users` row that can never sign in, like the payment integration `…a1` and automations `…a2`), with the task's creator kept as `task_created_by`. `add_call_list_entries` (invoker rights) inserts Call tasks with a conflict skip for contacts the caller can see and returns the contacts actually added. The `call_list_removal_guarded` trigger and `remove_from_call_list` enforce `call_list.remove` (`security.md`). The invariant is one open Call task per contact; several independently scheduled calls to one contact are not supported, and that limitation is left for a later decision rather than a separate campaign queue.

`20261113000002_contact_read_and_removal.sql` adds `customer.read` and `customer.delete`. Every existing role receives `customer.read` (membership alone showed contacts before) and roles holding `organization.manage` receive `customer.delete`; industry template roles gain `customer.read` too. Contacts, `contact_people`, `contact_companies`, `contact_affiliations`, `customer_locations` and contact events (`entity_type = 'customer'`) are readable only with `customer.read`, through `app.tenant_ids_with`, which a policy evaluates once per statement. `conversation_customer_candidates`, `form_submission_customer_candidates`, Marketing's contact search, audience member names and linked inquiry names, and form response contact names follow it too. `call_list_contacts` is the Dialer's narrow disclosure (`security.md`). Contacts gain `archived_at`/`archived_by`, set only by `archive_contact` and `restore_contact`; `contact_directory` exposes `archived_at`, and the directory, pickers, the call list, Marketing audiences, the CRM dashboard counts and the not-contacted list leave archived contacts out. `delete_contact` deletes only when `app.contact_retained_records` finds nothing the business must keep (every foreign key to contacts except the contact's own person/company details, plus import links); it locks the contact, records `customer.deleted`, and turns any foreign key refusal into the same message. `contact_removal_check` returns only the kinds of record that keep a contact. Both role backfills set aside `roles_capabilities_update_guard` for the statement, because it refuses any change in a business that already has nobody holding `role.manage`; additive grants cannot cause that.

`20261113000003_import_review_matching.sql` adds `review` to staging statuses and actions, and `match_reason`, `candidate_customer_ids` (at most ten) and `decided_by`/`decided_at` to `import_staging_rows`. Matching reuses `app.normalize_email`, `app.normalize_phone` and `app.contact_matches`. A file's source keys are scoped by its name, so a row whose whole content, or whose source ID together with the same name or email, is linked from another file of the same source is held as `source_other_file`; a bare source ID from another file is not, because unrelated files number rows the same way. `decide_import_row` (which also needs `customer.read`) and `skip_undecided_import_rows` record a person's decision; `apply_import_run` refuses while any row needs review, serializes all contact imports of one business, and fails rather than creates an undecided new row whose email, or phone without emails, now matches a contact.

`supabase/preflight/20261113_contacts_and_call_list.sql` is the read-only preflight for these three migrations (`deployment.md`).

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

An invoice's `source` is `work_item` or `direct`. A Work invoice names its Work item; a direct invoice names none and carries an issuance key and request fingerprint, and `invoices_source_reference` enforces exactly those combinations. `issue_invoice` and `issue_direct_invoice` are the only invoice writers and `record_payment`/`record_provider_payment` the only payment writers; `authenticated` holds no insert, update or delete on `invoices`, `invoice_lines` or `payments`. Both issuers take numbers from `app.allocate_invoice_number`, which serializes per organization. `issue_direct_invoice` accepts catalog item ids and whole quantities only, copies each item's name, unit, price and currency, requires the organization's trading currency, `invoice.issue` and a usable Billing module, and returns the existing invoice when an issuance key is retried with the same request. Payment events name the invoice when it has no Work item. `invoiced_and_incurred` counts direct invoices under their issued customer; they have no location or resource.

A commercial proposal's `basis` is `platform_plan` or `catalog` (`20261031000005`). A Platform Plan proposal names its plan and copied plan and add-on prices; a catalog proposal names no plan and has one-off terms, no discount, and copied `customer_commercial_proposal_lines` (item id kept as provenance with no foreign key, name, unit, currency, whole quantity, unit price and amount) whose sum is `catalog_total_minor`. A table check holds each shape. `build_catalog_proposal` (`20261031000006`) is the only writer: it requires membership, `price.manage` and usable Billing, copies prices from `price_book_items`, and writes the row, lines and event in one transaction under a per-customer lock so concurrent builds take consecutive versions. Signed-in members keep only the status update that marks a draft sent. `hand_off_accepted_proposal` refuses any basis but `platform_plan`.

A trigger (`20261031000007`) holds every proposal update to draft → sent and, inside the customer's own accept and decline functions only, sent → accepted or declined; no update may change a proposal's terms. An invoice's `source` is `work_item`, `direct` or `proposal`; a proposal invoice names its `proposal_id` (restrict on delete) and no Work, carries an issuance key, and `invoices_org_proposal_unique` allows one invoice per proposal. `issue_invoice_from_proposal` (`20261031000008`) is its only writer: it takes the proposal, optional dates and the key, requires membership, `invoice.issue` and usable Billing, accepts only an accepted one-off catalog proposal whose lines add up to its stored total, copies those lines, and numbers through `app.allocate_invoice_number`.

An issued invoice's presentation is `invoice_presentations` (`20261102000001`), one row per invoice written by an after-insert trigger on `invoices` in the issuing transaction, for every source: seller identity from `organization_identity` and the organization name, bill-to name and email, brand colours and fonts from `brand_settings`, the retained logo path, layout and version, and timezone. It holds no amount, price, payment or status, and nobody updates it. Retained logos and invoice PDFs live in the private `finance-documents` bucket. Since `20261102000003`/`20261102000004`, only the `invoice_document_writer` machine role (apps/api) stores there, under names it chooses. It may remove only objects it stored that nothing records, and nobody updates an object. `invoice_retained_logos` records the writer's copy of each brand logo with its SHA-256. A presentation names a retained logo only when the brand logo current at issue has a recorded copy, so a logo changed before issue falls back to the business name. `invoice_documents` records one canonical PDF per invoice (path, SHA-256, size, renderer). `record_invoice_document` and `record_retained_logo` are executable only by the writer and record once. They require the requesting person's `invoice.issue` (or, for a logo, `organization.manage`) in the invoice's own business, and accept only an object the writer itself stored at exactly that size. Paths are unique within their organization. The PDF states the invoice as issued and no payment status. Emailing an issued invoice (`20261102000005`) goes only through `queue_invoice_email`. It requires `invoice.issue`, `message.send` and usable Billing, and uses the business's default sender from `app.organization_email_sender`, with no fallback. The recipient is the email on the invoice customer's contact record, refused when it is suppressed or does not match what the request repeats. The message is queued through `queue_outbound_email` as a transactional email. The recorded PDF is attached in place: a `message_attachments` row with `storage_bucket = 'finance-documents'` and its `sha256`, which the tenant-email runtime checks against the bytes it reads before sending. `invoice_emails` records each send (message, sender and recipient as they were, document path and checksum, any earlier send it follows), is never updated, and is removed only with its business. Delivery state stays on the message. Members read their business's rows and files; a portal customer reads only their own invoices' rows and PDFs, never retained logos. Invoices issued before `20261102000001` have no presentation and are not backfilled.

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

Library files (`documents`, ADR-043) are organization-owned. Records reference them through `document_links`, one target per row. An Agent-private file is owned by its person and cannot be linked. The following hold for the private `documents` bucket (migration `20261022000086`):

- Only the uploader may remove an object, and only while no `documents` row or integration resource names its path (ADR-044).
- The bucket accepts only the MIME types a Library file may have. SVG is not one of them.
- A stored file's first bytes must match its format before it is written. Text formats must be UTF-8 with no NUL byte.
- Each file records a SHA-256 checksum of the bytes as stored. A file stored before the checksum existed has none recorded, and it is not shown as an empty one.
- The storage-limit check and the row insert run under a per-organization lock, so concurrent uploads cannot both pass the same remaining allowance.

The Library's file list is read through `library_file_page` and `library_file_summary` (migration `20261022000087`). Search, type, usage, sort and paging run in PostgreSQL, so the count above a list and the rows beneath it agree. Both are security-invoker, and neither ever lists an Agent-private file.

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

### Migration version numbers

A migration file is named `YYYYMMDDHHMMSS_purpose.sql`: Supabase's standard UTC timestamp. Create every new migration with `supabase migration new <purpose>` (run through the repository CLI, `pnpm exec supabase`), which writes the current UTC time. Do not type a version by hand, do not use a future date, and do not use the last six digits as a counter.

Supabase applies files in version order and refuses a new file that sorts before one already applied. Versions must be unique, valid timestamps, later than every existing version, and no later than the time they were created. `tests/architecture/static/migration-versions.test.ts` enforces this for every file not listed as a historical exception.

Historical exceptions (keep them; do not rename applied migrations):

- Before 2026-10-22, most files used `YYYYMMDD` followed by a counter in the time field (`000001`, `000002`, …). Counters up to `000059` are still valid times (00:00:01 to 00:00:59), so these comply.
- On 2026-10-22, 104 files were renumbered in their original order with contents unchanged. 100 had future dates (up to `20261230…`) and became `20261022000002`–`20261022000101`. Four had clock times and became the next counter of their own day. Of these, `20261022000060`–`20261022000099` (40 files) have a seconds value of 60–99, so they are not valid timestamps. Supabase CLI 2.115.0 lists, orders and applies them correctly and shows the raw number instead of a time. They are recorded as exceptions in the test.
- The local ledger was updated in place, and the hosted ledger (`nuceqypuwrjavrwiloda`) was corrected with `supabase migration repair` (new versions applied, old versions reverted). Any other database still holding the old numbers needs the same repair before its next migration run. Old-to-new pairs are recoverable with `git log --follow` on a migration file.

The first migration after these exceptions only has to sort after `20261022000101`, which any `supabase migration new` timestamp from 2026-10-22T00:01:02Z onward does.

---

`20261024011839_reconcile_hosted_schema.sql` restores the committed end state where the hosted project held earlier drafts of `20261022000075` and `20260923000001`. It recreates `app.external_card_payment_availability` and the public card-payment entry points, which require the Portal to offer invoice payments and card payments to be switched on and entitled by the plan. It also restores two Portal function bodies, forces row-level security on `public_communication_rate_limits` and revokes every table privilege on it from `PUBLIC`, `anon` and `authenticated`; the table is reached only through `consume_public_communication_rate_limit`. On a database that already matches, only the rate-limit table's leftover default privileges change. It is ordered after `20261022000098`–`20261022000101`, and nothing is applied to hosted without separate approval.

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

## Support persistence

Customer service reviews use `service_reviews`, composite-bound to the exact Organization/Customer/Engagement/disclosure/revision and optional approved typed deliverable. A unique nulls-not-distinct revision/target key refuses duplicate release. Requests are immutable except for one pending-to-final transition; terminal rows and target fields are protected by a database trigger. All public commands deny direct table mutation. Disclosure locks precede review locks, serializing publication, withdrawal and competing decisions; version conflicts return HTTP 409. Publication/withdrawal atomically finalize affected pending reviews. Response attribution pins the Portal user, invitation and customer-name snapshot. History is never repointed to a newer revision.

Changes requested atomically allocates a canonical Support Case number, creates a normal unassigned/unqueued Case and applies the existing active general normal-priority elapsed service-level policy. Request prose lives only in the immutable review row; a Support-capability projection supplies its original source. Private/public event payloads contain reference IDs, not customer prose. The forward migration is `20261022000077_customer_service_reviews.sql`.

Support uses `support_cases`, `support_queues`, `support_service_levels`, `support_case_counters`, `support_case_events` and `support_case_links`. Organization-leading composite foreign keys bind Customer, Membership, queue, policy and each typed canonical relation to the same tenant. An atomic per-organization counter allocates Case numbers safely under concurrent creation. One transaction validates and writes each command and its attributed immutable evidence. No authenticated direct mutation or deletion is granted.

`support_case_records` is an invoker view. `support_read` computes exact database totals and bounded independent status previews, paginated collections and history. Calendar periods and Today boundaries use the organization timezone. Resolution targets use elapsed minutes, immutable policy/deadline snapshots and current time for overdue classification. Reports use latest resolution for currently terminal Cases; reopened Cases retain historical evidence but leave resolution aggregates until resolved again. Private notes have no portal/public projection. Migration ordering follows the latest repository timestamp rather than the workstation date.

## Marketing persistence

Marketing persistence uses organization-bound composite foreign keys for Campaign, Audience, Form, submission, Customer and Membership references. Campaigns and inquiries preserve history and have no authenticated deletion grants. Dynamic audience definitions are typed version 1 filters, not materialized copies of CRM identities. Acquisition provenance snapshots only historical source names and bounded UTM context; submitted answers and immutable revision definitions remain Studio-owned. Tenant/submission uniqueness and a private request fingerprint ledger enforce acquisition idempotency; inquiry row locks enforce canonical CRM handoff idempotency. Landing page associations retain tenant-bound published Studio revision and page references. Reporting calendar boundaries use the organization timezone. Campaign/inquiry period, state and association indexes support exact database aggregates and bounded paginated collections. The Marketing migration follows the repository's latest migration sequence, whose existing timestamps extend beyond the workstation date.

## Global Home read projections

Home stores no duplicated operational records. Ordinary actor clients read exact category counts and bounded previews independently. `Counted` retains non-serialized exact-count evidence so an absent count cannot masquerade as a complete preview. Call/Inbox totals remain unavailable when the server does not answer their exact-count request. Studio tables retain their direct-read restrictions: `home_studio_summary` checks the existing tenant Studio-manager boundary and returns only exact draft counts and bounded metadata, excluding archived Forms and editor content. `home_financial_totals` is an invoker aggregation over the canonical invoiced/incurred report, retaining `report.read`, tenant RLS, organization-local date bounds and stored currencies while avoiding transfer of all Customer groups. Forward-only migrations are `20261022000063_home_studio_summary.sql` and `20261022000064_home_financial_totals.sql`; neither introduces a record table. Hosted application is a separate release step.

## Studio Portal publication

`portal_definitions` is the stable Organization-owned composition identity; `portal_revisions` contains append-only published snapshots with publisher/time. Both force RLS and grant authenticated clients SELECT only through Organization-management policies. Guarded commands serialize against the definition and compare `draft_version`; stale saves/publishes/unpublishes return HTTP 409, rather than a retryable transaction failure. A first save locks the Organization parent to prevent duplicate creators. Publication is idempotent for matching live content; a later publication or republish after withdrawal increments the revision number. Restore reads an authorized same-Organization revision and saves it as a new draft version.

Content admits exactly version, settings, defaultPageId, pages and navigation. Database and TypeScript validators agree on bounds, plain text, unique page paths/IDs, globally unique module IDs, registered configuration keys/variants and valid navigation references. Forms cannot duplicate on one page. `draft_status` and submission attribution bind review to the saved version; saving/restoring clears review. Immutable historical foundation revisions normalize on read while retaining their original stored contents. No credentials or customer records are stored in composition. Typed Portal deliverables use the existing same-tenant composite foreign key. The forward B migration removes the premature engagement visibility column and Services projection.

## Tenant AI resources

`ai_assistants` remains the canonical agent resource, with editable configuration and a monotonically increasing draft number. `ai_assistant_versions` stores immutable published instructions, configuration and knowledge-site associations. `ai_assistant_deployments` pins a published version and channel configuration; it is not a separate agent model. Composite Organization foreign keys protect versions, deployments, run attribution and website-thread attribution. Tenant managers write through capability-checked commands; no direct client draft/version mutation is granted.

`agent_runs` and `agent_conversations` retain personal operator history. `communication_threads` and `communication_entries` retain website visitor and staff history, including claim ownership and staff authorship. Anonymous visitors are opaque visitor keys, not automatically created Customers. `ai_assistant_evaluations` records the caller's safe preview and human verdict, rather than fabricated automated scores. Published knowledge is bounded retrieval of current published same-Organization site revisions; the version snapshots source associations, not website content.

## Business foundation persistence

Forward migrations `20261022000089`?`20261022000095` add private inbound call snapshots/stable route cursors, a Membership-readable and owner-command-written business profile, receptionist configuration, and private provider session/event records. Profile and receptionist writes use revision checks with immediate conflict responses; raw client writes are denied. Session admission serializes each business budget, requires Reception and Assistant entitlement and a usable central voice assignment. Event deduplication and duration/token metering commit atomically. Retry fences recheck live Membership capabilities and terminal call state. Applied locally only; hosted application is a separate release action.

## Approved CRM consolidation and compatibility retirement

V1.1 requires canonical `contacts` persistence with stable existing IDs, explicit Person/Company/Unspecified type, typed identity details and organization-bound affiliations. Existing associations remain attached to the same identity through PostgreSQL dependency-preserving table renaming. Transitional customer names are adapters to that identity, never a second store. The existing CRM obligations are the suitable task authority; no shared generic task table exists. Preserve task identifiers, assignments, due dates, statuses and historical event vocabulary.

Legacy database views, command/domain adapters and URL redirects have one compatibility period: retain through migration rollout and one client release after all consumers have moved. Remove only after consumer inventory and URL telemetry show no legacy use for 30 consecutive days, historical import/provider replay tests pass, and a forward migration has been reviewed. Do not remove historical event names, capability identifiers or applied SQL as a cosmetic rename. Legacy routes retain tenant, record ID and query parameters.

`20261022000100_canonical_contact_identity.sql` renames `customers` to `contacts`, `customer_stages` to `contact_relationship_stages` and `crm_follow_ups` to `crm_tasks`. A rename keeps every row ID and every inbound foreign key (opportunities, quotes, invoices, calls, conversations, work, locations, documents, service engagements, portal access, import staging, external record links), along with RLS policies and triggers. Stored functions that named the old tables are rewritten to the new names in the same transaction. `contacts.contact_type` is `person`, `company` or `unspecified`; every existing row is `unspecified` and nothing infers a type. Typed details live in `contact_people` and `contact_companies`, and `contact_affiliations` links a person to a company with title, primary flag and active/historical state. Composite `(organization_id, id, contact_type)` keys make a wrong type or a cross-organization link impossible. All three new tables are read-only to members and written only through `create_crm_contact`, `update_crm_contact` (which classifies an Unspecified record once and refuses any later change of type) and `save_contact_affiliation`, each checking `customer.create` or `customer.update`. Columns keep their existing names (`customer_id`, `matched_customer_id`), and so do event entity types and capability keys, because they are historical vocabulary.

`20261022000101_crm_contact_intake.sql` adds the `contact_directory` view (invoker RLS) that projects each contact's active primary company for sorting and grouping. It adds `opportunities.primary_person_id`, which must be a person actively affiliated with the opportunity's company. It also replaces `apply_import_run` so imports write `contacts.contact_type` from the mapping (default `unspecified`) and attach an affiliation only by an exact company contact ID, never by a similar name.

| Old name | Canonical name | Compatibility layer |
| --- | --- | --- |
| table `customers` | `contacts` | view `customers` (invoker RLS, same rows) |
| table `customer_stages` | `contact_relationship_stages` | view `customer_stages` |
| table `crm_follow_ups` | `crm_tasks` | view `crm_follow_ups` |
| `lib/domain/customers/customers.ts` | `lib/domain/contacts/contacts.ts` | re-export shim, no app callers |
| `lib/domain/follow-ups/follow-ups.ts` | `lib/domain/tasks/tasks.ts` | re-export shim, no app callers |

Local ledger verification on 2026-10-22 found all four migrations applied through `20261022000101`. They were renumbered on 2026-10-22 under the version rule in Database migrations. Hosted ledger/application is a separately authorized release step.

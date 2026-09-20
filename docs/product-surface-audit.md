# Product Surface Audit

This is the maintained human reading of `apps/web/lib/catalogue-surface-coverage.ts`, the
machine-checked map of every canonical Feature marked `available` or `partial`. Catalogue state
describes the commercial/runtime claim; Domain, UI, Interaction and Test describe what a person
can actually use. Neither silently changes the other.

## Catalogue implementation matrix

The table groups Features only to keep it readable; every non-planned qualified key is named.
The exact per-Feature coverage levels, evidence paths and gaps live in the typed registry above
and are checked against the seeded catalogue by `catalogue-plans.test.ts`.

| Product / Module | Available and partial Features | Domain / web owner | Primary route | Interaction / test |
|---|---|---|---|---|
| CRM / Customers & Contacts | `customer_profile`, `ownership_assignment`*, `tags_segmentation`*, `activity_timeline` | `customers`, `timeline` / `features/crm/customers` | `/customers`, `/customers/[id]` | operational / E2E |
| CRM / Sales | `pipeline`, `configurable_stages`, `qualification_state`* | `customers/stages` / `features/crm/sales` | `/customers/pipeline` | configurable / E2E |
| CRM / Data | `custom_fields`, `configurable_views`*, `file_imports`, `app_connections`, `data_mapping` | `fields`, `integrations` / shared feature packages | `/customers`, `/integrations/imports` | operational / integration |
| Communications / Voice | `inbound_calling`, `outbound_calling`, `call_controls`*, `call_history`, `number_inventory`*, `caller_id`, `recording`*, `call_dispositions` | `reception` / `features/communications/voice` | `/calls`, customer Communications tab | operational / E2E |
| Communications / Email | `sending`, `sender_identity` | `automation`, provider bindings / Automations and Connections | `/automations`, `/settings/connections` | partial operational / integration |
| Operations / Work Management | `work_items`, `work_types_statuses`, `assignment`, `checklists`, `time_cost_capture`, `work_timeline` | `work-items` / `features/work` | `/work` | operational / integration |
| Operations / Scheduling | `calendar`, `availability`, `rescheduling`, `scheduling_rules` | `scheduling` / route composition | `/schedule`, Settings | operational / integration |
| Operations / Resources | `resource_records`, `capacity_allocation`* | `resources` / route composition | `/resources` | partial operational / integration |
| Operations / Assets & Locations | `locations`, `assets`, `asset_history` | `locations`, `assets`, `timeline` / shared record features | `/locations`, `/assets` | operational / integration |
| Operations / Dispatch | `weather_aware_dispatch`* | `automation` / `features/automations` | `/automations` | configurable / integration |
| Financial Operations | `price_book`, `service_rates`, `quote_creation`, `quote_to_invoice`, `invoices`, `invoice_history`, `connected_processor`, `card_payments`, `revenue_costs`, `gross_margin`, `estimated_vs_actual`* | `pricing`, `billing` / Work and CRM projections | `/pricing`, `/work/[id]`, customer Financial tab | operational / integration |
| Automation | `rule_authoring`, `domain_event_trigger`, `counter_trigger`, `external_condition_trigger`, `conditions`, `branching`*, `email_action`, `update_customer_action`, `update_work_action`, `create_work_action`, `voice_action`*, `run_history`, `rule_review` | `automation` / `features/automations` | `/automations` | operational / integration |
| Insights | `saved_dashboards`, `saved_reports`, `financial_reports`, `utilization`, `profitability`, `ask_gold` | `reporting`, `assistant` / Reporting and Ask | `/reports`, `/ask` | operational / integration |
| Customer Experience / Website | `pages_sections`, `draft_review_publish`, `seo_metadata`* | `public-site` / `features/public-site` | `/settings/website` | configurable / integration |
| Customer Experience / Public Booking | `service_selection`, `availability_display`, `booking` | `booking`, `scheduling` / public booking route | `/book/[slug]` | operational / E2E |
| Customer Experience / Customer Portal | `portal_auth`, `portal_history` | `portal`, `billing` / `features/portal-access` | `/portal/[token]` | operational / E2E |
| Customer Experience / Forms | `booking_intake` | `booking` / public booking form | `/book/[slug]` | operational / E2E |
| Customer Experience / Brand | `brand_theme`, `domain_binding`* | `branding`, provider bindings / Branding and Connections | `/settings`, `/settings/connections` | configurable / integration |

`*` marks a partial implementation or a catalogue claim with a material UI gap. In particular,
customer ownership has no stored owner, Voice number inventory has no tenant inventory UI,
recording has no playback/configuration surface, and qualification is not an independent state.

## Prior audit snapshot (historical)

The remainder of this document is the repository-wide audit that preceded the CRM + Voice
reference implementation. It is retained for the deferred-product findings and original
evidence, but statements about customer financial visibility, route-local CRM/Voice UI, and
Voice setup have been superseded by the maintained matrix and typed registry above.

## Executive summary

GOLD's domain layer is in materially better shape, product-surface-wise, than a folder-count
comparison would suggest. Every Foundation entity (Customer, Work Item, Location, Asset,
Resource) has a working list/detail/custom-field/document surface with the sole documented
exceptions this repository already names (`ui-spec.md` §9). CRM's customer lifecycle already
models a lead as a customer state, not a second kind of person — the exact shape
`constraints.md`'s "decided, not yet built" table worried would need a painful migration if built
wrong. Public identity, branding and the website editor are already three independently
reachable settings sections, none gated on the booking module — a business can have a public
page with booking off today, contrary to this brief's leading hypothesis. Automation review is
correctly a lint/diagnostic overlay, not a rubber-stamped approval flow, and nothing about its
implementation suggests it was meant to be one.

Two kinds of problem showed up instead of the anticipated ones:

1. **A small number of screens that will not survive the tenant they were built for outgrowing
   its first month.** The automations list has no pagination and renders every rule as a full
   detail card; the sales pipeline board renders one `<li>` per customer per stage with no
   internal limit; the automation run log is capped to 25 rows with filter parameters the domain
   layer supports and no control ever sets. None of these are wrong today. All three are the
   G4 pattern this audit was asked to test for.
2. **Two structural absences that are not about screens at all.** A customer's own record page
   has no view of that customer's invoices — the money side of the relationship lives only on
   each job, one at a time. The customer portal shows a customer their own invoices and cannot
   let them pay one — `card_payments`' UI lives entirely on the operator's job screen. Both are
   Financial Operations content that Customer Experience and CRM each partially surface without
   completing the loop.

The three capabilities `CLAUDE.md` already names as having no operator path — `revokePortalInvite`,
`assignRole`, `browserTelephoneToken` — are confirmed still true and are the clearest P0/P1
findings in this audit, precisely because they were already known. Nothing else found here rises
to that severity; the rest is P2 composition debt or P3 cleanup.

## Audit method

Read `CLAUDE.md`, `docs/domain-model.md`, `docs/constraints.md`, `docs/roadmap.md`,
`docs/ui-spec.md`, `docs/walkthrough.md`, `docs/public-web-architecture.md`, `docs/vision.md`,
`docs/market.md`, and `apps/web/features/README.md` in full. Enumerated `apps/web/lib/domain/**`,
`apps/web/features/**`, `apps/web/app/**` and `apps/api/app/domains/**` by glob. Dispatched six
parallel research passes, each reading full source files (not excerpts) for one domain cluster —
Automations; CRM + Communications/Voice + Reception; Public Presence + Branding + Locale;
Scheduling + Resources + Locations + Assets + Work Items; Platform Context vs Organization
Context + Catalogue/Commercial/Providers; and a sweep of Custom Fields, Integrations, Documents,
Timeline, Reporting, Assistant, Portal, public intake (then named workflow-review) and Guided Setup — each instructed to
report only verifiable facts with file:line citations, never priorities or recommendations. This
document performs all synthesis, classification and prioritization itself against those facts,
with two claims spot-checked directly against source (the automation-condition custom-field
picker, resolved below; several file line counts). No production code changed. No new domain
requirements were invented; every gap named below traces to a concrete absence in the read code
or a named future milestone, not to a hypothesis about what a business might someday want.

## Product-surface model

Applied per the brief's six categories. Notes below name which category each domain actually
turned out to fit, where that differs from what the folder structure implies.

| Category | What it looks like | Confirmed examples in this codebase |
|---|---|---|
| Operational entity | list → detail → edit → history | Customer, Work Item (both complete); Location, Asset (missing history); Resource (missing edit and history) |
| Operational workflow | workspace, board, calendar, queue | Today, Work board, Schedule (day view, not a calendar grid), Sales Pipeline |
| Configuration / policy | Settings section, vocabulary editor | Custom fields, statuses/transitions, currency/timezone, call outcomes, stages |
| Template / blueprint | library → editor → instantiate → usage | Message templates (partial — no usage-history, no separate library view); Checklist templates (copied at creation, correctly headless after that) |
| Public projection | editor → preview → publish → public route | Website (complete); Public profile (complete, simpler — no preview/publish cycle, edits live immediately) |
| System primitive | no direct UI by design | `app.current_tenant_ids()`, RLS policies, `events` table itself, the automation execution runtime, provider secret storage (Vault) |

## Scope model

| Scope | Confirmed contents | Notes |
|---|---|---|
| Platform Context | Overview; Organizations (tenant list, provisioning, support sessions, per-tenant commercial/providers/usage detail); Catalog (canonical Product→Module→Feature, legacy `platform_products` SKUs, Plans & Add-ons, runtime-module cross-reference, meters); Pricing (GOLD's own recurring/retail/provider rate cards); Providers (global vendor vocabulary, binding counts, no credentials); Failures | Clean separation confirmed; canonical and legacy catalogues coexist deliberately, cross-linked, never merged (D50) |
| Organization Context | Today, Work, Schedule, Resources, Ask, Reports, Customers, Calls, Locations, Assets, Pricing (tenant's own Price Book — Financial Operations, not GOLD's catalogue), Automations, Custom fields, People and roles, Guided setup, Integrations, Settings (public page, brand, website, this business, connections, plan & usage) | `settings/plan` reads only tenant-safe usage functions (`listUsageEvents`, never `organizationCommercialSummary`/`organizationUsageDetail`) — I29/I31 confirmed held in the UI code, not only in the database grant |
| Customer Portal | `/portal/[token]` — own work items, own invoices, own public-header identity | Read-only; no messaging, no work request, no online payment |
| Public / Anonymous | `/book/[slug]`, `/(marketing)/` (including `/demo` and `/contact`), `/(auth)/` | public intake (`submit_public_inquiry`; audited as `workflow-review`) confirmed as pure lead capture (D22); no account, membership or organization is created by it |
| Shared presentation | `settings/connections` (organization-facing, read-mostly view of D44 provider-binding state) | See *Cross-domain inconsistencies* — this is a deliberate, correctly-scoped crossover, not a leak |

One flagged crossover, resolved as healthy rather than a mistake: `organizations/[organizationId]/settings/connections/page.tsx`
reads the same `lib/domain/providers/bindings.ts` functions the staff-only
`/platform/organizations/[organizationId]/providers` screen uses, to show a tenant its own Twilio
binding status, phone numbers and Resend domain. The page's own comment names exactly what it
withholds — parent account, secret, vault reference, wholesale rate, provider cost — and the one
tenant-initiated write (`recordOrganizationEmailDomain`) is narrow and capability-gated. This is
the provider-control-plane pattern working as D44 intended: platform provisions, tenant reads its
own resulting state through the same reader, nothing duplicated.

## Domain → product surface matrix

Grouped where two folders serve one recognizable capability, per the brief's own example.
Coverage/Architecture/Priority reasoning is expanded in the sections that follow; this table is
the index into them.

| Domain | User intent | Feature owner | Route/surface | Configure | Operate | Observe | Coverage | Architecture | Priority |
|---|---|---|---|---|---|---|---|---|---|
| Tenancy / Identity / Roles | Run the business as a team with the right people holding the right authority | — (route-owned) | `/roles`, `/organizations/accept-invite/[token]` | `/roles` | invite, accept | pending invitations list | Partial — role reassignment and invite revocation both absent | Route-owned, healthy where it exists | **P0** |
| Work Items | Do a job start to finish | `features/work/**` | `/work`, `/work/[id]` | statuses/transitions on Work | edit, transition, checklist, consumption, pricing, invoicing, documents, timeline | job's own History section | Complete | **Healthy feature boundary** | P3 (maintain) |
| Scheduling | See what's free and what's booked today | none (route-owned, 164 lines, single caller) | `/schedule` | Settings → hours/buffer | day-view read; rescheduling happens from Work | none beyond the day view itself | Complete for current shape | Route-owned, justified by single-caller rule — not extraction debt yet | P3 (watch) |
| Resources | Track a bookable thing (van, bay, person) | none (route-adjacent files) | `/resources`, `/resources/[id]` | inline create | assign via Work/Schedule | work list on the resource | Partial — no edit form exists at all | Route-owned | **P2** |
| Locations | Track a serviced site | none (route-adjacent files) | `/locations`, `/locations/[id]` | inline create, coordinates | link customers, record coordinates | documents; **no timeline** | Partial | Route-owned | **P1** |
| Assets | Track equipment, its readings, its work | none (route-adjacent files) | `/assets`, `/assets/[id]` | inline create | record readings | documents; **no timeline** | Partial | Route-owned | **P1** |
| Customers (CRM core) | Know a customer and their relationship to the business | `features/crm/customers/**` | `/customers`, `/customers/[id]` | stage vocabulary | edit, stage, call, portal-link, custom fields | documents, calls, timeline; **no invoices** | Partial | Healthy feature boundary, with a real content gap | **P1** |
| Sales pipeline | See where every relationship stands | `features/crm/sales/**` | `/customers/pipeline` | stage settings | drag-free stage change per card | board itself | Complete at small scale | Healthy boundary; **scalability debt** (unbounded per-column render) | **P2** |
| Reception & Voice (Calls) | Never lose track of a call | `features/communications/voice/**` | `/calls` | outcome vocabulary, outbound identity (in-page "Set up") | place/receive, wrap up | call history (metadata only) | Partial by design — recording/transcript/analysis is M9, not this slice's scope | Healthy boundary; reference for the D51 Python-command pattern | P2 (tracked in M9/M14, not new) |
| Automations (rules, templates, deliveries, runs) | Make the business run itself | `features/automations/**` | `/automations` | same page | write rules, write templates | run log (capped, unfiltered in UI), delivery log | Complete at small scale | Healthy boundary; **composition/scale debt** | **P2** |
| Weather / Maintenance | Let physical-world conditions or meters trigger work | none — expressed entirely as Automation rules | `/automations` (via `requires: 'automations'`) | same page | same page | same page | Complete, by design (no second entity) | Correctly headless as a distinct screen; identity only visible in module description text | P3 |
| Reporting & Dashboards | See what happened without a spreadsheet | `features/reporting/**` | `/reports` | report/dashboard definitions | run/save/pin | tables, dashboards | Complete, deliberately narrow (3 measures, typed filters) | Healthy — narrowness is I4/I5 discipline, not a gap | P3 |
| Assistant / Ask | Ask the business a question in plain words | none (route-owned) | `/ask` | Settings → Ask | ask | full question history with row counts | Complete | Healthy | P3 |
| Guided setup (configuration proposals) | Stand up the business by describing it | none (route-owned) | `/setup` | Settings → Guided setup | describe, review, edit, apply | proposal history | Complete | Healthy | P3 |
| Custom fields | Track what the platform didn't think of | `features/custom-fields/**` | `/fields` | create/edit/order/required/choices | values render on all 5 supported entities | — | Complete for definition + display; **no filter/search anywhere** | Healthy boundary; deferral is explicit in code comments | P3 |
| Documents | Keep a file with the record it belongs to | `features/documents/**` | embedded on Customer/Location/Asset/Work Item | — | upload/list | — | Complete for its 4 entities; Resource is correctly excluded (no domain relation) | Healthy | P3 |
| Timeline | Reconstruct what happened | `features/timeline/**` | embedded on Customer/Work Item only | — | — | activity list | **Missing on Location and Asset** | Component exists, is not wired to two entities | **P1** |
| Integrations (CSV import) | Bring existing data in without typing it twice | none (route-owned) | `/integrations/**` | mapping | connect, map, stage, review, apply | run history, connection detail | Complete, full lifecycle | Healthy | P3 |
| Public Presence (Profile) | Say who the business is, publicly | `features/public-profile/**` | Settings → Public page | same | — | live preview link once a bookable type exists | Complete, independent of the booking module | Healthy — **hypothesis rejected** | P3 |
| Branding | Look like the business, not the platform | `features/branding/**` | Settings → How this business looks | same | — | — | Complete, 3-role constraint respected | Healthy | P3 |
| Website | Publish an approved public page | `features/public-site/**` | Settings → Website | same | edit, draft, preview, publish | revision history (implicit via draft/published state) | Complete for the typed section vocabulary that exists | Healthy | P3 |
| Locale | Trade in a currency, operate in a timezone | `features/locale/**` | Settings → This business | same | — | — | Complete for what it claims (tz + currency); **not general regional i18n**, and correctly does not claim to be | Healthy — narrow and honestly named | P3 |
| Booking (public) | Let a stranger take a slot | route-owned (`app/(public)/book/[slug]/**`) | `/book/[slug]` | Settings → Public page → publish booking module | take a slot | confirmation page | Complete | Healthy | P3 |
| Customer Portal | Let one customer see their own things | route-owned (`app/(public)/portal/[token]/**`) | `/portal/[token]` | Customer record → send link | view work, view invoices | — | Partial — **no online payment, no messaging** | Route-owned, correctly minimal for what's built, but the Product it's supposed to complete (paying) isn't reachable from it | **P1** |
| Public intake | Capture a demo request or contact inquiry on GOLD's own site | route-owned | `/(marketing)/demo`, `/(marketing)/contact` | — | submit | — | Complete, correctly narrow (D22) | Healthy | P3 |
| Platform Catalogue / Plans / Entitlements | Let GOLD staff define and sell what GOLD sells | `features/platform/catalog/**` | `/platform/catalog/**` | same | assign to organizations | organization commercial/usage detail | Complete for resolution; enforcement is the separately-tracked I28 gap (not a UI gap) | Healthy | P3 |
| Provider control plane (Twilio/Resend, D44) | Give an organization a working phone number / sending domain | `features/platform/organizations/**` (staff), `settings/connections` (tenant read) | `/platform/organizations/[id]/providers`, `/settings/connections` | staff provisions; tenant reads | staff: provision/status; tenant: record own domain | tenant reads binding/resource status | Complete for what's built (Twilio, partial Resend) | Healthy, deliberate two-surface split | P3 |
| Platform administration (tenants, support, failures) | Run GOLD without a database console | `features/platform/**` | `/platform/**` | — | provision, support session, inspect | failures feed | Complete | Healthy reference for Platform Context IA | P3 |

## P0 gaps

**`assignRole` has no operator path.** A role is assigned once, at invitation or add-by-email
time, and never changed afterward (`walkthrough.md`, confirmed unchanged in this audit — no
role-edit form exists on `/roles`). Every real business will eventually promote, demote or
correct a mis-assigned role. Today the only route is to remove the membership and re-invite,
which is destructive (loses the original invitation/join event) where the actual need is
corrective. This is `CLAUDE.md`'s own named gap, confirmed still true, and it meets the P0
bar directly: a routine operation is not reachable from any screen at all, with no workaround
that isn't destructive.

**`revokePortalInvite` has no operator path.** A customer portal link, once sent, cannot be
withdrawn by the business — confirmed via the portal domain layer and the customer detail page's
Portal section (which only offers *send*, never *revoke*). Unlike `assignRole`, this is not just
inconvenient — it is a live access-control capability with a database function and no UI to
invoke it, meaning the business has no way to end a customer's read access to their own work and
invoices short of a support request to GOLD staff. P0 for the same reason: reachable nowhere.

## P1 gaps

**A customer's own record shows no invoices.** `customers/[customerId]/page.tsx` composes
contact/stage, custom fields, an edit form, Calls (module-gated), Documents, Portal (module-gated)
and History — and nothing else. Invoices exist only per-work-item, on each job's own page
(`WorkInvoiceSection`). A business with `billing` enabled has no single place to see what one
customer has been billed, paid or still owes without opening every job that customer has ever
had. Reporting's `invoiced_and_incurred` can group by customer, but that is a business-wide report
table, not the record a rep pulls up mid-call — a different interaction model for a different
moment, per this audit's own operational-entity vs workflow distinction. This is a real gap in
CRM's own coherence, not a hypothetical: CRM's stated job is "know customers... and sales context"
(`domain-model.md`), and the money side of that relationship is invisible from the one screen
built to show it.

**The customer portal cannot collect payment, and the invoice a customer sees there is a dead
end.** `portal/[token]/page.tsx` renders the customer's invoices (number, date, total,
paid/outstanding) with no action attached — no "pay now," no card control. `RequestCardPaymentForm`
exists only on the operator's own Work Item page. `card_payments`' whole purpose (`MODULES`
description: "Ask a processor to collect what is outstanding, rather than only cash") and the
portal's whole purpose (`MODULES` description: "sees their own work and invoices") each half-exist
without meeting in the middle. A customer who wants to pay online, having been sent a portal
link specifically so they can see what they owe, cannot act on what they see there. This is a
Financial Operations × Customer Experience seam, not a bug in either Product read in isolation —
exactly the kind of cross-domain incoherence this audit was asked to surface.

**Location and Asset have no timeline, though the component and the underlying events already
exist.** `features/timeline/activity-list.tsx` is imported on exactly two pages — Customer and
Work Item. `ui-spec.md` §9 already names this ("Asset and Location timelines are not yet
surfaced"), confirmed still true. What makes this P1 rather than P3 cleanup: the component is
already built, `events` already carries `location.linked` and comparable facts (I11 names the
`location.linked` polymorphic-subject hazard was specifically fixed so a location's own timeline
could eventually read it), and both entities are Foundation entities with real operational
weight — a location a business services repeatedly, and an asset with meter readings and repeat
work, both accumulate a history nobody can currently see assembled in one place. This is cheap
relative to its value: wiring, not invention.

**`browserTelephoneToken` mints a token nothing consumes.** Confirmed: the function exists, no
browser softphone exists to call it. Unlike the two P0 items, this is correctly sequenced — M9
("record → understand → assist → automate → delegate") and M14 (provider control plane through
Voice) both explicitly own the front-desk build-out this token is part of, and Voice is
consistently and correctly described everywhere in this repo's docs as provider/callback
foundation rather than a finished product. Listed here as P1 rather than P0 because it is not an
orphaned operational need the way the other two are — it is a named, roadmapped, sequenced piece
of a Product not yet built, not a Product that exists everywhere except its own control surface.

## P2 gaps

**Automations will not survive a business with more than a handful of rules or a live history.**
`/automations` fetches every rule for the organization with no `limit`/`offset` in
`listAutomationRules`, and renders one full detail card per rule (conditions, actions, warnings,
last-5-runs) in a single unbroken scroll — verified: no pagination, search or filter control
exists anywhere on the page. The run log is capped to 25 rows total across the whole
organization (`listAutomationRuns(db, { organizationId, limit: 25 })`), even though the domain
function already supports `ruleId` and `failedOnly` filters — nothing in the UI ever sets them.
Message templates share the same page with no separate library view and no way to see which
rules reference a given template (a delete attempt surfaces only a raw foreign-key-violation
message, unnamed). None of this is broken at 3 rules. All of it degrades badly at 30 rules and
becomes unusable as a history at 300 runs — precisely the scale question this audit was asked to
test, and the answer is: not yet, but the domain layer (limit/offset support already present on
runs and deliveries) is most of the way there. **Recommended presentation:** an operational
workflow shape — a filterable, paginated queue for rules and for runs, not a flat unpaginated
list — per this document's own category model, not a new mechanism.

**The sales pipeline board has no ceiling on column size.** `pipeline-board.tsx` groups every
customer returned by `listCustomers` (bounded only by the domain layer's own generic `LIST_LIMIT`
page cap, not a board-specific limit) into stage columns, each rendered as one `<li>` per
customer with no internal pagination or per-column search. A business with a genuinely large
customer base sees a Won or Contacted column that scrolls indefinitely, with no way to search
within a stage. Not broken today; a real problem once a tenant's customer count outgrows
`LIST_LIMIT` handled gracefully as one flat page.

**Resource has no edit form.** Confirmed directly in the route's own comment: "No edit form:
nothing in the domain layer corrects a resource past its name today." A van renamed, or a bay
reclassified, cannot be corrected without deleting and recreating it (with whatever that does to
its scheduling history). Lower stakes than the P1 items because a resource's name rarely needs
correction post-creation, but it is a genuine missing "configure" lifecycle stage on a Foundation
entity most businesses touch daily.

## P3 debt

- **Schedule, Resources, Locations and Assets remain route-owned with no `features/` directory.**
  Confirmed each is single-caller today, which is exactly this repository's own stated bar for
  *not* extracting yet (`constraints.md`: "a rule gets extracted at its second caller"). Not
  extraction debt by the letter of that rule. Worth naming as a watch item because four different
  entities (Customer excepted, which is already extracted) independently reimplement the same
  operational-entity shape — header, custom fields, documents, a related-work list — in four
  separate route trees. If a fifth entity of this shape arrives, or if any of the four grows a
  second caller (an AI tool reading a resource, say), that is the trigger this repo's own rule
  already names, not a new one.
- **Weather and Maintenance are invisible as concepts on the one screen that expresses them.**
  A rule created under either module looks identical to any other automation rule on `/automations`
  — nothing labels it "your weather rule." Correctly headless per D11/D25 (neither owns an entity
  or a screen), but a business with several rules of mixed origin has no way to filter "show me
  the weather-related ones" without reading each rule's own condition. Minor, and arguably
  answered by the P2 automations-filtering fix above rather than needing its own.
- **Today's dashboard links only to Work, Schedule, Calls and Automations — never to Resources,
  Locations or Assets.** Consistent with Today's stated purpose (the operational loop, not a
  sitemap), so not a defect, but worth naming since those three are Records-group entities a
  business also touches often.
- **No filter or search on custom-field values, on any entity list.** Confirmed absent
  everywhere, and the code says so itself (`customer-table.tsx`'s own comment defers this to "a
  future search or filter toolbar"). No evidence anywhere in this audit that this is currently
  blocking real use — genuinely deferred, not silently missing.
- **"Locale" means exactly timezone and currency, and is honestly named that way.** `locale-fields.tsx`
  exports exactly `TimeZoneField` and `CurrencyField`; nothing in `features/locale/` or
  `lib/domain` models language, BCP-47 tags, date-format preference, week start or address
  convention. This is the semantic gap the brief hypothesized — confirmed real — but it is not a
  hidden one: `features/README.md` already describes the module as "Timezone and currency
  controls," and `public-web-architecture.md` already scopes real localization (French routing)
  to M16, contingent on a first complete French page set existing. No documentation correction is
  needed here; the gap is real but already correctly disclosed and appropriately deferred.

## Healthy/reference implementations

- **Work Items** (`features/work/**`) is the cleanest example of route-as-loader,
  feature-as-presentation in the repository — `work/page.tsx` and `work/[workItemId]/page.tsx`
  each carry an explicit comment naming this division of labor, and ten section components under
  `work-item-sections.tsx` compose everything a job needs: edit, transitions, checklist,
  consumption, pricing, invoicing, documents and timeline.
- **CRM + Communications/Voice's Python-command pattern (D51)** is a genuine reference
  implementation, not merely a well-intentioned comment. `stage-control.tsx` and
  `wrap-up-form.tsx` were traced end to end — feature component → route server action →
  `apps/web/lib/api/` caller forwarding the user's own token → a FastAPI physical handler →
  `apps/api/app/domains/{crm,communications/voice}/*.py` → one narrow, security-invoker Postgres
  RPC. Every hop is exactly what D51 describes, and `apps/api/app/domains/__init__.py`'s own
  docstring explains why only these two commands exist there: each is genuinely reachable from
  more than one caller today (a board an AI tool could also move a card on; a wrap-up an AI
  call-summary tool could also file), not because CRM and Voice are special as Products.
- **Customer lifecycle modeling.** `Customer.stageId` is a nullable foreign key on the one
  `Customer` entity, resolved against tenant-owned `customer_stages` — exactly the "a lead is a
  state of a customer, not a second kind of person" shape `constraints.md` worried about getting
  wrong. It is already built right.
- **Public Presence (Profile + Branding + Website).** Genuinely independent settings sections,
  none gated on the booking module, confirmed by reading the gating logic directly rather than
  inferring it: `settings/page.tsx`'s Public Page and Brand sections gate only on
  `organization.manage`; `settings/website/page.tsx` gates identically. `/book/[slug]` and
  `/portal/[token]` both render the same `PublicHeader` with the tenant's own copy — one shared
  identity concept correctly reused, not duplicated, across every public surface.
- **Reporting's narrowness is discipline, not a gap.** Three measures, typed filters, no
  free-text query builder, no per-page audience list (the audience is a policy on the report,
  read through in a subquery by the dashboard). This is I4/I5's "no second calculation" reasoning
  applied one level up, working as designed.
- **Integrations (CSV import)** has a complete lifecycle with a real screen at every stage —
  connect, map (with custom fields available in the mapping target list), stage, review, apply,
  and a run-history list distinct from the connection detail view.
- **Platform vs Organization scope** is clean. The canonical and legacy catalogues coexist
  without merging; GOLD's own cost and margin are withheld from every tenant-facing function at
  the UI layer as well as the grant layer; the tenant's own Financial Operations Price Book
  (`lib/domain/pricing/price-book.ts`) and GOLD's commercial catalogue
  (`lib/domain/commercial/catalogue.ts`) are never imported from the same screen.

## Intentionally headless concepts

Confirmed correctly absent, per this audit's own "system primitive" category:

- Tenant identity resolution, RLS policies, `app.current_tenant_ids()` — no UI, none warranted.
- The automation execution runtime itself (trigger→condition→action dispatch) — its *outcome* is
  visible in the run log; the runtime is not something a person operates.
- Checklist templates, once copied onto a work item — the copy is intentionally headless from its
  source (I8); only the source template itself is edited.
- Vault-stored provider secrets (D44) — confirmed no function anywhere selects one back out, and
  no UI attempts to.
- Weather and Maintenance as distinct entities — correctly expressed only as automation rules,
  per D11/D25, with no separate screen, table or engine.
- Public intake (audited as `workflow-review`, now `submit_public_inquiry`) — correctly a narrow, unauthenticated lead-capture write with no read-back
  path for its own caller, matching D22 exactly.

## Cross-domain inconsistencies

- **Financial Operations content is split across CRM and Customer Experience with neither side
  completing it.** See the two P1 findings above (customer record has no invoices; portal has no
  payment action). Both stem from the same root: `card_payments`/`billing` render only on the
  Work Item page, and nowhere else that a customer's overall financial standing would naturally
  belong.
- **The provider control plane (D44) crosses Platform and Organization scope on purpose, and does
  so carefully.** `settings/connections` is the one organization-facing screen that reads
  platform-provisioned state; it was checked line by line for leakage (secret, vault reference,
  wholesale rate, provider cost) and found to withhold all of it correctly. This is not an
  inconsistency needing correction — it is recorded here because the audit brief specifically
  asked whether platform/tenant responsibilities leak into each other, and this is the one place
  they deliberately, correctly touch.
- **No inconsistency found between `market.md`'s commercial model and the built catalogue** —
  GOLD's own Plans/Add-ons/Entitlements (Platform Context) and a tenant's own Price Book
  (Organization Context, Financial Operations) are backed by disjoint domain files with no shared
  import, exactly as `domain-model.md`'s "two planes" table requires.

## Navigation and discoverability findings

- **`assignRole` and `revokePortalInvite`'s absence is a discoverability dead end, not merely a
  missing form** — there is no place in the IA where a user would even learn these are
  unsupported; the People/Roles and Customer/Portal sections simply stop at "invite" and "send"
  with no visible next step, which is the honest state per `ui-spec.md` §8's own rule (no advice
  where the platform has no standing to give it), but it means the gap is invisible until someone
  needs the missing action.
- **Weather/Maintenance module identity is discoverable only by reading `MODULES` description
  text in Settings**, not from the Automations screen where the rules those modules produce
  actually live. Low severity, noted above under P3.
- **The legacy `platform_products` SKU list and the runtime-module cross-reference view are both
  intentionally one click deeper than the platform's own top-level nav** (`/platform/catalog`
  links out to them; `platform-navigation.tsx`'s own top-level entries point at the canonical
  catalogue). This is D50's coexistence model working as intended, not a navigation defect.
- **Today's dashboard is a faithful front door to the operational loop** (Work, Schedule, Calls,
  Automations failures) and correctly does not attempt to be a sitemap for Records-group entities,
  consistent with `ui-spec.md` §2b's stated purpose for the widget grid.

## Recommended UI patterns

- **For Automations (P2):** an operational-workflow pattern — a filterable, paginated rule queue
  (status: healthy / has warnings / disabled) with the existing per-rule warning list preserved
  exactly as-is (it is correctly a diagnostic overlay, not a workflow of its own), plus a run log
  that actually exposes the `ruleId`/`failedOnly` filters the domain layer already computes.
  Template management earns its own section or tab once past a handful of templates, with a
  named-caller list surfaced on delete rather than a raw constraint-violation message.
- **For the sales pipeline (P2):** either a per-column fetch-more affordance or a per-column
  search box; the underlying `listCustomers` call already accepts a `stageId`-scoped path in
  principle (grouping is currently done in TypeScript after one broad fetch) — the fix is
  narrowing the query per column, not inventing new domain capability.
- **For Location/Asset timelines (P1):** reuse `ActivityList` unchanged; the gap is a missing
  domain read (a `listLocationTimeline`/`listAssetTimeline` alongside the existing
  `listCustomerTimeline`/`listWorkItemTimeline`) and one import each on two existing pages, not a
  new component.
- **For customer-record financial visibility and portal payment (P1):** both are "operational
  entity, extended" rather than a new surface category — a read-only invoices section on the
  customer record (a projection of existing `invoices` rows, no new calculation, no I4 risk), and
  reusing the existing card-payment capability from the customer's own portal context rather than
  only the operator's Work Item page.
- **For `assignRole`/`revokePortalInvite` (P0):** both are configuration/policy surfaces already
  half-built — a select control next to an existing member row, and a revoke button next to an
  existing sent-invite line. Neither needs new domain design; both functions already exist and
  are tested.

## Recommended implementation sequence

Ordered by the P0/P1 findings above, each scoped small enough to be one vertical slice per this
repository's own convention (schema where needed, domain, route, UI, guard, test — never one
slice per layer).

### Slice 1 — Close the two P0 operator-path gaps

**Goal.** Add UI for `assignRole` (change an existing member's role) and `revokePortalInvite`
(withdraw a sent portal link), both already implemented and tested in the domain layer.
**Why now.** These are the only two findings in this audit that meet the strict P0 bar — a
capability genuinely unreachable from any screen, with a workaround that is either destructive
(remove-and-reinvite) or nonexistent (no way to end portal access at all).
**Likely files/domains involved.** `apps/web/lib/domain/tenancy/roles.ts` (`assignRole` already
exists per `walkthrough.md`); `apps/web/app/organizations/[organizationId]/roles/page.tsx` and a
new small form beside the existing member row; `apps/web/lib/domain/portal/portal.ts`
(`revokePortalInvite`); the customer detail page's existing Portal section
(`customers/[customerId]/page.tsx`).
**Explicit non-goals.** No change to the invitation flow itself, no new capability, no change to
`FOUNDING_ROLE` or role vocabulary.
**Acceptance criteria.** A non-founder with `role.manage` can change another member's role from
`/roles` and see the change reflected immediately; a customer's Portal section gains a revoke
control that, once used, makes the existing token unusable — both proven by policy tests in the
same shape `invitations.test.ts` already uses.
**Dependencies.** None — both underlying functions are already built and covered by tests per
`walkthrough.md`'s own table.

### Slice 2 — Wire Location and Asset timelines

**Goal.** Surface `ActivityList` on `[locationId]/page.tsx` and `[assetId]/page.tsx`, backed by a
new timeline reader for each entity alongside the existing customer/work-item ones.
**Why now.** Cheapest P1 finding relative to its value — component and underlying events already
exist; this is wiring, not invention, and it closes a gap this repository's own `ui-spec.md`
already names as open.
**Likely files/domains involved.** `apps/web/lib/domain/timeline/timeline.ts` (add
`listLocationTimeline`/`listAssetTimeline` alongside the existing customer/work-item readers);
the two detail routes; `features/timeline/activity-list.tsx` (no change expected — reused as-is).
**Explicit non-goals.** No new event types, no change to `events`' own schema, no timeline on
Resource (which correctly has no document relation either — out of scope until that changes).
**Acceptance criteria.** Opening a Location or Asset record shows its own history in the same
shape Customer and Work Item already do; a correspondence test (matching this repo's own I11
pattern) confirms no event that should attribute to a location/asset is silently dropped.
**Dependencies.** None.

### Slice 3 — Customer financial visibility and portal payment

**Goal.** A read-only invoices section on the customer record; a payment action reachable from
the customer's own portal view.
**Why now.** The clearest cross-domain incoherence found — Financial Operations content that two
different Products (CRM, Customer Experience) each partially expose without the loop closing
anywhere.
**Likely files/domains involved.** `apps/web/lib/domain/billing/invoices.ts` (a
customer-scoped list read, likely already close to what `jobEconomics`/reporting already query);
`customers/[customerId]/page.tsx`; `app/(public)/portal/[token]/page.tsx`; the existing
`RequestCardPaymentForm`/Stripe adapter, reused rather than reimplemented.
**Explicit non-goals.** No new pricing or invoicing calculation (I4 stays untouched — this is
presentation over existing rows); no change to how an operator issues an invoice.
**Acceptance criteria.** A customer record shows every invoice across all of that customer's work
items with standing (paid/outstanding); a portal visitor with an outstanding invoice and
`card_payments` enabled can pay it from `/portal/[token]` without operator involvement.
**Dependencies.** `card_payments` must remain scoped exactly as D26/D27 require — GOLD never
touches the money; this slice only relocates where the existing Stripe-backed control is
reachable from, it does not change who processes the charge.

### Slice 4 — Automations composition and scale

**Goal.** Paginate/filter the rule list and the run log; wire the `ruleId`/`failedOnly` filters
the domain layer already supports into visible controls; give templates their own section with a
named-caller list on delete-attempt.
**Why now.** The clearest P2 — works today, degrades badly at realistic scale, and the domain
layer is most of the way there already (limit/offset exist on runs and deliveries; only the rule
list itself needs a limit added).
**Likely files/domains involved.** `apps/web/lib/domain/automation/rules.ts`
(`listAutomationRules` needs a `limit`/`offset`, matching the shape `listAutomationRuns` already
has); `apps/web/app/organizations/[organizationId]/automations/page.tsx`;
`features/automations/activity/run-log.tsx` (add filter controls); `features/automations/templates/template-section.tsx`
(surface which rule references a template on a failed delete, from the existing `23503` error).
**Explicit non-goals.** No change to `reviewAutomationRules`' diagnostic framing — confirmed
correct as-is, not a target of this slice. No new trigger/action/condition kinds.
**Acceptance criteria.** A test business seeded with 30+ rules and 300+ runs renders the
automations page without a single unbounded query, and a user can filter the run log by rule and
by outcome from a visible control, not only through the domain layer's own parameters.
**Dependencies.** None.

### Slice 5 — Sales pipeline scale

**Goal.** Bound each pipeline column independently rather than relying on the generic
`LIST_LIMIT` applied to one flat customer fetch.
**Why now.** Same G4 shape as Slice 4, lower urgency (CRM/Sales is newer and likely has fewer
tenants at scale today than Automations).
**Likely files/domains involved.** `apps/web/lib/domain/customers/customers.ts` (`listCustomers`
gains a `stageId` filter usable per-column, or a dedicated grouped-count read);
`features/crm/sales/pipeline-board.tsx`.
**Explicit non-goals.** No change to stage vocabulary or the stage-change RPC path (D51's
reference implementation stays untouched).
**Acceptance criteria.** A pipeline board with several hundred customers in one stage does not
render every one of them in an unbounded list; each column supports at least a "load more" or
equivalent affordance.
**Dependencies.** None.

**The single next slice recommended first: Slice 1.** It is the only P0-graded work in this
audit, it requires no new domain design (both functions exist and are tested), it closes a named,
multi-milestone-old debt this repository's own `CLAUDE.md` already flags as something to "keep
explicit," and — unlike every other recommendation here — its absence is not a scaling concern or
a coherence gap but a hole a real business will hit in its first month of ordinary use (someone
mis-assigned a role; someone needs to revoke a link sent to the wrong address).

# Changelog

This file records **meaningful shipped changes by actual date**.

It is not:

- the roadmap;
- an implementation diary;
- a list of every commit;
- an architectural decision archive.

Use:

```text
docs/roadmap.md
→ what comes next

docs/decisions/
→ why durable architecture changed

Git
→ exact file/commit history
```

Dates use ISO format:

```text
YYYY-MM-DD
```

Entries describe the product or operational change, not every file touched.

---

## [Unreleased]

### Tenant AI agent operations ? 2026-10-08

- Replace the tenant AI starting page with agent collections, a draft/version workbench, deployment configuration, published website knowledge, governed tools, personal evaluations and real activity/allowance reporting.
- Connect published Operator Copilot configuration to the existing global Agent rail and shared runtime. Add contextual supervised drafting in Communications and summaries in Support.
- Add website conversation continuity and a Communications claim/reply/resolve workflow; restrict generated reply writes to the machine role and stop automated replies on handoff.
- Keep unsupported SMS/email/Support autonomous runtimes, Voice and Customer Portal explicitly unavailable; configuration never implies a verified channel integration.


### 2026-10-08

- Implemented the Support operating workspace: persistent Cases, queue ownership, priority, escalation, internal notes, resolution and explicit reopening, elapsed service levels, exact reports and private attributed history. Added shared contextual Case creation from CRM, Inbox, Calls and Work, six scoped capabilities, tenant-bound relationships and responsive Home/list/board/workbench/detail/configuration/report surfaces.

### Marketing operating workspace — 2026-10-08

- Added tenant-scoped campaigns, saved dynamic audiences, attributed acquisition inquiries and explicit canonical CRM handoff, with narrow Marketing capabilities and RLS.
- Replaced the Marketing placeholder with operational Home, Campaigns, Campaign detail, Audiences, Leads review and Performance routes.
- Connected tracked published Studio Form links to transactional, idempotent inquiry capture; retained revision/source history and existing untracked submissions.
- Added database journey and negative authorization coverage. Promotional broadcast delivery remains unavailable.

### Studio and shared page drawers — 2026-10-08

- Replace the sparse Studio Home with a contained website preview, factual website/form/response summaries, content and submission previews, publishing attention, creation shortcuts and public-surface configuration links. Preserve flat workspace navigation and canonical ownership.
- Unify contextual drawers around shared padded bodies, fixed headers/footers, body-only scrolling, Escape dismissal and focus return; remove repeated outer gutters from existing feature drawers. Add an isolated responsive website-template preview with mobile/tablet/desktop controls.
- Share responsive Website/Form editor panes, preserve compact editing state, add form-question duplication, local validation/confirmation testing and unsaved-change warnings. Forms exposes URL-backed search, publication filters, sorting and pagination; submission links retain the selected response.
- Add bounded response pages and read-only inspection of saved Form revisions with the existing manager authorization. Apply `20261203000001_studio_submission_pages.sql` and `20261203000002_studio_form_revision_inspection.sql` before deploying; database types are regenerated. Gate distribution links on publication, confirm archiving, and move legacy Catalogue/Plan drawer actions into fixed shell footers. Existing publishing/revision operations remain authoritative. No hosted data changes.

### Automations operating workspace — 2026-10-08

- Replace the minimal Home, Rules and Activity presentation with a contained operational dashboard, filtered collections, execution/delivery inspectors, and a linear visual Rule Builder. Retain legacy links, flat navigation and canonical execution authority.
- Add atomic condition/action editing, disabled-by-default UI authoring with deliberate activation, canonical readiness warnings, and message-template placeholder insertion with a sample-only preview.
- Add exact RLS-scoped execution aggregates and Organization-timezone trends through a forward-only migration. Preserve historical runs and snapshotted message content; per-action history and live provider verification remain outside the recorded telemetry.

### Work operating workspace ? 2026-10-08

- Replace the sparse Work Home with a contained operational dashboard using exact backlog counts, canonical daily commitments and resource availability, bounded previews and linked activity. Keep honest empty panels and opening-hours setup states.
- Add Dispatch with URL-backed queue filters, resource assignments/free windows, a contextual scheduling/feasibility inspector and actual Location map selection. Reuse the existing authorized mutation paths and refresh every affected operating surface.
- Add compact Work List/Board views with independent status reads and exact per-stage counts; reorganize Work configuration as a type workbench and expose Resource class/capability and day-availability filters. Preserve configured transitions, tenant boundaries and overlap prevention without a schema migration.

### Communications operating workspace — 2026-10-08

- Replace the sparse Communications Home with a dense operational dashboard: readiness strip, missed calls/unread/unassigned/wrap-up attention, bounded Inbox queue and canonical call history, Today/status/activity/insights rail. Search, date and queue filters operate on tenant-scoped records; counts are exact rather than preview lengths.
- Keep Calls, Inbox split view, Numbers and configuration as canonical destinations; remove the old CRM summary from Calls and expose handler/source columns. Reuse dialer, conversation assignment/read actions and call wrap-up; unavailable senders and calling connections cannot appear ready to send.
- Expand Communications configuration into visible sections. Restore saved ordered primary/fallback routing targets before allowing edits to save, retain route-to-route destinations, and expose routing preview with failure handling. No new persistence model or migration.

### Finance operating workspace — 2026-10-08

- Replace the sparse Finance Home with a contained financial dashboard: period-scoped recorded payments, current receivables and uninvoiced quotes, attention categories, due invoices, activity, aging and financial performance. Currency totals remain separate; unsupported reminders and processor outcomes are never implied.
- Add contextual Work pricing, invoice review/issue and payment-recording drawers, searchable paginated collections, a financial report destination and compact Services & Pricing management. Finance links open canonical Work financials directly.
- Add tenant-policy-preserving database read projections and permission-checked complete summaries. Invoice snapshots, one invoice per Work item and append-only payment corrections remain unchanged. A forward migration is required before deploying the new surfaces.

### Communications dialer pop-out — 2026-10-08

- Add a compact dialer window, informed by Next-Fund's keypad and calling presentation, from New call and the active call dock. It shares the existing telephone and call actions, preserves the number draft on return, and keeps live calls under control while moving between workspaces.
- Handle blocked pop-ups and window closure without hanging up; prevent the New call form from starting another call while one is active.

### Shared calendar foundation — 2026-10-07

- CRM Follow-ups and Work Schedule now share calendar navigation, date picker, workspace frame, week/day agenda and month grid. Domain filters, records and event actions remain contextual additions.

### Operational CRM — 2026-10-07

- Recompose CRM Home around attention, today, currency-safe forecast/pipeline and event-backed Opportunity conversion. Add Customer/Opportunity search and contextual creation.
- Add canonical CRM Follow-ups with collection, day/week/month calendar, Customer/Opportunity integration, inline completion, contextual editing and immutable activity evidence. Tenant-aware references and `follow_up.manage` enforce writes in PostgreSQL and server actions.
- Replace global pipeline paging with independent per-stage previews and exact stage totals. Mark Follow-ups and conversion implemented; correct the unsupported Customer-ownership catalogue claim.

### Workspace Homes — 2026-10-07

- Add authenticated Marketing, Support and tenant AI Homes with honest starting states and explanatory operating areas. All nine workspaces now have real Home destinations in the flat tenant sidebar, subject to existing eligibility rules.
- Use Megaphone for Marketing, Headset for Support and Bot for AI; retain Wrench for Work and the global Agent's Bot rail control. Tenant AI remains separate from Platform AI Runtime and provider credentials.

### CRM — 2026-10-07

- Add first-class Opportunities, collection/detail/pipeline views and a Customer Opportunities tab. Opportunity stages classify potential business as Open, Won or Lost while existing Customer stages remain the relationship lifecycle.
- CRM Home now summarizes canonical Opportunities with exact stage counts and separate currency values. Opportunity ownership uses Membership, permissions are separate from Customer editing, and events preserve historical stage meanings. No stages are seeded; unstaged remains separate from Open.

### Documentation

- Replace the legacy documentation sprawl with a canonical documentation set covering product, domain model, architecture, UI, security, data, integrations, testing, development, deployment, operations, roadmap and ADRs.
- Replace the old undated long-form changelog format with date-first release history.
- Make `CLAUDE.md` explicitly read-only for audits/reviews/plans unless repository mutation is requested, and require explicit permission for branch/commit/push/PR or external-system mutation.
- Add `docs/public-web.md` for the specialized public publishing/domain/external-session boundary instead of scattering those rules across generic architecture documents.
- Replace the empty ADR index with individual baseline decision records preserving rationale and rejected alternatives.

---

## [2026-10-06]

### Settings and identity

- Restored Settings as five independent scopes: Organization, Account, Access, Connections and Plan & usage.
- Removed duplicate ownership paths that placed team/access concerns under Organization settings.
- Added real editable personal profile behavior rather than a read-only email-only surface.
- Added secure signed-in password-change behavior using current-password/fresh-proof requirements.
- Added secure email-change flow with identity verification and a dedicated callback.
- Corrected Account-menu and Settings navigation behavior and tightened route ownership tests.

### Navigation and Insights

- Retired the global Insights workspace presentation.
- Preserved deep reporting/Insights routes as cross-cutting analysis rather than a canonical operator workspace.
- Restored page-level Configure controls to the surfaces that legitimately own configuration.

### Studio

- Added organization-created multi-page websites.
- Website publishing now selects one whole site revision so navigation and pages cannot drift across versions.
- Added pages, sections, navigation, starters, revision history and restore-as-new-draft behavior.
- Public hostname routing now resolves published site pages rather than only a single fixed public surface.

### Connections and provider readiness

- Added organization-managed Secrets & credentials with write/replace/disable behavior and no plaintext readback.
- Added GitHub as an organization Connection with installation/repository scoping.
- Moved connector readiness authority to the API so the UI only offers Connect when the deployment can actually support it.
- Expanded Platform Provider readiness so catalogued, configured, verified, implemented, assigned and operational states are distinguishable.

### Scheduling

- Added travel-aware scheduling feasibility for mobile resources using prior/next work and routing time.
- Travel uncertainty remains explicit rather than being treated as zero.

---

## [2026-10-05]

### AI and usage

- AI requests now check Organization entitlement before model spend.
- AI token usage is normalized into the shared Usage Event model after provider-reported usage is known.
- Configuration drafting now uses the same platform runtime-assignment model as other AI capabilities.
- Removed model-provider credential ownership from the web application where runtime selection belongs to Platform infrastructure.

### Finance and Platform commercial boundaries

- Finance Home now represents the Organization's own customer-to-business financial operations.
- Plans & Add-ons and platform portfolio economics returned to Platform Administration.
- Organization Settings → Plan & usage remains the customer-facing GildOps subscription surface.
- Platform billing subscriptions now preserve recurring items, checkout reconciliation and provider-event ordering rather than flattening a subscription to one price.
- Payment requirement was corrected to be a Launch/readiness concern rather than an initial Setup prerequisite.

### Voice

- A business Call is now one canonical record even when multiple provider legs/participants exist.
- Call completion, transfer behavior and call duration now follow the business call lifecycle rather than the first provider leg to disconnect.
- Numbers now expose their operational purpose/capabilities/readiness separately from provider internals.
- Calls gained a unified list/detail workflow with filters, outcomes, participant history and controlled recording playback.

### Booking and portal

- Work types can define booking notice, same-day, future-window and cadence policy independently of appointment duration.
- Customers can reschedule or cancel their own bookings within Organization-configured policy.
- Portal links are exchanged into dedicated sessions instead of remaining bearer secrets in every action.
- Booking can include an Organization-authored Studio Form and commit booking + response atomically.

### Proposals

- Proposal links are exchanged into dedicated review sessions.
- Accept/decline behavior is single-decision and version-aware rather than relying on repeated bearer-link submission.

### Scheduling and resources

- Work Items can have multiple Resource assignments.
- Work Types can declare resource requirements by class/capability and quantity.
- Resources can define working hours and exceptions.
- Scheduling/booking can find complete feasible sets of resources rather than a single arbitrary Resource.
- Resource feasibility remains authoritative at commit time.

---

## [2026-10-04]

### Communications

- Added the multi-channel Communications foundation for email and messaging.
- Introduced one Inbox for email and SMS conversations rather than separate parallel message applications.
- Conversation state, assignment, unread handling and customer linking now use one Communications-owned lifecycle.
- Email became a first-class Communications channel with compose, reply, attachments, provider delivery state and inbound threading.

### SMS

- Carrier delivery vocabulary is normalized at the provider boundary.
- Late or duplicate provider callbacks no longer regress delivery state or duplicate usage.
- Inbound messages are metered and correlated without allowing tenant-controlled delivery-state forgery.

### Studio forms

- Added a Studio form builder, hosted public forms and reusable form templates.
- Form submissions remain pinned to the published form revision used by the respondent.
- Forms can be placed in websites/portal/public flows without creating separate copied form definitions.

### Mobile shell

- Phone navigation became:
  - Home
  - AI
  - Menu
- The phone header was reduced to context/location rather than recreating desktop chrome.
- Menu opens the same projected navigation hierarchy rather than a separate mobile information architecture.

### Work and resources

- Work Types now explicitly state whether they are scheduled.
- Bookable work implies scheduled work.
- Field/Schedule navigation now follows actual scheduled-work capability rather than always rendering.
- Resources gained classes and capabilities as canonical configuration rather than inferred behavior.

---

## [2026-10-03]

### Scheduling UI

- Rebuilt Schedule as a real operational surface with Day, Week and Month views.
- Fixed Day/Week layout so the schedule fills the available workspace and remains usable at tablet width.
- Customer detail gained shared Location/map projections without creating CRM-owned location copies.

### Platform billing

- Added commercial purchase quote/snapshot before checkout.
- Added multi-line platform subscription checkout.
- Added negotiated provider-price support while preserving what the Organization actually reviewed.
- Checkout now buys the resolved commercial package instead of reconstructing a different package later.

### Usage, cost and allowances

- Added infrastructure-cost taxonomy and Organization storage allowance support.
- Added customer-charge composition and richer provider-cost attribution.
- Added resolved allowance behavior and allowance-aware usage rating.
- Strengthened the commercial permission boundary around commercial configuration.

### Email provider infrastructure

- Added tenant sending-domain provisioning through Resend using provider-confirmed state.
- Provider verification is authoritative; tenant input cannot simply mark a sending domain verified.

---

## [2026-10-02]

### Provider correctness

- Closed Cloudflare/Resend integration correctness and security gaps.
- Strengthened review-step UI around provider-backed configuration.
- Tightened provider state so GildOps does not present unverified external state as complete.

---

## [2026-10-01]

### Canonical operator workspaces

- Adopted the current operator workspace taxonomy:
  - CRM
  - Communications
  - Marketing
  - Support
  - Finance
  - AI
  - Automations
  - Field
  - Studio
- Began separating workspace registration from whether a real navigation row should be visible.

### Frontend/application architecture

- Refactored the application layer and bulk-read composition.
- Split Python service responsibilities more deliberately.
- Made the Agent load lazily and expanded rendered-browser test coverage.
- Established canonical screen archetypes and reset the frontend component architecture away from the old container model.

### Platform Administration

- Consolidated Platform navigation into a coherent administrative scope.
- Added commercial/provider administration surfaces without treating Platform as a customer workspace.

### Providers and domains

- Added Cloudflare DNS connector foundations and automated Vercel domain bridging.
- Added Resend Platform Provider Account and invitation-delivery lifecycle.

### Settings

- Restored Settings as an explicit landing point and normalized route ownership.
- Continued separating Calls, CRM stages and Communications configuration according to domain ownership.

---

## [2026-09-30]

### Sales → provisioning handoff

- Accepted commercial proposals can hand off into creation of the prospect's own Organization.
- Added atomic/idempotent handoff behavior and canonical configuration snapshotting.
- Setup now knows why the Organization exists and can seed its first draft from the Sales/discovery handoff instead of asking for the same information again.
- Real entitlement resolution was connected to the provisioning/setup lifecycle.

### Application architecture

- Reset the frontend architecture contract and retired the old `components/containers` model.
- Reorganized shared UI around clearer primitives, application components, features and routed surfaces.
- Rehomed the public website under Studio with a real editing workbench.
- Normalized Organization Settings routes.

### Finance / commercial navigation

- Work during this period exposed the distinction between tenant Finance and platform Plans & Add-ons.
- Subsequent 2026-10-05 work completed the correction by placing platform commercial management back under Platform Administration.

---

## [2026-09-29]

### Discovery and commercial proposal journey

- Added structured discovery requirements rather than storing discovery as an untyped flat list.
- Added provenance and unresolved-requirement handling.
- Added recommendation of real catalogue Features from discovery.
- Added a preview of the prospect's proposed GildOps configuration using the canonical workspace model.
- Added versioned commercial proposals snapshotted from real catalogue pricing.
- Added prospect-facing proposal review and acceptance.

This established the reusable pre-tenant journey:

```text
Marketing / inquiry
↓
Discovery
↓
Requirements
↓
Recommended configuration
↓
Preview
↓
Commercial proposal
↓
Acceptance
↓
Provisioning handoff
```

---

## Earlier history

Repository history before **2026-09-29** remains available in Git.

The previous changelog contained thousands of lines of mostly undated implementation narrative. That material is intentionally **not** copied into this replacement file, because doing so would preserve the exact defect this changelog is meant to fix.

If an older release/event needs to be reconstructed:

1. inspect Git commit history;
2. identify the actual commit date;
3. identify the meaningful product change;
4. add a dated historical entry only if that history still provides operational/product value.

Do not paste old implementation diaries back into this file.

---

## Entry format

New entries should use:

```markdown
## [YYYY-MM-DD]

### Area

- Meaningful product/operator change.
- Important architecture/security/compatibility consequence.
- Known limitation when it materially affects the shipped behavior.
```

For work not yet shipped:

```markdown
## [Unreleased]
```

When it ships, move the entry under the actual date.

---

## Changelog rules

### Include

- meaningful new product behavior;
- meaningful behavior change;
- security/authorization change;
- migration/compatibility change;
- operationally important provider/deployment change;
- architectural change visible to future operators/developers;
- removed/deprecated behavior with real consequence.

### Do not include

- every file edited;
- mechanical refactors with no meaningful consequence;
- test count diaries;
- code comments;
- speculative roadmap items;
- detailed rationale already owned by an ADR;
- enormous implementation walkthroughs.

A changelog entry should remain understandable without reading the diff.

Exact implementation history remains in Git.

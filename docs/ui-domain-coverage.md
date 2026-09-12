# UI ↔ domain coverage

What the domain layer can represent or do, mapped against what a route actually exposes,
how discoverable that is, and whether the surface has the states a user needs. Statuses:

- `SURFACED` — reachable, coherent, has the states its domain support warrants.
- `EMBEDDED` — deliberately not a first-class record; lives inside another surface. Correct, not a gap.
- `INCOMPLETE` — reachable but missing a state, relationship, or section the domain already supports.
- `HIDDEN` — the domain supports it; no route reaches it; not documented as intentional.
- `MISSING` — no domain support and no route.
- `HEADLESS_BY_DESIGN` — deliberately has no screen. Named as such in `CLAUDE.md`/`docs/domain-model.md`, not an oversight.

This document is a living index. Update a row's status in the same change that changes the
surface it describes. Do not let it drift into a duplicate of `CHANGELOG.md` — record what a
capability's surface *is*, not the history of getting there.

## Summary table

| Concept | Status | Highest-confidence gap |
|---|---|---|
| Customers | SURFACED | Fixed: Portal section now gated on the `portal` module, matching Reception |
| Work Items | SURFACED | Fixed: Documents section added; Customer/Location/Asset now link. Activity/timeline still `HIDDEN` |
| Assets | SURFACED | Fixed: `[assetId]` record route added (identity, readings, related work, documents) |
| Locations | SURFACED | Fixed: `[locationId]` record route added (identity, coordinates, customers, related assets/work, documents) |
| Resources | SURFACED | Fixed: `[resourceId]` record route added (identity, custom fields, related work). No edit or documents — neither exists in the domain |
| Scheduling | EMBEDDED | Correct as an advisory view over Work Items — no gap |
| Documents | INCOMPLETE/HIDDEN | 3 of 4 domain-supported attachment targets have no UI section |
| Custom fields | INCOMPLETE | Full lifecycle only for Customer/Work Item; Location/Resource/Asset lack a correction surface |
| Activity/Timeline | SURFACED for Customer/Work Item | Fixed: extracted `features/timeline/`, added `listWorkItemTimeline`. Asset/Location activity remains `HIDDEN` |
| Automation | SURFACED | Fixed: decomposed into `rules/`, `templates/`, `activity/`, `review/`; WHEN/IF/THEN kept as one unit |
| Booking | SURFACED (coupling debt) | Unmediated render of Public Profile + Branding; no independent identity |
| Public Profile / Branding | SURFACED | Fixed: real Preview link, shown only once `/book/{slug}` actually resolves |
| Website (`lib/domain/public-site/`) | SURFACED, missed by Phase 0 | A full per-tenant homepage builder (sections, SEO, draft/review/publish, its own `/preview` route) already exists, deliberately separate from Public Profile/Branding — added after this audit's first pass; see note below |
| Locale/regional | SURFACED | Terminology override is `MISSING`, already flagged in `navigation.ts` as future work |
| Tenancy/roles/invitations | SURFACED | `assignRole` is `HEADLESS_BY_DESIGN` (see below) |
| Identity/Account | SURFACED | Fixed: `/account` (email, password change, businesses, platform link); `AccountMenu` now shows the signed-in email |
| Platform administration | SURFACED | Mature; no gaps found |
| Integrations | SURFACED (CSV) / placeholder (others) | Google Workspace/HubSpot/Shopify are inert catalogue entries, not a gap to close here |
| Provider bindings | SURFACED | Correctly read-only per D44 |
| Reception/calls | SURFACED | No live/in-progress call indicator (minor) |
| Billing/pricing | INCOMPLETE (discovery) | Entitlement, config-completeness and usage/spend split across 3 screens; Plan & Usage absent from `navigation.ts` |
| Reporting | SURFACED | Closed measure/grouping enum is deliberate (I4), not a gap |
| Settings IA | Hybrid, working | Reviewed for Phase 7; no section's growth yet justifies moving it, so left as-is |

## Customers — `SURFACED`

- Domain: `apps/web/lib/domain/customers/customers.ts` (`listCustomers`, `createCustomer`, `getCustomer`, `updateCustomer`), `stages.ts`.
- Route: `app/organizations/[organizationId]/customers/page.tsx` (list/create), `[customerId]/page.tsx` (detail).
- Feature deps: `features/custom-fields/{inputs,values}`, `features/public-profile/portal-link-form`.
- Navigation: `records` group, kernel (no module).
- States present: create, list, detail, edit (capability-gated with a `Hint` fallback), relationships (stage, calls, portal invites — text only), custom fields (full lifecycle), documents (full section), activity (History section, deliberately not capability-gated).
- Deficiency: the Portal section renders regardless of the `portal` module's enabled state, unlike Reception's module-gated stage/calls sections — worth a one-line fix, not a redesign.

## Work Items — `SURFACED`

- Domain: `apps/web/lib/domain/work-items/{work-items,statuses,transitions,checklists,consumption,economics,types}.ts`. `listWorkItems` gained optional `assetId`/`locationId`/`resourceId` filters, mirroring the existing `typeId` pattern, so each new record page's "related work" section is a real query.
- Route: `.../work/page.tsx` (board), `[workItemId]/page.tsx`.
- Feature: `features/work/` (`work-list.tsx`, `work-item-sections.tsx`, plus five form files).
- States present: create, list, detail, correction (`work_item.update`), custom fields (full lifecycle), documents (fixed), activity (fixed).
- Fixed:
  - **Documents**: `DocumentsSection` composed in, gated by `document.create`.
  - **Activity**: `listWorkItemTimeline` + `ActivityList` (History section), sharing the interpretive core `listCustomerTimeline` already had.
  - **Relationships**: Customer, Asset, Location and Resource ("Assigned to") all now link to their own record pages.

## Assets — `INCOMPLETE`

- Domain: `apps/web/lib/domain/assets/{assets,readings}.ts`. `listAssets` (joins customer + location in one query), `createAsset`, `listAssetReadings`, `recordAssetReading`. No `getAsset` singular read function exists yet.
- Migrations: `supabase/migrations/20260827000004_assets.sql` (table `assets`, RLS gated on `asset.create`, no update policy), `20260831000006_counters.sql` (`asset_readings`, append-only, no update/delete).
- Route: `assets/page.tsx`, `actions.ts`, `create-asset-form.tsx`. **No `[assetId]` directory.**
- The list page's own comment (`page.tsx:30-32`) says the full reading log "lives under the asset" — confirmed as aspirational; no such route exists.
- Relationships: efficiently joined to customer/location already; `work_items.asset_id` is embedded in `WORK_ITEM_SELECT`.
- Custom fields: supported, rendered in the list's Details column only (no per-record correction surface).
- Documents: `asset` is a `DOCUMENT_ENTITIES` member; no host page exists to render the section.
- Module: gated by `assets` (paid/optional).
- This is Slice 1 (see below).

## Locations — `INCOMPLETE`

- Domain: `apps/web/lib/domain/locations/locations.ts`. `listLocations`, `createLocation`, `linkCustomerLocation`, `locateAddress` (geocode lookup), `setLocationCoordinates` (the only mutation past creation, narrowly scoped to lat/lng by grant).
- Migration: `20260827000001_locations.sql` — no update policy on `locations` itself beyond the coordinates grant; junction table `customer_locations` with composite FKs.
- Route: `locations/page.tsx` (DataTable only), `actions.ts`, `location-forms.tsx`. **No `[locationId]` directory**, and — unlike Assets — no comment anywhere implies one is planned.
- Deliberate absence, not a bug: general label/address editing is explicitly not implemented, because moving a location silently relocates every historical job done there (I8 territory). Any detail route must keep display and mutation separate, and must not add an "edit address" operation.
- Documents: `location` is a `DOCUMENT_ENTITIES` member; no host page.
- Custom fields: supported, list-column display only.
- Module: kernel.

## Resources — `INCOMPLETE`

- Domain: `apps/web/lib/domain/resources/resources.ts` — deliberately thin: `listResources`, `createResource` only. No `kind`/`active` column by design (migration comment).
- Route: `resources/page.tsx` (list/create only), **no `[resourceId]` directory**, no comment acknowledging the gap.
- Relationships: `work_items.resource_id` embedded efficiently in `WORK_ITEM_SELECT`; `scheduling/availability.ts`'s `listSchedule` already joins resources to work items for the schedule day-view.
- Documents: resource is **not** in `DOCUMENT_ENTITIES` at the domain/DB level — this is not a UI gap, it is undecided domain scope. Do not add it speculatively.
- Custom fields: supported, list-column display only.
- Module: kernel.
- Resource has become load-bearing (scheduling, work, reporting all reference it) without ever getting a lifecycle past its name — see Slice 6 below.

## Scheduling — `EMBEDDED` (correct)

- `scheduling/{schedule,availability,operating-hours,window}.ts`. No `calendar` table by design — a scheduled thing is a Work Item organized by time and resource (I5/I6).
- Route: `schedule/page.tsx`, a read-only day view (Previous/Next/date-picker) linking each booking to `/work/{id}`. Mutating actions (`scheduleWorkItem`/`unscheduleWorkItem`) live on the Work Item route, correctly — a second mutation surface here would be a second answer to *what is free*.
- No gap. Do not build a Resource-keyed schedule route in Phase 1 — a day-keyed advisory view is the one calculation (I5), and a resource's schedule is already visible by filtering this view, not by adding a second one.

## Documents — `INCOMPLETE` / `HIDDEN` depending on entity

- Domain: `apps/web/lib/domain/documents/documents.ts`. `DOCUMENT_ENTITIES = ['customer', 'location', 'asset', 'work_item']` (closed set, composite FK per entity — not polymorphic). `listDocuments`, `uploadDocument` (25MB cap, `create_document` RPC, `documents` bucket), `getDocumentUrl` (60s signed URL).
- Coverage against the 4 allowed entities:
  - `customer` → full UI (list, upload, empty state) on `[customerId]/page.tsx`.
  - `location` → domain allows it; **no detail route exists to host it**.
  - `asset` → domain allows it; **no detail route exists to host it**.
  - `work_item` → detail route exists; **section was never built** (confirmed zero references).
- Only 1 of 4 domain-supported attachment targets is actually usable. This is the single largest domain/UI mismatch found.
- Action: extract `features/documents/` (list, secure download link, upload control, empty state, capability/read-only message) out of the mature Customer implementation, then compose it into Work Item (Slice 4), Location (Slice 5) and Asset (Slice 3) as each gets a host page.

## Custom fields — `INCOMPLETE`

- Domain: `apps/web/lib/domain/fields/field-definitions.ts`. `CUSTOM_FIELD_ENTITIES = ['customer', 'location', 'resource', 'work_item', 'asset']`. `kind`/`key` are immutable once set (by column grant, not convention) — never add an edit path for either.
- Feature: `features/custom-fields/{inputs,values}.tsx` — sound, do not rebuild.
- Lifecycle per entity:
  - customer, work_item: definition → create → display → edit, all present (edit via each record's correction disclosure).
  - location, resource, asset: definition → create → display present; **edit is whatever the list page's create form doubles as** — no dedicated correction surface, because there is no detail page for any of the three.
- This is downstream of the same gap as Documents: three entities lack a record page, so neither documents nor custom-field correction has anywhere to live. Closing Slices 3/5/6 (Asset/Location/Resource records) closes this by construction — do not build a separate custom-field-editing mechanism.

## Activity/Timeline — `SURFACED` for Customer and Work Item; `HIDDEN` for Asset and Location

- `timeline.ts` exports `listCustomerTimeline`, now also `listWorkItemTimeline`, sharing one interpretive core (`describe`, `Vocabulary`) via `features/timeline/activity-list.tsx` for presentation. Neither is capability-gated — a deliberate transparency choice: the underlying table is append-only and RLS has already restricted every row to the caller's tenant.
- `WORK_ITEM_ACTIONS` was extracted out of `CUSTOMER_ACTIONS` (the customer list now spreads it) since a job's own page became the second caller for exactly that subset — the same "extract on the second caller" rule `customer_activity.sql` states for itself.
- No `work_item_activity` view was needed: every `WORK_ITEM_ACTIONS` event is written with `entity_type = 'work_item'` and `entity_id` equal to the job's own id, so a direct filter on `events` is the whole query — unlike a customer's history, which needs a view because some of what happened to a customer is written against their jobs instead.
- **A real gap surfaced along the way, not fixed here**: `document.created` events are written with `entity_type = 'document'` and `entity_id` equal to the document's own id (`20260827000005_documents.sql`), and the payload carries no `work_item_id`/`customer_id` to resolve it by. `customer_activity` already works around exactly this shape for `location.linked` (which does carry `customer_id` in its payload) but has no equivalent branch for documents, so `document.created` is listed in `CUSTOMER_ACTIONS` and has a `describe()` sentence that can never fire — a customer's own document uploads silently never appear in their history, and neither will a job's. `WORK_ITEM_ACTIONS` deliberately excludes `document.created` rather than reproduce the same dead entry. Fixing it needs a payload change to `create_document` (a migration) plus a new `customer_activity` branch — a self-contained follow-up, not folded into this slice.
- Asset and Location activity remain `HIDDEN`: no scope-specific loader exists yet for either. Both would follow the Work Item shape (a direct `events` filter, no new view) once asked for.

## Automation — `SURFACED`, decomposed

- Domain unchanged: `automation/rules.ts`, `review.ts` (rule health), `templates.ts` (includes delivery history). No domain validation or server action touched.
- Fixed: the single 931-line `features/automations/automation-forms.tsx` is gone, split into `features/automations/{rules/rule-card.tsx, rules/create-rule-form.tsx, templates/template-section.tsx, activity/run-log.tsx, review/rule-warnings.tsx, shared.tsx}`. The page-level "What the rules have done" log (previously inline JSX in `automations/page.tsx`) is now its own `RunLog` component alongside the same-shaped extraction for everything else.
- The WHEN/IF/THEN rule-editor mental model was kept as one unit deliberately: `AutomationRuleCard` (in `rules/rule-card.tsx`) still renders a rule's trigger, conditions and actions together, including its own per-rule warnings (`RuleWarnings`, extracted but rendered in the same place) and its own short "Recently" run list — splitting a rule's own sentence across files or moving its warnings to a separate review screen would have made rules harder to read for the sake of a tidier file tree, which is exactly what the task warned against.
- No new routes, no tabs — the single-page workspace was already the right shape; only the code topology changed to match it.
- `tests/milestone-m11.test.ts`'s destructive-action/`ConfirmSubmit` pairing (which named the old single file) was updated to check the two new files that actually call those actions now (`rule-card.tsx` for delete rule/remove condition/remove action, `template-section.tsx` for delete message) — the invariant it enforces is unchanged, only the file it checks.

## Booking — `SURFACED`, with a coupling debt (deliberately not resolved)

- `app/(public)/book/[slug]/**` renders `publicProfile()` and `getBrand()` directly — the same domain read used by Settings. There is no booking-specific identity; whatever Settings holds is exactly what a visitor sees.
- Phase 5's premise (public identity and Booking are conflated) is real, but the fix it originally proposed — making the identity render independent of whether a bookable type exists — was raised and explicitly declined: `resolveBookingSlug`'s bookable-type requirement is a deliberate privacy opt-in, not an oversight (see Public Profile / Branding, below). The lower-risk fix landed instead: a real Preview link from Settings, shown only once the page genuinely resolves. Decoupling the identity render from Booking's own opt-in gate remains open, and would need a new, separate opt-in signal — not a reason to weaken the existing one.

## Website (`lib/domain/public-site/`) — `SURFACED`, missed entirely by this document's first pass

- Discovered mid-implementation, not by the original Phase 0 research (which was scoped to `app/organizations/[organizationId]/settings/**` and `book/[slug]` and never looked at `(preview)/`, `(marketing)/`, or `lib/domain/public-site/`). Landed in the two commits immediately before this work began (`3c8d761`, `a8142fd`), with further uncommitted changes to it already present when this session started.
- A full per-tenant homepage content system: fixed section kinds (hero, problem, capabilities, process, trust, cta), SEO title/description, a draft → in_review → published → archived lifecycle (`homepageEditorState`, `createHomepageDraft`, `updateHomepageDraft`, `submitHomepageRevision`, `publishHomepageRevision`), its own authenticated preview route (`/preview/[organizationId]/[revisionId]`), and a dedicated Settings destination (`settings/website`, its own `ConfigCard`).
- Deliberately kept separate from Public Profile/Branding — the Website settings page says so directly: "Profile and brand remain in Public presence." Today only GOLD's own root `/` actually serves a *published* revision publicly (`publishedGoldHomepage()`, chosen via `platform_settings` rather than a tenant's own slug); a tenant's own published Website revision has no public route yet — only staff/the tenant itself can reach it, through the authenticated preview.
- Out of scope for this pass: this is exactly the "full public website" content model Phase 5 said to document rather than build — and it already exists. Whether and how a tenant's own published Website becomes publicly reachable (its own route? keyed by the same slug as Booking? something else?) is a real open product question this document surfaces rather than answers.

## Public Profile / Branding — `SURFACED`

- Both edited on `settings/page.tsx` (`#public-page`, brand section) via `features/public-profile/profile-form.tsx` and `settings/brand-forms.tsx`.
- Fixed: `ProfileForm` now renders a real `ButtonLink` to `/book/{slug}` (`target="_blank"`) instead of inert text — but **only once the page would actually resolve**. `booking_organization` (the slug-resolution function) is a deliberate privacy opt-in: it answers only for a business that has published at least one bookable kind of work, specifically so that setting a slug alone does not make a business publicly addressable (`20260829000005_booking_slug.sql`'s own stated reasoning). A live link before that would send an operator to a dead 404, so the form now checks `listBookableTypes(...).length > 0` (passed from `settings/page.tsx`) and shows an explanatory sentence instead until it's true. This opt-in gate was deliberately **not** weakened — doing so was raised and explicitly declined.
- `PublicHeader`'s own comment claims "both booking and admin preview use it" — still not literally true (the preview is a link out to the live booking page, not an embedded admin render), but the practical gap it described — no way to see or reach the public page from Settings — is closed.
- Slice target (Phase 5): give Settings a real Preview/Open action, and let a public-presence surface exist independent of whether Booking is enabled — without building a CMS.

## Locale/regional — `SURFACED`; terminology override `MISSING` (already flagged)

- `features/locale/locale-fields.tsx` sources timezone/currency live from `Intl.supportedValuesOf`. Working hours are a separate anchor (`#hours`) on the same settings page, seeded empty by design (no default working week).
- Per-tenant terminology override for platform-level nouns does not exist; `navigation.ts`'s own header comment already names this as future work. Not a silent gap — do not build it in this slice unless explicitly requested.

## Tenancy/members/roles/invitations — `SURFACED`; `assignRole` is `HEADLESS_BY_DESIGN`

- Full CRUD for roles/members/invitations on `roles/page.tsx`, gated by `role.manage`.
- `assignRole` (roles.ts:100) has zero call sites outside tests. `docs/walkthrough.md` lists it under "What you cannot reach from any screen" — it is documented as intentionally unreached, not an operator escape hatch as this audit's originating prompt assumed. **Correction to the brief**: the walkthrough does not describe an operator manually invoking it; it names it as dead-by-design, alongside `revokePortalInvite` and `browserTelephoneToken`. Do not build a "change member role" screen without confirming that decision has actually changed — `CLAUDE.md` calls this out by name as a boundary ("Do not add a fourth without noticing").

## Identity/Account — `SURFACED`

- Domain: `identity/credentials.ts` gained `changePassword` — the same `auth.updateUser({password})` call `setNewPassword` makes for a recovery link, but with its own message, since nobody reaching a signed-in account page arrived holding an expired one.
- Route: `/account`, top-level and ungrouped like `/organizations` — identity spans Organization Context and Platform Context rather than belonging to either (D45), so this page belongs to neither's shell. Shows the signed-in email, a password-change form (reusing `CredentialsForm`, the same one every other credential screen already shares — hidden when Supabase's own `identities` list has no `email` provider, i.e. a Google-only account with no password to change), the caller's businesses (linking through `areaHref`, not a bare organization path with no page behind it), and a Platform Administration link when the caller holds platform staff.
- `AccountMenu` now shows the signed-in email (resolved via a second, deliberate `db.auth.getUser()` call alongside whichever layout-level actor check already ran) and links to `/account`, threaded through both shells (`OrgSidebar`, `AppSidebar`/`PlatformShell`) and the mobile header fallback.
- Deliberately narrow: no display name or avatar, because neither is persisted anywhere authoritative — inventing one here would be the platform answering a question nobody was asked.

## Platform administration — `SURFACED`

- Mature: overview, organizations list + provisioning, per-tenant support sessions, per-tenant provider administration (Twilio subaccount, phone numbers, resource status), global pricing/catalogue management, failures. No material gaps found.

## Integrations — `SURFACED` (CSV) / inert placeholders (others)

- CSV import is fully real (`connections`, `csv`, `import-runs`, `mappings`, `resources`). Google Workspace/HubSpot/Shopify are catalogue entries marked `available: false` — inert by design, not a gap this task should close (building them would be exactly the "speculative CMS/ERP" the brief forbids).
- Provider bindings (Twilio/Resend) are correctly read-only on the tenant side per D44; provisioning stays staff-only.

## Reception/calls — `SURFACED`

- `calls/page.tsx` is a real dashboard (today's calls, outcome breakdown, pipeline board), not just a log. `telephony_settings` UI is exactly D39's minimal shape — one phone-number field. No live/in-call status indicator exists, a minor and likely low-priority gap.

## Billing/pricing — `INCOMPLETE` (discovery, not function)

- Three separate screens answer three separate billing questions: `pricing/page.tsx` (the tenant's own price book), `settings/page.tsx#modules` (enabled/disabled + `configuredAt` completeness), `settings/plan/page.tsx` (entitlement state sentences, commercial terms, usage, calling credit).
- `settings/plan` is not in `navigation.ts`'s `AREAS`/`MODULES` at all — reachable only via the Settings card grid, not a first-class nav entry.
- Not a correctness gap (I4/I5/D41 are all intact) — a discoverability and duplication gap: module-label lookups are repeated across two of the three screens.

## Reporting — `SURFACED`

- Saved reports are named snapshots of a closed `{measure, grouping, period, filters}` shape re-run against one of three fixed aggregates — deliberate (I4), not a missing query builder.

## Settings IA — hybrid, functioning; reviewed, not restructured

- One root page (six inline sections + a card directory) plus dedicated sub-routes (`work`, `plan`, `connections`, `website`, `payments`), tied together by a shared `SettingsNavigation` component that already treats anchors and routes as interchangeable list entries. `Website` already has its own route with real weight behind it (drafts, review, publish, history) — evidence the pattern here already works when a section earns it.
- Reviewed against Phase 7's own test — move a section out only once its growth already justifies a dedicated route — and **declined to change it**. The one candidate this document's earlier pass named, Public Presence, is still two short forms (profile fields, brand colour/logo) even after gaining a preview action; splitting it into its own route now would be exactly the premature abstraction this repository's own rules warn against (no caller — no growth — justifies it yet). Settings IA is functioning and stays as it is until a section's own growth, not this audit's tidiness preference, asks for a route.

---

## Findings that contradict the originating brief

1. **`assignRole`'s absence is not an "operator hits it manually" case.** `docs/walkthrough.md` lists it, `revokePortalInvite`, and `browserTelephoneToken` together as *unreachable from any screen*, full stop — none of the three has an operator path, scripted or otherwise. The brief's framing ("`docs/walkthrough.md` names where an operator would hit the first two") does not match the document. Treat the whole trio as `HEADLESS_BY_DESIGN` unless told otherwise.
2. **Resource is not documentable** — `DOCUMENT_ENTITIES` excludes it at the schema level, not just the UI. A Resource record page (Slice 6) must not add documents support without a domain/migration change first, which is out of scope unless requested.
3. **Scheduling needs no new UI.** It's already a correctly embedded capability; nothing in Phase 1–3 should touch it beyond linking to it from new record pages.

## Slice 1 — Asset record (`/organizations/[organizationId]/assets/[assetId]`)

Domain work needed before the page can be truthful:
- Add `getAsset(db, {organizationId, assetId})` to `apps/web/lib/domain/assets/assets.ts`, mirroring `getCustomer`'s shape (single row + joined customer/location, 404 semantics via `null` return).
- No new mutation beyond what exists (`recordAssetReading`) — asset name/customer/location correction does not exist in the domain today; do not invent an edit path in this slice. If a future slice adds it, it needs the same tenancy/capability discipline as `updateCustomer`.
- Reuse `listAssetReadings` for the full reading history (currently only "latest" is shown on the list).
- Compose `features/documents/` (once extracted) for the asset's document section, gated by `document.create`.
- Compose `features/custom-fields/values.tsx` for display; no edit surface unless/until an `updateAsset` domain function exists.
- Link from `assets/page.tsx` DataTable rows to the new detail route.
- Work Item → Asset relationship: link the existing text `Detail` in `work-item-sections.tsx` to this route now that a target exists.

Implementation order for the remaining slices, per the task's own execution order: Documents feature extraction → Asset record → Work Item document integration → Location record → Resource record → shared Activity evolution → Account/Identity → Public Presence separation → Automation decomposition → Settings IA → final coverage re-audit.

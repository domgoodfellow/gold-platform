# Batch B — Studio customer Portal

Date: 2026-10-14. Scope: B0–B5 implemented and locally verified. The full repository gate passed; browser results and their rerun qualification follow below.

## 1. Repository baseline

HEAD: `1fd3608be38a5ed4c184975b742421844cd0c0f3` (Batch A), on `main`.
The worktree already contained an uncommitted narrower Portal implementation and concurrent prospect-import/environment/documentation work. Import paths, the December 15 import migration, local environments and the source-reference patch are preserved. Implementation and verification ended without staging, committing, pushing or deploying; Git delivery was subsequently requested separately.

Preflight read CLAUDE.md, web AGENTS.md, installed Next documentation, the accepted entitlement/external-actor/Website publication decisions, canonical domain documentation and the supplied B work order. The existing authorities are PortalContext and dedicated session cookies; Work/customer RLS; Finance invoice standing/payment commands; Form publication and portal_forms placement; Studio EditorLayout/PageDrawer; and the existing managed/custom hostname resolver/provider-record infrastructure. Automation artifact summaries intentionally follow their owning membership-only read policy; Studio/AI configuration summaries require their owning management permission.

The first expanded whole-repository run passed 3,905 checks and found three failures: a route-owned payment component imported by a feature, a Plan fixture querying a nonexistent generic table, and a fresh Auth recovery proof crossing a clock-second boundary. The component was moved to its owning feature, Plan fixtures now use canonical commands, and the recovery test waits for the signed proof timestamp without changing production authorization. The final clean gate is recorded below.

## 2. Portal artifact model

One `portal_definitions` root belongs to one organization. Version-2 content contains settings, pages, ordered module instances, navigation by stable page ID, and defaultPageId. Pages have stable IDs, unique lowercase paths, names and modules. Module IDs are globally unique within a definition. Bounds: 12 pages, 12 modules per page, 12 navigation entries, 100 records per module.

Save and restore affect only the draft and clear review. Submit records the exact saved version and reviewer/time. Publish checks version, management, entitlement and activation, then atomically activates one immutable coherent revision. Matching publication is idempotent. Unpublish retains invitations, records and history while pausing customer access. History is read in descending bounded pages; older revisions remain inspectable/restorable.

## 3. Module registry

The canonical domain registry defines kind, label, description, strict configuration parser, independent defaults, variants, required feature, multiplicity, customer access rules, presenter key and labelled-example strategy. A closed typed UI adapter connects presenter keys to the shared component.

| Kind | Configuration | Entitlement/access |
| --- | --- | --- |
| Work | heading, history/upcoming, limit | portal_history; existing customer-owned Work |
| Invoices | heading, list/summary, limit, payments | portal_history; customer-owned invoices and canonical Finance eligibility |
| Forms | heading, list/cards, limit | portal_auth; canonical offered placement and current published Form |

All delivery requires live PortalContext and Portal activation/entitlement. Payments additionally require current Card Payments activation/entitlement, invoice ownership/outstanding balance, and the existing connected-account/provider gates. Forms cannot duplicate on one page. Work/invoice instances may duplicate with new stable IDs. Services are excluded.

## 4. Backward compatibility

Application-origin invitation links retain `/portal/{token}`, fresh anonymous exchange and the dedicated cookie. Until the first custom publication, an absent root or saved unpublished root uses the deliberate default Work/Forms/Invoices definition. No customer record is copied into configuration.

The historical activation-only default is retained only where there is no Plan or Portal commercial history. An expired/revoked commercial ledger or explicit feature override is authoritative; custom publication always needs current entitlement. Foundation-format snapshots normalize on read without editing immutable historical contents. The premature Services projection/visibility controls are removed by the forward migration.

Before first custom publication, presentation also retains the full predecessor record lists
within their existing source-query bounds. Configured record limits take effect on custom
publication; saving the new draft does not shorten a legacy customer's history.

## 5. Studio editor

Studio has a flat functional Customer portal destination between Website and Forms. Create Portal starts from defaults or Basic Customer Portal / Service Business Portal. Templates appear in the existing typed Templates browser, with navigable shared previews; existing Portal roots are opened instead of silently replaced.

Structure controls pages and module order using keyboard-operable buttons. Inspector edits settings, page paths/names/navigation/defaults and registered module configuration. Canvas and preview share live presenters and canonical branding/profile. Narrow containers use native PageDrawer Structure/Inspector controls. Preview uses explicitly labelled examples, without a customer session. Save, Preview, Send for review, Publish, History, inspect/restore and unpublish are functional. Dirty changes block review/publication. Selection and history disclosure survive authoritative refreshes; drawer Escape restores focus.

## 6. Public runtime

The no-argument published projection derives organization/customer identity from PortalContext. Only current published content is rendered. The default route chooses defaultPageId; `/portal/p/{path}` selects an exposed published page. Navigation-excluded and unknown paths are not found. Reads are performed only for modules needed on the selected page and currently available; source failures are not converted to fake empty records. Unavailable modules explain their state.

## 7. Hostname delivery

Managed origin: `https://{organization.slug}.{platform_public_domain}/portal`; invitations start at that origin's `/portal/{token}`. Its Website root remains Website. Verified custom Portal origins redirect their root to their own `/portal` and use the same routes.

The existing provider claim/DNS/TLS records and resolver remain authoritative. Exchange validates hostname organization/surface before canonical claim. Pages, payment return and actions freshly verify hostname/context organization agreement, independent of the routing cache. Custom Website, foreign, unverified, released and unknown hosts are refused. Next's internal origin is not used for custom-host redirects.

Cookies remain host-only, HttpOnly, Secure in production, SameSite=Lax and scoped to `/portal`. No cross-origin credential transfer, shared domain cookie, redirect parameter, new project, new DNS record or provider deployment was introduced. Customer invitation UI projects verified/TLS-issued custom Portal addresses, otherwise managed addresses, otherwise the application origin.

## 8. Forms, Work and Finance

Work retains its canonical customer RLS and authorized history/scheduling fields. Internal board vocabulary remains protected by status-configuration RLS; composition does not grant access to that configuration or invent public labels. Finance retains invoice lines/payments, invoiceStanding, formatMoney and existing processor commands; browser amounts/accounts are never authoritative.

Forms retain portal_forms placement, current Form publication, canonical answer validation, rate limiting, source/customer attribution and exact revision storage. HTTP submissions now carry the revision actually opened; a newer publication refuses stale answers even if their shape remains compatible, with the existing reload flow. No separate Forms module activation or copied question bank is invented.

## 9. Security

Private definition/history reads and all authoring require independent organization membership/management. Authenticated clients have no direct insert/update/delete on definition/revision tables. Version checks prevent stale/concurrent overwrite. Typed content rejects unknown keys, forged IDs, duplicate references, invalid variants/limits, invalid paths, malformed Unicode and oversized/plain-whitespace text.

Published navigation/module exposure gates Form submission and payment initiation at the database boundary, supplementing canonical resource authorization. Payment availability is guarded too. Private helper/original functions are not executable by ordinary authenticated/anonymous callers. Revocation/expiry and hostname release fail closed. Operator, Portal, proposal and public Form sessions coexist in one browser context. Portal responses use noindex/noarchive, private/no-store and no-referrer.

## 10. Database changes

- `20261214000001_studio_customer_portal_composition.sql`: stable root/revisions, optimistic commands, typed Portal deliverable reference.
- `20261216000001_portal_pages_authoring_and_host_delivery.sql`: strict v2 normalization/validation; reviewed publication metadata; current feature/legacy resolution; exposure-guarded canonical Form/payment RPCs; hostname-bound claim/context; removal of premature Services exposure.
- The concurrent `20261215000001_prospect_import_batches.sql` is preserved.
- Composite organization/root/revision and tenant Portal deliverable references, FORCE RLS, pinned search paths and explicit execution grants remain enforced. Database types are regenerated from disposable local Supabase.

## 11. UI and routes

Created `/organizations/[organizationId]/studio/portal` and `/portal/p/[slug]`.
Updated Portal home/token/action/payment-return/unavailable routes, Studio navigation/home/Templates, verified address projection in Customer invitation UI, proxy/hosted Portal root delivery and typed Portal artifact links.

Added the Portal workbench, shared renderer/presenter adapter, template preview, customer page loader, request-context/address/domain helpers and reusable loopback TLS test fixture. The canonical PayInvoiceForm component moved from app-owned presentation to features/portal-access. Canonical docs and ADR-042 record ownership, compatibility, placement, preview and host/session decisions.

## 12. Tests

Portal database coverage includes defaults/draft isolation; strict scalar/Unicode validator parity; independent/private ownership; review, current Plan/legacy entitlement and expiry/overrides; immutable/idempotent publication; stale/concurrent saves; unpublish/restore; excluded module/payment configuration; direct guarded commands; managed/custom/Website/foreign/released host binding; invitation revocation; stale Form revisions; independent typed tenant deliverables; and history beyond 50 revisions.

Unit/component coverage includes template independence, typed invalid references, deletion repair, safe literal rendering, review readiness, page/navigation edits, permitted module duplication, availability, retained selection and history disclosure. Existing placement, payments, identity, navigation, schema and feature-ownership tests remain meaningful.

Existing browser contracts were repaired where they still expected a removed sidebar Settings link,
the old GOLD organization name or the retired fixed phone navigation. The Form distribution helper
now waits for the durable published revision instead of a transient confirmation message.

## 13. Browser verification

The isolated full-B journey passes against loopback Supabase and an isolated Next build. It exercises default-before-publication; page creation/navigation/reload; review/publish; authorized Work/invoices and foreign-customer exclusion; exact Portal Form customer/revision attribution; stale revision refusal without insertion; same-context operator/Portal/proposal/public Form submission and reload; private draft isolation; unpublish/restore; unknown paths; HTTPS custom-host exchange/action/reload; Secure host-only cookies; copied-session rejection; action refusal after domain release; and invitation revocation.

Viewports: 1440×900, 1024×900, 390×844. Structure/Inspector/Preview Escape/focus and overflow are asserted. Screenshots were visually inspected and preserved under ignored `.artifacts/full-b-browser`. Custom hosts use `portal-{uuid}.example.test` and `wrong-{uuid}.example.test`, mapped to a self-signed loopback TLS reverse proxy on port 3141 forwarding to 3140. Provider-record fixtures simulate verified delivery; they do not prove real DNS/TLS/provider readiness.

Existing Studio Website/Forms/distribution/Portal-booking/payments/proposal/navigation/adaptive-shell
regressions ran after the final gate. All 56 selected checks have passing evidence: 55 passed in the
combined run (2.5 minutes), and the tablet Settings/account-menu check passed separately (13.4
seconds including startup). That check had received a local upstream error from telephone number
resolution (`numbers.resolve_failed`) in the combined run; the error was preserved, not hidden by
changing product behavior or weakening its assertions. It also passed in the earlier run. The
combined run is therefore recorded as 55 passed / one transient failure, followed by one passed
rerun, rather than described as an uninterrupted green run.

## 14. Verification commands

| Command | Result |
| --- | --- |
| `pnpm db:reset` | Final disposable-local replay passed |
| `pnpm db:types` | Passed |
| `pnpm check` | Passed: 311 files / 3,911 web checks; TypeScript, lint, production build, four Node API security checks and 922 Python checks |
| `pnpm exec supabase db lint --local --level error` | Passed, no database function errors |
| Focused Portal/payment/placement/component/unit/architecture checks | Passed: final six-file subset, 70 checks |
| `node .artifacts/batch-b-run.cjs build` | Passed using loopback public Supabase settings |
| `node apps/web/e2e/portal-tls-fixture.mjs` | Reusable loopback HTTPS fixture verified |
| `pnpm --filter @gold/web exec playwright test --config playwright.batch-b.config.ts` | Passed: final comprehensive journey, 20.2 seconds including startup |
| Selected eight-file existing Playwright suite below | 55 passed / one local upstream failure; remaining check passed on focused rerun |
| `pnpm --filter @gold/web exec playwright test e2e/adaptive-shell.spec.ts --grep 'Settings navigation and account menu at 768px'` | Passed: one check, 13.4 seconds including startup |
| `pnpm --filter @gold/web typecheck` | Passed after navigation contract repairs |
| `git diff --check` | Passed |

The first whole-repository run's three failures were repaired and targeted checks passed. Two existing unused-variable lint warnings remain. No live Stripe checkout, real DNS/TLS verification, hosted migration or deployment is claimed.

The concluding gate includes preservation of full legacy record lists before the first custom
publication; published modules apply their configured limits. Full output is preserved locally
in ignored `.artifacts/full-b-check-final.log`.

Browser setup uses the canonical demo/business/domain fixtures with an ignored local adapter
(`node .artifacts/full-b-demo.cjs`). The current demo predates required Plan capability checks
and current launch readiness. The adapter creates and assigns a non-billable local fixture Plan
through canonical commands, includes available catalogue features, and leaves demo businesses
truthfully in Setup. Production entitlement and launch guards are unchanged. The app is rebuilt
with loopback public Supabase settings; normal local development environment files are preserved.

Selected existing browser command (`E2E_BASE_URL=http://localhost:3140`):

```text
pnpm --filter @gold/web exec playwright test e2e/studio-website.spec.ts e2e/studio-forms.spec.ts e2e/studio-form-distribution.spec.ts e2e/portal-booking-forms.spec.ts e2e/proposal-access.spec.ts e2e/studio-navigation.spec.ts e2e/portal-payments.spec.ts e2e/adaptive-shell.spec.ts
```

## 15. Remaining gaps

No known incomplete Batch B implementation requirement remains after local verification. The
browser rerun qualification and the demo fixture's Plan/Setup adaptation are documented above.
External provider readiness/live payments require their existing approved configuration and
separate verification; this batch provisions none. The new migrations have been replayed only on
disposable local Supabase, not applied to a hosted project. No deployment was made; Git delivery is
a separately authorized step following this verification.
Services, managed-services Portal projections and additional unsupported module types remain
deliberate Batch C exclusions. Batch C has not been started.

## 16. Batch C readiness

Batch A relationships, engagements and typed deliverable references remain available, including independently authorized Portal root references. Batch B provides a stable Studio Portal definition, typed registry, immutable publication/history, canonical PortalContext and functional managed/custom-origin application routing/session enforcement. These are the intended Batch C inputs; no customer-facing managed-services projection or new cross-tenant grant is implemented.

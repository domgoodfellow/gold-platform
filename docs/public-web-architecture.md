# Public web architecture

> Audit date: 2026-09-12. Repository state, migrations, and tests are the evidence. Legal and
> registrar notes are current research, not legal advice or provider selection.

This document answers one question: **how does GOLD's public presence become a production web
system without becoming a second product beside the operating platform?** It records the current
surface, the intended information architecture, and the boundaries for the next implementation
slices. It does not track delivery status; shipped work remains in `CHANGELOG.md`.

## Current public surface

The proxy's closed public set is authoritative for anonymous reachability. Route groups are
layout boundaries, not URL or security boundaries.

| Route | Current purpose and truth | Required follow-through |
|---|---|---|
| `/` | GOLD's homepage renders the one immutable revision selected by the publishing model. Canonical/social metadata, `robots.txt`, a deliberate marketing-route sitemap and JSON-LD are built; drafts, review and history are not anonymous. | Expand the sitemap only as approved public routes gain substantive content; keep structured claims tied to published facts. |
| `/demo`, `/contact` | Two forms, one narrow RPC (`submit_public_inquiry`): a demo request and a general inquiry each attribute a Customer and an Event (`source` = `demo` or `contact`) to the platform-configured GOLD organization. The old `/workflow-review` route and RPC are gone. | Add rate limiting/bot mitigation and a confirmed retention period. |
| `/privacy`, `/terms` | Routed initial text with metadata, in the sitemap and footer; marked pending legal review, each unconfirmed clause carries a `LEGAL-REVIEW` comment. | Counsel-approved text; the versioned `/legal/[type]` model below remains the target. |
| `/login`, `/sign-up`, password routes | One identity serves Organization and Platform Context. Auth layout is noindex; invitation/recovery callbacks work without a second account or re-login. | Preserve safe intended route and hostname context. |
| `/book/[slug]` | Tenant-branded transaction flow over the real Scheduling and Pricing domain. | Connect it to the tenant's primary public site and canonical host rather than treating the slug as distribution. |
| `/book/[slug]/[workItemId]` | Caller-scoped booking confirmation under the noindex public layout. | Preserve referrer/search leakage controls. |
| `/portal/[token]` | Token-credentialed, read-only tenant customer surface under the noindex public layout. | Preserve strict referrer discipline. |
| `/organizations/accept-invite/[token]` | Noindex, context-preserving organization invitation acceptance with exact-email validation. | Retain token-safe auth redirects. |

The organization-side Website settings now provide a real edit, preview, revision and publish
foundation. The built homepage vocabulary is intentionally narrow and typed; publishing
atomically advances the public pointer, published revisions are immutable, and anonymous reads
use `published_gold_homepage()` rather than table access. Tenant brand settings and logo also
drive authenticated and selected public surfaces.

This is not yet tenant website distribution. There is no public hostname resolver for each
organization, verified custom-domain lifecycle, governed public media library, additional/legal
page publication, full public authentication-context preservation, or complete attribution/
consent layer. The site at GOLD's root proves publishing mechanics for GOLD; it does not imply
that a tenant's published revision is reachable on that tenant's host.

Operational `assets` are customer/business equipment and property. Public images and downloads
need a distinct governed media concept; reusing `assets` would corrupt both authorization and
language.

## Proposed GOLD sitemap and conversion intent

The launch sitemap stays smaller than the illustrative brief. Industries, Resources, and public
Pricing wait for real material; publishing thin pages would create crawlable noise rather than
search coverage.

| Page | Visitor problem and search intent | Marketing objective / CTA | Section order | Proof and source | Links / structured data |
|---|---|---|---|---|---|
| `/` | “What is GOLD, and is it for an operations business like mine?” | Qualify quickly; **Request a demo**; secondary See how it works | Outcome hero → fragmented-work problem → shared operating model → real capabilities → configurable examples → implementation → security/trust → FAQ → CTA | Product screenshots and only verified capability claims; published GOLD site revision | Platform, Solutions, Review; `Organization`, `WebSite`, `WebPage` |
| `/platform` | “Business operating platform / operations management software” | Explain the whole system; **See how GOLD works** | Product thesis → shared customer/work/timeline → modules → configuration → automation/AI boundaries → security → implementation → CTA | Real UI and domain concepts; published structured sections | Solutions, Review, Sign in; `Product` only once a visible, purchasable product description is accurate |
| `/solutions` | “Connect sales, operations, service, automation” | Route visitors by problem; **Choose a workflow** | Problem chooser → Sales → Operations → Customer service → Automation/AI → partial adoption → CTA | Capability-backed examples; no invented vertical claims | Platform and focused solution anchors/pages when each has enough unique evidence; `Service` where visible |
| `/demo` | “Show me GOLD on my business” | Capture a qualified request; **Request a demo** | Expectations → compact form → privacy-purpose notice → what happens next | Existing customer/event write; published form definition | Platform/Solutions; `WebPage` (not `FAQPage`) |
| `/about` | “Who operates GOLD and can I trust them?” | Establish accountability; **Contact GOLD** | Company identity → approach → responsible operator/contact → trust → CTA | Canonical GOLD organization profile and verified team/company facts | Legal, Platform; `AboutPage`, `Organization` |
| `/contact` | General or support contact | Route enquiry; **Send enquiry** | Contact choices → narrow form → existing-customer sign-in | Organization contact records and purpose-specific form | Review, Sign in, Legal; `ContactPage` |
| `/legal/[type]` | Understand governing terms/privacy | Read current policy; acceptance only when required | Document title/effective date → counsel-approved body → version/supersession → contact | Published platform legal-document version | Footer and forms; `WebPage` |
| `/login`, `/sign-up` | Enter or establish the one identity | Authenticate | One task per page | Supabase Auth | `noindex`; links home and between credential states |

Later, add `/industries/[slug]` only when a real customer/use case supplies distinct language and
proof; `/resources/[slug]` only with an editorial owner and article pipeline; `/pricing` only when
published catalogue terms match how GOLD actually sells. Integrations belong as proof within the
platform page before they earn a directory.

## Public content and publishing model

Canonical records remain canonical. A website references them and may choose what to show; it does
not copy them into a “website service” or “website location.”

```text
canonical organization data                 website presentation
organizations / organization_profiles  ─┐   public_sites (org, default locale, mode)
brand_settings + public media assets    ─┼─► public_site_revisions (draft/review/published)
locations / operating_hours             ─┤   public_pages (stable identity + slug)
work_item_types as service capability   ─┤   public_page_revisions (SEO + ordered sections)
price_book_items as public offer input  ─┘   section references canonical record ids

platform-owned configuration
platform_settings: GOLD site owner and lead target
public_domains: hostname verification, primary/redirect and certificate state
provider adapters: DNS/hosting/registrar implementations and secrets
```

The minimum section vocabulary should be typed and validated: hero, rich text, feature list,
canonical-service list, canonical-offer list, testimonial list, FAQ list, trust, form, and CTA.
Each section has an explicit schema and renderer. There is no arbitrary component name or freeform
HTML/JSON page builder. Add a new section kind only with a renderer and editor in the same change.

Revision state is `draft | in_review | published | archived`. A revision records author,
created/updated time, reviewer where used, published time, locale, and a monotonic revision number.
Publishing atomically points the site/page at an immutable revision; editing a published revision
creates a draft. AI can create/update drafts and can never invoke publish. Preview requires an
unforgeable, expiring, site-and-revision-bound token and must return `noindex, nofollow`.

Public reads go through narrow functions/views returning published fields only. Anonymous callers
never receive a tenant-wide table grant. Publish invalidates the page/domain cache; drafts never do.

Media needs a new `media_assets` concept because operational `assets` already has a different,
load-bearing meaning. Postgres owns organization, object key, kind/MIME, title, alt text, dimensions,
tags, source, rights/license note, created by/at, archived state, and public/private visibility.
Storage owns bytes. Public renderers accept only public media records. Google Drive is an import
adapter: copy stable public-site media and counsel-approved documents into GOLD; retain Drive ids
and checksums as provenance; synchronize only by an explicit reviewed import. The live site never
depends on Drive availability or authorization.

## Authentication and context routing

```text
public visitor
  ├─ marketing/form ─► remains public; narrow attributed write only
  └─ sign in on host H ─► authenticate one identity ─► resolve H and intended safe path
                                      │
                                      ├─ tenant host + membership ─► that Organization Context
                                      ├─ one organization ─────────► that Organization Context
                                      ├─ many organizations ───────► the one last worked in, else the first
                                      ├─ platform only ────────────► Platform Context
                                      └─ none ─────────────────────► onboarding

same identity = platform_staff fact + zero/many organization memberships
```

Membership in GOLD's organization never implies platform authority; the existing independent
`platform_staff` check and membership list are correct. A custom-domain login must preserve its
host so cookies and OAuth callbacks return to the initiating host, then verify that the account may
enter the resolved organization. Intended destinations must be relative, normalized application
paths from an allowlist/closed resolver—never caller-supplied absolute URLs. Invitations remain a
narrower, token-specific context.

## Tenant website and domain architecture

Four explicit modes share the same organization and operations domain:

- **Hosted:** hostname → verified `public_domains` row → organization/site → locale → published
  page revision → shared renderer. GOLD subdomain and custom domain are the same mode.
- **External + GOLD:** the external site remains presentation; narrow server endpoints/embeds create
  bookings, enquiries, and portal sessions. Origin allowlists, signed embed configuration, rate
  limiting, and server validation are per site.
- **Headless:** a versioned, cacheable public-content API returns only published projections. It
  exposes no canonical private table and accepts no generalized writes.
- **Migration:** inventory URLs/assets/metadata, map canonical records and redirects, preview,
  validate analytics and search signals, then cut DNS. Redirects are durable site data.

`public_domains` should lead every uniqueness rule with normalized hostname globally unique across
active claims. It records organization/site, kind (`platform | gold_subdomain | custom`), requested,
verification and certificate states, verification token/method, primary flag, redirect target,
created/verified timestamps, and platform actor. A tenant may request a domain; only the platform
can mark verification/certificate facts. Resolution accepts a normalized Host value, never a tenant
id header or query parameter, and returns only an active mapping. Unknown hosts fail closed.

No customer gets a repository, Supabase project, or Vercel application merely for a domain.

For acquisition, do not pick a registrar yet. Current official material shows three materially
different shapes: OpenSRS is reseller-first with API/storefront operations; GoDaddy offers an API
reseller agreement; Namecheap exposes availability/registration/DNS APIs; Cloudflare's Registrar
API now exposes search/check/register but is beta and account-centric. Evaluate ownership model,
`.ca` support, registrant portability, renewal/support burden, DNS API, reseller economics, and
white-label obligations with counsel and operations before selecting. Start with referral/outbound
registration so the customer owns the account; a reseller integration becomes justified by volume.

## Public forms, analytics, and attribution

The public intake path (`submit_public_inquiry`, serving `/demo` and `/contact`) is already correctly narrow: it accepts no organization id, creates one
ordinary customer plus an event in the deployment-configured GOLD organization, leaves no external
binding, and signs out. Extend it with server-enforced size validation, rate limiting/bot mitigation,
purpose/retention notice, and attribution fields. Contact, demo, and consultation remain distinct
operations even if they resolve to the same customer entity; each records its purpose and event.

Capture first landing page, referrer, UTM source/medium/campaign/content/term, form kind, locale, and
consent evidence once, then attach the immutable acquisition snapshot to the customer/event. Record
page views and CTA/form funnel events with a privacy-minimal first-party tool. No cross-site ad
tracking at launch. Load optional analytics only after the applicable consent decision, and retain
the policy/version behind that decision.

## SEO, locale, and performance plan

- Configure one canonical production origin; never derive canonical URLs from an untrusted Host.
- Give every indexable page unique title, description, canonical, Open Graph fields, one H1, and
  crawlable contextual links. Keep auth, portal, confirmations, previews, and invitation tokens out
  of indexes and sitemaps.
- Generate robots and per-primary-domain sitemaps from published pages. Redirect alternate domains
  to the primary before rendering. Return real 404/410 statuses for absent/retired material.
- Emit `Organization`, `WebSite`, `WebPage`, breadcrumbs, services/offers, and FAQs only from visible
  published facts. Never manufacture ratings, customers, prices, or FAQ markup hidden from readers.
- Start locale routing as `/en/...` and `/fr/...` when the first complete French page set is ready.
  Until then keep `lang="en"` and do not emit false alternates. Once enabled, each locale gets a
  self-canonical plus reciprocal `hreflang` and `x-default`; localized slugs require a durable
  cross-locale page identity and redirect history.
- Prefer server components/static output; isolate interaction into client islands. Revalidate on
  publish. Public pages should target LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 at the 75th percentile, no
  horizontal overflow at 320px, and no public-route bundle growth without measurement.
- Keep keyboard/focus behavior, 44px practical touch targets, reduced motion, semantic landmarks,
  labelled forms, useful alt text, and WCAG 2.2 AA contrast as release gates.

## Legal document architecture and current research

This is an implementation inventory, not legal advice. Counsel must determine applicability and
approve wording before publication.

**Sourced requirements/guidance.** Canada's privacy regulator describes accountability, identified
purposes, consent, collection/use/retention limits, safeguards, openness, access, and challenge as
PIPEDA's fair-information principles. Quebec's privacy regulator says organizations collecting
personal information technologically must publish a clear privacy policy, use purpose-specific
plain consent, use privacy-protective defaults, perform privacy impact assessments for relevant
information-system projects and before communicating personal information outside Quebec. The CRTC
requires consent, sender identification, and unsubscribe for commercial email/SMS under CASL, with
evidence of consent; telemarketing has separate DNCL/ADAD rules. The federal privacy regulator says
recorded callers should be told recording purpose and asked for consent, with an alternative where
appropriate. US expansion adds state-specific privacy/recording/subscription analysis plus federal
FTC data-security/deception and FCC robocall/robotext rules; do not launch one generic “US-compliant”
policy without that scoped review.

Primary sources reviewed 2026-09-12:

- Office of the Privacy Commissioner of Canada, [PIPEDA and fair information principles](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/)
- Commission d'accès à l'information du Québec, [Loi 25: principaux changements](https://www.cai.gouv.qc.ca/protection-renseignements-personnels/sujets-et-domaines-dinteret/principaux-changements-loi-25)
- CRTC, [CASL guidance](https://crtc.gc.ca/eng/com500/guide.htm) and [telemarketing obligations](https://crtc.gc.ca/eng/phone/telemarketing/tobligations.htm)
- Office of the Privacy Commissioner of Canada, [recording customer telephone calls](https://www.priv.gc.ca/en/privacy-topics/surveillance/02_05_d_14/)
- FTC, [data security guidance](https://www.ftc.gov/business-guidance/privacy-security/data-security)
- FCC, [consumer guide to robocalls/robotexts](https://docs.fcc.gov/public/attachments/DOC-408396A1.pdf)

**Platform documents:** Privacy Policy, Terms of Service, Cookie/Tracking Policy, Acceptable Use
Policy, Data Processing Addendum, Subprocessor List, Security/Data Handling statement, support and
service terms, cancellation/refund terms, and feature-specific SMS/call-recording/AI disclosures.
**Tenant documents:** each tenant's privacy/cookie notices, service terms, cancellation/refund
policies, and consent language. A Pneu3L policy never becomes GOLD SaaS terms.

Store a stable legal-document identity plus immutable versions: owner scope (`platform` or
organization), type, jurisdiction, locale, status, effective date, body/document media reference,
author/reviewer, published/superseded timestamps. Acceptance records snapshot user/external actor,
document version, time, context, IP/user-agent only where justified, and the affirmative action.
Imported counsel documents enter draft/review. AI output is visibly marked as a draft and cannot
publish.

## Implementation gap matrix

| Classification | Requirements |
|---|---|
| **ALREADY GOOD** | One identity; independent platform/membership facts; RLS tenant boundary; profile/brand projection; narrow public-intake write; booking/portal domain reuse; typed immutable homepage revisions; preview/publish; narrow anonymous projection; responsive shared controls |
| **REFACTOR** | Auth intended-context routing and public header/footer information architecture |
| **CONNECT EXISTING** | Work types as service capability; price book as offer input; locations/hours; documents; customer events and stages; commercial catalogue where public terms are explicitly approved |
| **CONFIGURE** | Production canonical origin; public-intake target (`platform_settings`); deployment domain; analytics/consent provider; support/privacy contacts |
| **BUILD** | Media library; hostname mapping; legal versions/acceptance; attribution; abuse controls; French routing/content |
| **RESEARCH** | Counsel-reviewed Quebec/Canada/US scope; accessibility obligations by market; subprocessors/transfers; registrar/reseller economics and `.ca` requirements; analytics consent choice |
| **DEFER** | Arbitrary drag-and-drop builder; domain registration/reselling; full external SDK; articles/industry directory without content owners; multi-template marketplace; translation automation |
| **REMOVE** | Provider-technology marquee as marketing proof; duplicate/route-inappropriate auth CTA; any future dead footer link or invented proof |

## Recommended sequence

The SEO/canonical/noindex foundation and the structured publishing slice are built. The homepage
now reads one tagged published projection, uses GOLD's canonical organization profile/brand, and
shares its typed renderer with a manager-only preview; only publish invalidates that projection.
M16 next adds governed media and legal versions, then hostname/domain mapping and tenant
distribution. External embeds/headless reads must follow the same published projection rather
than inventing another source.

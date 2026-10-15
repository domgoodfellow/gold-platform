# GildOps Testing & Verification

## Purpose

### Imported connector checks

`node-contract` runs `apps/api/library/runtime.test.mjs` in the fast tier and is included by `pnpm test:contract`. The API package's `check` runs metadata drift checks and these runtime tests. They verify signed request integrity, expiry, reviewed reads, connector matching, input refusal and secret redaction without contacting a vendor.

`test_resource_sync.py` checks provider paging, deletion markers, stable keys and Graph cursor egress offline. `integration-library-sync.test.ts` checks live local Postgres tenant isolation, machine-only admission, synchronization leases and snapshot reconciliation. These checks do not prove a live OAuth flow, source synchronization, accounting connection or deployment configuration. Authorized vendor sandbox accounts are required for that acceptance evidence.

This document defines the **canonical testing and verification strategy for GildOps**.

It answers:

- Which kinds of tests exist?
- What does each test type prove?
- Which runner and environment does each category use?
- How are tests classified and invoked?
- What belongs in CI?
- When is browser or visual verification required?
- How should security, database, provider and AI behavior be verified?
- What evidence is required before work is called complete?

Testing asks:

> Does this behavior satisfy an expected condition?

Verification asks the broader question:

> Do we have sufficient evidence that the implemented change satisfies the requirement in the real system?

Passing tests are evidence.

They are not automatically proof of correctness.

---

## Source of truth

The machine-readable classification source is:

```text
test-manifest.json
```

It owns:

- test categories;
- runner;
- required environment;
- gate status;
- tier membership;
- classification of each test file.

The test launcher is:

```text
scripts/test.mjs
```

It reads the manifest and invokes the correct runner.

Do not maintain a second hard-coded list of test files in another script.

When a test file is added, moved or reclassified, update `test-manifest.json`.

---

## Testing principles

### Managed-service acceptance

`apps/web/e2e/service-engagements.spec.ts` creates its own local accounts and tenant fixtures through the isolated `playwright.batch-a.config.ts`, without the normal demo global setup. It refuses non-loopback database/API URLs. Run `pnpm --filter @gold/web exec playwright test --config playwright.batch-a.config.ts` against the local web server; `E2E_BASE_URL` selects its address. The journey covers verified tenant-manager linking, accepted-proposal handoff/retry, Website/AI/Automation references, foreign artifact refusal, historical lifecycle and desktop/tablet/phone keyboard/touch behavior. Configuration status is not evidence of a live AI/provider deployment.

Baseline reconciliation keeps the assertions authoritative: capability mapping includes native adapters and reviewed imported-library metadata; machine grants name the existing sync/library functions explicitly; planned-connector refusal uses a genuinely planned fixture. Provider and Connector may share a vendor key while their foreign keys remain attached to their separate canonical authorities. Palette checks cover grouped public/root selectors and forced appearance scopes without changing theme colors.

### 1. Test behavior, not implementation trivia

Prefer assertions about observable behavior and durable contracts.

Good:

```text
unauthorized member cannot update billing
```

Weak:

```text
helper X was called exactly once
```

unless that call itself is the contract being tested.

---

### 2. Use the lowest reliable test level

Use the cheapest test that can actually prove the requirement.

Examples:

```text
pure calculation
→ unit test

React interaction
→ component test

RLS isolation
→ real database integration test

route/navigation/browser behavior
→ Playwright

provider protocol translation
→ offline contract test

actual provider sandbox behavior
→ provider-contract test
```

Do not use a browser test to prove a pure function.

Do not use a mock to prove real database authorization.

---

### 3. Do not mock the thing being proven

If the requirement is:

> PostgreSQL prevents tenant leakage.

then a mocked database test does not prove it.

If the requirement is:

> Twilio signature verification rejects tampered requests.

then replacing the signature verifier with a stub does not prove it.

Mocks are appropriate around dependencies outside the behavior under test.

---

### 4. Test negative behavior

Security and integrity are not proven by successful paths alone.

For protected behavior, test relevant refusal cases such as:

- wrong Organization;
- missing Membership;
- insufficient capability;
- missing entitlement;
- anonymous actor;
- malformed input;
- duplicate request;
- stale/revoked credential;
- invalid lifecycle transition;
- provider signature failure.

A system is not secure because the intended user can use it.

It is secure only if unintended actors cannot.

---

### 5. Test the invariant directly

If the invariant is:

> One Work Item cannot reserve the same Resource in overlapping time.

test the database/scheduling invariant directly.

Do not only test that the UI hides an unavailable time.

---

### 6. Verification depth follows risk

Increase verification depth with:

- security impact;
- data impact;
- money;
- shared infrastructure;
- migration risk;
- cross-runtime behavior;
- provider interaction;
- blast radius;
- difficulty of rollback.

A label change and a billing migration do not require the same evidence.

---

### 7. Tests should be deterministic

Control unnecessary nondeterminism.

Avoid failures caused by:

- uncontrolled time;
- randomness;
- test ordering;
- arbitrary sleeps;
- live provider latency in ordinary tests;
- shared mutable fixtures.

Where time or randomness matters, inject or control it.

---

### 8. A green build is not UI verification

Type checking, linting and unit tests do not prove:

- visual hierarchy;
- spacing;
- responsive behavior;
- focus;
- browser APIs;
- drawer/sheet geometry;
- clipping/overflow.

User-visible work requires rendered verification appropriate to its risk.

---

## Test taxonomy

### Unit

Category:

```text
unit
python-unit
```

Purpose:

> Verify deterministic behavior in isolation.

Good candidates:

- calculations;
- parsers;
- normalization;
- state transitions;
- domain helpers;
- permission projection;
- scheduling calculations;
- format validation.

Runners:

- Vitest for TypeScript;
- pytest for Python.

External database/provider dependencies should not be required.

---

### Component

Category:

```text
component
python-component
```

Purpose:

> Verify one coherent component/handler/use-case with outer boundaries controlled.

Frontend examples:

- forms;
- keyboard behavior;
- builder interactions;
- view switching;
- validation presentation.

Python examples:

- handler sequencing;
- command behavior;
- provider-operation orchestration with the network/database boundary replaced.

A component test is not a database integration test merely because the product concept is called an “integration.”

---

### Static architecture

Category:

```text
architecture-static
```

Purpose:

> Enforce source, dependency and structural contracts without a database.

Examples:

- forbidden import direction;
- provider SDK absent from domain code;
- one canonical registry;
- public route does not import operator shell;
- source-control boundary;
- AI runtime boundary.

Architecture tests are appropriate for rules that otherwise regress silently during refactors.

Do not encode arbitrary style preferences as architecture tests.

---

### Database architecture

Category:

```text
architecture-db
```

Purpose:

> Ask the real local PostgreSQL schema whether structural/security guarantees exist.

Examples:

- required functions exist;
- grants are narrow;
- privileged functions are not executable by `PUBLIC`;
- RLS/role shape;
- schema conformance.

Requires a real local Supabase/Postgres stack.

---

### Database integration

Category:

```text
database-integration
```

Purpose:

> Verify domain/application behavior against real Supabase Auth, PostgreSQL and RLS.

Use this category for requirements involving:

- tenant isolation;
- roles/capabilities;
- transactions;
- constraints;
- scheduling concurrency;
- authoritative domain functions;
- commercial ledgers;
- public/anonymous database doors.

Do not mock RLS when RLS is what you need to prove.

---

### Offline contract

Categories:

```text
offline-contract
python-contract
```

Purpose:

> Verify the protocol shape GildOps depends on without making a live vendor call.

Examples:

- HTTP request shape;
- webhook signature algorithm;
- provider response parsing;
- RPC contract;
- OAuth payload shape;
- adapter error normalization.

The external transport is controlled/replaced.

The translation logic under test is real.

---

### Browser acceptance / E2E

Category:

```text
playwright-acceptance
```

Purpose:

> Verify integrated user journeys in an actual browser against a running app and seeded local stack.

Examples:

```text
sign in
↓
navigate
↓
perform task
↓
database-backed result appears
```

Use E2E strategically for behavior that depends on:

- routing;
- browser rendering;
- authentication continuity;
- responsive shell;
- cross-page journeys;
- real server/database composition.

Do not reproduce every unit or database test in Playwright.

---

### Smoke

Category:

```text
playwright-smoke
```

Purpose:

> Verify that a running deployment is alive enough to serve real users.

Current smoke proves:

1. the application answers;
2. the login surface renders;
3. a real session can be established;
4. the authenticated shell loads.

Smoke is intentionally broad and shallow.

It is not acceptance coverage.

---

### Visual regression

Category:

```text
playwright-visual
```

Purpose:

> Detect unintended visual change in a deliberately small set of representative canonical surfaces.

Current baselines cover representative patterns such as:

- Workspace Home;
- collection/board;
- Organization Settings;
- authenticated state/not-found;
- record/detail;
- Platform control plane;

at:

```text
1440×900
1024×800
390×844
```

Visual regression is **not** a default correctness gate.

A changed baseline requires human review because design intent may legitimately change.

Do not snapshot every current page and thereby canonize every inconsistency.

---

### Provider contract

Category:

```text
provider-contract
```

Purpose:

> Verify behavior against a real provider sandbox or test account.

Requires sandbox credentials.

This tier is not part of ordinary CI.

As of the current repository contract, the tier exists but no vendor-sandbox tests are classified under it.

Running:

```bash
pnpm test:provider
```

therefore reports that no provider was verified.

Do not treat an empty provider tier as provider verification.

---

## Test tiers

The canonical tiers are:

```text
fast
local
e2e
smoke
visual
provider
```

---

### Fast tier

Command:

```bash
pnpm test:fast
```

Includes:

- TypeScript unit;
- TypeScript component;
- static architecture;
- offline TypeScript contracts;
- Python unit;
- Python component;
- Python contracts.

Requires no local database.

The broader fast repository gate is:

```bash
pnpm check:fast
```

which currently performs:

```text
web typecheck
↓
web lint
↓
fast test tier
↓
web production build
```

---

### Local tier

Command:

```bash
pnpm test:local
```

Includes:

- database architecture;
- database integration.

Requires local Supabase/PostgreSQL.

The local stack provides real:

- Auth;
- Postgres;
- RLS;
- RPCs;
- constraints.

---

### Full default repository check

Command:

```bash
pnpm check
```

This runs package checks plus the API test check.

Use it before completion when the change has meaningful repository-wide blast radius.

Do not assume `pnpm check` includes Playwright E2E, smoke, visual or live provider testing.

It does not.

---

### E2E tier

Command:

```bash
pnpm test:e2e
```

Requires:

- local Supabase running;
- migrations/seed/demo prepared;
- web app running;
- Playwright Chromium installed.

The standard local setup is described in `docs/development.md`.

---

### Smoke tier

Command:

```bash
pnpm test:smoke
```

Against localhost, the suite may use the demo account.

For local verification with an existing hosted account, fill `SMOKE_EMAIL` and
`SMOKE_PASSWORD` in the ignored `apps/web/.env.local`. The smoke configuration
loads that file quietly without overriding existing process variables. These
credentials are optional verification inputs, never browser-public variables or
deployment configuration. Smoke traces are disabled to avoid capturing real
credentials during sign-in. Do not print credential values or save authenticated
browser state as a repository artifact.

Keep each credential variable exactly once in the file: a later blank duplicate
overrides an earlier populated value when the file is parsed.

Against a deployment, provide:

```text
SMOKE_BASE_URL
SMOKE_EMAIL
SMOKE_PASSWORD
```

A deployment smoke URL must be HTTPS and must not be localhost.

Smoke should remain non-destructive.

---

### Visual tier

Command:

```bash
pnpm test:visual
```

Requires the same local running-app/demo prerequisites as acceptance tests.

Use visual tests to review canonical patterns, not to replace direct visual inspection.

---

### Provider tier

Command:

```bash
pnpm test:provider
```

Requires provider-specific sandbox credentials for any test that actually exists.

Never run provider tests with live production customer credentials as part of ordinary development.

---

## Runner commands

Useful focused commands:

```bash
pnpm test:unit
pnpm test:component
pnpm test:architecture
pnpm test:architecture:db
pnpm test:db
pnpm test:contract
pnpm test:api
```

Web package commands:

```bash
pnpm --filter @gold/web typecheck
pnpm --filter @gold/web lint
pnpm --filter @gold/web build
pnpm --filter @gold/web test
```

Python API tests:

```bash
python -m pytest apps/api/tests -q
```

The exact scripts in `package.json`, `apps/web/package.json`, and `scripts/test.mjs` remain executable authority.

This document explains how to choose them.

---

## CI contract

Current CI separates verification by dependency cost.

### Pull request / push to `main`

Runs:

#### `fast`

- install;
- Python test dependencies;
- typecheck;
- lint;
- fast test tier;
- production web build.

#### `local`

- start local Supabase;
- expose local test environment;
- run real database architecture/integration tier.

These two jobs are the ordinary merge gate.

---

### Scheduled / manual E2E

The E2E workflow:

- starts local Supabase;
- seeds/demo-prepares it;
- starts the web app;
- installs Playwright Chromium;
- runs acceptance;
- runs smoke;
- uploads traces/logs on failure.

E2E is slower and therefore not part of the ordinary fast PR gate.

---

### Manual deployment smoke

Manual smoke accepts an explicit deployment URL and smoke account.

It starts no local application and verifies the actual deployment.

---

### Provider sandbox

No provider-sandbox CI job should be enabled until:

- at least one real provider-contract test exists;
- sandbox credentials are safely configured;
- the test has a clear non-production contract.

---

## Test data

Test data is part of the verification.

Fixtures should exercise relevant:

- nullability;
- relationships;
- tenant isolation;
- role differences;
- lifecycle states;
- edge values;
- cross-domain composition.

Do not use only the easiest “owner with everything configured” fixture for authorization work.

---

## Demo data

The demo dataset supports browser journeys and manual exploration.

It is not the canonical domain specification.

A feature that only works for the current demo shape is incomplete.

E2E global setup may add small browser-specific fixtures beyond the core demo where the acceptance suite needs them.

Do not silently grow demo setup into hidden production configuration.

---

## Security verification

Security tests require both positive and negative evidence.

For a protected capability, consider:

```text
authorized actor succeeds
unauthorized actor fails
other tenant fails
anonymous actor fails
state remains unchanged after refusal
```

When the security property is database-enforced, use real database tests.

---

## Database verification

For schema/migration work, verify as applicable:

1. fresh local migration/reset succeeds;
2. schema matches intended structure;
3. generated database types are current;
4. RLS/grants are correct;
5. invalid direct database state is refused;
6. intended domain operation succeeds;
7. cross-tenant access is refused;
8. historical behavior remains stable.

Do not declare a database invariant verified based only on TypeScript mocks.

---

## Provider verification

Provider behavior has three distinct levels.

### Offline contract

Proves the contract GildOps believes the provider uses.

No network.

### Sandbox/live-provider contract

Proves the real test provider currently behaves that way.

Network + sandbox credentials.

### Production smoke/observation

Proves the deployed production path is operating.

Use narrow non-destructive checks.

Do not confuse these levels.

---

## AI verification

The tenant AI workspace has database integration coverage in `ai-workspace.test.ts` for command authorization, cross-Organization denial, immutable versions, stale draft conflicts, deployment version/site validation, unsupported runtime activation, personal evaluations, public knowledge and anonymous-to-staff website handoff. Python loop tests verify request-local tool allowlists; RPC contract checks cover both the source payloads and local Postgres grants/parameters. `e2e/ai-workspace.spec.ts` exercises draft creation, publishing, editing, recovery after reload/back navigation, channel configuration, destinations, empty states and responsive UI with the seeded local demo context. A separate journey uses a real published tenant website, temporary local entitlement/domain fixtures and Communications claim/reply/resolve to verify visitor-visible staff follow-up. Fixture mutations refuse non-loopback databases and restore platform domain/temporary entitlement on completion. Inspected screenshots and the scoped visual comparison are in `docs/design/ai/design-qa.md`. Browser evidence does not establish live model, carrier or external-message operation; those require configured sandbox runtime credentials and a controlled channel test. Never record human-reviewed preview verdicts as automated quality scores.

Probabilistic systems require several kinds of evidence.

Use deterministic tests for:

- tool schema;
- authorization;
- structured-output validation;
- provider selection;
- intended-action workflow;
- usage accounting.

Use evaluation sets for model-dependent qualities such as:

- extraction accuracy;
- classification;
- response relevance;
- tool-selection behavior.

AI outputs must still pass deterministic domain/security boundaries.

A “good-looking answer” is not sufficient verification of a tool-enabled action.

---

## UI verification

For meaningful UI work, verify rendered behavior.

At minimum, inspect relevant:

- desktop layout;
- phone layout;
- intermediate/tablet layout when composition changes;
- loading;
- empty;
- error;
- permission/locked state;
- drawer/sheet/dialog behavior;
- focus/keyboard behavior.

See `docs/ui-system.md`.

---

## Accessibility verification

Automated accessibility checks help detect:

- missing labels;
- invalid semantics;
- certain contrast/ARIA problems.

They do not prove:

- sensible keyboard order;
- understandable focus movement;
- meaningful screen-reader content;
- task usability.

Interactive surfaces require manual/browser inspection where those behaviors matter.

---

## Regression tests

When fixing a defect with meaningful recurrence risk:

```text
reproduce
↓
add failing regression test at the correct layer
↓
fix
↓
prove test passes
```

Do not preserve tests for behavior that the product has intentionally removed.

Obsolete tests are documentation bugs.

---

## Flakiness

A flaky test damages confidence in the whole suite.

Do not normalize flaky reruns as success.

Investigate:

- timing;
- shared state;
- unbounded polling;
- provider/network dependency;
- ordering;
- animation;
- race conditions;
- environment contamination.

Retries may be useful in provider/production contexts, but they must not hide deterministic defects.

---

## Coverage

Code coverage is a signal, not a correctness score.

Do not optimize for percentage alone.

Prioritize coverage of:

- domain invariants;
- security boundaries;
- money;
- scheduling;
- migrations;
- provider translations;
- known failure modes;
- high-fan-out shared UI/architecture.

---

## Performance testing

Performance verification should be introduced where user/system risk justifies it.

Examples:

- large collections;
- scheduling queries;
- heavy report aggregates;
- provider fan-out;
- AI throughput;
- import volume;
- public traffic.

Possible methods:

- benchmark;
- load;
- stress;
- soak;
- query-plan analysis.

Do not manufacture arbitrary performance targets without product/operational requirements.

---

## Verification by change type

### Pure domain helper

Typical evidence:

```text
unit test
+
relevant typecheck
```

### Shared React component

Typical evidence:

```text
component test
+
browser inspection
+
broader visual/navigation regression if high fan-out
```

### Database/RLS change

Typical evidence:

```text
fresh migration/reset
+
database architecture/integration tests
+
generated types
+
negative tenant/security cases
```

### API/provider adapter

Typical evidence:

```text
unit/component
+
offline contract
+
provider sandbox when the real vendor contract itself changed
```

### Auth/security change

Typical evidence:

```text
unit/component
+
real DB/RLS where relevant
+
browser journey
+
negative cases
```

### UI layout/navigation change

Typical evidence:

```text
component/static tests where useful
+
Playwright/browser behavior
+
rendered desktop/tablet/phone inspection
+
visual regression when canonical pattern changes
```

### Deployment/infrastructure change

Typical evidence:

```text
CI
+
deployment
+
smoke
+
runtime observation
+
rollback/rollforward plan
```

---

## Completion evidence

A completion report must separate:

### Implemented

What changed.

### Verified

Exactly what commands or runtime checks were performed.

### Not verified

Anything that could not be executed or inspected.

### Remaining risk

Known limitations relevant to the change.

Do not write:

> Everything verified.

unless every relevant claim actually has evidence.

---

## Verification matrix

For substantial work, map requirements to evidence.

Example:

| Requirement | Evidence |
| --- | --- |
| Member can create customer | domain/database + browser journey |
| Other tenant cannot read customer | database integration negative case |
| Phone layout does not clip controls | rendered phone browser inspection |
| Webhook rejects tampered signature | offline contract test |
| Deployment can sign in | deployed smoke test |

This exposes gaps before completion.

---

## Test-maintenance rules

- test names describe behavior;
- helpers remove mechanical setup, not scenario meaning;
- fixtures remain understandable;
- one behavior may be asserted at several layers only when each layer proves something different;
- do not snapshot huge unstable objects without a reason;
- do not test private implementation details that may change safely;
- keep test environment isolated from production;
- remove stale tests when the requirement is gone;
- keep `test-manifest.json` synchronized.

---

## Testing anti-patterns

Do not:

- mock the database to prove RLS;
- use browser tests for every pure function;
- claim a build proves runtime behavior;
- treat hidden UI as authorization;
- call a test “integration” because the product feature is an integration;
- run live vendor calls in the default gate;
- update visual snapshots blindly;
- use sleeps instead of observable conditions;
- let test order determine success;
- skip negative security cases;
- treat provider-tier success with zero tests as vendor verification;
- claim UI correctness without rendered inspection.

---

## Definition of verified

A change is **verified** when:

1. its requirements are explicit;
2. each material requirement has appropriate evidence;
3. security/integrity negative cases are tested where relevant;
4. real dependencies are exercised where mocks cannot prove the contract;
5. user-visible behavior is rendered/inspected where appropriate;
6. broader regression is proportional to blast radius;
7. unverified areas are stated plainly.

The goal is not maximum test count.

The goal is **credible evidence**.

Configuration coverage includes real-database tests for a proposal forged into another organization
owned by the same actor, concurrent Apply claims, frozen applying documents, malformed nested shape
data, unavailable feature preflight, feature enablement without an existing override, and Plan-only
booking readiness across disable/re-enable/direct RPC launch. Existing identity, invitation, role,
last-manager, provider, plan and Sales handoff suites exercise the retained owners.

`e2e/configuration-onboarding.spec.ts` uses staff provisioning and the signed-in demo owner's session
against loopback Supabase only. Its explicitly labeled local review fixture is edited, saved, applied
and launched through the browser; canonical Work and Organization records verify the result. The
suite captures Settings, setup, proposal and role drawer surfaces at 1440, 768 and 390 pixels and
checks reduced-role controls, search and horizontal containment. Screenshots require rendered visual
inspection in addition to test assertions. Real external OAuth/payment/AI calls remain outside this suite.
Account captures use the personal Settings routes, explicitly reject 404s, and assert profile/password
fields; the invitation capture waits for the newly created invitation to render.

## Global Home verification

The development design gallery has a separate no-fixture browser tier: start the web dev
server and run `pnpm test:design` (optional `E2E_BASE_URL`). `playwright.design.config.ts` runs
the manifest-classified `e2e/design` tests at 1440, 768 and 390 pixels. It checks all six
preset/scheme scopes, selection, disabled/loading/errors, keyboard tabs, modal focus
restoration, filter/menu portals, real-browser axe including contrast, overflow and reduced
motion. Captures go to ignored Playwright test results and require visual inspection. These
tests are excluded from the seeded acceptance config and cannot run against a production
gallery, which is unavailable. Unit/component checks cover closed token admission, precedence,
legacy defaults and label/error relationships. No database integration is required for these
typed, non-persisted contracts; Slice B must add it with preference storage and publication.

Global Home verification combines `home-projection.test.ts` for local date/DST, normalization, exact-count evidence and deterministic identity/priority semantics; `home-dashboard.test.ts` for canonical local records, exact counts beyond previews, scheduling exceptions, currency separation, actor scope, private Agent approval/failure metadata, restricted RPC access and real source-failure isolation; and `global-home.spec.ts` for owning creation workflows, filters, persistent browser preferences, Agent rail, narrow-container containment and the 16 requested captures. Fixtures require loopback Supabase, use canonical provisioning and domain commands, and simulate carrier ingress only in the local database. Screenshot inspection is required in addition to passing browser assertions. Hosted migrations and live voice, payment and AI providers are outside these local checks.

### Batch C managed-service verification

`service-disclosures.test.ts` exercises real PostgreSQL ownership/RLS, default privacy, closed
draft/Portal validators, attributable immutable releases, stale and concurrent edits/publication,
independent tenant artifact authority, wrong-customer/organization refusal, ended relationships,
unchanged lifecycle copy, module publication/removal, activation/entitlement, session expiry and
invitation revocation. `service-disclosure-editor.test.tsx` covers draft/published preview, explicit confirmation,
read-only controls, lifecycle review and shared List/Cards/Summary presentations with safe text.

The isolated `playwright.batch-c.config.ts` runs `e2e/service-disclosures.spec.ts` against loopback
Supabase and an explicitly loopback-configured app, without demo global setup. Run
`pnpm --filter @gold/web exec playwright test --config playwright.batch-c.config.ts` with
`E2E_BASE_URL` selecting the app. Separate browser contexts exercise seller approval, different
customer and tenant Portal identities, draft isolation, withdrawal, direct RPC denial and Portal
module removal. It captures engagement and Portal surfaces at 1440, 1024 and 390 pixels and checks
keyboard focus return, phone touch gestures and overflow. Inspect screenshots separately; assertions alone are not visual
evidence. Batch A/B and existing publication/payment/hostname regressions remain required. No hosted
migration, provider DNS/TLS, private tenant operation or production delivery is proved by local tests.

Batch C hostname acceptance uses the same loopback TLS fixture described below, with
`E2E_PORTAL_TLS_URL` selecting its listener. Seller and receiving-tenant Portal hostnames, invitations
and browser cookie stores remain independent; a seller context is refused on the tenant hostname.
Run the hostname acceptance against a locally configured production build to verify Secure cookies.

### Batch B Portal verification

Custom-host browser verification uses a disposable loopback HTTPS reverse proxy so production
`Secure` Portal cookies remain enabled. Start a loopback-configured app, then run
`node apps/web/e2e/portal-tls-fixture.mjs` in a second terminal with OpenSSL available.
`E2E_BASE_URL` selects the upstream (default `http://localhost:3140`),
`E2E_PORTAL_TLS_URL` selects the local TLS listener (default `https://localhost:3141`).
`E2E_OPENSSL` and `E2E_OPENSSL_CONFIG` may identify a Windows executable/configuration.
The helper generates a two-day test certificate under ignored `.artifacts/portal-tls`, binds
only loopback, and forwards the actual Host and HTTPS protocol. The isolated Playwright config
maps `*.example.test` to loopback and accepts that test certificate. This is application-origin
evidence, not provider DNS/TLS provisioning. Never use a hosted database for this fixture.

`portal-composition.test.ts` exercises private drafts, immutable attributed releases, review and current entitlement requirements, stale/concurrent saves, restore/unpublish/default compatibility, hidden Form/payment command refusal, managed and provider-verified custom Portal origin binding, revocation and typed deliverable tenant authority. Unit tests validate bounded pages/modules/navigation, template independence and historical normalization; component tests verify review readiness, safe text, page paths/navigation, permitted duplication and truthful availability.

Run isolated `e2e/portal-composition.spec.ts` with `pnpm --filter @gold/web exec playwright test --config playwright.batch-b.config.ts` against a loopback-configured local app (`E2E_BASE_URL` selects its port). Canonically provisioned local accounts exercise legacy/default transition, review/publication, Work/invoices, exact customer/Form revision attribution, refusal of shape-compatible stale Form revisions, same-context operator/Portal/proposal/public Form sessions, draft isolation, unpublish/restore, custom-origin root/exchange/action/reload, copied-cookie hostname rejection and release/revocation. Browser DNS mapping and local provider-record fixtures prove application behavior, not real DNS/TLS/provider readiness. Inspect 1440×900, 1024×900 and 390×844 screenshots and overflow/focus assertions. Component/database checks additionally preserve full legacy record lists and history paging beyond 50 revisions. Release gate: disposable-local `pnpm db:reset`, `pnpm db:types`, `pnpm check`, followed by selected existing Website/Form/distribution/hostname/proposal/navigation regressions.

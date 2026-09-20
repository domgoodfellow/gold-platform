# Testing

How the suite is classified, where a test lives, what runs when, and where it is thin. The
classification is `test-manifest.json` at the repository root; this file explains it and does not
repeat it.

## Three separate questions

A test answers each independently. Do not fold them into one hierarchy.

**1. Level: what does it prove?** One per file.

| Level | It proves | Manifest category |
|---|---|---|
| Unit | One function or a small group, in-process, nothing external | `unit`, `python-unit` |
| Component | A coherent piece with its outer boundary faked | `component`, `python-component` |
| Integration | Real GOLD layers together. Today that means the database: domain layer, Postgres, RLS | `database-integration` |
| Contract | The shape at a boundary: a webhook signature, a vendor's request and reply. Offline; a vendor-sandbox contract is its own category | `offline-contract`, `python-contract`; `provider-contract` |
| Architecture | A rule about the code, build or schema, not a business behaviour | `architecture-static`, `architecture-db` |
| End to end | A durable journey through a real browser and the running app | `playwright-acceptance` |
| Smoke | The smallest check that a running deployment is alive | `playwright-smoke` |

**2. Execution requirement: what must be running?** Fixed by the category, never by the folder.

| Needs | Categories |
|---|---|
| Nothing | `unit`, `component`, `architecture-static`, `offline-contract`, all `python-*` |
| Local Supabase (`pnpm db:start`) | `architecture-db`, `database-integration` |
| The running app, and an account | `playwright-acceptance` (plus seeded demo data), `playwright-smoke` |
| A vendor sandbox and its credentials | `provider-contract` |

**3. Concerns: what is it about?** Free tags in the manifest, several per file: `tenancy`,
`security`, `billing`, `communications`, and so on. They cut across levels. *Regression*,
*security*, *auth* and *tenancy* are concerns and never levels, and there is no regressions folder:
a regression test lives at its level, beside the test it extends.

## Tiers and commands

Run from the repository root. A tier is a set of categories; `test-manifest.json` says which.

| Tier | Command | Runs | Needs |
|---|---|---|---|
| **Fast** | `pnpm test:fast` | unit, component, architecture, contract, and all Python | nothing |
| | `pnpm check:fast` | typecheck, lint, `test:fast`, `next build` | nothing |
| **Local integration** | `pnpm test:local` | architecture-db, database-integration | local Supabase |
| **Gate** | `pnpm check` | typecheck, lint, all of Vitest, build, all of pytest | local Supabase |
| **E2E** | `pnpm test:e2e` | Playwright acceptance | Supabase, `pnpm demo:fresh`, `pnpm dev` |
| **Smoke** | `pnpm test:smoke` | the deployment check | a running app, one account |
| **Provider** | `pnpm test:provider` | vendor-sandbox contracts (none exist yet) | sandbox credentials |

One category at a time: `test:unit`, `test:component`, `test:architecture`, `test:architecture:db`,
`test:db`, `test:contract`, `test:api`. Python tests need
`pip install -r apps/api/requirements-dev.txt`.

**`pnpm check` is the authoritative gate and its contract is unchanged.** Fast plus local is the
whole gate, and the guard (`tests/architecture/static/test-manifest.test.ts`) fails if they stop
being. `check` runs Vitest and pytest unfiltered, so a test nobody classified still runs and the
guard is what fails for it. A category outside the gate (`e2e`, `smoke`, `provider`) is excluded
from the default Vitest run by directory, so a sandbox test can never ride into `pnpm check`.
Database files run one at a time (`fileParallelism: false`) in every command; they share one
Postgres and some of its global tables.

## Where a test lives

The directory is the category; the manifest's `dir` says which, and the guard fails a file anywhere
else.

| Directory | Category |
|---|---|
| `apps/web/tests/unit/` | `unit` |
| `apps/web/tests/component/` | `component` |
| `apps/web/tests/contract/` | `offline-contract` |
| `apps/web/tests/provider-contract/` | `provider-contract` (none yet) |
| `apps/web/tests/architecture/static/` | `architecture-static` |
| `apps/web/tests/architecture/database/` | `architecture-db` |
| `apps/web/tests/integration/database/` | `database-integration` |
| `apps/web/tests/support/` | not tests: `setup.ts`, `founding.ts` (import `@/tests/support/founding`) |
| `apps/web/e2e/`, `apps/web/e2e/smoke/` | `playwright-acceptance`, `playwright-smoke` |
| `apps/api/tests/{unit,component,contract}/` | `python-unit`, `python-component`, `python-contract` |

**Naming.** The folder carries the level, so the file carries the subject: `economics.test.ts`,
`test_handlers.py`, `<journey>.spec.ts`. No level in the name, no milestone number in a new name.
A file that reads source with a relative path is depth-sensitive; moving one means changing its
`..` count, and running its category proves it.

## Choosing a category for a new test

Put the file in the category's directory and add one entry to `test-manifest.json` (`category`, at
least one `concerns` tag, a `note` if it holds a second kind of test). Then, in order:

1. Does it open a browser? `playwright-acceptance`; `playwright-smoke` only for the deployment check.
2. Does it call a real vendor sandbox? `provider-contract`, and it must skip itself without its credentials.
3. Does it need real Postgres or Supabase Auth? A schema, grant or catalogue rule with no business
   behaviour is `architecture-db`; anything else is `database-integration`.
4. Does it read source or run the compiler to enforce a rule? `architecture-static`.
5. Does it check what is sent to or read from a boundary, offline? `offline-contract` / `python-contract`.
6. Does it run several internal modules with the outside faked? `component` / `python-component`.
7. Otherwise `unit`.

**Which level for which question.** A business rule (who may do what, what a total is) belongs in
`database-integration` or `unit`, never only in a browser. A wiring fact (a handler verifies before
it writes) is `component`. A drift risk between two runtimes, or between code and schema, is
`architecture`. What we send a vendor is `contract`. A person's durable route through screens is
`e2e`, and it should not re-prove a rule already held lower.

A file that is half one thing and half another is split when the halves need different things
running, so a command never lies about what it needs. Otherwise keep it whole, pick what it mostly
does, and say so in `note`.

## What runs where

| Job | When | Runs |
|---|---|---|
| Pull request | every push to a PR | `fast` and `local` in parallel. Together they are `pnpm check` |
| Main | merge to `main` | the same, so a green main is a green gate |
| Nightly | schedule | `e2e` against a freshly seeded local stack |
| Deployment smoke | manual, after a deploy | `smoke` against `SMOKE_BASE_URL` with `SMOKE_EMAIL`/`SMOKE_PASSWORD` |
| Provider | none yet | `pnpm test:provider` with sandbox secrets, scheduled, never on a PR |

`.github/workflows/ci.yml` defines these. It has **not been run on GitHub**: its YAML parses and the
`.env.test` recipe was checked against the local stack, but expect a first-run fix. Promote `e2e` to
every merge only after its first green nightly.

## A name is not a category

- `test_integration_operations.py` is a **component** test: the Integrations feature, every
  boundary patched. Nothing real is integrated.
- `communications.test.ts` is a **database integration** test about the credit purse and call cost.
- `schema-conformance.test.ts` is **architecture** that happens to need a database.
- `milestone-m11.test.ts` is a static source scan named for a roadmap period.
- `platform-billing.test.ts` stubs Stripe's HTTP but is a database integration test, not a contract.

The manifest is authoritative where a name and a category disagree.

## Smoke

`playwright.smoke.config.ts` has no fixture setup. It checks that the app answers at `/login`, that
the page renders, that a real sign-in works, and that the shell behind it loads; the last two prove
the app reaches Supabase Auth and Postgres. Locally it signs in as the demo owner; anywhere else it
needs `SMOKE_EMAIL` and `SMOKE_PASSWORD` and fails, not skips, without them. `/` is deliberately not
checked: it renders the published GOLD homepage and answers 500 on a database where none is published.

## Where the suite is thin

Graded by level against each domain, not by percentage. **S** strong: the rules of the domain are
held at this level. **P** partial: real but incomplete, or asserted only by proxy. **—** missing.
**n/a** the level has nothing to say here.

| Domain / concern | Unit | Component | Contract | Architecture | DB integration | E2E |
|---|---|---|---|---|---|---|
| Auth / session identity | P | S | n/a | S | S | P |
| Tenancy / RLS | — | — | n/a | S | S | P |
| Platform vs organization authority | — | — | n/a | S | S | P |
| Commercial terms, usage, billing | P | S | S | P | S | P |
| Provider bindings and secrets | — | S | P | S | S | — |
| Communications / voice | P | S | S | P | S | P |
| CRM / customers | — | S | n/a | P | S | S |
| Work, scheduling, booking | P | — | n/a | P | S | P |
| Integrations / OAuth | — | S | P | S | S | — |
| Public site / intake | — | — | P | S | S | P |
| Documents / assets | — | — | n/a | — | S | S |
| Configuration / lifecycle | S | — | n/a | S | S | S |
| Core UI / accessibility | — | P | n/a | P | n/a | P |
| Platform administration | — | — | n/a | S | S | P |
| AI / assistant | — | S | P | S | S | — |
| Automation | P | S | n/a | — | S | P |
| Reporting | — | — | n/a | — | S | — |

Why each **P** and **—** is graded so:

- **Auth E2E P:** sign-in and sign-up are walked; sign-out, password reset and OAuth sign-in are not.
- **Tenancy / platform E2E P:** only the positive path is walked in a browser; no test opens another
  business's URL, or `/platform` as a non-staff person. The database refuses both, so this is a
  cheap browser guard to add, not an open hole.
- **Contract P (providers, integrations, AI):** Stripe payments, Resend, Nominatim, the Twilio browser
  token and every webhook signature are pinned. Not yet: Twilio call placement and provisioning (one
  `fetch` spy inside a database test), the Anthropic drafting adapter, the answering adapter, and the
  web platform-billing adapter's own request shape. No vendor-sandbox contract exists.
- **Work / booking E2E P:** no browser test books, schedules or double-books. The exclusion
  constraint is held at the database, which is where the rule lives.
- **Public site / intake E2E P:** the preview link is walked; an anonymous visitor submitting an
  inquiry or a booking is not.
- **UI / accessibility P:** one component file renders to a string (no DOM, no focus, no keyboard);
  31 architecture files check conventions by reading source. Nothing measures accessibility by
  behaviour. This is the largest structural weakness and the least urgent.
- **Voice, softphone:** call history renders; there is no browser softphone to test (M9/M14).

## Asymmetries found, and what was done

| Asymmetry | Status |
|---|---|
| Every signature/secret/bearer check tested as a function, none as the wired handler | **Closed.** `test_handlers.py` drives all 13 entrypoints and asserts each refusal *and* that the sink was never reached |
| Python names 27 database functions and only the assistant's tools were checked against the schema | **Closed.** `python-rpc-surface.test.ts`: names, the calling role's grant, machine doors closed to signed-in roles, and a new call must be declared |
| "Every page calls `requireOrganization`" (I12) had an empty `Held by` | **Closed.** `organization-page-guard.test.ts`; verified by mutation |
| Adapter mocks with no contract: card payments, transactional email, geocoding, browser telephone token | **Closed** for these four. See *Contract P* for what remains |
| Credential-minting boundary `browserTelephoneToken` had no test | **Partly closed.** The minted token is pinned; the domain function around it is not |
| Duplicate assertions at the expensive level: `documents.spec.ts` uploads to three records; four read-only `catalog-plans` render checks; `portal-payments.spec.ts` list checks | **Open.** Fold into one journey each once the rule is held lower; changing e2e was out of scope |
| 31 source-scan files assert UI behaviour by matching text | **Open.** Real component tests need a DOM harness this repo does not have |
| Python argument names (`p_...`) are not checked against the database functions' parameters | **Open.** The natural next extension of `python-rpc-surface` |
| E2E with no underlying authorization test | **None found.** Every mutating spec (`operator-paths`, `platform-catalog`, `feature-navigation-gate`) has a database test for its rule |

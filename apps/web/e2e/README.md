# E2E — a small, real-browser harness

Proof for the UX journeys `tests/**/*.test.ts` cannot reach: a route existing is not the same as
a route being discoverable and usable through a real browser. This is deliberately small — one
browser, no CI matrix, no visual-diff snapshots — a handful of durable product contracts, not a
second, parallel test suite duplicating Vitest's coverage.

## Prerequisites

1. `pnpm db:start` (from the repo root) — the local Supabase stack.
2. `pnpm demo:fresh` (or `pnpm demo` on an empty database) — stands up the same two real
   businesses `apps/web/scripts/demo/` always does, through real domain calls.
3. `pnpm --filter @gold/web dev` running and reachable at `http://localhost:3000` (or set
   `E2E_BASE_URL`). There is deliberately no `webServer` entry in `playwright.config.ts` — this
   app's dev server is very often already running in a developer's own terminal, and having
   Playwright try to manage a second one on the same port fights it rather than reusing it.

Then, from `apps/web`:

```
pnpm test:e2e       # headless, once
pnpm test:e2e:ui    # Playwright's own UI mode, for iterating on a spec
```

## What `globalSetup` does

`e2e/global-setup.ts` runs once before the suite. It signs in as the first demo business's owner
and, through the same domain layer every other caller in this repo uses (never a service-role
client, never a direct table write), adds the handful of fixtures the demo script itself does not
create:

- one Asset with a reading (the demo script never calls `createAsset`),
- one document each on a customer and a work item,
- a public slug and a bookable kind of work, so the Public Presence preview has somewhere real to
  point at (`booking_organization`'s bookable-type requirement is a deliberate privacy opt-in —
  this satisfies it rather than bypassing it),
- the `portal` module, switched on **and** given a commercial term — neither demo shape asks for
  it, and D41 means the switch alone would leave it wanted but not paid, so the Portal section
  would still render nothing to test against.

It is idempotent: re-running it against data an earlier run already touched adds nothing a second
time, so it is safe to run before every invocation rather than only once per `demo:fresh`. It also
signs in through the real login form in a headless browser once and saves the resulting session
(`e2e/.auth/owner.json`) so individual specs start already authenticated rather than each paying
for their own login — and writes `e2e/.demo-context.json` (organization/customer/asset/etc. ids)
so specs don't have to re-derive them by scraping the UI. Both files are generated, gitignored,
and local-only; `global-setup.ts` refuses to run against anything but `127.0.0.1`/`localhost`,
the same guard `scripts/demo/run.ts` applies to itself.

## What's covered

One spec file per durable journey (see each file's own doc comment for why it's there):
record navigation (Asset/Location/Resource list → record), a Work Item's relationship links,
uploading a document and seeing it in that record's activity history (proving the
`document.created` attribution fix), reaching `/account` through the account menu, the
Automations workspace after its file-level decomposition, the public booking preview link from
Settings, and the two operator paths `docs/product-surface-audit.md` found unreachable —
reassigning a member's role and revoking a customer's portal link, each also proven absent for a
caller who lacks the governing capability.

## What's deliberately not here

Not a replacement for `pnpm test` (real Postgres, real RLS, the actual authorization boundary) —
this harness's job is UI reachability and rendering, not policy. Not wired into `pnpm check`: it
needs a browser install, a running dev server and seeded data that the fast gate does not assume.
Run it by hand, or wire it into CI separately once there is a CI environment that can satisfy its
prerequisites.

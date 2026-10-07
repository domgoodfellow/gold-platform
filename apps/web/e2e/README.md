# Browser acceptance harness

`apps/web/e2e` contains the small real-browser acceptance suite for product behavior that source/unit/database tests cannot prove.

Its job is:

> Prove that a real user can reach and operate selected durable journeys in a real browser.

It is not a second copy of every Vitest/database assertion.

## Prerequisites

From repository root:

```bash
pnpm db:start
pnpm demo:fresh
pnpm --filter @gold/web dev
```

Install Chromium if needed:

```bash
pnpm --filter @gold/web exec playwright install chromium
```

Then run:

```bash
pnpm test:e2e
```

The Playwright acceptance configuration intentionally does not start another web server.

A developer often already has the app running.

## Global setup

`e2e/global-setup.ts` prepares the small amount of browser-specific demo state that the general demo does not create.

It uses the real domain/application paths rather than a service-role database shortcut.

Generated browser-auth/context files remain local and gitignored.

The setup refuses non-local targets.

## What belongs in browser acceptance

Use this suite for behavior that depends on:

- route discoverability;
- browser navigation/history;
- real authentication continuity;
- sheets/dialogs/drawers;
- keyboard/focus behavior;
- responsive shell behavior;
- cross-page journeys;
- integrated server/database composition.

Use lower test levels for pure logic, RLS and deterministic domain invariants.

## Smoke and visual are separate

Smoke:

```bash
pnpm test:smoke
```

Visual regression:

```bash
pnpm test:visual
```

These have separate Playwright configurations and purposes.

See `docs/testing.md`.

## Test data

Browser tests use repeatable demo data plus the explicit fixtures required by their journeys.

Do not hard-code production/customer identifiers.

Do not use the acceptance harness against Production as a destructive test suite.

## Maintenance

When a user-visible flow changes intentionally:

1. update the relevant acceptance test if the durable contract changed;
2. do not preserve a stale test merely to keep historical behavior;
3. keep setup mechanical and scenario meaning in the spec;
4. verify failures produce useful Playwright traces/logs.

The source of truth for test classification is `test-manifest.json`.

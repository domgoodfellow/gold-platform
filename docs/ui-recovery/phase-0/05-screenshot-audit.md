# Exhaustive screenshot-audit tooling

## Existing state found

The repository already has two visual mechanisms:

1. `playwright.visual.config.ts` + `e2e/visual/*`: a deliberately small visual-regression baseline over representative patterns.
2. `scripts/audit/platform-visual.mjs`: an ad-hoc Platform screenshot/geometry auditor.

Neither is exhaustive, and the Platform script still drives legacy `/platform/**` addresses.

## Phase 0 tooling added

### Static inventory generator
`scripts/audit/ui-recovery.mjs`

Regenerates:
- route/surface inventory;
- shared-surface inventory;
- pattern/spacing/width measurements;
- flagged divergence candidates.

### Exhaustive browser crawler
`playwright.audit.config.ts` + `audit/ui-recovery.spec.ts`

The audit runner:
- uses the existing demo global setup and signed-in storage states;
- starts from organization, Settings, Account, Platform and public roots;
- follows same-origin links breadth-first;
- captures desktop, tablet and phone;
- records console errors and failed requests;
- maps each captured URL back to the static route template inventory;
- records unmatched route templates instead of pretending coverage is complete;
- stores results under `.artifacts/ui-audit/<viewport>/...`.

This is forensic audit tooling. It is **not** the visual regression gate and should not turn every current inconsistency into an accepted golden baseline.

### Gallery generator
`scripts/audit/generate-ui-gallery.mjs`

Builds `.artifacts/ui-audit/index.html` from the viewport manifests so the application can be reviewed as a contact sheet.

## Run contract

With the normal local demo prerequisites running:

```bash
pnpm --filter @gold/web audit:ui
```

The command:
1. regenerates the static inventories;
2. crawls/captures reachable UI in three viewport classes;
3. generates the gallery.

## Coverage semantics

"Exhaustive" means:
- every source route is in the static inventory;
- every route template reached by the seeded application gets screenshot evidence;
- every inventory route not reached is listed explicitly as unmatched and must be resolved by adding a seed/discovery path or classifying it as intentionally unreachable in the demo state.

It does **not** mean inventing fake IDs just to force dynamic routes to render.

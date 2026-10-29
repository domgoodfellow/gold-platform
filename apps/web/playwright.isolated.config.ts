import path from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The demo-dependent navigation specs, the CRM form-drawer contract, the responsive shell and workspace configuration discovery, run against one disposable
 * business instead of the shared demo ones (`e2e/isolated-setup.ts`, removed again by
 * `e2e/isolated-teardown.ts`). The tests that
 * need Platform staff stay out: Platform needs GildOps' own operating organization, which a
 * disposable business cannot stand in for, so they remain unverified here.
 */
process.env.E2E_FIXTURE_DIR ??= path.join(__dirname, '..', '..', '.artifacts', 'e2e-isolated', `${process.pid}`);

export default defineConfig({
  ...base,
  globalSetup: './e2e/isolated-setup.ts',
  globalTeardown: './e2e/isolated-teardown.ts',
  testMatch: ['**/adaptive-shell.spec.ts', '**/breadcrumbs.spec.ts', '**/studio-navigation.spec.ts', '**/crm-form-drawers.spec.ts', '**/responsive-shell.spec.ts', '**/crm-configuration.spec.ts', '**/workspace-configuration-cleanup.spec.ts', '**/surface-replacements.spec.ts', '**/page-composition.spec.ts', '**/crm-dashboard.spec.ts', '**/crm-home.spec.ts', '**/crm-intake.spec.ts', '**/crm-workflow-refinement.spec.ts', '**/crm-voice.spec.ts', '**/finance-v2.spec.ts', '**/finance-v21.spec.ts', '**/finance-structure.spec.ts', '**/settings-work-finance-ux.spec.ts', '**/work-w1.spec.ts', '**/work-w2.spec.ts', '**/work-w3.spec.ts', '**/home-h1.spec.ts'],
  grepInvert: /GildOps platform staff|Administration breadcrumbs|mobile Platform page location/,
});

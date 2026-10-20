import path from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The demo-dependent navigation specs, run against one disposable business instead of the shared
 * demo ones (`e2e/isolated-setup.ts`, removed again by `e2e/isolated-teardown.ts`). The tests that
 * need Platform staff stay out: Platform needs GildOps' own operating organization, which a
 * disposable business cannot stand in for, so they remain unverified here.
 */
process.env.E2E_FIXTURE_DIR ??= path.join(__dirname, '..', '..', '.artifacts', 'e2e-isolated', `${process.pid}`);

export default defineConfig({
  ...base,
  globalSetup: './e2e/isolated-setup.ts',
  globalTeardown: './e2e/isolated-teardown.ts',
  testMatch: ['**/adaptive-shell.spec.ts', '**/breadcrumbs.spec.ts', '**/studio-navigation.spec.ts'],
  grepInvert: /GildOps platform staff|Administration breadcrumbs|mobile Platform page location/,
});

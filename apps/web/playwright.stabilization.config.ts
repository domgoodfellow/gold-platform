import path from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

process.env.E2E_FIXTURE_DIR ??= path.join(__dirname, '../../.artifacts/v11-browser-fixtures', String(process.pid));
export default defineConfig({
  ...base,
  use: { ...base.use, actionTimeout: 15_000 },
  globalSetup: './e2e/isolated-setup.ts',
  globalTeardown: './e2e/isolated-teardown.ts',
  testMatch: [
    '**/crm-acceptance.spec.ts', '**/crm-legacy-links.spec.ts', '**/workspace-navigation.spec.ts',
    '**/breadcrumbs.spec.ts', '**/responsive-shell.spec.ts',
  ],
  testIgnore: ['**/smoke/**', '**/design/**', '**/visual/**'],
  timeout: 90_000,
  grepInvert: /GildOps platform staff|Administration breadcrumbs|mobile Platform page location/,
  outputDir: '../../.artifacts/v11-browser-results',
});

import path from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

process.env.E2E_FIXTURE_DIR ??= path.join(__dirname, '../../.artifacts/v11-browser-fixtures', String(process.pid));
export default defineConfig({
  ...base,
  globalSetup: './e2e/isolated-setup.ts',
  globalTeardown: './e2e/isolated-teardown.ts',
  testMatch: process.env.E2E_STABILIZATION_FULL === '1' ? '**/*.spec.ts' : [
    '**/crm-acceptance.spec.ts', '**/crm-legacy-links.spec.ts', '**/workspace-navigation.spec.ts',
    '**/breadcrumbs.spec.ts', '**/responsive-shell.spec.ts',
  ],
  testIgnore: ['**/smoke/**', '**/design/**', '**/visual/**'],
  timeout: 90_000,
  outputDir: '../../.artifacts/v11-browser-results',
});

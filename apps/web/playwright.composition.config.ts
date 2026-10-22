import path from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

process.env.E2E_FIXTURE_DIR ??= path.join(__dirname, '../../.artifacts/e2e-composition', String(process.pid));
export default defineConfig({
  ...base,
  globalSetup: './e2e/isolated-setup.ts',
  globalTeardown: './e2e/isolated-teardown.ts',
  testMatch: '**/work-composition.spec.ts',
  timeout: 120_000,
  outputDir: '../../.artifacts/composition-results',
});

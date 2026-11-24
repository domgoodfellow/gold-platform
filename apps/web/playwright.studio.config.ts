import path from 'node:path';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Studio stabilization (revision lifecycle, rendering parity, previews and the workbench) against
 * one disposable business that stands in for GildOps' own website, with its production revision
 * history (`e2e/studio-fixture.ts`). Run only against a disposable stack and a tokened test server.
 */
process.env.E2E_FIXTURE_DIR ??= path.join(__dirname, '..', '..', '.artifacts', 'e2e-studio', `${process.pid}`);

export default defineConfig({
  ...base,
  globalSetup: './e2e/studio-setup.ts',
  globalTeardown: './e2e/studio-teardown.ts',
  testMatch: '**/studio-stabilization.spec.ts',
  timeout: 90_000,
  outputDir: '../../.artifacts/studio-s1-results',
});

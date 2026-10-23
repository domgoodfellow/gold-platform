import { defineConfig } from '@playwright/test';
import { assertLocalE2eEnvironment } from './e2e/environment-guard';

assertLocalE2eEnvironment();

/** Local account fixtures, independent of the larger demo bootstrap. */
export default defineConfig({
  testDir: './e2e', testMatch: 'appearance.spec.ts', tsconfig: './tsconfig.json', workers: 1, retries: 0,
  outputDir: './.next/appearance-test-results',
  timeout: 120_000, forbidOnly: !!process.env.CI,
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'tablet', use: { viewport: { width: 768, height: 1024 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 } } },
  ],
});

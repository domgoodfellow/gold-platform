import { defineConfig, devices } from '@playwright/test';

/**
 * The smoke suite: the smallest check that a running GOLD is alive (docs/testing.md).
 *
 * It is deliberately not the acceptance config. There is no `globalSetup`, so it writes no
 * fixtures and needs no demo data, and it can point at any deployment:
 *
 *   SMOKE_BASE_URL   where the app answers (falls back to E2E_BASE_URL, then localhost:3000)
 *   SMOKE_EMAIL / SMOKE_PASSWORD   one existing account, for the sign-in check
 *
 * Against localhost the account defaults to the demo owner; against anything else the account
 * must be given, and the run fails without it rather than skipping the check that matters.
 */
export default defineConfig({
  testDir: './e2e/smoke',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: process.env.SMOKE_BASE_URL || process.env.E2E_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

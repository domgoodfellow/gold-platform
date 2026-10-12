import { defineConfig, devices } from '@playwright/test';

/**
 * A small, deterministic browser harness — proof for the UX journeys a unit test cannot reach,
 * not a second, parallel test suite. One browser, no CI matrix, no visual-diff snapshots.
 *
 * Prerequisites (see e2e/README.md): `pnpm db:start`, `pnpm demo:fresh`, and `pnpm dev` already
 * running. No `webServer` entry here on purpose — this repo's dev server takes several seconds
 * to boot and is very often already running in a developer's own terminal; managing a second
 * one address-clashes with it rather than reusing it. `globalSetup` signs in as the demo owner,
 * adds the handful of fixtures (an asset with a reading, two documents) the demo script itself
 * does not create, and saves a signed-in browser state so individual specs do not each pay for
 * their own login.
 */
export default defineConfig({
  testDir: './e2e',
  // The smoke suite is its own thing (playwright.smoke.config.ts): no seeded fixtures, no globalSetup.
  testIgnore: ['**/smoke/**', '**/design/**'],
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

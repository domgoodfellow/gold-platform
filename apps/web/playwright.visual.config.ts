import { defineConfig } from '@playwright/test';

/**
 * Pixel baselines — never the acceptance suite's job (`playwright.config.ts`'s own doc comment:
 * "no visual-diff snapshots"). A small, deliberately bounded set: one pattern each for a
 * workspace-home, a collection board, Organization Settings, an authenticated 404/StatePage, a
 * record/detail page and one Platform control-plane page, at three widths. Never in the default
 * run (`gate: false` in `test-manifest.json`) — a baseline drifts with design intent, and a diff
 * here is a prompt for a person to look, never a build failure like `pnpm check`'s own suites.
 *
 * Same prerequisites as the acceptance suite (`e2e/README.md`): `pnpm db:start`,
 * `pnpm demo:fresh`, `pnpm --filter @gold/web dev`. Reuses the acceptance suite's own
 * `globalSetup` and signed-in storage states rather than a second fixture story.
 */
export default defineConfig({
  testDir: './e2e/visual',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 30_000,
  globalSetup: './e2e/global-setup.ts',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}',
  expect: {
    // No animation-dependent timing: every transition is skipped to its end state before the
    // screenshot is taken, so a baseline never flakes on a spinner or a fade that happened to
    // still be running.
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css' },
  },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { viewport: { width: 1024, height: 800 } } },
    { name: 'phone', use: { viewport: { width: 390, height: 844 } } },
  ],
});

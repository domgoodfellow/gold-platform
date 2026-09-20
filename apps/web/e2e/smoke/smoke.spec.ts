import { test, expect } from '@playwright/test';
import { BUSINESSES, DEMO_PASSWORD } from '../../scripts/demo/businesses';

/**
 * Is a running GOLD alive? Four claims, in the order a person would meet them (docs/testing.md):
 * the app answers, the login surface renders, a real session can be established, and the
 * authenticated shell loads behind it. The last two are also the proof that the app can reach its
 * backend: signing in is a call to Supabase Auth, and the page after it reads the caller's
 * memberships from Postgres.
 *
 * Nothing here needs a seeded fixture beyond one account, and nothing is written.
 */

const baseURL = process.env.SMOKE_BASE_URL || process.env.E2E_BASE_URL || 'http://localhost:3000';
const isLocal = ['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname);

/** An explicit account, or — on this machine only — the demo owner, whose password is not secret. */
function account(): { email: string; password: string } {
  const email = process.env.SMOKE_EMAIL || (isLocal ? BUSINESSES[0].owner.email : undefined);
  const password = process.env.SMOKE_PASSWORD || (isLocal ? DEMO_PASSWORD : undefined);
  if (!email || !password) {
    throw new Error(`Smoke against ${baseURL} needs SMOKE_EMAIL and SMOKE_PASSWORD: one existing account to sign in with.`);
  }
  return { email, password };
}

// `/login`, not `/`: the front page renders the published GOLD homepage and answers 500 by design
// on a database where none has been published, which is a content state and not a dead app.
test('the application answers', async ({ request }) => {
  const response = await request.get('/login');
  expect(response.status()).toBe(200);
});

test('the login surface renders', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
});

test('a session can be established and the authenticated shell loads', async ({ page }) => {
  const { email, password } = account();

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();

  await page.waitForURL(/\/organizations/, { timeout: 15_000 });
  await expect(page.getByRole('heading').first()).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/application error/i);
});

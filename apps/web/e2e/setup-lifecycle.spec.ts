import { randomUUID } from 'node:crypto';
import { test, expect, type Page } from '@playwright/test';

/**
 * A business is created, set up, launched and then stops being treated as onboarding.
 *
 * Self-contained on purpose: it founds its own account and business through the real sign-up and
 * create-business forms (local Supabase has email confirmation off), so it needs no demo data and
 * leaves nothing behind that another spec reads. What it proves that `tests/**` cannot: the
 * redirect a browser actually follows, that Setup is reachable at phone width without a header
 * badge, and that nothing still says "setting up" once the business is Live.
 */

test.use({ storageState: { cookies: [], origins: [] } });

async function foundBusiness(page: Page): Promise<string> {
  const email = `setup-${randomUUID().slice(0, 8)}@example.test`;
  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correct-horse-battery');
  await page.getByLabel('Confirm password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/organizations$/);
  await page.getByLabel('What should we call you?').fill('Founder');
  await page.getByLabel('And what is the business called?').fill(`Lifecycle Co ${randomUUID().slice(0, 4)}`);
  await page.getByRole('button', { name: 'Create business' }).click();

  // The new business is in SETUP, so entry goes to Setup — not the operating cockpit.
  await expect(page).toHaveURL(/\/organizations\/[^/]+\/setup$/);
  return /\/organizations\/([^/]+)\/setup/.exec(page.url())![1];
}

test('a new business enters Setup, can leave it freely, launches, and lands on Today with Setup gone', async ({
  page,
}) => {
  const organizationId = await foundBusiness(page);

  // The cockpit: progress as a count of areas, areas in words, Launch available (nothing blocks).
  await expect(page.getByRole('heading', { level: 1, name: /^Set up / })).toBeVisible();
  await expect(page.getByText(/\d+ of \d+/).first()).toBeVisible();
  await expect(page.getByText('setup areas ready')).toBeVisible();
  await expect(page.getByText('Optional').first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Configure Work' })).toHaveAttribute(
    'href',
    `/organizations/${organizationId}/work/configuration`,
  );
  await expect(page.getByText('Nothing blocks launch.')).toBeVisible();

  // One Setup treatment in the sidebar, none in the header.
  await expect(page.getByRole('link', { name: /^Setup/ })).toBeVisible();
  await expect(page.getByText('Setting up')).toHaveCount(0);
  await expect(page.getByText('Set up your business')).toHaveCount(0);

  // SETUP is not a route prison: Today opens, with one restrained notice and a way back.
  await page.goto(`/organizations/${organizationId}/today`);
  await expect(page.getByText('This business is still being set up.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue setup' })).toBeVisible();
  await expect(page.getByText('Setup readiness')).toHaveCount(0);

  // Launch.
  await page.getByRole('link', { name: 'Continue setup' }).click();
  await page.getByRole('button', { name: 'Launch business' }).click();
  await expect(page).toHaveURL(`/organizations/${organizationId}/today`);

  // LIVE: nothing treats this business as onboarding any more.
  await expect(page.getByText('This business is still being set up.')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Setup/ })).toHaveCount(0);

  // Setup remains reachable from Settings, as a reconfiguration map with no Launch.
  await page.goto(`/organizations/${organizationId}/settings`);
  await page.getByRole('link', { name: 'Open setup' }).click();
  await expect(page).toHaveURL(`/organizations/${organizationId}/setup`);
  await expect(page.getByRole('heading', { level: 1, name: 'Setup' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Launch business' })).toHaveCount(0);

  // And the business now opens on Today.
  await page.goto(`/organizations/${organizationId}`);
  await expect(page).toHaveURL(`/organizations/${organizationId}/today`);
});

test('a phone reaches Setup from the bottom bar while SETUP lasts, and the header carries no badge', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const organizationId = await foundBusiness(page);

  await page.goto(`/organizations/${organizationId}/today`);
  const bar = page.getByRole('navigation', { name: 'This business' });
  const setupLink = bar.getByRole('link', { name: /^Setup/ });
  await expect(setupLink).toBeVisible();
  await expect(page.getByText('Setting up')).toHaveCount(0);

  await setupLink.click();
  await expect(page).toHaveURL(`/organizations/${organizationId}/setup`);

  await page.getByRole('button', { name: 'Launch business' }).click();
  await expect(page).toHaveURL(`/organizations/${organizationId}/today`);
  await expect(bar.getByRole('link', { name: /^Setup/ })).toHaveCount(0);
});

import { expect, test } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.describe('canonical Settings routes', () => {
  test.setTimeout(90_000);
  test.use({ storageState: OWNER_STORAGE_STATE });

  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    test(`five scopes have one owner at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const { organizationId } = loadDemoContext();
      const root = `/organizations/${organizationId}/settings`;
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      await page.goto(root);
      await expect(page.getByRole('heading', { level: 1, name: 'Settings', exact: true })).toBeVisible();
      for (const label of ['Organization', 'Account', 'Access', 'Connections', 'Plan & usage']) {
        await expect(page.getByRole('link', { name: new RegExp(`^${label}`) }).first()).toBeVisible();
      }
      await page.getByRole('link', { name: /^Organization Business/ }).click();
      await expect(page).toHaveURL(`${root}/organization`);
      await expect(page.getByRole('heading', { level: 1, name: 'Organization', exact: true })).toBeVisible();
      const main = page.getByRole('main');
      for (const removed of ['Team', 'Apps and files', 'Plan & usage', 'Secrets & credentials']) {
        await expect(main.getByRole('link', { name: removed, exact: true })).toHaveCount(0);
      }
      await page.screenshot({ path: testInfo.outputPath(`organization-${viewport.width}.png`), fullPage: true });

      await page.goto(root);
      await page.getByRole('link', { name: /^Account Your/ }).click();
      await expect(page.getByLabel('Display name')).toBeVisible();
      await expect(page.getByLabel('New email address')).toBeVisible();
      await page.getByRole('link', { name: 'Security & sign-in', exact: true }).click();
      await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
      await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
      await page.getByLabel('Current password', { exact: true }).fill('incorrect password');
      await page.getByLabel('New password', { exact: true }).fill('a candidate password never installed');
      await page.getByLabel('Confirm new password', { exact: true }).fill('a candidate password never installed');
      await page.getByRole('button', { name: 'Change password', exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Your current password is incorrect.' })).toContainText('Your current password is incorrect.');
      await page.screenshot({ path: testInfo.outputPath(`account-${viewport.width}.png`), fullPage: true });

      await page.goto(root);
      await page.getByRole('link', { name: /^Access Who/ }).click();
      await expect(page).toHaveURL(`${root}/access/members`);
      await page.getByRole('link', { name: /Invitations/ }).click();
      await expect(page).toHaveURL(`${root}/access/invitations`);
      await page.getByRole('link', { name: 'Roles', exact: true }).click();
      await expect(page).toHaveURL(`${root}/access/roles`);

      await page.goto(root);
      await page.getByRole('link', { name: /^Connections The/ }).click();
      await expect(page).toHaveURL(`${root}/connections`);
      await page.getByRole('link', { name: 'Secrets & credentials', exact: true }).click();
      await expect(page).toHaveURL(`${root}/secrets`);
      await expect(page.getByRole('navigation', { name: 'breadcrumb' }).getByText('Connections', { exact: true })).toBeVisible();

      await page.goto(root);
      await page.getByRole('link', { name: /^Plan & usage What/ }).click();
      await expect(page).toHaveURL(`${root}/plan`);
      await expect(page.getByRole('heading', { level: 1, name: 'Plan & usage', exact: true })).toBeVisible();
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  test('legacy organization URLs redirect directly to canonical Settings destinations', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    for (const [legacy, canonical] of [
      ['pricing', 'settings/pricing'],
      ['fields', 'settings/custom-fields'],
      ['roles?view=roles', 'settings/access/roles'],
      ['integrations?view=browse', 'settings/connections/apps'],
    ] as const) {
      await page.goto(`/organizations/${organizationId}/${legacy}`);
      await expect(page).toHaveURL(`/organizations/${organizationId}/${canonical}`);
    }
  });

  test('personal Account breadcrumbs begin with Settings and Account', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/settings/account/security?org=${organizationId}`);
    const trail = page.getByRole('navigation', { name: 'breadcrumb' });
    await expect(trail.getByText('Settings', { exact: true })).toBeVisible();
    await expect(trail.getByText('Account', { exact: true })).toBeVisible();
    await expect(trail.getByText('Security & sign-in', { exact: true })).toBeVisible();
  });
});

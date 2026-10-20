import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { COLLEAGUE_STORAGE_STATE, loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

/** Studio enters a contextual sidebar; Home also launches its operating destinations. */

const SHOTS = process.env.E2E_SHOTS ?? '';
const sidebar = (page: Page) => page.locator('[data-slot="sidebar-container"] nav[aria-label="This business"]');
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

test.describe('an owner', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('desktop: the flat Studio row opens Home and its operating destinations', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/home`);
    const nav = sidebar(page);

    await nav.getByRole('link', { name: 'Studio', exact: true }).click();
    await expect(nav.getByRole('button', { name: 'Expand Studio' })).toHaveCount(0);
    const destinations = page.getByRole('navigation', { name: 'Studio destinations' });
    for (const label of ['Website', 'Customer portal', 'Forms', 'Templates']) await expect(destinations.getByRole('link', { name: label, exact: true })).toBeVisible();
    await shot(page, 'studio-nav-desktop');

    await destinations.getByRole('link', { name: 'Forms', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/organizations/${organizationId}/studio/forms$`));

    // ADR-047: the Studio heading is the way back to Studio's Home.
    await nav.getByRole('link', { name: 'Studio home', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/organizations/${organizationId}/studio$`));
  });

  test('phone: the menu reaches Studio Home and each Studio page', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/organizations/${organizationId}/home`);
    await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, 'studio-nav-phone');
    await expect(page.getByRole('button', { name: 'Expand Studio' })).toHaveCount(0);
    await page.getByRole('dialog').getByRole('link', { name: 'Studio', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // On a phone the header strip is hidden; the menu now lists Studio's own pages.
    await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'Templates', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/organizations/${organizationId}/studio/templates$`));
  });
});

test.describe('a colleague who cannot manage the organization', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });

  test('sees Studio as a plain row with no pages beneath it', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/home`);
    const nav = sidebar(page);
    await expect(nav.getByRole('link', { name: 'Studio', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Expand Studio' })).toHaveCount(0);
  });
});

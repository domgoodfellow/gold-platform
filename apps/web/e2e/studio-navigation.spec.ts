import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { COLLEAGUE_STORAGE_STATE, loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

/**
 * Studio is one workspace whose pages are navigation, not a card on its Home: the row opens Studio
 * Home, the chevron opens Website, Forms and Templates. The editor's own parts (structure, canvas,
 * inspector) never reach the sidebar.
 */

const SHOTS = process.env.E2E_SHOTS ?? '';
const sidebar = (page: Page) => page.locator('[data-slot="sidebar-container"] nav[aria-label="This business"]');
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

test.describe('an owner', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('desktop: the Studio row is Home, and its chevron lists Website, Forms and Templates', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/home`);
    const nav = sidebar(page);

    await nav.getByRole('button', { name: 'Expand Studio' }).click();
    for (const label of ['Website', 'Forms', 'Templates']) await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    // The editor's own concepts are not places.
    for (const label of ['Structure', 'Canvas', 'Inspector']) await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    await shot(page, 'studio-nav-desktop');

    await nav.getByRole('link', { name: 'Forms', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/organizations/${organizationId}/studio/forms$`));

    await nav.getByRole('link', { name: 'Studio', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/organizations/${organizationId}/studio$`));
  });

  test('phone: the menu reaches Studio Home and each Studio page', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/organizations/${organizationId}/studio`);
    await page.locator('nav[aria-label="This business"].fixed').getByRole('button', { name: 'Menu', exact: true }).click();
    await shot(page, 'studio-nav-phone');
    for (const label of ['Website', 'Forms', 'Templates']) await expect(page.getByRole('link', { name: label, exact: true }).first()).toBeVisible();
    await page.getByRole('link', { name: 'Templates', exact: true }).first().click();
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

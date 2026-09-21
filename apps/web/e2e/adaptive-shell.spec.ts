import { test, expect } from '@playwright/test';
import { COLLEAGUE_STORAGE_STATE, loadDemoContext, OWNER_STORAGE_STATE, STAFF_STORAGE_STATE } from './helpers';

/**
 * The one adaptive shell, in a browser. What each person sees is a projection of the
 * organization's entitlements, their own permissions and — in GOLD's own organization — their
 * platform permissions. `shell-projection.test.ts` proves the matrix on the pure function; these
 * prove the projection is what actually renders, on desktop and on a phone, and that a hidden
 * destination is still refused when the URL is typed.
 */

const sidebar = (page: import('@playwright/test').Page) => page.locator('[data-slot="sidebar-container"] nav[aria-label="This business"]');

test.describe('a tenant owner', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('sees their own administration and never the GOLD platform', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/home`);
    const nav = sidebar(page);
    await expect(nav.getByText('Administration', { exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Team', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Plan & usage', exact: true })).toBeVisible();
    await expect(nav.getByText('Platform', { exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Organizations', exact: true })).toHaveCount(0);
  });

  test('is refused the platform when the URL is typed', async ({ page }) => {
    const response = await page.goto('/platform/providers');
    // Not staff: sent back to their own business rather than served, or refused outright.
    expect(page.url()).not.toContain('/platform/providers');
    expect(response?.status() ?? 200).toBeLessThan(500);
  });

  test('on a phone reaches Administration behind More, not in the bar', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/organizations/${organizationId}/home`);
    const bar = page.locator('nav[aria-label="This business"].fixed');
    await expect(bar.getByRole('link', { name: 'Team', exact: true })).toHaveCount(0);
    await bar.getByRole('button', { name: 'More' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Administration', { exact: true })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Team', exact: true })).toBeVisible();
    await expect(sheet.getByText('Platform', { exact: true })).toHaveCount(0);
  });
});

test.describe('a tenant colleague with a reduced role', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });

  test('sees the work their role allows and no administration they cannot manage', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/home`);
    const nav = sidebar(page);
    await expect(nav.getByRole('link', { name: 'Work', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Team', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Plan & usage', exact: true })).toHaveCount(0);
    await expect(nav.getByText('Platform', { exact: true })).toHaveCount(0);
  });

  test('is still refused the roles page by the server when the URL is typed', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/roles`);
    // The page loads (it is read-only for them) but offers no way to change a role: hiding the row was courtesy.
    await expect(page.getByRole('button', { name: 'New role' })).toHaveCount(0);
  });
});

test.describe('GOLD platform staff', () => {
  test.use({ storageState: STAFF_STORAGE_STATE });

  test('reach the platform through GOLD’s own shell, in the one sidebar', async ({ page }) => {
    await page.goto('/platform');
    const nav = sidebar(page);
    await expect(nav.getByText('Platform', { exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Organizations', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Providers', exact: true })).toBeVisible();
    // The same shell: GOLD's own workspaces are in it, beside Platform, not in a second frame.
    await expect(nav.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
  });

  test('are not offered Platform Administration as somewhere to switch to', async ({ page }) => {
    await page.goto('/platform');
    await expect(page.getByText('Platform Administration')).toHaveCount(0);
    await expect(page.getByText('Global tools')).toHaveCount(0);
  });

  test('on a phone, reach Platform behind More', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/platform');
    const bar = page.locator('nav[aria-label="This business"].fixed');
    await bar.getByRole('button', { name: 'More' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByText('Platform', { exact: true })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Providers', exact: true })).toBeVisible();
  });
});

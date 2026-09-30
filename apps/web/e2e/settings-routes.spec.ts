import { expect, test } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.describe('canonical Settings routes', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('scope and child routes keep URLs, tabs, and breadcrumbs coherent', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(`/organizations/${organizationId}/settings`);
    await expect(page.getByRole('heading', { level: 1, name: 'Organization' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Organization', exact: true })).toHaveAttribute('aria-current', 'page');

    await page.getByRole('link', { name: 'Access', exact: true }).click();
    await expect(page).toHaveURL(`/organizations/${organizationId}/settings/access/members`);
    await expect(page.getByRole('heading', { level: 1, name: 'Members' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'breadcrumb' }).getByText('Access', { exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Invitations', exact: false }).click();
    await expect(page).toHaveURL(`/organizations/${organizationId}/settings/access/invitations`);
    await page.getByRole('link', { name: 'Roles', exact: true }).click();
    await expect(page).toHaveURL(`/organizations/${organizationId}/settings/access/roles`);

    await page.getByRole('link', { name: 'Connections', exact: true }).click();
    await expect(page).toHaveURL(`/organizations/${organizationId}/settings/connections`);
    await page.getByRole('link', { name: 'Browse apps', exact: true }).click();
    await expect(page).toHaveURL(`/organizations/${organizationId}/settings/connections/apps`);

    await page.getByRole('link', { name: 'Plan & usage', exact: true }).first().click();
    await expect(page).toHaveURL(`/organizations/${organizationId}/settings/plan`);
    await expect(page.getByRole('heading', { level: 1, name: 'Plan & usage' })).toBeVisible();

    await page.goto(`/organizations/${organizationId}/settings/pricing`);
    await expect(page.getByRole('navigation', { name: 'breadcrumb' }).getByText('Pricing', { exact: true })).toBeVisible();
    await page.goto(`/organizations/${organizationId}/settings/custom-fields`);
    await expect(page.getByRole('navigation', { name: 'breadcrumb' }).getByText('Custom fields', { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });

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

import { test, expect } from '@playwright/test';
import { loadDemoContext, platformUrl, OWNER_STORAGE_STATE, STAFF_STORAGE_STATE } from './helpers';

/**
 * Proves the durable breadcrumb contract by driving the real app rather than reading source:
 * every authenticated page publishes a location into the sticky header, the current page is
 * never a link, and a real ancestor actually navigates.
 */
test.describe('workspace and record breadcrumbs', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('a workspace root publishes only its own name, non-linked', async ({ page }) => {
    const ctx = loadDemoContext();
    await page.goto(`/organizations/${ctx.organizationId}/field`);
    const trail = page.getByRole('navigation', { name: 'breadcrumb' });
    await expect(trail).toBeVisible();
    await expect(trail.getByText('Field', { exact: true })).toBeVisible();
    // No repeated "Field / Field" and no separator — a workspace Home has zero ancestors.
    await expect(trail.locator('a')).toHaveCount(0);
  });

  test('a workspace child page links back to its workspace Home', async ({ page }) => {
    const ctx = loadDemoContext();
    await page.goto(`/organizations/${ctx.organizationId}/resources`);
    const trail = page.getByRole('navigation', { name: 'breadcrumb' });
    const fieldLink = trail.getByRole('link', { name: 'Field' });
    await expect(fieldLink).toBeVisible();
    await expect(trail.getByText('Resources', { exact: true })).toBeVisible();
    await fieldLink.click();
    await expect(page).toHaveURL(new RegExp(`/organizations/${ctx.organizationId}/field$`));
  });

  test('a record detail trail ends on the current record, not linked, with a real ancestor link', async ({ page }) => {
    const ctx = loadDemoContext();
    await page.goto(`/organizations/${ctx.organizationId}/assets/${ctx.assetId}`);
    const trail = page.getByRole('navigation', { name: 'breadcrumb' });
    const assetsLink = trail.getByRole('link', { name: 'Assets' });
    await expect(assetsLink).toBeVisible();
    // The current record is present but is a `BreadcrumbPage` span, never a real anchor.
    await expect(trail.locator('a', { hasText: 'E2E Test Compressor' })).toHaveCount(0);
    await expect(trail.getByText('E2E Test Compressor', { exact: true })).toHaveAttribute('aria-current', 'page');
    await assetsLink.click();
    await expect(page).toHaveURL(new RegExp(`/organizations/${ctx.organizationId}/assets$`));
  });
});

test.describe('Platform breadcrumbs', () => {
  test.use({ storageState: STAFF_STORAGE_STATE });

  test('a grouped Platform destination reads Platform / Group / Page, Platform linking to the root', async ({ page }) => {
    await page.goto(platformUrl('catalog/plans'));
    const trail = page.getByRole('navigation', { name: 'breadcrumb' });
    const platformLink = trail.getByRole('link', { name: 'Platform' });
    await expect(platformLink).toBeVisible();
    await expect(trail.getByText('Catalog', { exact: true })).toBeVisible();
    await expect(trail.getByText('Plans & Add-ons', { exact: true })).toBeVisible();
    await platformLink.click();
    await expect(page).toHaveURL(new RegExp(`/platform$`));
  });

  test('a nested Platform record extends the trail one level further', async ({ page }) => {
    await page.goto(platformUrl('providers/twilio'));
    const trail = page.getByRole('navigation', { name: 'breadcrumb' });
    await expect(trail.getByRole('link', { name: 'Platform' })).toBeVisible();
    await expect(trail.getByText('Infrastructure', { exact: true })).toBeVisible();
    const providersLink = trail.getByRole('link', { name: 'Providers' });
    await expect(providersLink).toBeVisible();
    await expect(trail.getByText('Twilio', { exact: true })).toBeVisible();
    await providersLink.click();
    await expect(page).toHaveURL(/\/platform\/providers$/);
  });
});

test.describe('Account breadcrumbs', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('an Account page reads Account / Page, with Account unlinked', async ({ page }) => {
    await page.goto('/settings/account/security');
    const trail = page.getByRole('navigation', { name: 'breadcrumb' });
    await expect(trail.getByText('Account', { exact: true })).toBeVisible();
    await expect(trail.getByRole('link', { name: 'Account' })).toHaveCount(0);
    await expect(trail.getByText('Security & sign-in', { exact: true })).toBeVisible();
  });
});

test.describe('phone-width breadcrumb behaviour', () => {
  test.use({ storageState: OWNER_STORAGE_STATE, viewport: { width: 375, height: 812 } });

  test('a long record title truncates in the trail without pushing Agent out of view', async ({ page }) => {
    const ctx = loadDemoContext();
    await page.goto(`/organizations/${ctx.organizationId}/assets/${ctx.assetId}`);
    await expect(page.getByRole('button', { name: 'Agent' })).toBeVisible();
    const trail = page.getByRole('navigation', { name: 'breadcrumb' });
    await expect(trail).toBeVisible();
    const box = await trail.boundingBox();
    const agentBox = await page.getByRole('button', { name: 'Agent' }).boundingBox();
    expect(box).not.toBeNull();
    expect(agentBox).not.toBeNull();
    // The trail never overlaps or overflows past where Agent starts.
    if (box && agentBox) expect(box.x + box.width).toBeLessThanOrEqual(agentBox.x + 1);
  });
});

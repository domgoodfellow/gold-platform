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
    await expect(trail.getByText('Work', { exact: true })).toBeVisible();
    // No repeated "Field / Field" and no separator — a workspace Home has zero ancestors.
    await expect(trail.locator('a')).toHaveCount(0);
  });

  test('a workspace child page links back to its workspace Home', async ({ page }) => {
    const ctx = loadDemoContext();
    await page.goto(`/organizations/${ctx.organizationId}/resources`);
    const trail = page.getByRole('navigation', { name: 'breadcrumb' });
    const fieldLink = trail.getByRole('link', { name: 'Work' });
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

test.describe('Administration breadcrumbs', () => {
  test.use({ storageState: STAFF_STORAGE_STATE });

  test('a grouped destination reads Administration / Group / Page, Administration linking to the root', async ({ page }) => {
    await page.goto(platformUrl('catalog/meters'));
    const trail = page.getByRole('navigation', { name: 'breadcrumb' });
    const platformLink = trail.getByRole('link', { name: 'Administration' });
    await expect(platformLink).toBeVisible();
    await expect(trail.getByText('Product Registry', { exact: true })).toBeVisible();
    await expect(trail.getByText('Meters', { exact: true })).toBeVisible();
    await platformLink.click();
    await expect(page).toHaveURL(new RegExp(`/platform$`));
  });

  test('Plans & Add-ons reads Administration / Commercial administration / Plans & Add-ons, never Finance', async ({ page }) => {
    await page.goto(platformUrl('plans'));
    const trail = page.getByRole('navigation', { name: 'breadcrumb' });
    const platformLink = trail.getByRole('link', { name: 'Administration' });
    await expect(platformLink).toBeVisible();
    await expect(trail.getByText('Commercial administration', { exact: true })).toBeVisible();
    await expect(trail.getByRole('link', { name: 'Finance' })).toHaveCount(0);
    await platformLink.click();
    await expect(page).toHaveURL(new RegExp(`/platform$`));
  });

  test('a nested Administration record extends the trail one level further', async ({ page }) => {
    await page.goto(platformUrl('providers/twilio'));
    const trail = page.getByRole('navigation', { name: 'breadcrumb' });
    await expect(trail.getByRole('link', { name: 'Administration' })).toBeVisible();
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

  test('an Account page names Settings once in the bar and its own title beneath', async ({ page }) => {
    await page.goto('/settings/account/security');
    const trail = page.getByRole('navigation', { name: 'breadcrumb' });
    await expect(trail.getByText('Settings', { exact: true })).toBeVisible();
    await expect(trail.getByText('Security & sign-in', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Security & sign-in' })).toBeVisible();
  });
});

test.describe('responsive page location', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });
  test('overview and direct details use semantic parents after refresh', async ({ page }) => {
    const ctx = loadDemoContext();
    const base = `/organizations/${ctx.organizationId}`;
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/field`);
    const location = page.getByRole('navigation', { name: 'Page location', exact: true });
    await expect(location.getByRole('link', { name: 'Back to parent' })).toHaveAttribute('href', `${base}/home`);
    await location.getByRole('link', { name: 'Back to parent' }).click();
    await expect(page).toHaveURL(`${base}/home`);
    await expect(location.getByRole('link', { name: 'Back to parent' })).toHaveCount(0);
    await page.goto(`${base}/work/${ctx.workItemId}`);
    await page.reload();
    const parent = await location.getByRole('link', { name: 'Back to parent' }).getAttribute('href');
    expect(new URL(parent!, 'http://localhost').pathname).toBe(`${base}/work`);
    await location.getByRole('link', { name: 'Back to parent' }).click();
    await expect(page).toHaveURL(new URL(parent!, page.url()).href);
  });
  test('dropdown operates with keyboard, outside tap, and selection', async ({ page }) => {
    const ctx = loadDemoContext();
    const base = `/organizations/${ctx.organizationId}`;
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${base}/resources`);
    const trigger = page.getByRole('button', { name: 'Navigate within current section' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitem', { name: 'Resources', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('menuitem', { name: 'Overview', exact: true })).toHaveAttribute('href', `${base}/field`);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.press('Space');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.mouse.click(10, 600);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Overview', exact: true }).click();
    await expect(page).toHaveURL(`${base}/field`);
    await expect(page.getByRole('menu')).toHaveCount(0);
  });
  test('responsive location and dropdown fit all viewports in light and dark', async ({ page }, testInfo) => {
    const ctx = loadDemoContext();
    test.setTimeout(90000);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of [320, 375, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/organizations/${ctx.organizationId}/assets/${ctx.assetId}`);
        const location = page.getByRole('navigation', { name: width < 768 ? 'Page location' : 'breadcrumb', exact: true });
        await expect(location).toBeVisible();
        await expect(location.locator('[aria-current="page"]')).toContainText('E2E Test Compressor');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`location-${scheme}-${width}.png`) });
        if (width < 768) {
          const trigger = page.locator('header').getByRole('button', { name: 'Menu', exact: true });
          const box = (await location.boundingBox())!;
          const menuBox = (await trigger.boundingBox())!;
          expect(box.x + box.width).toBeLessThanOrEqual(menuBox.x + 1);
          await page.getByRole('button', { name: 'Navigate within current section' }).click();
          await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`dropdown-${scheme}-${width}.png`) });
          await page.setViewportSize({ width: 1024, height: 900 });
          await expect(page.getByRole('menu')).toHaveCount(0);
          await expect(page.getByRole('navigation', { name: 'breadcrumb', exact: true })).toBeVisible();
        }
      }
    }
  });
  test('long translated label fixture truncates and live resizing resets the menu', async ({ page }, testInfo) => {
    const ctx = loadDemoContext();
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(`/organizations/${ctx.organizationId}/assets/${ctx.assetId}`);
    const location = page.getByRole('navigation', { name: 'Page location', exact: true });
    const label = location.locator('[aria-current="page"]');
    // Stress the rendered label without changing the persisted record or route metadata.
    await label.evaluate((element) => { element.textContent = 'A deliberately long translated equipment and asset record title for narrow phone navigation'; });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      expect(await label.evaluate((element) => element.scrollWidth > element.clientWidth && getComputedStyle(element).textOverflow === 'ellipsis')).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`long-label-fixture-${scheme}-320.png`) });
    }
    await location.getByRole('button', { name: 'Navigate within current section' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'breadcrumb', exact: true })).toBeVisible();
    await page.setViewportSize({ width: 320, height: 900 });
    await expect(location).toBeVisible();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await location.getByRole('button', { name: 'Navigate within current section' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
  });
});

test.describe('mobile Platform page location', () => {
  test.use({ storageState: STAFF_STORAGE_STATE, viewport: { width: 390, height: 844 } });
  test('uses the authorized system navigation and semantic provider parent', async ({ page }) => {
    await page.goto(platformUrl('providers/twilio'));
    await page.getByRole('button', { name: 'Navigate within current section' }).click();
    await expect(page.getByRole('menuitem', { name: 'Providers', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('menuitem', { name: 'CRM', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('link', { name: 'Back to parent' })).toHaveAttribute('href', platformUrl('providers'));
  });
});

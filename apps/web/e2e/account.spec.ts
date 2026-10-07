import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

test('reaches Account through the one Settings entry, and its breadcrumbs return to the business', async ({
  page,
}) => {
  const ctx = loadDemoContext();

  await page.goto(`/organizations/${ctx.organizationId}/home`);

  // The sidebar footer's account button shows the signed-in email as its visible text.
  const accountTrigger = page.getByRole('button').filter({ hasText: ctx.ownerEmail });
  await expect(accountTrigger).toBeVisible();
  await accountTrigger.click();
  // Radix's DropdownMenuItem renders `role="menuitem"` even when it wraps a Link via `asChild`
  // — not `role="link"`, which is what the underlying `<a>` would suggest. There is one Settings
  // entry now (D71); it opens the Settings landing chooser.
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('link', { name: /^Account Your/ }).click();

  await expect(page).toHaveURL(`/settings/account?org=${ctx.organizationId}`);
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
  await expect(page.getByText(ctx.ownerEmail).first()).toBeVisible();

  // The retired address lands here rather than on a second surface.
  await page.goto('/account');
  await expect(page).toHaveURL('/settings/account');

  // The Settings breadcrumb returns to the business's landing chooser.
  await page.goto(`/settings/account?org=${ctx.organizationId}`);
  await page.getByRole('navigation', { name: 'breadcrumb' }).getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(`/organizations/${ctx.organizationId}/settings`);
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 900 }, { width: 390, height: 844 }]) {
  test(`profile edits persist at ${viewport.width}px without overflow or page errors`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/settings/account');
    await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: /Profile photo/ })).toBeVisible();
    await expect(page.getByLabel('Avatar URL')).toHaveCount(0);
    const city = page.getByLabel('City', { exact: true });
    const original = await city.inputValue();
    try {
      await city.fill(`Kyoto ${viewport.width}`);
      await page.getByRole('button', { name: 'Save profile', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
      await page.reload();
      await expect(city).toHaveValue(`Kyoto ${viewport.width}`);
      await expect(page.getByRole('button', { name: 'Send email verification code' })).toBeVisible();
      await expect(page.getByLabel('New email address')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Security & sign-in', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`profile-${viewport.width}.png`), fullPage: true });
      for (const heading of ['Contact information', 'Regional preferences', 'Email verification / change email']) {
        const section = page.getByRole('region', { name: heading, exact: true });
        await section.screenshot({ path: testInfo.outputPath(`${heading.split(' ')[0].toLowerCase()}-${viewport.width}.png`) });
      }
      await page.getByRole('button', { name: 'Change email address', exact: true }).click({ trial: true });
      expect(errors).toEqual([]);
    } finally {
      await city.fill(original);
      await page.getByRole('button', { name: 'Save profile', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Profile saved.' })).toBeVisible();
    }
  });
}

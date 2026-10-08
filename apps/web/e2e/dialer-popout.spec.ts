import { expect, test } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

test('compact dialer preserves its draft across workspace navigation and window closure', async ({ page }, testInfo) => {
  const { organizationId } = loadDemoContext();
  await page.goto(`/organizations/${organizationId}/calls`);
  await page.getByRole('button', { name: 'New call', exact: true }).click();
  await page.getByLabel('Number to call', { exact: true }).fill('+1514555012');
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Pop out dialer', exact: true }).click();
  const popup = await popupPromise;
  await expect(popup.getByRole('heading', { name: 'Dialer', exact: true })).toBeVisible();
  await popup.getByRole('button', { name: 'Dial 3', exact: true }).click();
  await expect(popup.getByLabel('Number to call')).toHaveValue('+15145550123');
  await popup.screenshot({ path: testInfo.outputPath('dialer-popout-desktop.png') });

  await page.locator(`a[href="/organizations/${organizationId}/comms"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/organizations/${organizationId}/comms$`));
  await expect(popup.getByLabel('Number to call')).toHaveValue('+15145550123');
  await popup.setViewportSize({ width: 390, height: 844 });
  expect(await popup.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await popup.screenshot({ path: testInfo.outputPath('dialer-popout-mobile.png') });

  await page.goBack();
  await page.getByRole('button', { name: 'New call', exact: true }).click();
  await expect(page.getByText('The dialer is open in a separate window.')).toBeVisible();
  await popup.close();
  await expect(page.getByLabel('Number to call')).toBeVisible();
});

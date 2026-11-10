import { expect, test } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';
import { chooseOption, selectedLabel } from './select-field';

test.use({ storageState: OWNER_STORAGE_STATE });

test('Communications empty and unavailable states fit each canvas and preserve navigation', async ({ page }, info) => {
  test.setTimeout(180_000);
  const organizationId = loadDemoContext().organizationId;
  const base = `/organizations/${organizationId}`;
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/comms`);
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeAttached();
    if (width >= 768) await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText('Communications');
    await expect(page.getByRole('status').filter({ hasText: 'Calling isn’t enabled yet.' })).toBeVisible();
    await expect(page.getByText('Needs Setting Up', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Routing setup/ })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`dashboard-${width}.png`), fullPage: true });

    await page.goto(`${base}/calls`);
    if (width >= 768) await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText('Communications');
    const readiness = page.getByRole('region', { name: 'Calling readiness' });
    await expect(readiness).toHaveText('Calling isn’t enabled yet.');
    await expect(readiness.getByRole('link')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Call', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Call', exact: true })).toHaveAccessibleDescription('Calling isn’t enabled yet.');
    await expect(page.getByRole('region', { name: 'Call workflow' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`dialer-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: 'Call history', exact: true }).click();
    await expect(page.locator('#call-history')).toHaveAttribute('open', '');

    await page.goto(`${base}/comms/inbox?q=sample&channel=email&status=waiting`);
    await expect(page.getByText('No conversations match this search.')).toBeVisible();
    await expect(page.getByText('Select a conversation', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Messaging channel', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`conversations-${width}.png`), fullPage: true });
    await page.getByRole('navigation', { name: 'Conversation views' }).getByRole('link', { name: /^Mine/ }).click();
    await expect(page).toHaveURL(/view=mine/);
    await expect(page).toHaveURL(/q=sample/);
    await chooseOption(page.getByRole('combobox', { name: 'Messaging channel' }), 'SMS');
    await expect(page).toHaveURL(/channel=sms/);
    await expect(page).toHaveURL(/status=waiting/);
    await page.getByRole('searchbox', { name: 'Search conversations' }).fill('Alice');
    await page.getByRole('button', { name: 'Search conversations', exact: true }).click();
    await expect(page).toHaveURL(/q=Alice/);
    await page.reload();
    await expect(page.getByRole('searchbox', { name: 'Search conversations' })).toHaveValue('Alice');
    await expect(selectedLabel(page.getByRole('combobox', { name: 'Messaging channel' }))).toHaveText('SMS');
  }
});

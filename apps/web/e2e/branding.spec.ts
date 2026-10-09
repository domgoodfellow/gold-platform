import { test, expect, type Page } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE, provisionBrowserOrganization } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

const SHOTS = process.env.BRANDING_SHOTS;

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

const computed = (page: Page, selector: string, property: string) =>
  page.locator(selector).first().evaluate((element, prop) => getComputedStyle(element).getPropertyValue(prop), property);

test.describe.configure({ mode: 'serial' });

test('brand journey: draft previews, saves, applies to shared controls, stays in its organization, resets', async ({ page }) => {
  const ctx = loadDemoContext();
  const branding = `/organizations/${ctx.organizationId}/settings/branding`;

  await page.goto(branding);
  await expect(page.getByRole('heading', { name: 'Branding', level: 1 })).toBeVisible();

  // A previous interrupted run may have left a brand saved; start from the platform default.
  if ((await page.getByLabel('Hex value').inputValue()) !== '' || (await page.getByRole('button', { name: 'Use platform default' }).isEnabled())) {
    await page.getByRole('button', { name: 'Use platform default' }).click();
    await page.getByRole('button', { name: 'Save appearance' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.reload();
  }
  await shot(page, 'default-desktop');

  const preview = page.getByTestId('brand-preview');
  const save = page.getByRole('button', { name: 'Save appearance' });
  await expect(save).toBeDisabled();

  // Unsaved draft changes the preview and nothing else.
  await page.getByRole('button', { name: 'Blue', exact: true }).click();
  await expect(preview).toHaveCSS('--accent', '#2563eb');
  // The shared link variant reads the derived link role, not the neutral foreground.
  await expect(page.getByRole('button', { name: 'View all' })).toHaveCSS('color', 'rgb(37, 99, 235)');
  expect(await computed(page, 'button:has-text("Save appearance")', 'background-color')).not.toBe('rgb(37, 99, 235)');

  // A malformed hex is rejected, not drawn.
  const hex = page.getByLabel('Hex value');
  await hex.fill('#12');
  await expect(page.getByText('That is not a colour')).toBeVisible();
  await expect(save).toBeDisabled();
  await hex.fill('#2563eb');

  await page.getByRole('radio', { name: /Traditional/ }).nth(1).check({ force: true });
  await expect(preview).toHaveCSS('--font-body', /Georgia/);
  await shot(page, 'draft-desktop');

  await save.click();
  await expect(page.getByText('Saved.')).toBeVisible();

  // Survives reload; shared controls now carry the accent; body font reaches inherited text.
  await page.reload();
  await expect(page.getByLabel('Hex value')).toHaveValue('#2563eb');
  expect(await computed(page, 'button:has-text("Save appearance")', 'background-color')).toBe('rgb(37, 99, 235)');
  expect(await computed(page, '[data-brand] main', 'font-family')).toMatch(/Georgia/);

  // Another workspace, same organization: the primary control follows.
  await page.goto(`/organizations/${ctx.organizationId}/home`);
  await shot(page, 'other-workspace-branded');
  expect(await computed(page, '[data-brand]', '--accent')).toBe('#2563eb');

  // A different organization does not inherit it.
  const other = await provisionBrowserOrganization(`Brand isolation ${Date.now()}`);
  await page.goto(`/organizations/${other.organizationId}/home`);
  await expect(page.locator('[data-brand]').first()).toBeVisible();
  expect((await computed(page, '[data-brand]', '--accent')).trim()).not.toBe('#2563eb');

  // Reset to platform default, save, reload.
  await page.goto(branding);
  await page.getByRole('button', { name: 'Use platform default' }).click();
  await expect(preview).toHaveCSS('--accent', '#171717');
  await page.getByRole('button', { name: 'Save appearance' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Hex value')).toHaveValue('');
  expect((await computed(page, '[data-brand]', '--accent')).trim()).not.toBe('#2563eb');
});

test('branding page has no horizontal overflow on a phone and tablet, and previews dark', async ({ page }) => {
  const ctx = loadDemoContext();
  for (const [label, size] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }]] as const) {
    await page.setViewportSize(size);
    await page.goto(`/organizations/${ctx.organizationId}/settings/branding`);
    await page.getByRole('button', { name: 'Violet', exact: true }).click();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.getByRole('button', { name: 'Customer page' }).click();
    await shot(page, `${label}-dark-customer`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${label} overflows horizontally`).toBeLessThanOrEqual(0);
  }
});

test('domains owns the booking address and public profile has its own page', async ({ page }) => {
  const ctx = loadDemoContext();
  await page.goto(`/organizations/${ctx.organizationId}/settings/domains`);
  await expect(page.getByRole('heading', { name: 'Public booking address' })).toBeVisible();
  await page.goto(`/organizations/${ctx.organizationId}/settings/public-profile`);
  await expect(page.getByRole('heading', { name: 'Public profile', level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeVisible();
  await page.goto(`/organizations/${ctx.organizationId}/settings/branding`);
  await expect(page.getByLabel('Name shown to customers')).toHaveCount(0);
});

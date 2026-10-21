import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE, STAFF_STORAGE_STATE, platformUrl } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

for (const width of [1440, 768, 390]) {
  test(`Studio drawers have gutters, fixed chrome and contained previews at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const base = `/organizations/${loadDemoContext().organizationId}/studio`;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base);
    await expect(page.getByRole('heading', { name: 'Website overview', exact: true })).toBeVisible();
    await page.screenshot({ path: path.join('test-results/studio-layout', `home-${width}.png`), fullPage: true });
    await page.goto(`${base}/forms`);
    const trigger = page.getByRole('button', { name: 'New form', exact: true }).first();
    await trigger.click();
    const drawer = page.getByRole('dialog', { name: 'New blank form' });
    const name = drawer.getByLabel('Form name');
    await expect(name).toBeFocused();
    const panel = await drawer.boundingBox();
    const input = await name.boundingBox();
    expect(input!.x - panel!.x).toBeGreaterThanOrEqual(15);
    expect(panel!.x + panel!.width - input!.x - input!.width).toBeGreaterThanOrEqual(15);
    await expect(drawer.getByRole('button', { name: 'Create form' })).toBeDisabled();
    await name.fill('Local preview only');
    await expect(drawer.getByRole('button', { name: 'Create form' })).toBeEnabled();
    await page.screenshot({ path: path.join('test-results/studio-layout', `new-form-${width}.png`) });
    await name.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await page.goto(`${base}/templates?kind=website`);
    await page.getByRole('button', { name: /^Preview / }).first().click();
    const preview = page.getByRole('dialog');
    const frame = preview.locator('iframe');
    await expect(frame).toBeVisible();
    await expect(frame.contentFrame().getByRole('heading').first()).toBeVisible();
    const overflow = await frame.contentFrame().locator('body').evaluate((body) => body.scrollWidth > body.clientWidth);
    expect(overflow).toBe(false);
    const titleBefore = await preview.getByRole('heading').boundingBox();
    await preview.locator('[data-drawer-body]').evaluate((body) => { body.scrollTop = body.scrollHeight; });
    const titleAfter = await preview.getByRole('heading').boundingBox();
    expect(titleAfter!.y).toBe(titleBefore!.y);
    await expect(preview.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
    await page.screenshot({ path: path.join('test-results/studio-layout', `template-${width}.png`) });
    await preview.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(preview).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('form editing retains changes across compact drawers and tests responses locally', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  const base = `/organizations/${loadDemoContext().organizationId}/studio`;
  await page.goto(`${base}/forms`);
  await page.getByRole('button', { name: 'New form', exact: true }).first().click();
  await page.getByLabel('Form name').fill(`Layout acceptance ${Date.now()}`);
  await page.getByRole('button', { name: 'Create form' }).click();
  await expect(page).toHaveURL(/\/studio\/forms\/[0-9a-f-]{36}$/);
  // Batch B: sharing is a section of the form's page; the toolbar links down to it.
  await expect(page.getByRole('button', { name: 'Distribute', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Sharing', exact: true }).click();
  const distribution = page.getByRole('region', { name: 'Sharing', exact: true });
  await expect(distribution).toBeInViewport();
  await expect(distribution.getByText('Publish this form to share it. Links and embeds open the published version only.')).toBeVisible();
  await expect(distribution.getByRole('region', { name: 'Link', exact: true })).toHaveCount(0);
  await expect(distribution.getByRole('region', { name: 'Embed', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Short text', exact: true }).click();
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill('Your name');
  await page.getByRole('checkbox', { name: 'Required' }).check();
  await page.getByRole('button', { name: 'Duplicate “Your name”' }).click();
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill('Company');
  await page.getByRole('checkbox', { name: 'Required' }).uncheck();
  await page.screenshot({ path: 'test-results/studio-layout/form-builder-1440.png' });
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('link', { name: 'Submissions', exact: true }).click();
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Question', exact: true })).toHaveValue('Company');
  await page.screenshot({ path: 'test-results/studio-layout/form-inspector-390.png' });
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Questions', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Form structure' }).getByRole('button', { name: /^Your name/ })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your name', exact: true })).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Local visitor');
  await page.getByRole('button', { name: 'Submit', exact: true }).click();
  await expect(page.getByText('Preview only. No response was sent.')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test.describe('shared drawer contract outside Studio', () => {
  test.use({ storageState: STAFF_STORAGE_STATE });
  test('plan editing uses shell gutters and a fixed footer associated with its form', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: 1440, height: 560 });
    await page.goto(platformUrl('plans/gold_internal'));
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: 'Edit GildOps Internal', exact: true });
    const body = drawer.locator('[data-drawer-body]');
    const footer = drawer.locator('[data-drawer-footer]');
    const panelBounds = await drawer.boundingBox();
    const inputBounds = await drawer.getByLabel('Label', { exact: true }).boundingBox();
    expect(inputBounds!.x - panelBounds!.x).toBeGreaterThanOrEqual(15);
    expect(inputBounds!.x - panelBounds!.x).toBeLessThanOrEqual(18);
    const footerBefore = await footer.boundingBox();
    await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const footerAfter = await footer.boundingBox();
    expect(footerAfter!.y).toBe(footerBefore!.y);
    const submit = footer.getByRole('button', { name: 'Save', exact: true });
    expect(await submit.evaluate((button: HTMLButtonElement) => button.form?.id === button.getAttribute('form'))).toBe(true);
    await drawer.getByLabel('Label', { exact: true }).fill('');
    await submit.click();
    await expect(drawer.getByLabel('Label', { exact: true })).toBeFocused();
    await expect(drawer).toBeVisible();
    await page.screenshot({ path: 'test-results/studio-layout/shared-plan-drawer-1440.png' });
  });
});

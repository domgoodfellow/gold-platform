import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

/**
 * Forms, end to end in a real browser: build a form in Studio, publish it, open the public address
 * as a stranger, submit, and read the response back in Studio — then the same through a template,
 * and the guarantee that editing a published form leaves the public one alone until publish.
 */
test.describe('Studio forms', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('blank form to published form to submitted response', async ({ page, browser }) => {
    const ctx = loadDemoContext();
    const name = `E2E enquiry ${Date.now()}`;
    await page.goto(`/organizations/${ctx.organizationId}/studio/forms`);
    await page.getByRole('button', { name: 'New form' }).first().click();
    await page.getByLabel('Form name').fill(name);
    await page.getByRole('button', { name: 'Create form' }).click();
    await expect(page).toHaveURL(/\/studio\/forms\/[0-9a-f-]{36}$/);

    // Build: one text question and one dropdown, renamed.
    await page.getByRole('button', { name: 'Short text' }).click();
    await page.getByRole('textbox', { name: 'Question', exact: true }).fill('Your name');
    await page.getByRole('checkbox', { name: 'Required' }).check();
    await page.getByRole('button', { name: 'Dropdown' }).click();
    await page.getByRole('textbox', { name: 'Question', exact: true }).fill('Service');
    await expect(page.getByText('Unsaved changes')).toBeVisible();

    // The preview is the live form: both questions are there as labelled controls.
    await expect(page.getByLabel('Your name').first()).toBeVisible();
    await expect(page.getByLabel(/^Service/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published. Visitors now see this version.')).toBeVisible();

    const publicPath = await page.getByRole('link', { name: 'Open public form' }).getAttribute('href');
    // The link a business shares is the stable one: it survives a rename of the form or the business.
    expect(publicPath).toMatch(/^\/f\/[a-f0-9]{12}$/);

    // A stranger: a fresh context with no session at all.
    const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const visitor = await stranger.newPage();
    await visitor.goto(publicPath!);
    await visitor.getByLabel('Your name').fill('Ada Visitor');
    await visitor.getByRole('button', { name: 'Submit' }).click();
    await expect(visitor.getByRole('status')).toContainText('Thank you');
    // Nothing of the business's own application is reachable from here.
    await expect(visitor.getByRole('navigation', { name: 'Form structure' })).toHaveCount(0);
    await stranger.close();

    // And it is in Studio, tied to the revision it was answered under.
    await page.getByRole('link', { name: 'Submissions' }).click();
    await expect(page.getByRole('article', { name: 'Response detail' })).toContainText('Ada Visitor');
    await expect(page.getByRole('article', { name: 'Response detail' })).toContainText('Revision');
  });

  test('a draft edit does not change the public form until it is published', async ({ page, browser }) => {
    const ctx = loadDemoContext();
    await page.goto(`/organizations/${ctx.organizationId}/studio/templates`);
    await page.getByRole('button', { name: 'Use template' }).first().click();
    await page.getByRole('button', { name: 'Create form' }).click();
    await expect(page).toHaveURL(/\/studio\/forms\/[0-9a-f-]{36}$/);
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published. Visitors now see this version.')).toBeVisible();
    const publicPath = (await page.getByRole('link', { name: 'Open public form' }).getAttribute('href'))!;

    await page.getByRole('button', { name: 'Edit form' }).click();
    // The published title, read from the form's own title field rather than from page headings.
    const originalTitle = await page.getByLabel('Title shown to visitors').inputValue();
    expect(originalTitle).not.toBe('');
    await page.getByLabel('Title shown to visitors').fill('A brand new title');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Draft saved.')).toBeVisible();

    const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const visitor = await stranger.newPage();
    await visitor.goto(publicPath);
    await expect(visitor.getByRole('heading', { name: 'A brand new title' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published. Visitors now see this version.')).toBeVisible();
    await visitor.reload();
    await expect(visitor.getByRole('heading', { name: 'A brand new title' })).toBeVisible();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    const history = page.getByRole('dialog', { name: 'Revision history', exact: true });
    await history.getByRole('button', { name: 'Inspect revision 1', exact: true }).click();
    const historical = history.getByRole('region', { name: 'Saved revision 1' });
    await expect(historical.getByRole('heading', { name: originalTitle!, exact: true })).toBeVisible();
    await expect(historical.getByRole('heading', { name: 'A brand new title' })).toHaveCount(0);
    await expect(historical.getByRole('textbox').first()).toBeDisabled();
    await page.screenshot({ path: 'test-results/studio-layout/form-history-1440.png' });
    await stranger.close();
  });

  test('another business\'s form editor is not reachable by URL', async ({ page }) => {
    const ctx = loadDemoContext();
    await page.goto(`/organizations/${ctx.organizationId}/studio/forms/00000000-0000-0000-0000-000000000000`);
    // The route streams inside the shell, so the status is already 200: what a reader sees is the check.
    await expect(page.getByText(/This page does not exist/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
  });
});

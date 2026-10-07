import { expect, test } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.describe('CRM reference vertical', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('finds and creates customers, opens detail, and reads the canonical pipeline', async ({ page }, testInfo) => {
    const ctx = loadDemoContext();
    const customerName = `E2E customer ${Date.now()}`;

    await page.goto(`/organizations/${ctx.organizationId}/sales`);
    await expect(page.getByRole('heading', { name: 'CRM', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Opportunity pipeline snapshot' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Recent CRM activity' })).toBeVisible();
    await expect(page.getByRole('search')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('crm-home-populated.png'), fullPage: true });

    await page.getByRole('button', { name: 'New customer' }).click();
    const createSheet = page.getByRole('dialog', { name: 'New customer' });
    await expect(createSheet).toBeVisible();
    await createSheet.getByLabel('Name').fill(customerName);
    await createSheet.getByRole('button', { name: 'Add customer' }).click();
    await expect(createSheet).toBeHidden();

    await expect(page.getByRole('region', { name: 'Recent customers' }).getByRole('link', { name: customerName })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search customers' }).fill(customerName);
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/customers\\?q=${encodeURIComponent(customerName).replace(/%20/g, '\\+')}`));
    await expect(page.getByRole('heading', { name: 'Customers', exact: true }).last()).toBeVisible();

    const customerLink = page.getByRole('link', { name: customerName });
    await expect(customerLink).toBeVisible();
    await customerLink.click();
    await expect(page.getByRole('heading', { name: customerName }).last()).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Activity' })).toBeVisible();
    await page.getByRole('tab', { name: 'Work' }).click();
    await expect(page.getByText('No work recorded for this customer.')).toBeVisible();

    await page.goto(`/organizations/${ctx.organizationId}/customers/pipeline`);
    await expect(page.getByRole('heading', { name: 'Pipeline' }).last()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stages' })).toBeVisible();
    const stageSelect = page.getByRole('combobox', {
      name: `Move ${customerName} to a different stage`,
    });
    await expect(stageSelect).toBeVisible();
    const initialStage = await stageSelect.inputValue();
    const target = await stageSelect.locator('option').evaluateAll(
      (options, current) => options.map((option) => (option as HTMLOptionElement).value).find((value) => value && value !== current),
      initialStage,
    );
    expect(target).toBeTruthy();
    await stageSelect.selectOption(target!);
    await expect(stageSelect).toBeEnabled();
    await page.reload();
    await expect(stageSelect).toHaveValue(target!);
    await page.goto(`/organizations/${ctx.organizationId}/sales`);
    await expect(page.getByRole('region', { name: 'Recent customers' }).getByRole('link', { name: customerName })).toBeVisible();
    await page.getByRole('button', { name: 'Insights', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Customer insights', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'CRM configuration', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Custom field settings' })).toHaveAttribute('href', `/organizations/${ctx.organizationId}/settings/custom-fields`);
    await expect(page.getByRole('link', { name: 'Relationship-stage settings' })).toHaveAttribute('href', `/organizations/${ctx.organizationId}/settings/sales-stages`);
  });
});

test.describe('Voice reference vertical', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('renders call history, wrap-up, outcomes, and outbound identity setup', async ({ page }) => {
    const ctx = loadDemoContext();
    await page.goto(`/organizations/${ctx.organizationId}/calls`);

    await expect(page.locator('main').getByRole('heading', { name: 'Voice' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent calls' })).toBeVisible();
    await expect(page.getByRole('table').getByText('Outbound')).toBeVisible();

    await page.getByRole('link', { name: 'Needs wrap-up' }).click();
    await expect(page.getByRole('heading', { name: 'Every call' })).toBeVisible();
    await page.getByRole('button', { name: 'Wrap up' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Wrap up call' })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    await page.goto(`/organizations/${ctx.organizationId}/calls`);
    await page.getByRole('button', { name: 'Voice settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Voice settings' });
    await expect(settings.getByRole('heading', { name: 'Call outcomes' })).toBeVisible();
    await expect(settings.getByText('Spoke', { exact: true })).toBeVisible();
    await expect(settings.getByLabel('The number this business dials from')).toBeVisible();
  });
});

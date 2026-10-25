import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { addContactManually, loadDemoContext, OWNER_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { createCustomerStage, listCustomerStages } from '../lib/domain/customers/stages';

test.describe('CRM reference vertical', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  // Rewritten for the current CRM (V1.2-V1.4): the Dashboard, the Add contacts intake, the
  // identity-led directory, sectioned records and the relationship board. Same intent as before:
  // create a contact, find it, open it, move it between relationship stages, and reach Insights
  // and configuration.
  test('creates and finds a contact, opens its record, and moves it on the relationship board', async ({ page }, testInfo) => {
    test.setTimeout(150_000);
    const ctx = loadDemoContext();
    const base = `/organizations/${ctx.organizationId}`;
    const customerName = `E2E contact ${Date.now()}`;
    loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test'), quiet: true });
    const owner = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await owner.auth.signInWithPassword({ email: ctx.ownerEmail, password: DEMO_PASSWORD }); if (login.error) throw login.error;
    // The board needs at least two stages to move between; reuse the business's own when present.
    const existing = await listCustomerStages(owner, { organizationId: ctx.organizationId });
    for (let index = existing.length; index < 2; index += 1) await createCustomerStage(owner, { organizationId: ctx.organizationId, name: `Voice stage ${index + 1} ${Date.now()}`, position: index + 10 });

    await page.goto(`${base}/crm`);
    await expect(page.getByRole('region', { name: 'Relationship overview' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('crm-home-populated.png'), fullPage: true });
    await addContactManually(page, { type: 'person', name: customerName });

    await page.goto(`${base}/crm/contacts`);
    await page.getByRole('searchbox', { name: 'Search contacts' }).fill(customerName);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/crm/contacts\\?.*q=${encodeURIComponent(customerName).replace(/%20/g, '\\+')}`));
    const customerLink = page.getByRole('link', { name: customerName, exact: true }).first();
    await expect(customerLink).toBeVisible();
    await customerLink.click();
    await expect(page.getByRole('heading', { name: customerName }).last()).toBeAttached();
    await expect(page.getByRole('link', { name: 'Activity', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Related', exact: true }).click();
    await expect(page.getByText('No work recorded for this customer.')).toBeVisible();

    await page.goto(`${base}/crm/contacts/stages`);
    const stageSelect = page.getByRole('combobox', { name: `Move ${customerName} to a different stage` });
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
    await expect(page.getByRole('combobox', { name: `Move ${customerName} to a different stage` })).toHaveValue(target!);

    await page.goto(`${base}/crm/contacts`);
    await page.getByRole('button', { name: 'Insights', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Contact insights', exact: true })).toBeVisible();
    await page.goto(`${base}/crm`);
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Customer fields' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Relationship stages' }).click();
    await expect(page).toHaveURL(`${base}/crm/configuration/relationship-stages`);
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

import path from 'node:path';
import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import { addContactManually, loadDemoContext, OWNER_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { createCustomerStage, listCustomerStages } from '../lib/domain/customers/stages';
import { chooseOption, optionValues, selectFieldValue } from './select-field';

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
    const initialStage = await selectFieldValue(stageSelect).inputValue();
    const target = (await optionValues(stageSelect)).find((value) => value && value !== initialStage);
    expect(target).toBeTruthy();
    await chooseOption(stageSelect, target!);
    await expect(stageSelect).toBeEnabled();
    await page.reload();
    await expect(selectFieldValue(page.getByRole('combobox', { name: `Move ${customerName} to a different stage` }))).toHaveValue(target!);

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

  test('opens the Dialer with its call list, calling workspace and call history, and its calling settings one menu away', async ({ page }) => {
    const ctx = loadDemoContext();
    await page.goto(`/organizations/${ctx.organizationId}/calls`);

    await expect(page.getByRole('heading', { name: 'Dialer', level: 1 })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Calling console' })).toBeVisible();
    // Below the console's three-column width the call list is one press away in the region switcher.
    const switcher = page.getByRole('group', { name: 'Dialer region' });
    if (await switcher.isVisible()) await switcher.getByRole('button', { name: 'Call list', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Call list' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Call history', level: 2 })).toBeVisible();

    // Calling configuration sits behind the toolbar's More menu, never on the working surface.
    await page.getByRole('button', { name: 'More Dialer actions' }).click();
    await page.getByRole('menuitem', { name: 'Calling & routing' }).click();
    await expect(page).toHaveURL(`/organizations/${ctx.organizationId}/comms/configuration/calling`);
  });
});

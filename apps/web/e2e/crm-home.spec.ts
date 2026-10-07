import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { loadDemoContext, OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { recordCommercialTerm } from '../lib/domain/commercial/terms';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';

test.describe('CRM Home empty organization', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('keeps empty structure, distinguishes pipeline setup and shows configured zero counts', async ({ page }, testInfo) => {
    loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test') });
    const url = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
    if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('CRM fixtures require a local database.');
    const key = process.env.SUPABASE_ANON_KEY ?? '';
    const options = { auth: { autoRefreshToken: false, persistSession: false } };
    const staff = createClient(url, key, options);
    const owner = createClient(url, key, options);
    const ctx = loadDemoContext();
    const staffLogin = await staff.auth.signInWithPassword({ email: 'staff@gold.test', password: DEMO_PASSWORD });
    if (staffLogin.error) throw staffLogin.error;
    const ownerLogin = await owner.auth.signInWithPassword({ email: ctx.ownerEmail, password: DEMO_PASSWORD });
    if (ownerLogin.error) throw ownerLogin.error;
    const organizationId = await provisionOrganization(staff, {
      ownerEmail: ctx.ownerEmail, name: `CRM empty acceptance ${Date.now()}`, currency: 'CAD', timezone: 'America/Toronto',
    });
    const home = `/organizations/${organizationId}/sales`;
    await page.goto(home);
    await expect(page.getByRole('heading', { name: 'CRM', exact: true })).toBeVisible();
    await expect(page.getByText('No opportunity stages configured')).toBeVisible();
    await expect(page.getByText('No customers have been added yet.')).toBeVisible();
    await expect(page.getByText('No CRM activity yet.')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('crm-home-empty-unavailable.png'), fullPage: true });

    await setModuleEnabled(owner, { organizationId, key: 'reception', enabled: true });
    await recordCommercialTerm(staff, {
      organizationId, productKey: 'module:reception', periodStart: new Date().toISOString().slice(0, 10),
      periodEnd: '9999-12-31', priceMinor: 0, note: 'Local CRM Home acceptance fixture',
    });
    await page.reload();
    await expect(page.getByText('No opportunity stages configured')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('crm-home-empty-setup.png'), fullPage: true });
    await page.getByRole('link', { name: 'Configure relationship stages' }).click();
    await expect(page).toHaveURL(`/organizations/${organizationId}/settings/sales-stages`);
    await page.getByRole('button', { name: 'Stages', exact: true }).click();
    await page.getByLabel('Stage name', { exact: true }).fill('Review together');
    await page.getByRole('button', { name: 'Add stage' }).click();
    await expect(page.getByLabel('Stage name', { exact: true })).toHaveCount(2);
    await expect(page.getByLabel('Stage name', { exact: true }).first()).toHaveValue('Review together');
    await page.goto(home);
    const pipeline = page.getByRole('region', { name: 'Opportunity pipeline snapshot' });
    await expect(pipeline.getByText('No opportunity stages configured')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Relationship pipeline', exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('crm-home-empty-stages.png'), fullPage: true });
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await page.getByRole('button', { name: 'New field', exact: true }).click();
    const fieldSheet = page.getByRole('dialog', { name: 'New field', exact: true });
    await fieldSheet.getByLabel('Label', { exact: true }).fill('Relationship note');
    await fieldSheet.getByLabel('Key', { exact: true }).fill('relationship_note');
    await fieldSheet.getByRole('button', { name: 'Add field', exact: true }).click();
    await expect(fieldSheet).toBeHidden();
    await page.reload();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: testInfo.outputPath('crm-home-empty-mobile.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'New customer', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: 'New customer' })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'New customer' }).getByLabel('Relationship note')).toBeVisible();
  });
});

test.describe('CRM Home reduced role', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });
  test('does not offer unauthorized customer creation or configuration', async ({ page }) => {
    await page.goto(`/organizations/${loadDemoContext().organizationId}/sales`);
    await expect(page.getByRole('heading', { name: 'CRM', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New customer', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Import customers' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Configure', exact: true })).toHaveCount(0);
  });
});

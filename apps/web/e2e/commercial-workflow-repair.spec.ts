import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect, type Page } from '@playwright/test';
import { OWNER_STORAGE_STATE } from './helpers';
import { provisionFinanceBusiness, signInOwner } from './finance-fixtures';
import { chooseOption, selectedLabel } from './select-field';
import { guardedShot } from './visual-guard';
import { createCustomer } from '../lib/domain/customers/customers';
import { createWorkItemType } from '../lib/domain/work-items/types';
import { createPriceBookItem } from '../lib/domain/pricing/price-book';
import { listCommercialProposals, acceptCommercialProposal } from '../lib/domain/customers/commercial-proposals';
import { claimProposalInvite, createProposalInvite } from '../lib/domain/customers/proposal-invites';

const OUT = path.join(__dirname, '../../../.artifacts/workflow-repair');
let owner: { db: SupabaseClient; userId: string; ownerEmail: string };
let organizationId: string, customerId: string, itemId: string, oilId: string, typeId: string, quoteId: string, pricedWork: string;
const base = () => `/organizations/${organizationId}`;
const commercial = () => `${base()}/crm/contacts/${customerId}?section=sales&view=commercial`;
const count = async (table: 'work_items' | 'work_item_priced_lines') => (await owner.db.from(table).select('id', { count: 'exact', head: true }).eq('organization_id', organizationId)).count;
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

test.describe.serial('Commercial workflow repair', () => {
  test.use({ storageState: OWNER_STORAGE_STATE, actionTimeout: 15000 });
  test.beforeAll(async () => {
    owner = await signInOwner();
    organizationId = await provisionFinanceBusiness(owner, `Workflow repair ${Date.now()}`);
    customerId = await createCustomer(owner.db, { organizationId, name: 'Workflow Customer', email: 'workflow@example.test' });
    oilId = await createWorkItemType(owner.db, { organizationId, name: 'Oil Change', schedulable: true });
    itemId = await createPriceBookItem(owner.db, { organizationId, name: 'Garden design', unit: 'visit', unitAmountMinor: 12000 });
    await createPriceBookItem(owner.db, { organizationId, name: 'Maintenance charge', unit: 'month', unitAmountMinor: 5000 });
    await createPriceBookItem(owner.db, { organizationId, name: 'Consultation', unit: 'hour', unitAmountMinor: 9000 });
  });

  test('creates a customer quote before any Work and preserves its accepted terms', async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base()}/finance`);
    await expect(page.getByText(/Pricing configured/)).toBeVisible();
    await page.getByRole('button', { name: 'New quote', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New quote', exact: true });
    await expect(dialog.getByRole('radio', { name: 'Customer quote', exact: true })).toBeChecked();
    await dialog.getByText('Workflow Customer', { exact: true }).click();
    await chooseOption(dialog.getByLabel('Price item 1', { exact: true }), itemId);
    await dialog.getByLabel('Quantity 1', { exact: true }).fill('2');
    await dialog.getByRole('button', { name: 'Create quote', exact: true }).click();
    await expect(dialog.getByText('Customer quote created', { exact: true })).toBeVisible();
    expect(await count('work_items')).toBe(0);
    await dialog.getByRole('link', { name: 'Open quote', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/crm/contacts/${customerId}`));
    const proposals = await listCommercialProposals(owner.db, { organizationId, customerId });
    quoteId = proposals[0].id;
    expect(proposals[0].catalogTotalMinor).toBe(24000);
    await page.getByRole('button', { name: 'Mark sent', exact: true }).click();
    await expect(page.getByText('sent', { exact: true })).toBeVisible();
    const token = await createProposalInvite(owner.db, { customerId });
    const visitor = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    await claimProposalInvite(visitor, { token });
    await acceptCommercialProposal(visitor, { proposalId: quoteId });
    await page.reload();
    await expect(page.getByText('accepted', { exact: true })).toBeVisible();
  });

  test('creates a Work type beside an unusable test type, then links service delivery', async ({ page }) => {
    test.setTimeout(120000);
    await page.goto(`${base()}/work/new`);
    await expect(selectedLabel(page.getByLabel('Work type', { exact: true }))).toHaveText('Choose a Work type');
    await expect(page.getByLabel('Starting stage', { exact: true })).toHaveCount(0);
    await page.getByRole('link', { name: 'New Work type', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New work type', exact: true });
    await dialog.getByLabel('Name', { exact: true }).fill('Garden visits');
    await dialog.getByRole('radio', { name: /^Not scheduled/ }).check();
    await dialog.getByRole('button', { name: 'Create type', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(/work\/configuration\?.*type=/);
    typeId = new URL(page.url()).searchParams.get('type')!;
    await expect(page.getByRole('list', { name: 'Stages in order' }).getByRole('listitem').first()).toContainText('Starts here');
    await page.getByRole('tab', { name: 'General', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Garden delivery');
    await page.getByRole('button', { name: 'Save name', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Garden delivery', exact: true })).toBeVisible();
    await page.goto(`${base()}/finance/catalog`);
    const field = page.getByLabel('Delivery Work type for Garden design', { exact: true });
    await chooseOption(field, typeId);
    await field.locator('xpath=ancestor::form').getByRole('button', { name: 'Save delivery type' }).click();
    await expect(page.getByRole('link', { name: 'Create Work from Garden design', exact: true })).toBeVisible();
    await page.goto(commercial());
    await page.getByRole('link', { name: 'Create delivery: Garden design', exact: true }).click();
    await expect(selectedLabel(page.getByLabel('Work type', { exact: true }))).toHaveText('Garden delivery');
    await page.getByLabel('Job title', { exact: true }).fill('Deliver accepted garden quote');
    await page.getByRole('button', { name: 'Create work', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Open accepted customer quote', exact: true })).toBeVisible();
    expect(await count('work_item_priced_lines')).toBe(0);
    await page.goto(`${base()}/finance/catalog`);
    await page.getByRole('link', { name: 'Create Work from Garden design', exact: true }).click();
    await page.getByLabel('Job title', { exact: true }).fill('Separately priced garden Work');
    await page.getByRole('button', { name: 'Create work', exact: true }).click();
    await expect(page).toHaveURL(/\/work\/[a-f0-9-]+\?tab=financials/);
    pricedWork = new URL(page.url()).pathname.split('/').at(-1)!;
    expect(await count('work_item_priced_lines')).toBe(1);
  });

  test('keeps navigation, dialogs and keyboard access usable at phone, tablet and desktop widths', async ({ page }) => {
    test.setTimeout(180000);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base()}/finance/catalog`);
      await fits(page);
      await guardedShot(page, { url: `${base()}/finance/catalog`, content: page.getByRole('heading', { name: 'Price book' }) }, { path: path.join(OUT, `catalog-${width}.png`), fullPage: true });
      await page.goto(`${base()}/finance/quotes`);
      const trigger = page.getByRole('button', { name: 'New quote', exact: true });
      await trigger.focus(); await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'New quote', exact: true });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('radio', { name: /Workflow Customer/ })).toHaveCount(1);
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
      await fits(page);
      await guardedShot(page, { url: `${base()}/finance/quotes`, content: dialog }, { path: path.join(OUT, `quote-${width}.png`), fullPage: true });
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
      await page.goto(`${base()}/work/new?type=${typeId}&service=${itemId}`);
      await expect(page.getByLabel('Job title', { exact: true })).toBeVisible();
      await fits(page);
      await guardedShot(page, { url: new RegExp(`/organizations/${organizationId}/work/new`), content: page.getByLabel('Job title', { exact: true }) }, { path: path.join(OUT, `work-new-${width}.png`), fullPage: true });
      await page.goto(`${base()}/work/configuration?type=${typeId}&tab=general`);
      await expect(page.getByRole('button', { name: 'Archive Work type', exact: true })).toBeVisible();
      await fits(page);
      await guardedShot(page, { url: new RegExp(`/organizations/${organizationId}/work/configuration`), content: page.getByRole('button', { name: 'Archive Work type', exact: true }) }, { path: path.join(OUT, `work-types-${width}.png`), fullPage: true });
      await page.goto(`${base()}/crm/contacts`);
      const contactFields = page.getByRole('link', { name: 'Contact fields', exact: true });
      await contactFields.focus(); await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp('/crm/configuration/fields'));
      await expect(page.getByRole('heading', { name: 'Contact fields', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Opportunity stages', exact: true })).toHaveCount(0);
      await fits(page);
      await page.goto(`${base()}/crm/pipeline`);
      await expect(page.getByRole('link', { name: 'Set up stages', exact: true })).toHaveCount(1);
      await expect(page.getByRole('link', { name: 'Opportunity stages', exact: true })).toHaveCount(0);
      await fits(page);
      await guardedShot(page, { url: `${base()}/crm/pipeline`, content: page.getByRole('heading', { name: 'Set up your pipeline' }) }, { path: path.join(OUT, `pipeline-${width}.png`), fullPage: true });
    }
  });

  test('archives the delivery type without changing existing Work or deleting the original test type', async ({ page }) => {
    await page.goto(`${base()}/work/configuration?type=${typeId}&tab=general`);
    await page.getByRole('button', { name: 'Archive Work type', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Restore Work type', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete unused type', exact: true })).toHaveCount(0);
    await page.goto(`${base()}/work/new`);
    await page.getByLabel('Work type', { exact: true }).click();
    await expect(page.getByRole('option', { name: 'Garden delivery', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto(`${base()}/work/${pricedWork}?tab=financials`);
    await expect(page.getByText(/Garden design/).first()).toBeVisible();
    expect(await count('work_items')).toBe(2);
    expect((await owner.db.from('work_item_types').select('archived_at').eq('id', oilId).single()).data).toEqual({ archived_at: null });
  });
});

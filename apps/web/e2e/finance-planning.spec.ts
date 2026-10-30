import path from 'node:path';
import { Client } from 'pg';
import { test, expect } from '@playwright/test';
import { OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE, loadDemoContext } from './helpers';
import { signInOwner, populateFinanceBusiness, provisionFinanceBusiness } from './finance-fixtures';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { recordCost } from '../lib/domain/work-items/consumption';
import { organizationResolvedFeatureStates, disableOrganizationFeature, enableOrganizationFeature, currentPlanAssignment, recordPlanAssignment } from '../lib/domain/catalogue/organization-plans';
import { guardedShot } from './visual-guard';

const baseline = process.env.FINANCE_E1_BASELINE === '1';
const out = path.join(__dirname, '../../../.artifacts/finance-e1', baseline ? 'before' : 'after');
test.describe.serial('Finance pricing planning', () => {
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const { db } = await signInOwner();
    const organizationId = loadDemoContext().organizationId;
    await setModuleEnabled(db, { organizationId, key: 'billing', enabled: true });
  });
  test.use({ storageState: OWNER_STORAGE_STATE });
  test('empty business and populated business at every requested width; edits never persist', async ({ page }) => {
    test.setTimeout(240_000);
    const clientErrors: string[] = [];
    page.on('pageerror', error => clientErrors.push(error.message));
    const { organizationId } = loadDemoContext();
    const { db } = await signInOwner();
    const url = `/organizations/${organizationId}/finance/reports`;
    for (const populated of [false, true]) {
      if (populated) {
        const fx = await populateFinanceBusiness(db, organizationId);
        await recordCost(db, { workItemId: fx.work.overdueA, description: 'Recorded supplier receipt', amountMinor: 8500 });
      }
      const snapshot = async () => Promise.all(['price_book_items', 'work_item_types', 'work_items', 'work_item_priced_lines', 'work_item_costs', 'invoices', 'invoice_lines', 'payments'].map(async table => {
        const { data, error } = await db.from(table).select('*').eq('organization_id', organizationId).order('id');
        if (error) throw error;
        return data;
      }));
      const before = await snapshot();
      for (const width of [390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 1100 });
        await page.goto(url);
        await expect(page.getByRole('heading', { name: 'Financial performance', exact: true })).toBeVisible();
        if (!baseline) {
          const scenario = page.getByRole('group', { name: 'Scenario 1', exact: true });
          await expect(scenario).toContainText('Unknown');
          await scenario.getByLabel('Currency', { exact: true }).selectOption('EUR');
          await scenario.getByLabel('Labor quantity (hours)').fill('2');
          await scenario.getByLabel('Labor cost per hour').fill('40');
          await scenario.getByLabel('Materials cost').fill('20');
          await scenario.getByLabel('Supplier cost').fill('10');
          await scenario.getByLabel('Other estimated cost').fill('10');
          await scenario.getByLabel('Target gross margin (%)').fill('25');
          await expect(scenario.getByTestId('suggested-price')).toContainText('160.00');
          if (populated) {
            await scenario.getByLabel('Compare one catalog unit').selectOption({ label: 'Service visit · visit · EUR' });
            await expect(scenario).toContainText('145.00');
          }
          await page.getByRole('button', { name: 'Compare another scenario' }).click();
          const second = page.getByRole('group', { name: 'Scenario 2', exact: true });
          await second.getByLabel('Target gross margin (%)').fill('40');
          await expect(second.getByTestId('suggested-price')).toContainText('200.00');
          await expect(scenario.getByTestId('suggested-price')).toContainText('160.00');
        }
        await page.waitForLoadState('networkidle');
        const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, fields: [...document.querySelectorAll('main input, main select')].map(node => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right }; }) }));
        expect(geometry.document).toBeLessThanOrEqual(width + 1);
        expect(geometry.fields.every(r => r.left >= 0 && r.right <= width + 1)).toBe(true);
        // The shell scrolls internally; capture the entire composition at the same width.
        const contentHeight = await page.locator('main').evaluate(node => node.scrollHeight);
        await page.setViewportSize({ width, height: Math.max(1100, contentHeight + 100) });
        await guardedShot(page, { url, content: page.getByRole('heading', { name: 'Financial performance', exact: true }) }, { path: path.join(out, `${populated ? 'populated' : 'empty'}-${width}.png`), fullPage: true });
      }
      expect(await snapshot()).toEqual(before);
      if (!baseline) {
        await page.reload();
        await expect(page.getByRole('group', { name: 'Scenario 1', exact: true })).toContainText('Unknown');
        await expect(page.getByRole('group', { name: 'Scenario 2', exact: true })).toHaveCount(0);
      }
    }
    expect(clientErrors).toEqual([]);
  });
  test('unknown, documented zero, invalid inputs and foreign currency stay explicit', async ({ page }) => {
    if (baseline) return;
    const url = `/organizations/${loadDemoContext().organizationId}/finance/reports`;
    await page.goto(url);
    const scenario = page.getByRole('group', { name: 'Scenario 1', exact: true });
    for (const label of ['Labor quantity (hours)', 'Labor cost per hour', 'Materials cost', 'Supplier cost', 'Other estimated cost']) await scenario.getByLabel(label).fill('0');
    await scenario.getByLabel('Target gross margin (%)').fill('25');
    await expect(scenario).toContainText('Explain each zero-cost assumption');
    await scenario.getByLabel('Zero-cost assumptions').fill('Volunteer work; no purchased inputs.');
    await expect(scenario.getByTestId('suggested-price')).toContainText('0.00');
    await expect(scenario).toContainText('no defined gross margin');
    await scenario.getByLabel('Materials cost').fill('-1');
    await expect(scenario.getByTestId('suggested-price')).toContainText('Unknown');
    await scenario.getByLabel('Materials cost').fill('20');
    await scenario.getByLabel('Target gross margin (%)').fill('100');
    await expect(scenario.getByLabel('Target gross margin (%)')).toHaveAttribute('aria-invalid', 'true');
    await scenario.getByLabel('Target gross margin (%)').fill('25');
    await scenario.getByLabel('Compare one catalog unit').selectOption({ label: 'Cross-border consultation · hour · USD' });
    await expect(scenario).toContainText('Different currencies');
    await scenario.getByLabel('Currency', { exact: true }).selectOption('JPY');
    await expect(scenario.getByLabel('Materials cost')).toHaveValue('');
  });
  test('reduced role cannot open reports or planning', async ({ browser }) => {
    const context = await browser.newContext({ storageState: COLLEAGUE_STORAGE_STATE });
    const page = await context.newPage();
    await page.goto(`/organizations/${loadDemoContext().organizationId}/finance/reports`);
    await expect(page.getByRole('group', { name: 'Scenario 1', exact: true })).toHaveCount(0);
    await expect(page.getByText(/Your role cannot read financial reports|This page does not exist/)).toBeVisible();
    await context.close();
  });
  test('disabled report features and nonmembership refuse the planner on direct navigation', async ({ page, browser }) => {
    if (baseline) return;
    const { db, userId, ownerEmail } = await signInOwner();
    const { organizationId } = loadDemoContext();
    // Assigned businesses use feature activation, rather than the legacy module switch.
    const features = (await organizationResolvedFeatureStates(db, { organizationId })).filter(f => ['invoices', 'invoice_history'].includes(f.featureKey));
    expect(features).toHaveLength(2);
    for (const feature of features) await disableOrganizationFeature(db, { organizationId, featureId: feature.featureId });
    try {
      await page.goto(`/organizations/${organizationId}/finance/reports`);
      await expect(page.getByRole('group', { name: 'Scenario 1', exact: true })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: /^This page does not exist/ })).toBeVisible();
    } finally {
      for (const feature of features) await enableOrganizationFeature(db, { organizationId, featureId: feature.featureId });
    }
    const foreign = await provisionFinanceBusiness({ db, userId, ownerEmail }, `Private Finance E1 ${Date.now()}`);
    const context = await browser.newContext({ storageState: COLLEAGUE_STORAGE_STATE });
    const denied = await context.newPage();
    await denied.goto(`/organizations/${foreign}/finance/reports`);
    await expect(denied.getByRole('heading', { name: 'This business is not available', exact: true })).toBeVisible();
    await expect(denied.getByRole('group', { name: 'Scenario 1', exact: true })).toHaveCount(0);
    await context.close();
  });
  test('a business with no catalog or Work records can plan at every requested width', async ({ page }) => {
    if (baseline) return;
    test.setTimeout(120_000);
    const owner = await signInOwner();
    const organizationId = await provisionFinanceBusiness(owner, `Empty Finance E1 ${Date.now()}`);
    // Reuse this isolated run's manifest-owned Plan. No development/hosted assignments change.
    const plan = await currentPlanAssignment(owner.db, { organizationId: loadDemoContext().organizationId });
    if (!plan) throw new Error('Missing isolated fixture Plan.');
    const pg = new Client(process.env.SUPABASE_DB_URL!);
    await pg.connect();
    try {
      await pg.query('insert into platform_staff(user_id,name) values($1,$2)', [owner.userId, 'Finance E1 empty fixture']);
      await recordPlanAssignment(owner.db, { organizationId, planId: plan.planId, periodStart: '2020-01-01', periodEnd: '9999-12-31' });
    } finally {
      await pg.query('delete from platform_staff where user_id=$1', [owner.userId]);
      await pg.end();
    }
    const url = `/organizations/${organizationId}/finance/reports`;
    for (const width of [390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1100 });
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await expect(page.getByRole('region', { name: 'Economics & pricing planning', exact: true }).getByText(/No catalog items yet/)).toBeVisible();
      await expect(page.getByText('No financial activity in this period.', { exact: true }).filter({ visible: true })).toBeVisible();
      const scenario = page.getByRole('group', { name: 'Scenario 1', exact: true });
      for (const [label, value] of [['Labor quantity (hours)', '2'], ['Labor cost per hour', '40'], ['Materials cost', '20'], ['Supplier cost', '10'], ['Other estimated cost', '10'], ['Target gross margin (%)', '25']]) await scenario.getByLabel(label).fill(value);
      await expect(scenario.getByTestId('suggested-price')).toContainText('160.00');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.setViewportSize({ width, height: Math.max(1100, await page.locator('main').evaluate(node => node.scrollHeight) + 100) });
      await guardedShot(page, { url, content: page.getByRole('heading', { name: 'Financial performance', exact: true }) }, { path: path.join(out, `no-catalog-${width}.png`), fullPage: true });
    }
    for (const table of ['price_book_items', 'work_item_types', 'work_items', 'work_item_costs', 'invoices', 'payments']) {
      const { count, error } = await owner.db.from(table).select('id', { head: true, count: 'exact' }).eq('organization_id', organizationId);
      if (error) throw error;
      expect(count).toBe(0);
    }
  });
});

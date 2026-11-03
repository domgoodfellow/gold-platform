import path from 'node:path';
import { Client } from 'pg';
import { test, expect } from '@playwright/test';
import { OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE, loadDemoContext } from './helpers';
import { provisionFinanceBusiness, signInOwner } from './finance-fixtures';
import { currentPlanAssignment, recordPlanAssignment, organizationResolvedFeatureStates, disableOrganizationFeature } from '../lib/domain/catalogue/organization-plans';
import { createPriceBookItem } from '../lib/domain/pricing/price-book';
import { createWorkItemType } from '../lib/domain/work-items/types';
import { computeSetupOverview, launchOrganization } from '../lib/domain/tenancy/lifecycle';
import { guardedShot } from './visual-guard';
import { getOrganization } from '../lib/domain/tenancy/organizations';
import { listCustomerStages } from '../lib/domain/customers/stages';
import { chooseOption } from './select-field';

const before = process.env.UX_GUIDED_PHASE === 'before';
const output = path.join(__dirname, '../../../.artifacts/ux-guided', before ? 'before' : 'after');
const widths = [390, 768, 1024, 1440];
let organizationId: string;
let typeId: string;

async function emptyBusiness(name: string) {
  const owner = await signInOwner();
  const id = await provisionFinanceBusiness(owner, name);
  const plan = await currentPlanAssignment(owner.db, { organizationId: loadDemoContext().organizationId });
  if (!plan) throw new Error('Missing disposable run Plan.');
  const pg = new Client(process.env.SUPABASE_DB_URL!);
  await pg.connect();
  try {
    await pg.query('insert into platform_staff(user_id,name) values($1,$2)', [owner.userId, 'Guided empty fixture']);
    await recordPlanAssignment(owner.db, { organizationId: id, planId: plan.planId, periodStart: '2020-01-01', periodEnd: '9999-12-31' });
  } finally {
    await pg.query('delete from platform_staff where user_id=$1', [owner.userId]);
    await pg.end();
  }
  return { ...owner, organizationId: id };
}

test.describe.serial('UX drift and guided configuration', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });
  test.beforeAll(async () => {
    test.setTimeout(180_000);
    const owner = await signInOwner();
    organizationId = await provisionFinanceBusiness(owner, `Guided configuration ${Date.now()}`);
    const plan = await currentPlanAssignment(owner.db, { organizationId: loadDemoContext().organizationId });
    if (!plan) throw new Error('Missing disposable run Plan.');
    const pg = new Client(process.env.SUPABASE_DB_URL!);
    await pg.connect();
    try {
      await pg.query('insert into platform_staff(user_id,name) values($1,$2)', [owner.userId, 'Guided configuration fixture']);
      await recordPlanAssignment(owner.db, { organizationId, planId: plan.planId, periodStart: '2020-01-01', periodEnd: '9999-12-31' });
    } finally {
      await pg.query('delete from platform_staff where user_id=$1', [owner.userId]);
      await pg.end();
    }
    typeId = await createWorkItemType(owner.db, { organizationId, name: 'Guided service', schedulable: false });
    await createPriceBookItem(owner.db, { organizationId, name: 'Guided delivery', unit: 'visit', unitAmountMinor: 12500 });
  });
  test('the five concrete surfaces at every requested width', async ({ page }) => {
    test.setTimeout(180_000);
    const base = `/organizations/${organizationId}`;
    for (const width of widths) {
      await page.setViewportSize({ width, height: 1100 });
      const capture = async (name: string, url: string, dialog = false) => {
        await page.waitForLoadState('networkidle');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await guardedShot(page, { url, content: dialog ? page.getByRole('dialog') : name.startsWith('work-type') ? page.getByRole('heading', { name: 'Guided service', exact: true, level: 2 }) : name === 'schedule' ? page.getByRole('navigation', { name: 'Calendar views' }) : page.getByRole('region', { name: 'Relationship stages', exact: true }) }, { path: path.join(output, `${name}-${width}.png`), fullPage: true });
      };
      const schedule = `/organizations/${loadDemoContext().organizationId}/schedule`;
      await page.goto(schedule);
      await capture('schedule', schedule);
      if (!before) {
        await expect(page.getByText(/Times shown in/)).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Opening hours', exact: true })).toHaveCount(0);
        const day = page.getByRole('navigation', { name: 'Calendar views' }).getByRole('link', { name: 'Day', exact: true });
        await day.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
        await expect(day).toBeFocused();
        expect(await day.evaluate(node => { const style = getComputedStyle(node); return parseFloat(style.outlineWidth) >= 2 || style.boxShadow !== 'none'; })).toBe(true);
        await page.getByRole('link', { name: 'Week', exact: true }).click();
        await expect(page).toHaveURL(/view=week/);
        const on = new URL(page.url()).searchParams.get('on');
        await page.getByRole('link', { name: 'Month', exact: true }).click();
        await expect(page).toHaveURL(/view=month/);
        expect(new URL(page.url()).searchParams.get('on')).toBe(on);
      }
      await page.goto(`${base}/work/configuration?type=${typeId}`);
      await capture('work-type', `${base}/work/configuration`);
      if (!before) {
        await page.goto(`${base}/work/configuration?type=${typeId}&tab=general`);
        await expect(page.getByRole('button', { name: 'Save name', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save scheduling behavior', exact: true })).toBeVisible();
        await capture('work-type-general', `${base}/work/configuration`);
      }
      await page.goto(`${base}/finance/quotes?create=1`);
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('dialog').getByText(/There are none yet|starts from a Work item|No Work items yet/)).toBeVisible();
      await capture('quote-empty', `${base}/finance/quotes`, true);
      await page.goto(`${base}/crm/configuration/relationship-stages`);
      await capture('relationship-stages', `${base}/crm/configuration/relationship-stages`);
      await page.getByRole('button', { name: 'Add stage', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await capture('add-stage-dialog', `${base}/crm/configuration/relationship-stages`, true);
    }
  });

  test('New quote creates Work through starting-stage recovery and continues to its Financials', async ({ page }) => {
    if (before) return;
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/finance/quotes?create=1`);
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('link', { name: 'Create Work', exact: true })).toBeVisible();
    await expect(dialog.getByRole('searchbox')).toHaveCount(0);
    await dialog.getByRole('link', { name: 'Create Work', exact: true }).click();
    await expect(page).toHaveURL(/work\/new\?returnTo=quote/);
    await expect(page.getByRole('region', { name: /needs a starting stage/ })).toBeVisible();
    await page.getByLabel('Starting stage name', { exact: true }).fill('Received');
    await page.getByRole('button', { name: 'Add stage and continue', exact: true }).click();
    await page.getByLabel('Job title', { exact: true }).fill('Work prepared from Finance');
    await page.getByRole('button', { name: 'Create work', exact: true }).click();
    await expect(page).toHaveURL(/\/work\/[^/?]+\?tab=financials/);
    await page.getByRole('button', { name: 'Add priced line', exact: true }).click();
    await chooseOption(page.getByRole('dialog').getByLabel('Price item'), { label: 'Guided delivery · CA$125.00 / visit' });
    await page.getByRole('dialog').getByRole('button', { name: 'Add to quote', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('status')).toContainText('Priced line added to quote.');
    const { db } = await signInOwner();
    expect(await listCustomerStages(db, { organizationId })).toEqual([]); // CRM stages are never a Work-quote prerequisite.
    await page.goto(`${base}/finance/quotes?create=1`);
    await page.getByRole('dialog').getByRole('searchbox').fill('No matching Work fixture');
    await expect(page.getByRole('dialog').getByText(/No Work matches this search/)).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Create Work', exact: true })).toHaveCount(0);
  });

  test('a new type has no automatic stage; Workflow leads to Work creation and explicit General stays General', async ({ page }) => {
    if (before) return;
    await page.setViewportSize({ width: 1440, height: 1000 });
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/work/configuration`);
    await page.getByRole('button', { name: 'New type', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New work type', exact: true });
    await dialog.getByLabel('Name', { exact: true }).fill('Another delivery');
    await dialog.getByRole('radio', { name: /^Not scheduled/ }).check();
    await dialog.getByRole('button', { name: 'Create type', exact: true }).click();
    await expect(page).toHaveURL(/tab=workflow/);
    await expect(page.getByRole('tab', { name: 'Workflow', exact: true })).toHaveAttribute('aria-selected', 'true');
    const createdType = new URL(page.url()).searchParams.get('type')!;
    const { db } = await signInOwner();
    expect((await db.from('work_item_statuses').select('id').eq('type_id', createdType)).data).toEqual([]);
    await page.goto(`${base}/work/configuration?type=${createdType}&tab=general`);
    await expect(page.getByRole('tab', { name: 'General', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('button', { name: 'Save name', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save scheduling behavior', exact: true })).toBeVisible();
    await page.goto(`${base}/work/configuration?type=${createdType}`);
    await expect(page.getByRole('tab', { name: 'Workflow', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByLabel('Starting stage name', { exact: true }).fill('Ready to start');
    await page.getByRole('button', { name: 'Add starting stage', exact: true }).click();
    await page.getByRole('link', { name: 'New work', exact: true }).click();
    await page.getByLabel('Job title', { exact: true }).fill('Work from type configuration');
    await page.getByRole('button', { name: 'Create work', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/work\\?type=${createdType}`));
  });

  test('CRM stage dialog preserves draft, focus and canonical add, rename, ordering and removal', async ({ page }) => {
    if (before) return;
    await page.setViewportSize({ width: 390, height: 844 });
    const base = `/organizations/${organizationId}/crm/configuration/relationship-stages`;
    await page.goto(`${base}?setupStep=customers`);
    await expect(page.getByRole('link', { name: 'Return to setup', exact: true })).toHaveAttribute('href', `/organizations/${organizationId}/setup?step=customers`);
    await page.getByRole('button', { name: 'Add stage', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Add stage', exact: true });
    await dialog.getByLabel('Stage name', { exact: true }).fill('First contact');
    await page.keyboard.press('Escape');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(dialog.getByLabel('Stage name', { exact: true })).toHaveValue('First contact');
    await expect(dialog.getByLabel('Stage name', { exact: true })).toBeFocused();
    await dialog.getByRole('button', { name: 'Add stage', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add stage', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Add stage', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Add stage', exact: true });
    await dialog.getByLabel('Stage name', { exact: true }).fill('In discussion');
    await dialog.getByRole('button', { name: 'Add stage', exact: true }).click();
    await page.getByRole('button', { name: 'Move In discussion up', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Relationship stages', exact: true }).getByRole('listitem').first()).toContainText('In discussion');
    await page.getByRole('button', { name: 'Rename First contact', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Rename stage', exact: true });
    await dialog.getByLabel('Stage name', { exact: true }).fill('Introduced');
    await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'Remove Introduced', exact: true }).click();
    await page.getByRole('dialog', { name: 'Remove Introduced?', exact: true }).getByRole('button', { name: 'Remove Introduced?', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Rename Introduced', exact: true })).toHaveCount(0);
  });

  test('Setup follows the real starting-stage gap to its editor, returns and refreshes; Live is reviewable', async ({ page }) => {
    if (before) return;
    const { db } = await signInOwner();
    const missing = await createWorkItemType(db, { organizationId, name: 'Needs workflow', schedulable: false });
    const overview = await computeSetupOverview(db, { organizationId });
    expect(overview.areas.find(area => area.key === 'work')).toMatchObject({ state: 'incomplete', importance: 'optional' });
    expect(overview.blockers.some(area => area.key === 'work')).toBe(false);
    await page.setViewportSize({ width: 1024, height: 1000 });
    const base = `/organizations/${organizationId}`;
    await page.goto(`${base}/setup?step=operations`);
    const link = page.getByRole('navigation', { name: 'Operations destinations', exact: true }).getByRole('link', { name: /Work types/ });
    await expect(link).toContainText('Needs workflow needs a starting stage');
    await guardedShot(page, { url: `${base}/setup`, content: link }, { path: path.join(output, 'setup-missing-workflow.png'), fullPage: true });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`type=${missing}.*tab=workflow.*setupStep=operations`));
    await page.getByLabel('Starting stage name', { exact: true }).fill('Received');
    await page.getByRole('button', { name: 'Add starting stage', exact: true }).click();
    await page.getByRole('link', { name: 'Return to setup', exact: true }).click();
    await expect(page).toHaveURL(`${base}/setup?step=operations`);
    await expect(page.getByRole('navigation', { name: 'Operations destinations', exact: true }).getByRole('link', { name: /Work types/ })).toContainText('Ready');
    expect((await computeSetupOverview(db, { organizationId })).areas.find(area => area.key === 'work')?.state).toBe('complete');
    await guardedShot(page, { url: `${base}/setup`, content: page.getByRole('navigation', { name: 'Operations destinations', exact: true }) }, { path: path.join(output, 'setup-workflow-ready.png'), fullPage: true });
    // This synthetic all-feature Plan includes unconfigured booking and card payments. Keep the
    // launch refusal, then explicitly deactivate those optional capabilities through their owner.
    await expect(launchOrganization(db, { organizationId })).rejects.toMatchObject({ code: 'organizations.not_ready' });
    const inactiveForThisBusiness = (await organizationResolvedFeatureStates(db, { organizationId })).filter(feature => feature.moduleKey === 'booking' || feature.moduleKey === 'card_payments');
    for (const feature of inactiveForThisBusiness) await disableOrganizationFeature(db, { organizationId, featureId: feature.featureId });
    expect((await computeSetupOverview(db, { organizationId })).blockers).toEqual([]);
    await launchOrganization(db, { organizationId });
    await page.goto(`${base}/setup?step=operations`);
    await expect(page.getByRole('heading', { name: 'Organization is Live', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish setup', exact: true })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Operations destinations', exact: true })).toBeVisible();
    await guardedShot(page, { url: `${base}/setup`, content: page.getByRole('heading', { name: 'Organization is Live', exact: true }) }, { path: path.join(output, 'live-setup-review.png'), fullPage: true });
  });

  test('a reduced role sees no unauthorized configuration or platform shortcuts', async ({ browser }) => {
    if (before) return;
    const context = await browser.newContext({ storageState: COLLEAGUE_STORAGE_STATE });
    const page = await context.newPage();
    const base = `/organizations/${loadDemoContext().organizationId}`;
    for (const path of ['work/configuration', 'crm/configuration/relationship-stages']) {
      await page.goto(`${base}/${path}`);
      await expect(page.getByRole('heading', { name: /^This page does not exist/ })).toBeVisible();
    }
    await page.goto(`${base}/setup?step=operations`);
    await expect(page.getByRole('link', { name: /Work types/ })).toHaveCount(0);
    await page.goto('/platform/providers');
    await expect(page.getByRole('heading', { name: /not available|does not exist/i })).toBeVisible();
    await context.close();
  });

  test('no catalog leads to its canonical editor and returns to the Work prerequisite', async ({ page }) => {
    if (before) return;
    const fx = await emptyBusiness(`No catalog guided fixture ${Date.now()}`);
    const base = `/organizations/${fx.organizationId}`;
    await page.goto(`${base}/finance/quotes?create=1`);
    await page.getByRole('dialog').getByRole('link', { name: 'Open Catalog & pricing', exact: true }).click();
    await expect(page).toHaveURL(`${base}/finance/catalog?returnTo=quote`);
    await page.getByRole('button', { name: 'Add price item', exact: true }).click();
    const form = page.getByRole('form', { name: 'Add price item', exact: true });
    await form.getByLabel(/Name of/).fill('Configured price');
    await form.getByLabel(/Unit of/).fill('visit');
    await form.getByLabel(/Amount in CAD/).fill('75');
    await form.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(form).toHaveCount(0);
    await page.getByRole('link', { name: 'Return to new quote', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('link', { name: 'Create Work', exact: true })).toBeVisible();
    expect((await fx.db.from('work_items').select('id').eq('organization_id', fx.organizationId)).data).toEqual([]);
    expect((await fx.db.from('work_item_types').select('id').eq('organization_id', fx.organizationId)).data).toEqual([]);
  });

  test('operating-organization Setup is unchanged by designation or staff authority; Platform needs its own permission', async ({ page, browser }) => {
    if (before) return;
    test.setTimeout(120_000);
    const owner = await signInOwner();
    const own = loadDemoContext().organizationId;
    const base = `/organizations/${own}`;
    const roleBefore = (await getOrganization(owner.db, own))!.capabilities;
    const overviewBefore = await computeSetupOverview(owner.db, { organizationId: own });
    await page.goto(`${base}/setup?step=operations`);
    const destinations = () => page.getByRole('navigation', { name: 'Operations destinations', exact: true }).getByRole('link').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
    await expect(page.getByRole('navigation', { name: 'Operations destinations', exact: true }).getByRole('link')).toHaveCount(2);
    const linksBefore = await destinations();
    const pg = new Client(process.env.SUPABASE_DB_URL!);
    await pg.connect();
    const previous = (await pg.query('select operating_organization_id from platform_settings where singleton')).rows[0].operating_organization_id;
    try {
      await pg.query('update platform_settings set operating_organization_id=$1 where singleton', [own]);
      await page.reload();
      await expect.poll(destinations).toEqual(linksBefore);
      expect((await getOrganization(owner.db, own))!.capabilities).toEqual(roleBefore);
      expect(await computeSetupOverview(owner.db, { organizationId: own })).toEqual(overviewBefore);
      await page.goto('/platform/providers');
      await expect(page.getByRole('heading', { name: /not available|does not exist/i })).toBeVisible();
      await pg.query('insert into platform_staff(user_id,name,capabilities) values($1,$2,$3)', [owner.userId, 'Disposable authorized operator', ['platform.providers', 'platform.catalogue']]);
      await page.goto('/platform/providers');
      await expect(page.getByRole('heading', { name: 'Providers', exact: true })).toBeVisible();
      await guardedShot(page, { url: '/platform/providers', content: page.getByRole('heading', { name: 'Providers', exact: true }) }, { path: path.join(output, 'platform-providers.png'), fullPage: true });
      await page.goto('/platform/ai-runtime');
      await expect(page.getByText(/Assignments select a service, account and model/)).toBeVisible();
      await guardedShot(page, { url: '/platform/ai-runtime', content: page.getByText(/Assignments select a service, account and model/) }, { path: path.join(output, 'platform-ai-runtime.png'), fullPage: true });
      await page.goto('/platform/integrations');
      await expect(page.getByRole('heading', { name: 'Connectors', exact: true })).toBeVisible();
      await page.goto(`${base}/setup?step=operations`);
      await expect.poll(destinations).toEqual(linksBefore);
      await pg.query('update platform_staff set capabilities=$2 where user_id=$1', [owner.userId, ['platform.catalogue']]);
      await page.goto('/platform/providers');
      await expect(page.getByRole('heading', { name: /not available|does not exist/i })).toBeVisible();
      const context = await browser.newContext({ storageState: COLLEAGUE_STORAGE_STATE });
      const limited = await context.newPage();
      await limited.goto(`${base}/work/configuration`);
      await expect(limited.getByRole('heading', { name: /^This page does not exist/ })).toBeVisible();
      await limited.goto('/platform/providers');
      await expect(limited.getByRole('heading', { name: /not available|does not exist/i })).toBeVisible();
      await context.close();
    } finally {
      await pg.query('update platform_settings set operating_organization_id=$1 where singleton', [previous]);
      await pg.query('delete from platform_staff where user_id=$1', [owner.userId]);
      await pg.end();
    }
  });
});

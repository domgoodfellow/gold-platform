import path from 'node:path';
import { readFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { populateFinanceBusiness, provisionFinanceBusiness, signInOwner } from './finance-fixtures';
import { guardedShot } from './visual-guard';
import { Client } from 'pg';
import { COLLEAGUE_STORAGE_STATE, OWNER_STORAGE_STATE, loadDemoContext } from './helpers';
import { createWorkItemType } from '../lib/domain/work-items/types';
import { saveAppearance } from '../lib/domain/identity/appearance';
import type { Db } from '../lib/db/types';
import { selectFieldValue } from './select-field';

/**
 * Settings, Work and Finance UX correction, in a real browser against disposable businesses:
 * General holds only the business profile and regional settings (the stored currency shows even
 * with no country, and is never replaced); Customer payments and Words & navigation are their own
 * Settings pages, and old `#getting-paid` links reach them; New work recovers from a type with no
 * starting stage in place; Work has no Configuration row; Finance's first run offers one setup
 * action. Every capture passes `assertCapturable`. Screenshots land in `.artifacts/ux-correction`.
 */
const OUT = path.join(__dirname, '..', '..', '..', '.artifacts', 'ux-correction');
const VIEWPORTS = [{ name: '390', width: 390, height: 844 }, { name: '768', width: 768, height: 1024 }, { name: '1024', width: 1024, height: 900 }, { name: '1440', width: 1440, height: 900 },
  // The width the original defect screenshots were taken at (2557 device pixels at 125% scaling).
  { name: '2000', width: 2000, height: 995 }] as const;
const main = (page: Page) => page.getByRole('main');
const sidebar = (page: Page) => page.locator('[data-slot="sidebar-container"]');
const breadcrumb = (page: Page) => page.getByRole('navigation', { name: 'breadcrumb' });
async function fits(page: Page, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label} scrolls sideways`).toBe(true);
}
/** Each width: the route, sign-in, readiness and error checks of `guardedShot`, plus no sideways scroll. */
async function captureAll(page: Page, name: string, url: string, content: (page: Page) => ReturnType<Page['getByRole']>, end?: (page: Page) => ReturnType<Page['getByRole']>) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto(url);
    await fits(page, `${name} at ${viewport.name}`);
    await guardedShot(page, { url: url.split('#')[0], content: content(page) }, { path: path.join(OUT, `${name}-${viewport.name}.png`), fullPage: true });
    // The app scrolls inside its main region, so the lower part of a long page is a second capture.
    if (end) {
      await end(page).scrollIntoViewIfNeeded();
      await guardedShot(page, { url: url.split('#')[0], content: end(page) }, { path: path.join(OUT, `${name}-${viewport.name}-end.png`) });
    }
  }
}

let owner: { db: SupabaseClient; userId: string; ownerEmail: string };
let fresh: string; let populated: string; let untouched: string;

test.use({ storageState: OWNER_STORAGE_STATE });

test.describe.serial('Settings, Work and Finance UX correction', () => {
  // Each journey captures several pages at five widths; the default 30s covers one or two.
  test.describe.configure({ timeout: 180_000 });
  test.beforeAll(async () => {
    test.setTimeout(240_000);
    owner = await signInOwner();
    const run = Date.now().toString(36);
    // Provisioned like a real sign-up with a currency but no address: CAD is stored, the country is not.
    fresh = await provisionFinanceBusiness(owner, `UX fresh ${run}`);
    // Kept exactly as provisioned, so the background capture shows a true first run (journey 5 prices `fresh`).
    untouched = await provisionFinanceBusiness(owner, `UX untouched ${run}`);
    populated = (await populateFinanceBusiness(owner.db, await provisionFinanceBusiness(owner, `UX populated ${run}`))).organizationId;
  });

  test('1. General is the business profile, and shows the stored currency without a country', async ({ page }) => {
    const base = `/organizations/${fresh}`;
    await page.goto(`${base}/settings/general`);
    for (const name of ['Business identity', 'Primary business address', 'Business contact', 'Regional settings']) await expect(main(page).getByRole('heading', { name, exact: true })).toBeVisible();
    for (const name of ['Getting paid', 'Business words and navigation']) await expect(main(page).getByRole('heading', { name })).toHaveCount(0);
    const regional = main(page).locator('section[aria-labelledby="regional-heading"]');
    await expect(regional).toContainText('trading currency CAD');
    await expect(regional).toContainText('No country is set, so no time zone or currency is suggested.');
    await captureAll(page, 'settings-general', `${base}/settings/general`, p => main(p).getByRole('heading', { name: 'Business identity' }), p => main(p).getByRole('button', { name: 'Save changes' }));
    // Saving the profile keeps the stored currency: nothing is inferred to replace it.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/settings/general`);
    await main(page).getByLabel('Legal name').fill('UX Fresh Ltd');
    await main(page).getByRole('button', { name: 'Save changes' }).click();
    await expect(main(page).getByRole('status').filter({ hasText: 'Business profile saved.' })).toBeVisible();
    expect((await owner.db.from('organizations').select('currency').eq('id', fresh).single()).data?.currency).toBe('CAD');
  });

  test('2. Customer payments is its own page, separate from Plan & usage, and old anchors reach it', async ({ page }) => {
    const base = `/organizations/${fresh}`;
    await page.goto(`${base}/settings/payments`);
    await expect(main(page).getByRole('heading', { level: 1, name: 'Customer payments' })).toBeVisible();
    for (const name of ['Trading currency', 'Recording payments', 'Card payments']) await expect(main(page).getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(main(page).getByText('New prices and invoices are in')).toContainText('CAD');
    await expect(sidebar(page).getByRole('link', { name: 'Customer payments' })).toHaveAttribute('aria-current', 'page');
    await expect(sidebar(page).getByRole('link', { name: 'Plan & usage' })).toHaveAttribute('href', `${base}/settings/plan`);
    await captureAll(page, 'settings-payments', `${base}/settings/payments`, p => main(p).getByRole('heading', { name: 'Card payments' }));
    for (const old of ['settings/general#getting-paid', 'finance/configuration/pricing#getting-paid', 'finance/configuration', 'settings/commerce']) {
      await page.goto(`${base}/${old}`);
      await expect(page, old).toHaveURL(new RegExp(`${base}/settings/payments`));
      await expect(main(page).getByRole('heading', { level: 1, name: 'Customer payments' })).toBeVisible();
    }
  });

  test('3. Words & navigation edits the business profile on its own page', async ({ page }) => {
    const base = `/organizations/${fresh}`;
    await page.goto(`${base}/settings/terminology`);
    await expect(main(page).getByRole('heading', { level: 1, name: 'Words & navigation' })).toBeVisible();
    await expect(sidebar(page).getByRole('link', { name: 'Words & navigation' })).toHaveAttribute('aria-current', 'page');
    await captureAll(page, 'settings-terminology', `${base}/settings/terminology`, p => main(p).getByRole('heading', { name: 'Record names' }), p => main(p).getByRole('button', { name: 'Save business words and navigation' }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/settings/terminology`);
    const label = main(page).getByLabel('Work items navigation label');
    await label.fill('Jobs');
    await main(page).getByRole('button', { name: 'Save business words and navigation' }).click();
    await expect(main(page).getByRole('status').filter({ hasText: 'Business profile saved.' })).toBeVisible();
    await page.goto(`${base}/field`);
    await expect(sidebar(page).getByRole('link', { name: 'Jobs', exact: true })).toBeVisible();
  });

  test('4. New work recovers from a type with no starting stage, and Work has no Configuration row', async ({ page }) => {
    const base = `/organizations/${fresh}`;
    const typeId = await createWorkItemType(owner.db as unknown as Db, { organizationId: fresh, name: 'Site survey', schedulable: false });
    const url = `${base}/work/new?type=${typeId}`;
    await page.goto(url);
    await expect(main(page).getByRole('heading', { name: 'Site survey needs a starting stage' })).toBeVisible();
    await expect(main(page).getByLabel('Starting stage name')).toHaveValue('');
    await expect(main(page).getByRole('button', { name: 'Create work' })).toHaveCount(0);
    // The parent is the business's own label for Work items (renamed to Jobs in journey 3), never a hardcoded word.
    await expect(breadcrumb(page).getByRole('link', { name: 'Jobs', exact: true })).toHaveAttribute('href', `${base}/work`);
    await expect(breadcrumb(page)).not.toContainText('Work Items');
    await captureAll(page, 'work-new-missing-stage', url, p => main(p).getByRole('form', { name: 'Add a starting stage to Site survey' }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url);
    // Nothing exists until the person names a stage and submits it.
    expect((await owner.db.from('work_item_statuses').select('id').eq('type_id', typeId)).data).toEqual([]);
    await main(page).getByLabel('Starting stage name').fill('Booked');
    await main(page).getByRole('button', { name: 'Add stage and continue' }).click();
    await expect(main(page).getByRole('form', { name: 'Create work' })).toBeVisible();
    await expect(selectFieldValue(main(page).getByLabel('Work type'))).toHaveValue(typeId);
    await expect(main(page).getByLabel('Starting stage', { exact: true })).toHaveText('Booked');
    await captureAll(page, 'work-new-recovered', url, p => main(p).getByRole('form', { name: 'Create work' }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(url);
    await main(page).getByLabel('Job title').fill('First survey');
    await main(page).getByRole('button', { name: 'Create work' }).click();
    await expect(page).toHaveURL(`${base}/work?type=${typeId}`);
    await expect(main(page).getByRole('link', { name: 'First survey' })).toBeVisible();
    // Work's sidebar has no Configuration row; its editor keeps Work items selected while it is open.
    await expect(sidebar(page).getByRole('link', { name: 'Configuration' })).toHaveCount(0);
    await expect(sidebar(page).getByRole('button', { name: 'Configuration' })).toHaveCount(0);
    await page.goto(`${base}/work/configuration?type=${typeId}`);
    await expect(sidebar(page).getByRole('link', { name: 'Jobs', exact: true })).toHaveAttribute('aria-current', 'page');
    // The editor's trail is the page it configures, with no Configuration level.
    await expect(breadcrumb(page).getByRole('link', { name: 'Jobs', exact: true })).toHaveAttribute('href', `${base}/work`);
    await expect(breadcrumb(page)).not.toContainText('Configuration');
    await page.setViewportSize({ width: 2000, height: 995 });
    await guardedShot(page, { url: `${base}/work/configuration`, content: breadcrumb(page) }, { path: path.join(OUT, 'work-configuration-breadcrumb-2000.png') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${base}/field/configuration`);
    await expect(page).toHaveURL(new RegExp(`${base}/work/configuration`));
  });

  test('4b. A member who cannot configure Work types sees the missing stage but no way to add one', async ({ browser }) => {
    const { organizationId } = loadDemoContext();
    const typeId = await createWorkItemType(owner.db as unknown as Db, { organizationId, name: `Unconfigured ${Date.now().toString(36)}`, schedulable: false });
    const pg = new Client(process.env.SUPABASE_DB_URL);
    await pg.connect();
    let capabilities: string[];
    try {
      const fixtures = JSON.parse(readFileSync(path.join(process.env.E2E_FIXTURE_DIR!, 'fixtures.json'), 'utf8')) as { userIds: string[] };
      const row = await pg.query('select r.capabilities from memberships m join roles r on r.id = m.role_id where m.organization_id = $1 and m.user_id <> all($2::uuid[])', [organizationId, [fixtures.userIds[0]]]);
      capabilities = row.rows[0].capabilities;
    } finally { await pg.end(); }
    expect(capabilities, 'the reduced-role colleague must not configure Work types').not.toContain('field.manage');
    const context = await browser.newContext({ storageState: COLLEAGUE_STORAGE_STATE });
    const page = await context.newPage();
    try {
      await page.goto(`/organizations/${organizationId}/work/new?type=${typeId}`);
      if (capabilities.includes('work_item.create')) {
        await expect(main(page).getByRole('heading', { name: /needs a starting stage$/ })).toBeVisible();
        await expect(main(page).getByText(/An administrator must configure the type/)).toBeVisible();
      } else {
        // A member who cannot create work is refused the page itself.
        await expect(page.getByText('This page does not exist.')).toBeVisible();
      }
      await expect(main(page).getByRole('form', { name: /Add a starting stage/ })).toHaveCount(0);
      await expect(main(page).getByRole('button', { name: 'Add stage and continue' })).toHaveCount(0);
      await expect(main(page).getByRole('link', { name: 'Open Work type settings' })).toHaveCount(0);
    } finally { await context.close(); }
  });

  test('5. Finance first run offers one setup action; populated Dashboard and Catalog are unchanged in substance', async ({ page }) => {
    await page.goto(`/organizations/${fresh}/finance`);
    const started = main(page).getByRole('heading', { name: 'Getting started' });
    await expect(started).toBeVisible();
    await expect(main(page).getByRole('link', { name: 'Set up pricing' })).toHaveCount(1);
    await expect(main(page).getByRole('heading', { name: 'Financial activity' })).toHaveCount(0);
    await expect(main(page).getByText('No invoices, quotes or payments are recorded yet.')).toBeVisible();
    await captureAll(page, 'finance-dashboard-empty', `/organizations/${fresh}/finance`, () => started);
    await captureAll(page, 'finance-catalog-empty', `/organizations/${fresh}/finance/catalog`, p => main(p).getByRole('button', { name: 'Add price item' }));
    await captureAll(page, 'finance-dashboard-populated', `/organizations/${populated}/finance`, p => main(p).getByRole('heading', { name: 'Needs attention' }));
    await captureAll(page, 'finance-catalog-populated', `/organizations/${populated}/finance/catalog`, p => main(p).getByRole('heading', { name: /Price book/ }));
    // Adding a price item creates no Work type and no Work.
    await page.setViewportSize({ width: 1440, height: 900 });
    const before = (await owner.db.from('work_item_types').select('id').eq('organization_id', fresh)).data?.length;
    await page.goto(`/organizations/${fresh}/finance/catalog`);
    await main(page).getByRole('button', { name: 'Add price item', exact: true }).click();
    const row = main(page).getByRole('form', { name: 'Add price item', exact: true });
    await row.getByLabel('Name of new price item', { exact: true }).fill('Site visit');
    await row.getByLabel('Unit of new price item', { exact: true }).fill('visit');
    await row.getByLabel('Amount in CAD for new price item', { exact: true }).fill('120');
    await row.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(row).toHaveCount(0);
    await expect(main(page).getByText('Site visit', { exact: true })).toBeVisible();
    expect((await owner.db.from('work_item_types').select('id').eq('organization_id', fresh)).data?.length).toBe(before);
  });

  test('6. Ambient 3D stays a soft background behind the Dashboard header', async ({ page }) => {
    await saveAppearance(owner.db as unknown as Db, { background: 'ambient3d' });
    try {
      for (const id of [untouched, populated]) for (const viewport of [{ width: 1440, height: 900 }, { width: 2000, height: 995 }]) {
        await page.setViewportSize(viewport);
        await page.goto(`/organizations/${id}/finance`);
        const intro = main(page).locator('[data-slot="workspace-intro"]');
        await expect(intro.locator('[data-decorative-background^="ambient3d"]')).toHaveCount(1);
        if (id === untouched) await expect(main(page).getByRole('heading', { name: 'Getting started' })).toBeVisible();
        await fits(page, `ambient 3D at ${viewport.width}`);
        await page.waitForTimeout(1200);
        await guardedShot(page, { url: `/organizations/${id}/finance`, content: intro }, { path: path.join(OUT, `finance-ambient3d-${id === untouched ? 'empty' : 'populated'}-${viewport.width}.png`) });
      }
    } finally {
      await saveAppearance(owner.db as unknown as Db, { background: 'none' });
    }
  });
});

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { config as loadEnv } from 'dotenv';
import { loadDemoContext, OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { createContact } from '../lib/domain/contacts/contacts';
import { createTask, changeTaskStatus } from '../lib/domain/tasks/tasks';
import { createOpportunity, createOpportunityStage } from '../lib/domain/opportunities/opportunities';

/**
 * The relationship-first CRM Dashboard in a real browser, against the isolated run's disposable
 * business (`playwright.isolated.config.ts`) plus one extra empty business this spec provisions and
 * records in the run's `fixtures.json`, so the run's teardown removes it. States are built in order:
 * new organization, relationship-focused business, people and companies with activity, sales-heavy,
 * and the reduced-role member.
 */
const VIEWPORTS = [{ name: 'phone', width: 390, height: 844 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1440, height: 900 }] as const;
const run = Date.now().toString(36);
let owner: SupabaseClient; let organizationId: string; let emptyOrganizationId: string;

async function fitsEveryWidth(page: Page, url: string, shot: string, check: () => Promise<void>) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto(url);
    await check();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${shot} fits ${viewport.name}`).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`${shot}-${viewport.name}.png`), fullPage: true });
  }
}
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });

test.describe.serial('Relationship-first CRM Dashboard', () => {
  test.beforeAll(async () => {
    loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test'), quiet: true });
    const url = process.env.SUPABASE_URL!; if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local fixtures only.');
    const context = loadDemoContext(); organizationId = context.organizationId;
    owner = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await owner.auth.signInWithPassword({ email: context.ownerEmail, password: DEMO_PASSWORD }); if (login.error) throw login.error;
    // A second, empty business for the new-organization state, provisioned through the same temporary staff door as the run's own.
    const pg = new Client(process.env.SUPABASE_DB_URL!); await pg.connect();
    try {
      await pg.query('insert into platform_staff(user_id,name) values($1,$2)', [login.data.user.id, `CRM dashboard E2E ${run}`]);
      emptyOrganizationId = await provisionOrganization(owner, { ownerEmail: context.ownerEmail, name: `CRM dashboard empty ${run}`, displayName: 'Owner', timezone: 'America/Toronto', currency: 'CAD' });
      const manifestPath = path.join(process.env.E2E_FIXTURE_DIR!, 'fixtures.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { organizationIds: string[] };
      manifest.organizationIds.push(emptyOrganizationId); writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    } finally {
      await pg.query('delete from platform_staff where user_id=$1', [login.data.user.id]).catch(() => undefined); await pg.end();
    }
  });

  test.describe('owner', () => {
    test.use({ storageState: OWNER_STORAGE_STATE });
    test('a new organization keeps the normal dashboard with add and import entry points', async ({ page }) => {
      test.setTimeout(120_000);
      await fitsEveryWidth(page, `/organizations/${emptyOrganizationId}/crm`, 'crm-dashboard-new', async () => {
        await expect(region(page, 'Relationship overview')).toBeVisible();
        await expect(page.getByText('Get started with CRM')).toHaveCount(0);
        const recent = region(page, 'Recently active relationships');
        await expect(recent.getByText(/No contacts yet/)).toBeVisible();
        await expect(recent.getByRole('button', { name: 'Add contacts', exact: true })).toBeVisible();
        await expect(recent.getByRole('navigation', { name: 'Relationship grouping' })).toHaveCount(0);
        await expect(region(page, 'Opportunities & Pipeline').getByRole('link', { name: 'Set up opportunity stages' })).toBeVisible();
        await expect(page.getByText('Win rate')).toHaveCount(0);
      });
    });

    test('a relationship-focused business sees recently added contacts, then real activity, and groups by company', async ({ page }) => {
      test.setTimeout(150_000);
      await page.goto(`/organizations/${organizationId}/crm`);
      await expect(region(page, 'Recently added contacts')).toBeVisible();
      await expect(page.getByText(/these are the newest records/)).toBeVisible();
      await expect(page.getByText('Win rate')).toHaveCount(0);

      const company = await createContact(owner, { organizationId, name: `Harbour Supply ${run}`, contactType: 'company' });
      const person = await createContact(owner, { organizationId, name: `Ada Marsh ${run}`, contactType: 'person', companyId: company });
      const colleague = await createContact(owner, { organizationId, name: `Ben Ortiz ${run}`, contactType: 'person', companyId: company });
      const solo = await createContact(owner, { organizationId, name: `Cy Lund ${run}`, contactType: 'person' });
      for (const [customerId, kind, title] of [[solo, 'call', 'Intro call'], [colleague, 'email', 'Sent brochure'], [person, 'meeting', 'Site walk']] as const) {
        const id = await createTask(owner, { organizationId, customerId, kind, title, dueAt: new Date().toISOString() });
        await changeTaskStatus(owner, { organizationId, id, status: 'completed' });
      }
      await createTask(owner, { organizationId, customerId: person, kind: 'call', title: `Follow up ${run}`, dueAt: new Date(Date.now() + 2 * 86400000).toISOString() });

      await fitsEveryWidth(page, `/organizations/${organizationId}/crm`, 'crm-dashboard-relationships', async () => {
        const recent = region(page, 'Recently active relationships');
        await expect(recent).toBeVisible();
        const names = await recent.getByRole('link', { name: new RegExp(run) }).allTextContents();
        expect(names.slice(0, 3)).toEqual([`Ada Marsh ${run}`, `Ben Ortiz ${run}`, `Cy Lund ${run}`]);
        await expect(recent.getByText('Meeting task completed: Site walk')).toBeVisible();
        await expect(recent.getByText(`Next: Follow up ${run}`)).toBeVisible();
        await expect(recent.getByText(`Person · Lead · Harbour Supply ${run}`).first()).toBeVisible();
      });

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/organizations/${organizationId}/crm`);
      await region(page, 'Recently active relationships').getByRole('link', { name: 'Group by company', exact: true }).click();
      await expect(page).toHaveURL(/group=company/);
      const grouped = page.getByRole('list', { name: 'Grouped by company' });
      await expect(grouped).toBeVisible();
      await expect(grouped.getByRole('link', { name: `Harbour Supply ${run}`, exact: true })).toHaveCount(1);
      for (const name of [`Ada Marsh ${run}`, `Ben Ortiz ${run}`, `Cy Lund ${run}`]) await expect(grouped.getByRole('link', { name, exact: true })).toHaveCount(1);
      await expect(grouped.getByText('No company', { exact: true })).toBeVisible();
      await page.screenshot({ path: test.info().outputPath('crm-dashboard-grouped-desktop.png'), fullPage: true });

      // New contacts opens Contacts filtered to the same 30-day window, and the records shown match the count.
      await page.goto(`/organizations/${organizationId}/crm`);
      const tile = page.getByRole('link', { name: /New contacts/ });
      const count = Number((await tile.locator('.text-2xl').textContent())?.trim());
      expect(count).toBeGreaterThanOrEqual(4);
      await tile.click();
      await expect(page).toHaveURL(/\/crm\/contacts\?added=30d$/);
      await expect(page.getByLabel('Filter by date added')).toHaveValue('30d');
      await expect(page.locator('table tbody tr')).toHaveCount(count);
      await page.goto(`/organizations/${organizationId}/crm?group=company`);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.getByRole('link', { name: 'Group by company', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await page.screenshot({ path: test.info().outputPath('crm-dashboard-grouped-phone.png'), fullPage: true });
    });

    test('a sales-heavy business adds the Opportunities & Pipeline section without changing the relationship metrics', async ({ page }) => {
      test.setTimeout(150_000);
      const open = await createOpportunityStage(owner, { organizationId, name: `Quoted ${run}`, kind: 'open', position: 10 });
      await createOpportunityStage(owner, { organizationId, name: `Won ${run}`, kind: 'won', position: 11 });
      const { data: contact } = await owner.from('contacts').select('id').eq('organization_id', organizationId).eq('name', `Harbour Supply ${run}`).single();
      const month = new Date().toISOString().slice(0, 7);
      await createOpportunity(owner, { organizationId, customerId: contact!.id, title: `Dock refit ${run}`, stageId: open, amountMinor: 250000, currency: 'CAD', expectedCloseOn: `${month}-20` });
      await createOpportunity(owner, { organizationId, customerId: contact!.id, title: `Crane hire ${run}`, stageId: open, amountMinor: 70000, currency: 'USD' });

      await fitsEveryWidth(page, `/organizations/${organizationId}/crm`, 'crm-dashboard-sales', async () => {
        const sales = region(page, 'Opportunities & Pipeline');
        await expect(sales).toBeVisible();
        await expect(sales.getByRole('link', { name: new RegExp(`Quoted ${run}`) })).toBeVisible();
        await expect(sales.getByText('CA$2,500.00').first()).toBeVisible();
        await expect(sales.getByText('US$700.00').first()).toBeVisible();
        await expect(sales.getByText(/unweighted/)).toBeVisible();
        await expect(sales.getByRole('table')).toHaveCount(0);
        const recent = region(page, 'Recently active relationships');
        await expect(recent.getByRole('link', { name: `Harbour Supply ${run}`, exact: true })).toBeVisible();
      });

      // The month governs only the sales measures and keeps the grouping choice.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/organizations/${organizationId}/crm?group=company`);
      const newContacts = await page.getByRole('link', { name: /New contacts/ }).textContent();
      await page.getByLabel('Month for expected closes and win rate').fill('2020-01');
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(page).toHaveURL(/month=2020-01/); await expect(page).toHaveURL(/group=company/);
      await expect(region(page, 'Opportunities & Pipeline').getByText('No opportunities closed in the selected month')).toBeVisible();
      expect(await page.getByRole('link', { name: /New contacts/ }).textContent()).toBe(newContacts);

      // Canonical navigation is unchanged: Dashboard → Contacts → Pipeline.
      await page.goto(`/organizations/${organizationId}/crm`);
      await page.getByRole('link', { name: 'Pipeline', exact: true }).first().click();
      await expect(page).toHaveURL(/\/crm\/pipeline/);
      await page.getByRole('link', { name: 'Contacts', exact: true }).first().click();
      await expect(page).toHaveURL(/\/crm\/contacts/);
    });
  });

  test.describe('reduced-role member', () => {
    test.use({ storageState: COLLEAGUE_STORAGE_STATE });
    test('reads the dashboard without creation or configuration controls', async ({ page }) => {
      test.setTimeout(120_000);
      await fitsEveryWidth(page, `/organizations/${organizationId}/crm`, 'crm-dashboard-member', async () => {
        await expect(region(page, 'Relationship overview')).toBeVisible();
        await expect(region(page, 'Recently active relationships')).toBeVisible();
        for (const name of ['Add contacts', 'New opportunity', 'Configure']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
        await expect(page.getByRole('link', { name: 'Set up opportunity stages' })).toHaveCount(0);
      });
    });
  });
});

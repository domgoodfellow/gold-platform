import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { config as loadEnv } from 'dotenv';
import { loadDemoContext, OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { createContact } from '../lib/domain/contacts/contacts';
import { resetAppearance, saveAppearance } from '../lib/domain/identity/appearance';
import { chooseOption, selectedLabel } from './select-field';

/**
 * The Add contacts intake in a real browser, against the isolated run's disposable business
 * (`playwright.isolated.config.ts`): one dialog from every CRM entry point, manual creation in two
 * stages with an inline company step, unsaved-change protection, the guided Library import from
 * upload to results, per-path permissions for the reduced-role member, and the dialog following the
 * owner's Appearance preferences. Records carry a run-unique suffix.
 */
const VIEWPORTS = [{ name: 'phone', width: 390, height: 844 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1440, height: 900 }] as const;
const run = Date.now().toString(36);
let owner: SupabaseClient; let organizationId: string; let pg: Client;
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
const openIntake = async (page: Page) => { await page.getByRole('button', { name: 'Add contacts', exact: true }).filter({ visible: true }).first().click(); return page.getByRole('dialog', { name: 'Add contacts' }); };

test.describe.serial('Add contacts intake', () => {
  test.beforeAll(async () => {
    loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test'), quiet: true });
    const url = process.env.SUPABASE_URL!; if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local fixtures only.');
    const context = loadDemoContext(); organizationId = context.organizationId;
    owner = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await owner.auth.signInWithPassword({ email: context.ownerEmail, password: DEMO_PASSWORD }); if (login.error) throw login.error;
    pg = new Client(process.env.SUPABASE_DB_URL); await pg.connect();
  });
  test.afterAll(async () => { await resetAppearance(owner).catch(() => undefined); await pg?.end(); });

  test.describe('owner', () => {
    test.use({ storageState: OWNER_STORAGE_STATE });

    test('every CRM entry point opens the same choice, usable at phone, tablet and desktop widths', async ({ page }) => {
      test.setTimeout(150_000);
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        for (const route of ['crm', 'crm/contacts']) {
          await page.goto(`/organizations/${organizationId}/${route}`);
          const intake = await openIntake(page);
          const choices = intake.getByRole('list', { name: 'Ways to add contacts' });
          await expect(choices.getByRole('button', { name: /Create manually/ })).toBeVisible();
          await expect(choices.getByRole('button', { name: /Import records/ })).toBeVisible();
          await expect(choices.getByRole('region', { name: 'Connect & synchronize' })).toBeVisible();
          await expect(choices.getByText(/Google Contacts|Outlook contacts/i)).toHaveCount(0);
          expect(await fits(page)).toBe(true);
          if (route === 'crm') await shot(page, `intake-choice-${viewport.name}`);
          await page.keyboard.press('Escape'); await expect(intake).toBeHidden();
        }
        const intake = await openIntake(page);
        await intake.getByRole('button', { name: /Create manually/ }).click();
        const form = page.getByRole('dialog', { name: 'Add a contact' });
        await form.getByText('Person', { exact: true }).click();
        // The actions stay inside the window at every width; only the body scrolls.
        const save = form.getByRole('button', { name: 'Save contact' });
        await expect(save).toBeInViewport();
        await shot(page, `intake-manual-${viewport.name}`);
        await form.getByRole('button', { name: 'Cancel' }).click(); await expect(form).toBeHidden();
      }
    });

    test('creates a Person and a Company from essentials, keeps a pending Person through inline company creation, and saves extra details', async ({ page }) => {
      test.setTimeout(150_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/organizations/${organizationId}/crm/contacts`);

      // Company, essentials only.
      const intake = await openIntake(page); await intake.getByRole('button', { name: /Create manually/ }).click();
      let form = page.getByRole('dialog', { name: 'Add a contact' });
      await form.getByText('Company', { exact: true }).click();
      await form.getByLabel('Company name', { exact: true }).fill(`Intake Works ${run}`);
      await form.getByRole('button', { name: 'Save contact' }).click();
      let done = page.getByRole('dialog', { name: 'Contact added' });
      await expect(done).toContainText(`Intake Works ${run} was added as a company.`);
      await shot(page, 'intake-created-desktop');

      // Add another: a Person, with an inline new company, then Additional information.
      await done.getByRole('button', { name: 'Add another' }).click();
      form = page.getByRole('dialog', { name: 'Add a contact' });
      await form.getByText('Person', { exact: true }).click();
      await form.getByLabel('Name', { exact: true }).fill(`Ida Intake ${run}`);
      await form.getByRole('textbox', { name: /^Email/ }).fill(`ida-${run}@example.test`);
      await form.getByRole('textbox', { name: /^Job title/ }).fill('Buyer');
      await form.getByRole('button', { name: 'New company' }).click();
      const step = page.getByRole('dialog', { name: 'New company' });
      await step.getByLabel('Company name', { exact: true }).fill(`Harbour Inline ${run}`);
      await shot(page, 'intake-inline-company-desktop');
      await step.getByRole('button', { name: 'Create company' }).click();
      form = page.getByRole('dialog', { name: 'Add a contact' });
      await expect(form.getByLabel('Name', { exact: true })).toHaveValue(`Ida Intake ${run}`);
      await expect(form.getByRole('textbox', { name: /^Email/ })).toHaveValue(`ida-${run}@example.test`);
      await expect(form.getByRole('textbox', { name: /^Job title/ })).toHaveValue('Buyer');
      await expect(selectedLabel(form.getByRole('combobox', { name: /^Company/ }))).toHaveText(`Harbour Inline ${run}`);
      await form.getByRole('button', { name: 'Add more details' }).click();
      await chooseOption(form.getByLabel('Lifecycle', { exact: true }), 'prospect');
      await chooseOption(form.getByLabel('Lead temperature'), 'warm');
      await shot(page, 'intake-details-desktop');
      await form.getByRole('button', { name: 'Save contact' }).click();
      done = page.getByRole('dialog', { name: 'Contact added' });
      await done.getByRole('link', { name: 'View contact' }).click();
      await expect(page).toHaveURL(/\/crm\/contacts\/[a-f0-9-]+$/, { timeout: 30_000 });
      await expect(page.getByRole('heading', { name: `Ida Intake ${run}` })).toBeVisible();

      const saved = await pg.query(`select c.contact_type, c.lifecycle, c.lead_temperature, a.title, company.name as company from public.contacts c
        left join public.contact_affiliations a on a.person_id = c.id and a.active left join public.contacts company on company.id = a.company_id
        where c.organization_id = $1 and c.name = $2`, [organizationId, `Ida Intake ${run}`]);
      expect(saved.rows).toEqual([{ contact_type: 'person', lifecycle: 'prospect', lead_temperature: 'warm', title: 'Buyer', company: `Harbour Inline ${run}` }]);
      const companies = await pg.query(`select contact_type from public.contacts where organization_id = $1 and name in ($2, $3)`, [organizationId, `Intake Works ${run}`, `Harbour Inline ${run}`]);
      expect(companies.rows.map(row => row.contact_type)).toEqual(['company', 'company']);
    });

    test('asks before discarding a changed form, and closes an untouched one at once', async ({ page }) => {
      await page.goto(`/organizations/${organizationId}/crm`);
      let intake = await openIntake(page); await intake.getByRole('button', { name: /Create manually/ }).click();
      const form = page.getByRole('dialog', { name: 'Add a contact' });
      await form.getByText('Company', { exact: true }).click();
      await form.getByLabel('Company name', { exact: true }).fill('Abandoned');
      await page.keyboard.press('Escape');
      const confirm = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
      await expect(confirm).toBeVisible(); await expect(confirm.getByRole('button', { name: 'Keep editing' })).toBeFocused();
      await page.keyboard.press('Escape'); await expect(confirm).toBeHidden();
      await expect(form.getByLabel('Company name', { exact: true })).toHaveValue('Abandoned');
      await form.getByRole('button', { name: 'Cancel' }).click();
      await confirm.getByRole('button', { name: 'Discard' }).click();
      await expect(form).toBeHidden();
      intake = await openIntake(page); await intake.getByRole('button', { name: /Create manually/ }).click();
      await page.getByRole('dialog', { name: 'Add a contact' }).getByRole('button', { name: 'Cancel' }).click();
      await expect(confirm).toBeHidden(); await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    test('imports a CSV through the guided Library workflow: source, mapping, review, confirmation and results', async ({ page }) => {
      test.setTimeout(150_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      const existing = await createContact(owner, { organizationId, name: `Existing Import ${run}`, email: `existing-${run}@example.test`, contactType: 'person' });
      await page.goto(`/organizations/${organizationId}/crm/contacts`);
      const intake = await openIntake(page);
      await intake.getByRole('button', { name: /Import records/ }).click();
      await expect(page.getByRole('dialog', { name: 'Import contacts' })).toBeVisible();
      await chooseOption(page.getByRole('combobox', { name: 'Source', exact: true }), 'Upload a CSV');
      const progress = page.getByRole('navigation', { name: 'Import progress' });
      await expect(progress.locator('[aria-current="step"]')).toContainText('Choose source');
      await shot(page, 'import-1-source-desktop');
      const csv = ['name,email,role', `New Import ${run},new-${run}@example.test,Owner`, `Existing Import Updated ${run},existing-${run}@example.test,Buyer`, `Duplicate Import ${run},new-${run}@example.test,Owner`].join('\n');
      await page.getByLabel('CSV file', { exact: true }).setInputFiles({ name: `intake-${run}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await page.getByRole('button', { name: 'Continue' }).click();

      await expect(progress.locator('[aria-current="step"]')).toContainText('Map fields', { timeout: 30_000 });
      await expect(page.getByRole('row', { name: /role/ }).getByText('Owner')).toBeVisible();
      await chooseOption(page.getByLabel('Contact type', { exact: true }), 'person');
      await shot(page, 'import-2-map-desktop');
      await page.getByRole('button', { name: 'Review changes' }).click();

      await expect(progress.locator('[aria-current="step"]')).toContainText('Review changes', { timeout: 30_000 });
      const staged = page.getByRole('definition');
      const count = (label: string) => page.locator('dl[aria-label="Staged changes"] div').filter({ hasText: label }).locator('dd');
      await expect(count('New contacts')).toHaveText('1');
      await expect(count('Updates to existing contacts')).toHaveText('1');
      await expect(count('Possible duplicates')).toHaveText('1');
      expect(await staged.count()).toBeGreaterThanOrEqual(4);
      await shot(page, 'import-3-review-desktop');
      await page.getByRole('button', { name: 'Import 2 contacts', exact: true }).click();
      const confirm = page.getByRole('dialog', { name: 'Import 2 contacts?' });
      await expect(confirm).toBeVisible(); await shot(page, 'import-4-confirm-desktop');
      await confirm.getByRole('button', { name: 'Import 2 contacts?' }).click();

      await expect(progress.locator('[aria-current="step"]')).toContainText('Results', { timeout: 30_000 });
      const results = page.getByRole('region', { name: 'Results' });
      await expect(results.getByText('Created')).toBeVisible();
      await expect(results.getByRole('link', { name: 'View contacts' })).toHaveAttribute('href', `/organizations/${organizationId}/crm/contacts`);
      await expect(results.getByRole('link', { name: 'Open saved source' })).toBeVisible();
      await shot(page, 'import-5-results-desktop');
      await page.setViewportSize({ width: 390, height: 844 }); expect(await fits(page)).toBe(true); await shot(page, 'import-5-results-phone');

      // Matching updated the existing contact rather than duplicating it, and both rows keep their source provenance.
      const contacts = await pg.query(`select id, name from public.contacts where organization_id = $1 and email in ($2, $3) order by name`, [organizationId, `new-${run}@example.test`, `existing-${run}@example.test`]);
      expect(contacts.rows.map(row => row.name)).toEqual([`Existing Import Updated ${run}`, `New Import ${run}`]);
      expect(contacts.rows.find(row => row.name.startsWith('Existing'))!.id).toBe(existing);
      const links = await pg.query(`select count(*)::int as n from public.external_record_links where organization_id = $1 and gold_entity_id = any($2::uuid[])`, [organizationId, contacts.rows.map(row => row.id)]);
      expect(links.rows[0].n).toBe(2);
    });

    test('the dialog follows the person’s Appearance preferences', async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      const measured: Record<string, { radius: string; background: string; appearance: string | null }> = {};
      for (const [name, preference] of [['minimal-square-light', { appearance: 'light', preset: 'minimal', density: 'compact', shape: 'square' }], ['expressive-soft-dark', { appearance: 'dark', preset: 'expressive', density: 'comfortable', shape: 'soft', motion: 'reduced' }]] as const) {
        await saveAppearance(owner, preference);
        await page.goto(`/organizations/${organizationId}/crm`);
        const intake = await openIntake(page);
        await intake.getByRole('button', { name: /Create manually/ }).click();
        const form = page.getByRole('dialog', { name: 'Add a contact' });
        await form.getByText('Person', { exact: true }).click();
        measured[name] = await form.evaluate(element => ({ radius: getComputedStyle(element).borderTopLeftRadius, background: getComputedStyle(element).backgroundColor, appearance: element.closest('[data-appearance]')?.getAttribute('data-appearance') ?? null }));
        await shot(page, `appearance-${name}`);
        await form.getByRole('button', { name: 'Cancel' }).click();
      }
      expect(measured['minimal-square-light'].appearance).toBe('light');
      expect(measured['expressive-soft-dark'].appearance).toBe('dark');
      expect(measured['minimal-square-light'].radius).not.toBe(measured['expressive-soft-dark'].radius);
      expect(measured['minimal-square-light'].background).not.toBe(measured['expressive-soft-dark'].background);
      await resetAppearance(owner);
    });
  });

  test.describe('reduced-role member', () => {
    test.use({ storageState: COLLEAGUE_STORAGE_STATE });
    test('sees only the paths their role can complete, with the reason for the others', async ({ page }) => {
      const { rows } = await pg.query(`select r.capabilities from public.memberships m join public.roles r on r.id = m.role_id join auth.users u on u.id = m.user_id
        where m.organization_id = $1 and u.email like 'isolated-colleague-%'`, [organizationId]);
      const capabilities: string[] = rows[0]?.capabilities ?? [];
      const mayCreate = capabilities.includes('customer.create'); const mayIntegrate = capabilities.includes('integration.manage');
      await page.goto(`/organizations/${organizationId}/crm/contacts`);
      const trigger = page.getByRole('button', { name: 'Add contacts', exact: true }).filter({ visible: true });
      if (!mayCreate && !mayIntegrate) { await expect(trigger).toHaveCount(0); return; }
      const intake = await openIntake(page);
      await expect(intake.getByRole('button', { name: /Create manually/ })).toHaveCount(mayCreate ? 1 : 0);
      if (!mayCreate) await expect(intake.getByText('Your role cannot add contacts.')).toBeVisible();
      if (!mayIntegrate) await expect(intake.getByText('Importing needs permission to manage data sources.')).toBeVisible();
      await shot(page, 'intake-member-desktop');
    });
  });
});

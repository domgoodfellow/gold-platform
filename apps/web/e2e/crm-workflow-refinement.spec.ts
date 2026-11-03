import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { config as loadEnv } from 'dotenv';
import { loadDemoContext, OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { createContact, updateContact } from '../lib/domain/contacts/contacts';
import { createCustomer } from '../lib/domain/customers/customers';
import { resetAppearance, saveAppearance } from '../lib/domain/identity/appearance';
import { createOpportunityStage, listOpportunityStages } from '../lib/domain/opportunities/opportunities';
import { chooseOption } from './select-field';

/**
 * V1.4 CRM interface refinement in a real browser, on the isolated run's disposable business
 * (`playwright.isolated.config.ts`): the contact record's sections, legacy tab links and focused
 * editing; relationship-stage configuration; both boards; the Contacts collection controls and
 * grouping; the organization header without a Calendar shortcut; and Appearance presets on real
 * CRM surfaces. Records carry a run-unique suffix.
 */
const VIEWPORTS = [{ name: 'phone', width: 390, height: 844 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1440, height: 900 }] as const;
const run = Date.now().toString(36);
let owner: SupabaseClient; let pg: Client; let organizationId: string;
let person: string, company: string, legacy: string, legacyTwo: string;
const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = (page: Page, name: string) => page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
const current = (page: Page, label: string) => page.getByRole('navigation', { name: label, exact: true }).locator('[aria-current="page"]');

test.describe.serial('CRM workflow refinement', () => {
  test.beforeAll(async () => {
    loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test'), quiet: true });
    const url = process.env.SUPABASE_URL!; if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local fixtures only.');
    const context = loadDemoContext(); organizationId = context.organizationId;
    owner = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await owner.auth.signInWithPassword({ email: context.ownerEmail, password: DEMO_PASSWORD }); if (login.error) throw login.error;
    pg = new Client(process.env.SUPABASE_DB_URL); await pg.connect();
    company = await createContact(owner, { organizationId, name: `Refine Works ${run}`, contactType: 'company', lifecycle: 'customer', email: `works-${run}@example.test` });
    person = await createContact(owner, { organizationId, name: `Rae Refine ${run}`, contactType: 'person', companyId: company, lifecycle: 'prospect', email: `rae-${run}@example.test`, phone: '+14165550123' });
    legacy = await createCustomer(owner, { organizationId, name: `Legacy Refine ${run}` });
    legacyTwo = await createCustomer(owner, { organizationId, name: `Legacy Review ${run}` });
    // The pipeline board renders only once stages exist (V1.4 first run shows setup instead), so this
    // file gives its business a stage of its own rather than relying on another spec having made one.
    if (!(await listOpportunityStages(owner, { organizationId })).length) await createOpportunityStage(owner, { organizationId, name: `Qualify ${run}`, position: 1, kind: 'open' });
  });
  test.afterAll(async () => { await resetAppearance(owner).catch(() => undefined); await pg?.end(); });

  test.describe('owner', () => {
    test.use({ storageState: OWNER_STORAGE_STATE });

    test('the contact record leads with identity, groups its sections, and keeps old tab links working', async ({ page }) => {
      test.setTimeout(150_000);
      const record = `/organizations/${organizationId}/crm/contacts/${person}`;
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(record);
        await expect(page.getByLabel('Classification')).toContainText('LifecycleProspect');
        await expect(page.getByRole('link', { name: `Refine Works ${run}`, exact: true }).first()).toBeVisible();
        const sections = page.getByRole('navigation', { name: 'Contact sections', exact: true });
        for (const name of ['Overview', 'Activity', 'Related', 'Documents']) await expect(sections.getByRole('link', { name, exact: true })).toBeVisible();
        await expect(current(page, 'Contact sections')).toHaveText('Overview');
        await expect(page.getByRole('region', { name: /Support/ })).toHaveCount(0);
        expect(await fits(page)).toBe(true);
        await shot(page, `record-person-${viewport.name}`);
      }
      // Every former tab still opens its content, now under its section.
      for (const [tab, section, view] of [['calls', 'Activity', 'Calls'], ['work', 'Related', 'Work'], ['locations', 'Related', 'Locations'], ['activity', 'Activity', 'Timeline']] as const) {
        await page.goto(`${record}?tab=${tab}`);
        await expect(current(page, 'Contact sections')).toHaveText(section);
        await expect(current(page, 'Contact sections: sections')).toHaveText(view);
      }
      await page.goto(`${record}?section=related&view=support`);
      await expect(current(page, 'Contact sections')).toHaveText('Related');
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/organizations/${organizationId}/crm/contacts/${company}`);
      await expect(page.getByText('Company', { exact: true }).first()).toBeVisible();
      await shot(page, 'record-company-desktop');
    });

    test('an Unspecified record is classified explicitly, and editing asks before discarding', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/organizations/${organizationId}/crm/contacts/${legacy}`);
      await expect(page.getByText('Needs classification.')).toBeVisible();
      await shot(page, 'record-unspecified-desktop');
      await page.getByRole('button', { name: 'Classify contact' }).click();
      let dialog = page.getByRole('dialog', { name: 'Classify and edit contact' });
      await expect(dialog.getByRole('radio', { name: /Not decided/ })).toBeChecked();
      await dialog.getByText('Company', { exact: true }).click();
      await shot(page, 'classify-dialog-desktop');
      await dialog.getByRole('button', { name: 'Save changes' }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText('Needs classification.')).toHaveCount(0);
      expect((await pg.query('select contact_type from public.contacts where id = $1', [legacy])).rows[0].contact_type).toBe('company');

      await page.goto(`/organizations/${organizationId}/crm/contacts/${person}`);
      const edit = page.getByRole('button', { name: 'Edit', exact: true });
      await edit.click();
      dialog = page.getByRole('dialog', { name: 'Edit contact' });
      await dialog.getByLabel('Name', { exact: true }).fill(`Changed ${run}`);
      await page.keyboard.press('Escape');
      const confirm = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
      await expect(confirm).toBeVisible(); await expect(confirm.getByRole('button', { name: 'Keep editing' })).toBeFocused();
      await confirm.getByRole('button', { name: 'Keep editing' }).click();
      await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue(`Changed ${run}`);
      await dialog.getByRole('button', { name: 'Relationship', exact: true }).click();
      await shot(page, 'edit-dialog-relationship-desktop');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await confirm.getByRole('button', { name: 'Discard' }).click();
      await expect(dialog).toBeHidden(); await expect(edit).toBeFocused();
      await page.setViewportSize({ width: 390, height: 844 });
      await edit.click();
      await expect(dialog.getByRole('button', { name: 'Save changes' })).toBeInViewport();
      await shot(page, 'edit-dialog-phone');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
    });

    test('relationship stages are managed in place: add, rename, reorder, and remove only when unused', async ({ page }) => {
      test.setTimeout(150_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      const configuration = `/organizations/${organizationId}/crm/configuration/relationship-stages`;
      await page.goto(configuration);
      const list = page.getByRole('region', { name: 'Relationship stages' }).or(page.locator('[data-slot=configuration-editor]'));
      for (const name of [`Intro ${run}`, `Active ${run}`]) {
        await page.getByRole('button', { name: 'Add stage' }).first().click();
        const dialog = page.getByRole('dialog', { name: 'Add stage' });
        await dialog.getByLabel('Stage name').fill(name);
        await dialog.getByRole('button', { name: 'Add stage' }).click();
        await expect(dialog).toBeHidden();
        await expect(list.getByText(name, { exact: true })).toBeVisible();
      }
      await page.getByRole('button', { name: `Rename Active ${run}` }).click();
      const rename = page.getByRole('dialog', { name: 'Rename stage' });
      await rename.getByLabel('Stage name').fill(`Engaged ${run}`);
      await rename.getByRole('button', { name: 'Save name' }).click();
      await expect(list.getByText(`Engaged ${run}`, { exact: true })).toBeVisible();
      const order = async () => (await page.locator('[data-slot=configuration-editor] li').allTextContents()).filter(text => text.includes(run));
      const before = await order();
      await page.getByRole('button', { name: `Move Engaged ${run} up` }).focus();
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await order()).findIndex(text => text.includes('Engaged')) < before.findIndex(text => text.includes('Engaged'))).toBe(true);

      const intro = (await pg.query('select id from public.contact_relationship_stages where organization_id = $1 and name = $2', [organizationId, `Intro ${run}`])).rows[0].id;
      await updateContact(owner, { organizationId, customerId: person, name: `Rae Refine ${run}`, contactType: 'person', stageId: intro });
      await page.reload();
      await expect(page.locator('[data-slot=configuration-editor] li').filter({ hasText: `Intro ${run}` })).toContainText('1 contact');
      await expect(page.getByRole('button', { name: `Remove Intro ${run}` })).toHaveCount(0);
      await page.getByRole('button', { name: `Remove Engaged ${run}` }).click();
      await page.getByRole('dialog', { name: `Remove Engaged ${run}?` }).getByRole('button', { name: `Remove Engaged ${run}?` }).click();
      await expect(list.getByText(`Engaged ${run}`, { exact: true })).toHaveCount(0);
      expect((await pg.query('select stage_id from public.contacts where id = $1', [person])).rows[0].stage_id).toBe(intro);
      await shot(page, 'stages-desktop');
      await page.setViewportSize({ width: 390, height: 844 }); expect(await fits(page)).toBe(true); await shot(page, 'stages-phone');
    });

    test('both boards keep their own stages, scroll inside a keyboard-reachable region, and count what the database holds', async ({ page }) => {
      test.setTimeout(150_000);
      for (const viewport of [VIEWPORTS[0], VIEWPORTS[2]]) {
        await page.setViewportSize(viewport);
        await page.goto(`/organizations/${organizationId}/crm/contacts/stages`);
        const board = page.getByRole('region', { name: 'Relationship stages' });
        if (await board.count()) {
          await expect(board).toHaveAttribute('tabindex', '0');
          await expect(board.getByRole('region', { name: `Intro ${run}` }).getByRole('link', { name: `Rae Refine ${run}` })).toBeVisible();
          expect(await fits(page)).toBe(true);
          await shot(page, `relationship-board-${viewport.name}`);
        }
        await page.goto(`/organizations/${organizationId}/crm/pipeline`);
        const pipeline = page.getByRole('region', { name: 'Opportunity stages' });
        await expect(pipeline).toBeVisible();
        await pipeline.focus();
        await page.keyboard.press('ArrowRight');
        expect(await fits(page)).toBe(true);
        await shot(page, `opportunity-board-${viewport.name}`);
      }
      const counts = await pg.query(`select coalesce(s.name, 'Unstaged') as name, count(o.id)::int as n from public.opportunities o left join public.opportunity_stages s on s.id = o.stage_id where o.organization_id = $1 group by 1`, [organizationId]);
      for (const row of counts.rows) {
        await expect(page.getByRole('region', { name: row.name, exact: true }).locator('header span.tabular-nums').first()).toHaveText(String(row.n));
      }
      // Relationship stages and opportunity stages stay separate configurations.
      await expect(page.getByRole('region', { name: `Intro ${run}` })).toHaveCount(0);
    });

    test('the Contacts collection: quick scopes, filters as removable chips, accurate counts, and grouping without duplicates', async ({ page }) => {
      test.setTimeout(150_000);
      const base = `/organizations/${organizationId}/crm/contacts`;
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(base);
      const views = page.getByRole('navigation', { name: 'Contact views' });
      await views.getByRole('link', { name: 'Needs review' }).click();
      await expect(page).toHaveURL(/review=1/);
      const reviewRows = (await pg.query(`select count(*)::int as n from public.contacts where organization_id = $1 and (contact_type = 'unspecified' or lifecycle is null)`, [organizationId])).rows[0].n;
      await expect(page.locator('table tbody tr')).toHaveCount(Math.min(reviewRows, 25));
      await expect(page.getByRole('link', { name: `Legacy Review ${run}` }).first()).toBeVisible();
      await shot(page, 'contacts-needs-review-desktop');

      await views.getByRole('link', { name: 'All' }).click();
      await expect(page).not.toHaveURL(/review=1/);
      await page.getByText('Filters', { exact: true }).click();
      await chooseOption(page.getByLabel('Filter by lifecycle'), 'prospect');
      await page.getByRole('button', { name: 'Apply filters' }).click();
      await expect(page).toHaveURL(/lifecycle=prospect/);
      const chips = page.getByRole('group', { name: 'Active filters' });
      await expect(chips.getByRole('link', { name: /Lifecycle: Prospect/ })).toBeVisible();
      const prospects = (await pg.query(`select count(*)::int as n from public.contacts where organization_id = $1 and lifecycle = 'prospect'`, [organizationId])).rows[0].n;
      await expect(page.locator('table tbody tr')).toHaveCount(Math.min(prospects, 25));
      await shot(page, 'contacts-filtered-desktop');
      await chips.getByRole('link', { name: /Lifecycle: Prospect/ }).click();
      await expect(page).not.toHaveURL(/lifecycle=/);

      await chooseOption(page.getByLabel('Contact grouping'), 'company');
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(page).toHaveURL(/group=company/);
      // A filter removed through its chip stays removed when the form is submitted again (an empty field is no filter).
      await expect(page).not.toHaveURL(/lifecycle=[^&]/);
      await expect(page.getByRole('group', { name: 'Active filters' })).toHaveCount(0);
      const group = page.getByRole('region', { name: `Refine Works ${run}` });
      await expect(group.getByRole('link', { name: `Rae Refine ${run}` })).toBeVisible();
      await expect(page.locator('table').getByRole('link', { name: `Rae Refine ${run}`, exact: true })).toHaveCount(1);
      for (const viewport of VIEWPORTS) { await page.setViewportSize(viewport); expect(await fits(page)).toBe(true); await shot(page, `contacts-grouped-${viewport.name}`); }
    });

    test('the organization header has no Calendar shortcut; calendars stay reachable in context', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/organizations/${organizationId}/crm`);
      const header = page.locator('header').first();
      await expect(header.getByRole('link', { name: /calendar/i })).toHaveCount(0);
      for (const name of ['Team', 'Connections']) await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Agent', exact: true }).first()).toBeVisible();
      await page.getByRole('link', { name: 'Calendar', exact: true }).click();
      await expect(page).toHaveURL(/\/crm\/calendar/);
      await shot(page, 'header-no-calendar-desktop');
    });

    test('Appearance presets visibly change real CRM surfaces', async ({ page }) => {
      test.setTimeout(150_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      const measured: Record<string, { radius: string; padding: string; luminance: number; cardPadding: string }> = {};
      for (const [name, preference] of [['minimal-square-compact-light', { appearance: 'light', preset: 'minimal', density: 'compact', shape: 'square' }], ['expressive-soft-comfortable-dark', { appearance: 'dark', preset: 'expressive', density: 'comfortable', shape: 'soft', motion: 'reduced' }]] as const) {
        await saveAppearance(owner, preference);
        await page.goto(`/organizations/${organizationId}/crm/contacts`);
        const cell = page.locator('[data-slot=table-cell]').first();
        const padding = await cell.evaluate(element => getComputedStyle(element).paddingTop);
        await shot(page, `appearance-contacts-${name}`);
        await page.goto(`/organizations/${organizationId}/crm/pipeline`);
        const column = page.locator('[data-slot=board-column]').first();        // The rendered page background: its brightness, not an attribute, shows the theme took effect.
        // The column heading's own text colour shows which theme actually rendered: dark text on light, light text on dark.
        const style = await column.evaluate(element => {
          // Browsers report theme colours in lab()/oklch(); painting one pixel converts any notation to RGB.
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d')!; context.fillStyle = getComputedStyle(element.querySelector('h2')!).color; context.fillRect(0, 0, 1, 1);
          const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
          return { radius: getComputedStyle(element).borderTopLeftRadius, luminance: 0.2126 * r + 0.7152 * g + 0.0722 * b };
        });
        const card = page.locator('[data-slot=board-card]').first();
        const cardPadding = (await card.count()) ? await card.evaluate(element => getComputedStyle(element).paddingTop) : '';
        measured[name] = { ...style, padding, cardPadding };
        await shot(page, `appearance-pipeline-${name}`);
      }
      const [light, dark] = [measured['minimal-square-compact-light'], measured['expressive-soft-comfortable-dark']];
      expect(light.luminance).toBeLessThan(100); expect(dark.luminance).toBeGreaterThan(180);
      expect(light.radius).not.toBe(dark.radius);
      expect(Number.parseFloat(light.padding)).toBeLessThan(Number.parseFloat(dark.padding));
      if (light.cardPadding && dark.cardPadding) expect(Number.parseFloat(light.cardPadding)).toBeLessThan(Number.parseFloat(dark.cardPadding));
      await resetAppearance(owner);
    });
  });

  test.describe('reduced-role member', () => {
    test.use({ storageState: COLLEAGUE_STORAGE_STATE });
    test('sees records and stages without actions their role cannot take', async ({ page }) => {
      const { rows } = await pg.query(`select r.capabilities from public.memberships m join public.roles r on r.id = m.role_id join auth.users u on u.id = m.user_id where m.organization_id = $1 and u.email like 'isolated-colleague-%'`, [organizationId]);
      const capabilities: string[] = rows[0]?.capabilities ?? [];
      await page.goto(`/organizations/${organizationId}/crm/contacts/${legacyTwo}`);
      await expect(page.getByRole('navigation', { name: 'Contact sections', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(capabilities.includes('customer.update') ? 1 : 0);
      await expect(page.getByRole('button', { name: 'Classify contact' })).toHaveCount(capabilities.includes('customer.update') ? 1 : 0);
      await page.goto(`/organizations/${organizationId}/crm/configuration/relationship-stages`);
      if (!capabilities.includes('field.manage')) await expect(page.getByRole('button', { name: /Add stage|Move .* up|Remove / })).toHaveCount(0);
      await shot(page, 'member-stages-desktop');
    });
  });
});

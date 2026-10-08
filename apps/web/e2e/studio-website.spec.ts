import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

/**
 * A business builds its own website in Studio — no platform step, no hostname — and a stranger
 * reads it at the business's address: blank or from a starter, several pages, sections added,
 * removed and reordered, navigation, a form, a private preview, one coherent publication and a
 * restore. Screenshots land in `test-results/website-shots`.
 *
 * Hostnames use `{slug}.website.localhost`, which Chromium resolves to this machine without DNS; the
 * platform's public domain is pointed at `website.localhost` for the run and put back afterwards.
 */

loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test') });
const ZONE = 'website.localhost';
const PORT = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000').port || '3000';
const SHOTS = process.env.WEBSITE_SHOTS ?? path.join(__dirname, '..', 'test-results', 'website-shots');
const STRANGER = { storageState: { cookies: [], origins: [] } };

let pg: Client;
let slug: string;

test.use({ storageState: OWNER_STORAGE_STATE });
test.describe.configure({ mode: 'serial' });

async function removeSite(organizationId: string) {
  await pg.query('set session_replication_role = replica');
  try { await pg.query('delete from public.public_sites where organization_id = $1', [organizationId]); }
  finally { await pg.query('set session_replication_role = origin'); }
}

test.beforeAll(async () => {
  const ctx = loadDemoContext();
  pg = new Client({ connectionString: process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
  await pg.connect();
  slug = (await pg.query('select slug from public.organizations where id = $1', [ctx.organizationId])).rows[0].slug;
  await pg.query('update public.platform_settings set platform_public_domain = $1 where singleton', [ZONE]);
  await removeSite(ctx.organizationId);
});

test.afterAll(async () => {
  await pg.query('update public.platform_settings set platform_public_domain = null where singleton');
  await removeSite(loadDemoContext().organizationId);
  await pg.end();
});

const studio = () => `/organizations/${loadDemoContext().organizationId}/studio`;
const site = (p = '/') => `http://${slug}.${ZONE}:${PORT}${p}`;
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });

async function asStranger(browser: Browser, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ ...STRANGER, viewport });
  return { context, page: await context.newPage() };
}

async function publishForm(page: Page, name: string) {
  await page.goto(`${studio()}/forms`);
  await page.getByRole('button', { name: 'New form' }).first().click();
  await page.getByLabel('Form name').fill(name);
  await page.getByRole('button', { name: 'Create form' }).click();
  await expect(page).toHaveURL(/\/studio\/forms\/[0-9a-f-]{36}$/);
  const formId = page.url().split('/').pop()!;
  await page.getByRole('button', { name: 'Short text' }).click();
  await page.getByRole('textbox', { name: 'Question', exact: true }).fill('Your name');
  await page.getByRole('checkbox', { name: 'Required' }).check();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Published. Visitors now see this version.')).toBeVisible();
  return formId;
}

/** A page's own row in the structure (its name and path), never a section that happens to share the name. */
const pageRow = (page: Page, name: string) => page.getByRole('navigation', { name: 'Website structure' }).getByRole('list').first().getByRole('button', { name, exact: false }).filter({ has: page.locator(`span:text-is("${name}")`) }).first();
const structure = (page: Page) => page.getByRole('navigation', { name: 'Website structure' });

async function publishDraft(page: Page) {
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText('Sent for review.')).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('button', { name: /Create draft from published website/ })).toBeVisible();
}

test('Studio keeps Home, Website, Forms and Templates in one workspace', async ({ page }) => {
  await page.goto(studio());
  const nav = page.getByRole('navigation', { name: 'Studio destinations' });
  for (const name of ['Website', 'Forms', 'Templates']) await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
});

test('journey A: create a blank website, compose a page, preview it privately, publish, and a visitor submits its form', async ({ page, browser }) => {
  const formId = await publishForm(page, `Website enquiry ${Date.now()}`);

  await page.goto(`${studio()}/website`);
  // No dead end: a business with no website is offered one, and needs no address to start.
  await expect(page.getByText('No website is configured')).toHaveCount(0);
  await shot(page, '01-create-website');
  await page.getByRole('button', { name: /Create blank website/ }).click();
  await expect(structure(page)).toBeVisible();
  await expect(pageRow(page, 'Home')).toBeVisible();

  // Add a hero from the chooser, which is built from the section registry.
  await structure(page).getByRole('button', { name: 'Add section' }).click();
  await expect(page.getByRole('heading', { name: 'Add section' })).toBeVisible();
  for (const group of ['Hero', 'Content', 'Features', 'Process', 'Social proof', 'Forms', 'Calls to action']) {
    await expect(page.getByRole('region', { name: group })).toBeVisible();
  }
  await shot(page, '02-section-chooser');
  await page.getByRole('button', { name: 'Add Hero', exact: true }).click();
  await page.getByLabel('Heading').fill('We fix boilers');

  // A form is chosen from the business's own forms, never copied in.
  await structure(page).getByRole('button', { name: 'Add section' }).click();
  await page.getByRole('region', { name: 'Forms' }).getByRole('combobox').selectOption(formId);
  await page.getByRole('button', { name: 'Add form section' }).click();
  await expect(page.getByRole('link', { name: 'Edit form' })).toHaveAttribute('href', new RegExp(`/studio/forms/${formId}$`));

  await structure(page).getByRole('button', { name: 'Add section' }).click();
  await page.getByRole('button', { name: 'Add Closing action' }).click();
  await structure(page).getByRole('button', { name: 'Add section' }).click();
  await page.getByRole('button', { name: 'Add Text', exact: true }).click();

  const order = async () => (await structure(page).getByRole('list', { name: 'Sections of Home' }).locator('li > div > button, li > button').allTextContents()).map((text) => text.trim()).filter((text) => text && text !== 'Add section');
  expect(await order()).toEqual(['Hero', 'Form', 'Closing action', 'Text']);

  // Reorder with buttons: the closing action moves up, then the text section goes.
  await structure(page).getByRole('button', { name: 'Move Closing action up' }).click();
  expect(await order()).toEqual(['Hero', 'Closing action', 'Form', 'Text']);
  await structure(page).getByRole('button', { name: 'Move Closing action down' }).click();
  await structure(page).getByRole('button', { name: 'Remove Text' }).click();
  expect(await order()).toEqual(['Hero', 'Form', 'Closing action']);
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await shot(page, '03-website-editor-desktop');

  // Nothing is public until it is published; the address shows the neutral 404 meanwhile.
  const stranger = await asStranger(browser);
  const before = await stranger.page.goto(site());
  expect(before?.status()).toBe(404);
  await expect(stranger.page.getByText('This page is not available.')).toBeVisible();

  // The private preview shows the draft through the same renderer.
  const previewHref = (await page.getByRole('link', { name: /^Preview/ }).getAttribute('href'))!;
  await page.goto(previewHref);
  await expect(page.getByText('Private preview')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'We fix boilers' })).toBeVisible();
  await page.goBack();

  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText('Sent for review.')).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('button', { name: /Create draft from published website/ })).toBeVisible();

  const visitor = stranger.page;
  await visitor.goto(site());
  await expect(visitor.getByRole('heading', { level: 1, name: 'We fix boilers' })).toBeVisible();
  await shot(visitor, '04-public-homepage');
  await visitor.getByLabel('Your name').fill('Website Visitor');
  await visitor.getByRole('button', { name: 'Submit' }).click();
  await expect(visitor.getByRole('status')).toContainText('Thank you');
  await stranger.context.close();

  await page.goto(`${studio()}/forms/${formId}/submissions`);
  await expect(page.getByRole('article', { name: 'Response detail' })).toContainText('Website Visitor');
  await expect(page.getByRole('article', { name: 'Response detail' })).toContainText('Website');
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(studio());
  await expect(page.getByRole('region', { name: 'Website overview' }).getByText(/Published/).first()).toBeVisible();
  await expect(page.locator('iframe[title="Website overview preview"]').contentFrame().getByRole('heading', { level: 1, name: 'We fix boilers' })).toBeVisible();
  await shot(page, '12-studio-home-published-1440');
});

test('journey C: add a page from a template, link it in the navigation, and it is served at its own path', async ({ page, browser }) => {
  await page.goto(`${studio()}/website`);
  await page.getByRole('button', { name: /Create draft from published website/ }).click();
  await expect(structure(page)).toBeVisible();

  await structure(page).getByRole('button', { name: 'Add page' }).click();
  await page.getByLabel('Page name').fill('Services');
  await page.getByLabel('Start from').selectOption({ label: 'Services' });
  await structure(page).getByRole('button', { name: 'Add page', exact: true }).click();
  await expect(pageRow(page, 'Services')).toBeVisible();
  await expect(page.getByLabel('Path')).toHaveValue('services');

  // A path the platform owns is refused, with words, and never saved.
  await page.getByLabel('Path').fill('portal');
  await expect(page.getByText('/portal is used by the platform')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/used by the platform/).first()).toBeVisible();
  await page.getByLabel('Path').fill('services');

  // Navigation names pages, not addresses.
  await page.getByRole('button', { name: 'Navigation', exact: true }).click();
  await page.getByLabel('Add a page').selectOption({ label: 'Services' });
  await page.getByRole('button', { name: 'Add page link' }).click();
  await page.getByLabel('Add a page').selectOption({ label: 'Home' });
  await page.getByRole('button', { name: 'Add page link' }).click();
  await page.getByRole('button', { name: 'Move Home up' }).click();
  await shot(page, '05-navigation-editor');
  await page.getByRole('button', { name: 'Close' }).first().click();

  await pageRow(page, 'Home').click();
  await shot(page, '06-multi-page-structure');
  await publishDraft(page);

  const { context, page: visitor } = await asStranger(browser);
  await visitor.goto(site());
  const nav = visitor.getByRole('navigation', { name: 'Site' });
  await expect(nav.getByRole('link')).toHaveText(['Home', 'Services']);
  await nav.getByRole('link', { name: 'Services' }).click();
  await expect(visitor).toHaveURL(site('/services'));
  await expect(visitor.getByRole('heading', { name: 'What we do' })).toBeVisible();
  await shot(visitor, '07-public-secondary-page');

  const missing = await visitor.goto(site('/nonsense'));
  expect(missing?.status()).toBe(404);
  await expect(visitor.getByText('This page is not available.')).toBeVisible();
  await expect(visitor.getByText('GildOps')).toHaveCount(0);
  await context.close();
});

test('journey F and G: edits stay private until publish, every page switches together, and an earlier revision is restored whole', async ({ page, browser }) => {
  const { context, page: visitor } = await asStranger(browser);
  await visitor.goto(site('/services'));
  await expect(visitor.getByRole('heading', { name: 'What we do' })).toBeVisible();

  await page.goto(`${studio()}/website`);
  await page.getByRole('button', { name: /Create draft from published website/ }).click();
  await expect(structure(page)).toBeVisible();
  await pageRow(page, 'Home').click();
  await structure(page).getByRole('button', { name: /^Hero/ }).click();
  await page.getByLabel('Heading').fill('Second edition home');
  await pageRow(page, 'Services').click();
  await pageRow(page, 'Services').first().click();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();

  // The public website is still the previous revision, on every page.
  await visitor.goto(site());
  await expect(visitor.getByRole('heading', { level: 1, name: 'We fix boilers' })).toBeVisible();
  await visitor.goto(site('/services'));
  await expect(visitor.getByRole('heading', { name: 'What we do' })).toBeVisible();
  await expect(visitor.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Services' })).toBeVisible();

  // The preview moves between the draft's own pages.
  const href = (await page.getByRole('link', { name: /^Preview/ }).getAttribute('href'))!.replace(/\/services$/, '');
  await page.goto(href);
  await expect(page.getByRole('heading', { level: 1, name: 'Second edition home' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Services' }).click();
  await expect(page).toHaveURL(/\/preview\/.+\/services$/);
  await page.goBack(); await page.goBack();

  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText('Sent for review.')).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByRole('button', { name: /Create draft from published website/ })).toBeVisible();

  await visitor.goto(site());
  await expect(visitor.getByRole('heading', { level: 1, name: 'Second edition home' })).toBeVisible();
  await expect(visitor.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Our services' }).or(visitor.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Services' }))).toBeVisible();

  // Restore the first revision: it comes back whole, as a new draft that is published like any other.
  await page.getByRole('button', { name: 'History' }).click();
  await page.getByRole('button', { name: /Restore revision 1 as a draft/ }).click();
  await expect(structure(page)).toBeVisible();
  await pageRow(page, 'Home').click();
  await publishDraft(page);
  await visitor.goto(site());
  await expect(visitor.getByRole('heading', { level: 1, name: 'We fix boilers' })).toBeVisible();
  await visitor.goto(site('/services'));
  expect((await visitor.goto(site('/services')))?.status()).toBe(404);
  await context.close();
});

test('journey B: a starter website from Templates becomes the business\'s own multi-page draft', async ({ page }) => {
  await removeSite(loadDemoContext().organizationId);
  await page.goto(`${studio()}/templates`);
  for (const filter of ['All', 'Website', 'Pages', 'Sections', 'Forms']) await expect(page.getByRole('button', { name: filter, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Website', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pages', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Use Local service business' }).click();
  await expect(page.getByText('Website created.')).toBeVisible();
  await page.getByRole('link', { name: 'Open the website' }).click();
  await expect(structure(page)).toBeVisible();
  for (const name of ['Home', 'Services', 'About', 'Contact']) await expect(pageRow(page, name)).toBeVisible();
  await shot(page, '08-site-template-multi-page');
});

test('mobile: the workbench is a canvas with Structure and Inspector drawers, and the public site fits 390px', async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${studio()}/website`);
  await expect(page.getByRole('button', { name: 'Structure' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inspector' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Website structure' })).toHaveCount(0);
  await shot(page, '09-editor-390');
  await page.getByRole('button', { name: 'Structure' }).click();
  await expect(structure(page)).toBeVisible();
  await shot(page, '10-structure-drawer-390');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // Publish the starter so a stranger has something to read at phone width.
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${studio()}/website`);
  await publishDraft(page);
  const { context, page: visitor } = await asStranger(browser, { width: 390, height: 844 });
  await visitor.goto(site());
  await expect(visitor.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await visitor.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await shot(visitor, '11-public-390');
  await context.close();
});

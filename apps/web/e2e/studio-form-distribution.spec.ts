import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { BUSINESSES, DEMO_PASSWORD } from '../scripts/demo/businesses';
import { createPortalInvite } from '../lib/domain/portal/portal';
import { setPortalForm } from '../lib/domain/portal/portal-forms';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

/**
 * A form placed on every surface that can show one, in a real browser: a website, a business's own
 * hostname, the customer portal, another site's page by embed, and the stable link — each submitted
 * as a stranger (or a portal customer), each landing in Studio's responses with where it came from.
 *
 * Hostnames use `{slug}.forms.localhost`, which Chromium resolves to this machine without DNS; the
 * platform's public domain is pointed at `forms.localhost` for the run and put back afterwards.
 */

loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test') });
const ZONE = 'forms.localhost';
const PORT = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000').port || '3000';
const STRANGER = { storageState: { cookies: [], origins: [] } };

let pg: Client;
let owner: SupabaseClient;
let slug: string;
let previousSettings: { gold_public_organization_id: string | null; gold_public_site_id: string | null };

test.use({ storageState: OWNER_STORAGE_STATE });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const ctx = loadDemoContext();
  pg = new Client({ connectionString: process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
  await pg.connect();
  slug = (await pg.query('select slug from public.organizations where id = $1', [ctx.organizationId])).rows[0].slug;
  previousSettings = (await pg.query('select gold_public_organization_id, gold_public_site_id from public.platform_settings where singleton')).rows[0];
  await pg.query('update public.platform_settings set platform_public_domain = $1 where singleton', [ZONE]);
  // A tenant's own website does not exist until one is configured for it; give this business the starting one.
  await pg.query('select app.bootstrap_gold_public_site($1)', [ctx.organizationId]);

  owner = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_ANON_KEY ?? '', { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await owner.auth.signInWithPassword({ email: BUSINESSES[0].owner.email, password: DEMO_PASSWORD });
  if (signIn.error) throw signIn.error;
});

test.afterAll(async () => {
  await pg.query('update public.platform_settings set platform_public_domain = null, gold_public_organization_id = $1, gold_public_site_id = $2 where singleton', [previousSettings.gold_public_organization_id, previousSettings.gold_public_site_id]);
  await pg.end();
});

const studio = () => `/organizations/${loadDemoContext().organizationId}/studio`;
const site = (path = '/') => `http://${slug}.${ZONE}:${PORT}${path}`;

/** Build and publish a one-question form through Studio, returning where it lives. */
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
  const key = (await page.getByRole('link', { name: 'Open public form' }).getAttribute('href'))!.split('/').pop()!;
  const formSlug = (await pg.query('select slug from public.forms where id = $1', [formId])).rows[0].slug as string;
  return { formId, key, formSlug };
}

async function responsesFor(page: Page, formId: string) {
  await page.goto(`${studio()}/forms/${formId}/submissions`);
  return page.getByRole('article', { name: 'Response detail' });
}

async function asStranger(browser: Browser, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ ...STRANGER, viewport });
  return { context, page: await context.newPage() };
}

test('website: place a published form on the website, publish it, and a visitor submits it there', async ({ page, browser }) => {
  const form = await publishForm(page, `Website enquiry ${Date.now()}`);

  await page.goto(`${studio()}/website`);
  const create = page.getByRole('button', { name: /Create (homepage draft|draft from published page)/ });
  const structure = page.getByRole('navigation', { name: 'Website structure' });
  await create.or(structure).first().waitFor();
  if (await create.isVisible()) await create.click();
  await expect(page.getByRole('navigation', { name: 'Website structure' })).toBeVisible();
  // A form section from an earlier run is taken out first: the website carries at most one.
  const remove = page.getByRole('button', { name: 'Remove form section' });
  if (await remove.isVisible()) await remove.click();
  await page.getByLabel('Add a form').selectOption({ value: form.formId });
  await expect(page.getByRole('heading', { name: 'Form', exact: true })).toBeVisible();
  // The questions are edited in the form, never here.
  await expect(page.getByRole('link', { name: 'Edit form' })).toHaveAttribute('href', new RegExp(`/studio/forms/${form.formId}$`));
  await expect(page.getByLabel('Your name')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText('Sent for review.')).toBeVisible();
  await page.getByRole('button', { name: 'Publish' }).click();
  // Publishing starts a fresh editor for the next draft, so the confirmation is the page's own state.
  await expect(page.getByRole('button', { name: /Create draft from published page/ })).toBeVisible();

  // The form now says it is used by the website, and will not be archived out from under it.
  await page.goto(`${studio()}/forms/${form.formId}`);
  await page.getByRole('button', { name: 'Distribute' }).click();
  await expect(page.getByRole('region', { name: 'Used by' })).toContainText('Website');
  await page.getByRole('button', { name: 'Close' }).first().click().catch(() => undefined);

  const { context, page: visitor } = await asStranger(browser);
  await visitor.goto(site());
  const section = visitor.getByRole('region', { name: /./ }).filter({ has: visitor.getByLabel('Your name') });
  await expect(section).toBeVisible();
  await visitor.getByLabel('Your name').fill('Website Visitor');
  await visitor.getByRole('button', { name: 'Submit' }).click();
  await expect(visitor.getByRole('status')).toContainText('Thank you');
  await context.close();

  const detail = await responsesFor(page, form.formId);
  await expect(detail).toContainText('Website Visitor');
  await expect(detail).toContainText('Website');
});

test('hosted: the form at the business hostname and at its stable link', async ({ page, browser }) => {
  const form = await publishForm(page, `Hosted enquiry ${Date.now()}`);

  const { context, page: visitor } = await asStranger(browser);
  await visitor.goto(site(`/forms/${form.formSlug}`));
  await visitor.getByLabel('Your name').fill('Hostname Visitor');
  await visitor.getByRole('button', { name: 'Submit' }).click();
  await expect(visitor.getByRole('status')).toContainText('Thank you');

  await visitor.goto(`/f/${form.key}`);
  await visitor.getByLabel('Your name').fill('Key Visitor');
  await visitor.getByRole('button', { name: 'Submit' }).click();
  await expect(visitor.getByRole('status')).toContainText('Thank you');

  // A hostname that is nobody's, and a form at somebody else's hostname, are the same not-found.
  const nobody = await visitor.goto(`http://nobody.${ZONE}:${PORT}/forms/${form.formSlug}`);
  expect(nobody?.status()).toBe(404);
  await context.close();

  await page.goto(`${studio()}/forms/${form.formId}/submissions`);
  await expect(page.getByRole('list', { name: 'Responses' }).getByRole('button')).toHaveCount(2);
});

test('portal: a customer opens an offered form and the response is theirs, whatever the form says', async ({ page, browser }) => {
  const ctx = loadDemoContext();
  const name = `Portal enquiry ${Date.now()}`;
  const form = await publishForm(page, name);

  // Offered through Studio's own Distribute panel.
  await page.goto(`${studio()}/forms/${form.formId}`);
  await page.getByRole('button', { name: 'Distribute' }).click();
  await page.getByRole('button', { name: 'Add to portal' }).click();
  await expect(page.getByRole('button', { name: 'Remove from portal' })).toBeVisible();

  const token = await createPortalInvite(owner as never, { customerId: ctx.customerId });
  const { context, page: customer } = await asStranger(browser);
  await customer.goto(`/portal/${token}`);
  await expect(customer.getByRole('heading', { name: 'Forms' })).toBeVisible();
  await customer.getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: 'Open', exact: true }).click();
  await customer.getByLabel('Your name').fill('Portal Person');
  await customer.getByRole('button', { name: 'Submit' }).click();
  await expect(customer.getByRole('status')).toContainText('Thank you');
  await context.close();

  const detail = await responsesFor(page, form.formId);
  await expect(detail).toContainText('Portal Person');
  await expect(detail).toContainText('Customer portal');
  await expect(detail.getByRole('link', { name: /./ }).filter({ hasText: /\w/ }).first()).toHaveAttribute('href', new RegExp(`/customers/${ctx.customerId}$`));

  // A form the portal offers is not archived out from under it.
  await page.goto(`${studio()}/forms/${form.formId}`);
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByText(/still used by the portal/)).toBeVisible();
  void setPortalForm;
});

test('embed: another site frames the form, it resizes, and a submission is recorded as an embed', async ({ page, browser }) => {
  const form = await publishForm(page, `Embedded enquiry ${Date.now()}`);
  // Another origin on this machine: a real other site is public, and a browser will not let a public page load from loopback.
  const origin = `http://localhost:${PORT}`;

  // Another site: a real server on another port, serving a page that carries the snippet.
  const theirs = createServer((_request, response) => {
    response.setHeader('content-type', 'text/html');
    response.end(`<!doctype html><html><body><h1>Their site</h1><div data-gildops-form="${form.key}"></div><script async src="${origin}/embed.js"></script></body></html>`);
  });
  await new Promise<void>((resolve) => theirs.listen(0, '127.0.0.1', resolve));
  const { context, page: external } = await asStranger(browser);
  await external.goto(`http://127.0.0.1:${(theirs.address() as AddressInfo).port}/contact`);
  const frame = external.frameLocator('iframe[title="Form"]');
  const iframe = external.locator('iframe[title="Form"]');
  // The frame reports its height only once it has hydrated, so this is also the wait for a form that takes input.
  await expect.poll(() => iframe.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThan(200);
  // A frame loaded cold can take input before React owns it; the answer is typed again until it is kept.
  await expect(async () => {
    await frame.getByLabel('Your name').fill('Embed Visitor');
    await frame.getByRole('button', { name: 'Submit' }).click();
    await expect(frame.getByRole('status')).toContainText('Thank you', { timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  // The frame shows only the form: no business header, no way into the application.
  await expect(frame.getByRole('link')).toHaveCount(0);
  // A key that is not a published form gets nothing.
  const missing = await external.goto(`${origin}/embed/forms/000000000000`);
  expect(missing?.status()).toBe(404);
  await context.close();
  theirs.close();

  const detail = await responsesFor(page, form.formId);
  await expect(detail).toContainText('Embed Visitor');
  await expect(detail).toContainText('Embedded on another site');
});

test('a signed-in Studio user submitting their own public form stays signed in', async ({ page, context }) => {
  const form = await publishForm(page, `Owner tries ${Date.now()}`);
  const second = await context.newPage();
  await second.goto(`/f/${form.key}`);
  await second.getByLabel('Your name').fill('The Owner');
  await second.getByRole('button', { name: 'Submit' }).click();
  await expect(second.getByRole('status')).toContainText('Thank you');
  await second.close();

  await page.goto(`${studio()}/forms/${form.formId}`);
  await expect(page).toHaveURL(/\/studio\/forms\//);
  await expect(page.getByRole('button', { name: 'Distribute' })).toBeVisible();
  const detail = await responsesFor(page, form.formId);
  await expect(detail).toContainText('The Owner');
});

test('mobile and keyboard: the hosted form and the distribution panel at a phone width', async ({ page, browser }) => {
  const form = await publishForm(page, `Phone enquiry ${Date.now()}`);

  const { context, page: visitor } = await asStranger(browser, { width: 390, height: 800 });
  await visitor.goto(site(`/forms/${form.formSlug}`));
  // No horizontal scroll at a phone width.
  expect(await visitor.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Keyboard only: Tab to Submit, press Enter on an empty required form — focus lands on the problem.
  await visitor.keyboard.press('Tab');
  await expect(visitor.getByLabel('Your name')).toBeFocused();
  await visitor.keyboard.press('Tab');
  await expect(visitor.getByRole('button', { name: 'Submit' })).toBeFocused();
  await visitor.keyboard.press('Enter');
  await expect(visitor.getByLabel('Your name')).toBeFocused();
  await expect(visitor.locator('p[role="alert"]')).toContainText(/highlighted/i);
  await expect(visitor.getByLabel('Your name')).toHaveAttribute('aria-invalid', 'true');
  await visitor.keyboard.type('Keyboard User');
  await visitor.keyboard.press('Tab');
  await visitor.keyboard.press('Enter');
  await expect(visitor.getByRole('status')).toContainText('Thank you');
  await context.close();

  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${studio()}/forms/${form.formId}`);
  await page.getByRole('button', { name: 'Distribute' }).click();
  await expect(page.getByRole('textbox', { name: 'Embed code' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

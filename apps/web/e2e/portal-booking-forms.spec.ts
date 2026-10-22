import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { test, expect, type Browser, type Page } from '@playwright/test';
import type { FormDefinition } from '@gold/schemas';
import { BUSINESSES, DEMO_PASSWORD } from '../scripts/demo/businesses';
import { listBookableTypes } from '../lib/domain/booking/booking';
import { setTypeBookingIntake } from '../lib/domain/booking/intake';
import { createForm, createFormDraft, formEditorState, publishFormRevision, saveFormDraft } from '../lib/domain/forms/forms';
import { createPortalInvite, listPortalInvites, revokePortalInvite } from '../lib/domain/portal/portal';
import { setPortalForm } from '../lib/domain/portal/portal-forms';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

/**
 * The customer's three surfaces, in a real browser, as one: the portal (a session made once from a
 * link), a booking that asks its business's own questions, and a form — with the operator signed in
 * to Studio in the same browser the whole time.
 *
 * Journeys: A the link is exchanged and left behind; B a portal form is the customer's, with no
 * token in the request; C revocation ends the session; D booking with intake, recorded with the
 * booking; E a refused answer books nothing, and so does a form changed under the visitor; F Studio,
 * the portal and a public form open at once and none ends another. Phone width at the end.
 */

loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test') });
const STRANGER = { storageState: { cookies: [], origins: [] } };
const SHOTS = process.env.E2E_SHOTS ?? '';

let pg: Client;
let owner: SupabaseClient;
let organizationId: string;
let customerId: string;
let slug: string;
let typeId: string;
let typeName: string;
let portalToken: string;
let intakeForm: { formId: string; revisionId: string; publicKey: string };
let portalForm: { formId: string; revisionId: string };
let bookableDay: string;
const PORTAL_TITLE = `A question for us ${Date.now()}`;

test.use({ storageState: OWNER_STORAGE_STATE });
test.describe.configure({ mode: 'serial' });

const VEHICLE: FormDefinition = {
  title: 'About your vehicle',
  submitLabel: 'Send',
  confirmation: { title: 'Thanks, we have it', message: '' },
  fields: [
    { id: 'vehicle', type: 'short_text', label: 'Vehicle', required: true },
    { id: 'notes', type: 'long_text', label: 'Anything we should know?' },
  ],
};

async function publish(name: string, definition: FormDefinition) {
  const { formId, revisionId } = await createForm(owner as never, { organizationId, name });
  await saveFormDraft(owner as never, { organizationId, revisionId, definition });
  await publishFormRevision(owner as never, { organizationId, revisionId });
  const state = (await formEditorState(owner as never, organizationId, formId))!;
  return { formId, revisionId, publicKey: state.form.publicKey };
}

async function asStranger(browser: Browser, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ ...STRANGER, viewport });
  return { context, page: await context.newPage() };
}

const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
};

/** The booking card for the kind of work that asks questions. */
const card = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: typeName }) });

async function openBooking(page: Page) {
  await page.goto(`/book/${slug}?on=${bookableDay}`);
  await expect(card(page)).toBeVisible();
  await card(page).getByRole('button', { name: /^\d{1,2}:\d{2}/ }).first().click();
}

const count = async (sql: string, args: unknown[]) => Number((await pg.query(sql, args)).rows[0].n);
const submissions = () => count('select count(*) n from public.form_submissions where organization_id = $1 and form_id = $2', [organizationId, intakeForm.formId]);
const workItems = () => count('select count(*) n from public.work_items where organization_id = $1', [organizationId]);

test.beforeAll(async ({ browser }) => {
  const ctx = loadDemoContext();
  organizationId = ctx.organizationId;
  customerId = ctx.customerId;
  pg = new Client({ connectionString: process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
  await pg.connect();
  slug = (await pg.query('select slug from public.organizations where id = $1', [organizationId])).rows[0].slug;
  owner = createClient(process.env.SUPABASE_URL ?? '', process.env.SUPABASE_ANON_KEY ?? '', { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await owner.auth.signInWithPassword({ email: BUSINESSES[0].owner.email, password: DEMO_PASSWORD });
  if (signIn.error) throw signIn.error;

  // Publishing a public booking page is two decisions, and the demo makes only one of them.
  await setModuleEnabled(owner as never, { organizationId, key: 'booking', enabled: true });
  const types = await listBookableTypes(owner as never, { organizationId });
  typeId = types[0]!.id;
  typeName = types[0]!.name;
  intakeForm = await publish(`Vehicle details ${Date.now()}`, VEHICLE);
  await setTypeBookingIntake(owner as never, { typeId, formId: intakeForm.formId });
  portalForm = await publish(`Portal question ${Date.now()}`, { ...VEHICLE, title: PORTAL_TITLE });
  await setPortalForm(owner as never, { organizationId, formId: portalForm.formId, enabled: true });
  portalToken = await createPortalInvite(owner as never, { customerId });

  // A day this business has something free on, found the way a visitor would: by looking.
  const probe = await (await browser.newContext(STRANGER)).newPage();
  const start = new Date();
  for (let offset = 0; offset < 21 && !bookableDay; offset += 1) {
    const day = new Date(start.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    await probe.goto(`/book/${slug}?on=${day}`);
    await probe.getByText('Times shown are in').waitFor();
    if ((await card(probe).getByRole('button', { name: /^\d{1,2}:\d{2}/ }).count()) > 0) bookableDay = day;
  }
  await probe.context().close();
  if (!bookableDay) throw new Error('The demo business has nothing free in the next three weeks.');
});

test.afterAll(async () => {
  await setTypeBookingIntake(owner as never, { typeId, formId: null });
  await pg.end();
});

test('A: the link is exchanged once, the address carries no secret, and a reload keeps the session', async ({ browser }) => {
  const { context, page } = await asStranger(browser);
  const posted: string[] = [];
  page.on('request', (request) => { if (request.method() === 'POST') posted.push(request.postData() ?? ''); });

  await page.goto(`/portal/${portalToken}`);
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole('heading', { name: 'Your invoices' })).toBeVisible();
  expect(await page.content()).not.toContain(portalToken);
  await shot(page, 'portal-home-desktop');

  const cookies = (await context.cookies()).filter((cookie) => cookie.name.startsWith('gold-portal'));
  expect(cookies.length).toBeGreaterThan(0);
  for (const cookie of cookies) {
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.path).toBe('/portal');
  }
  expect(await page.evaluate(() => document.cookie)).not.toContain('gold-portal');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your invoices' })).toBeVisible();
  // Nothing after the exchange carries the link.
  expect(posted.join('\n')).not.toContain(portalToken);

  // An invented link lands where every dead link lands.
  await page.goto('/portal/not-a-real-link');
  await expect(page).toHaveURL(/\/portal\/unavailable$/);
  await expect(page.getByRole('heading', { name: 'This link no longer works' })).toBeVisible();
  await context.close();
});

test('B: a portal form is the customer’s, recorded against the exact revision, with no link in the request', async ({ browser }) => {
  const { context, page } = await asStranger(browser);
  const posted: string[] = [];
  page.on('request', (request) => { if (request.method() === 'POST') posted.push(request.postData() ?? ''); });
  await page.goto(`/portal/${portalToken}`);
  await page.getByRole('listitem').filter({ hasText: PORTAL_TITLE }).getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByLabel('Vehicle', { exact: true }).fill('Portal van');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('status')).toContainText('Thanks, we have it');
  expect(posted.join('\n')).not.toContain(portalToken);

  const row = (await pg.query('select source, customer_id, form_revision_id from public.form_submissions where organization_id = $1 and form_id = $2', [organizationId, portalForm.formId])).rows;
  expect(row).toEqual([{ source: 'portal', customer_id: customerId, form_revision_id: portalForm.revisionId }]);
  await context.close();
});

test('C: with no processor configured the portal offers no Pay, and revoking the link ends the session on the next request', async ({ browser }) => {
  const { context, page } = await asStranger(browser);
  await page.goto(`/portal/${portalToken}`);
  await expect(page.getByRole('heading', { name: 'Your invoices' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Pay / })).toHaveCount(0);

  const invite = (await listPortalInvites(owner as never, { organizationId, customerId })).find((entry) => entry.token === portalToken)!;
  await revokePortalInvite(owner as never, { id: invite.id });

  // The same browser, the same cookie: the customer is simply no longer anyone.
  await page.reload();
  await expect(page).toHaveURL(/\/portal\/unavailable$/);
  await page.goto(`/portal/${portalToken}`);
  await expect(page).toHaveURL(/\/portal\/unavailable$/);
  await context.close();

  portalToken = await createPortalInvite(owner as never, { customerId });
});

test('D: a booking asks its business’s questions and the answers are recorded with it', async ({ browser }) => {
  const { context, page } = await asStranger(browser);
  await openBooking(page);
  await page.getByPlaceholder('Your name').fill('Camille Booker');
  await page.getByPlaceholder('Email').fill(`camille-${Date.now()}@example.test`);
  await expect(card(page).getByText('About your vehicle')).toBeVisible();
  // A customer is never shown how the questions are kept.
  await expect(page.getByText(/revision|published form/i)).toHaveCount(0);
  await card(page).getByLabel('Vehicle', { exact: true }).fill('Golf GTI');
  await card(page).getByLabel('Anything we should know?').fill('Winter tyres');
  await shot(page, 'booking-intake-desktop');

  const before = await submissions();
  await card(page).getByRole('button', { name: /^Book / }).click();
  await expect(page).toHaveURL(new RegExp(`/book/${slug}/[0-9a-f-]{36}$`));

  const rows = (await pg.query('select source, booking_work_item_id, customer_id, form_revision_id, answers from public.form_submissions where organization_id = $1 and form_id = $2 order by submitted_at desc limit 1', [organizationId, intakeForm.formId])).rows;
  expect(await submissions()).toBe(before + 1);
  expect(rows[0]).toMatchObject({ source: 'booking', form_revision_id: intakeForm.revisionId, answers: { vehicle: 'Golf GTI', notes: 'Winter tyres' } });
  expect(page.url()).toContain(rows[0].booking_work_item_id);
  const work = (await pg.query('select customer_id from public.work_items where id = $1', [rows[0].booking_work_item_id])).rows[0];
  expect(rows[0].customer_id).toBe(work.customer_id);
  await context.close();
});

test('E: an answer the form refuses books nothing, and neither does a form changed under the visitor', async ({ browser }) => {
  const { context, page } = await asStranger(browser);
  await openBooking(page);
  await page.getByPlaceholder('Your name').fill('Camille Blank');
  await page.getByPlaceholder('Email').fill(`blank-${Date.now()}@example.test`);

  const bookings = await workItems();
  const answers = await submissions();
  await card(page).getByRole('button', { name: /^Book / }).click();
  await expect(card(page).getByLabel('Vehicle', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  await expect(card(page).getByLabel('Vehicle', { exact: true })).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/book/${slug}`));
  expect(await workItems()).toBe(bookings);
  expect(await submissions()).toBe(answers);

  // The business publishes a new version while this visitor is still answering.
  const draft = await createFormDraft(owner as never, organizationId, intakeForm.formId);
  await saveFormDraft(owner as never, { organizationId, revisionId: draft, definition: { ...VEHICLE, title: 'About your vehicle, again' } });
  await publishFormRevision(owner as never, { organizationId, revisionId: draft });

  await card(page).getByLabel('Vehicle', { exact: true }).fill('Polo');
  await card(page).getByRole('button', { name: /^Book / }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'just updated' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload this page' })).toBeVisible();
  expect(await workItems()).toBe(bookings);
  expect(await submissions()).toBe(answers);

  // After a reload the visitor is asked the new questions and the booking goes through.
  await openBooking(page);
  await expect(card(page).getByText('About your vehicle, again')).toBeVisible();
  await page.getByPlaceholder('Your name').fill('Camille Again');
  await page.getByPlaceholder('Email').fill(`again-${Date.now()}@example.test`);
  await card(page).getByLabel('Vehicle', { exact: true }).fill('Polo');
  await card(page).getByRole('button', { name: /^Book / }).click();
  await expect(page).toHaveURL(new RegExp(`/book/${slug}/[0-9a-f-]{36}$`));
  const last = (await pg.query('select form_revision_id from public.form_submissions where organization_id = $1 and form_id = $2 order by submitted_at desc limit 1', [organizationId, intakeForm.formId])).rows[0];
  expect(last.form_revision_id).toBe(draft);
  await context.close();
});

test('F: Studio, the portal and a public form open together, and none ends another', async ({ browser }) => {
  // One browser, three tabs: the operator's own signed-in context is the one the portal link is opened in.
  const context = await browser.newContext({ storageState: OWNER_STORAGE_STATE });
  const studio = await context.newPage();
  const portal = await context.newPage();
  const site = await context.newPage();
  const customers = `/organizations/${organizationId}/crm/contacts`;

  await studio.goto(customers);
  await expect(studio).toHaveURL(new RegExp(`${customers}$`));

  await portal.goto(`/portal/${portalToken}`);
  await expect(portal.getByRole('heading', { name: 'Your invoices' })).toBeVisible();

  await studio.reload();
  await expect(studio).toHaveURL(new RegExp(`${customers}$`));

  await site.goto(`/f/${intakeForm.publicKey}`);
  await site.getByLabel('Vehicle', { exact: true }).fill('Studio-side visitor');
  await site.getByRole('button', { name: 'Send' }).click();
  await expect(site.getByRole('status')).toBeVisible();

  await studio.reload();
  await expect(studio).toHaveURL(new RegExp(`${customers}$`));
  await portal.reload();
  await expect(portal.getByRole('heading', { name: 'Your invoices' })).toBeVisible();

  // The two sessions live in different cookies: the portal's is scoped to /portal and named for it.
  const names = (await context.cookies()).map((cookie) => cookie.name);
  expect(names.some((name) => name.startsWith('gold-portal'))).toBe(true);
  expect(names.some((name) => /^sb-.*-auth-token/.test(name))).toBe(true);
  await context.close();
});

test('phone width: the portal, its form and the booking with questions all fit', async ({ browser }) => {
  const { context, page } = await asStranger(browser, { width: 390, height: 844 });
  await page.goto(`/portal/${portalToken}`);
  await expect(page.getByRole('heading', { name: 'Your invoices' })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.getByRole('listitem').filter({ hasText: PORTAL_TITLE }).getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.getByLabel('Vehicle', { exact: true })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByLabel('Vehicle', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, 'portal-form-error-phone');

  await page.goto(`/book/${slug}?on=${bookableDay}`);
  await card(page).getByRole('button', { name: /^\d{1,2}:\d{2}/ }).first().click();
  await expect(card(page).getByLabel('Vehicle', { exact: true })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await page.getByPlaceholder('Your name').fill('Phone Visitor');
  await page.getByPlaceholder('Email').fill(`phone-${Date.now()}@example.test`);
  await card(page).getByRole('button', { name: /^Book / }).click();
  await expect(card(page).getByLabel('Vehicle', { exact: true })).toHaveAttribute('aria-invalid', 'true');
  expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, 'booking-intake-phone');
  await context.close();
});

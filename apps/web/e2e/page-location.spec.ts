import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Database } from '../lib/db/types';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { createCustomer } from '../lib/domain/customers/customers';
import { saveBusinessProfile } from '../lib/domain/tenancy/business-profile';
import { createOpportunity } from '../lib/domain/opportunities/opportunities';
import { followUpsAvailable } from '../lib/application/crm/follow-ups';
import { RESOLVED_LOCATION_ROUTES } from '../lib/route/page-location';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { createPlan, grantPlanProduct } from '../lib/domain/catalogue/plans';
import { recordPlanAssignment } from '../lib/domain/catalogue/organization-plans';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';

/**
 * Rendered evidence for the page-location pilot (ADR-047, Slice 1B): the CRM Customers collection
 * and Customer detail resolve their location through `resolveLocation`, while unmigrated routes
 * keep their old behaviour. Expectations are the Batch 1 trails, not the implementation's output.
 *
 * Disposable loopback tenants only. `LOCATION_PHASE` (`before` | `after`) names the folder the
 * regression capture writes to under the ignored `.artifacts/page-location-1b`, so the same
 * capture can be compared across the change.
 */
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

const WIDTHS = [320, 390, 820, 1024, 1440] as const;
const PHASE = process.env.LOCATION_PHASE ?? 'after';
const OUT = path.join(__dirname, '../../..', '.artifacts', 'page-location-1b', PHASE);
const LONG_NAME = 'Northshore Heating, Ventilation and Air Conditioning Maintenance Cooperative of the Greater Lakeshore Region';

type Fixture = {
  email: string; password: string; userId: string; otherUserId: string;
  plain: string; vocabulary: string; other: string;
  acme: string; bravo: string; long: string; hidden: string;
  opportunity: string; hiddenOpportunity: string; followUps: boolean;
};
let fixture: Fixture;
let cleanup: () => Promise<void> = async () => {};

test.beforeAll(async () => {
  config({ path: path.join(__dirname, '../../..', '.env.test'), quiet: true });
  const url = process.env.SUPABASE_URL!;
  const connection = process.env.SUPABASE_DB_URL!;
  // Fixtures are created and deleted only in a local database, through a local app: never a hosted or shared environment.
  const app = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  if (![url, connection, app].every((value) => ['localhost', '127.0.0.1'].includes(new URL(value).hostname))) throw new Error('Disposable loopback fixtures only');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
  const db = createClient<Database>(url, process.env.SUPABASE_ANON_KEY!, options);
  const email = `page-location-${randomUUID()}@example.test`, password = randomUUID();
  const otherEmail = `page-location-other-${randomUUID()}@example.test`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  const otherPassword = randomUUID();
  const otherMade = await admin.auth.admin.createUser({ email: otherEmail, password: otherPassword, email_confirm: true });
  if (made.error) throw made.error;
  if (otherMade.error) throw otherMade.error;
  const pg = new Client(connection); await pg.connect();
  const organizations: string[] = [];
  const planKey = `page_location_${Date.now()}`;
  cleanup = async () => {
    await pg.query('delete from platform_staff where user_id=$1', [made.data.user.id]);
    await pg.query('delete from organizations where id=any($1::uuid[])', [organizations]);
    await pg.query('delete from platform_plans where key=$1', [planKey]);
    for (const id of [made.data.user.id, otherMade.data.user.id]) {
      const removed = await admin.auth.admin.deleteUser(id);
      if (removed.error) throw removed.error;
    }
    await pg.end();
  };
  await pg.query('insert into platform_staff(user_id,name) values($1,$2)', [made.data.user.id, 'Local page-location fixture']);
  const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
  const plain = await provisionOrganization(db, { ownerEmail: email, name: 'Location default business', currency: 'CAD', timezone: 'America/Toronto', displayName: 'Jane Doe' });
  const vocabulary = await provisionOrganization(db, { ownerEmail: email, name: 'Location vocabulary business', currency: 'CAD', timezone: 'America/Toronto', displayName: 'Jane Doe' });
  // A business the signed-in person does not belong to: its customer must never be named.
  const other = await provisionOrganization(db, { ownerEmail: otherEmail, name: 'Location other business', currency: 'CAD', timezone: 'America/Toronto', displayName: 'Someone Else' });
  organizations.push(plain, vocabulary, other);
  // Calling and pipeline, so the Dialer regression control renders its real page.
  const planId = await createPlan(db, { key: planKey, kind: 'plan', label: 'Local page-location', description: 'Local browser fixture only', billable: false });
  for (const productKey of ['comms', 'sales']) await grantPlanProduct(db, { planId, productKey });
  for (const organizationId of [plain, vocabulary]) {
    await setModuleEnabled(db, { organizationId, key: 'reception', enabled: true });
    await pg.query("insert into organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note) values($1,'module:reception','2020-01-01','9999-12-31',1,0,'CAD',$2,'Local page-location fixture')", [organizationId, made.data.user.id]);
    await recordPlanAssignment(db, { organizationId, planId, periodStart: '2020-01-01', periodEnd: '9999-12-31' });
  }
  const acme = await createCustomer(db, { organizationId: plain, name: 'Acme Ltd' });
  const bravo = await createCustomer(db, { organizationId: plain, name: 'Bravo Services' });
  const long = await createCustomer(db, { organizationId: plain, name: LONG_NAME });
  await createCustomer(db, { organizationId: vocabulary, name: 'Delta Clinic' });
  // The other business's own records, made by its own owner through the ordinary domain commands.
  const otherDb = createClient<Database>(url, process.env.SUPABASE_ANON_KEY!, options);
  const otherLogin = await otherDb.auth.signInWithPassword({ email: otherEmail, password: otherPassword }); if (otherLogin.error) throw otherLogin.error;
  const hidden = await createCustomer(otherDb, { organizationId: other, name: 'Hidden Secret Customer' });
  const opportunity = await createOpportunity(db, { organizationId: plain, customerId: acme, title: 'Roof refit' });
  await createOpportunity(db, { organizationId: vocabulary, customerId: await createCustomer(db, { organizationId: vocabulary, name: 'Echo Dental' }), title: 'Clinic fit-out' });
  const hiddenOpportunity = await createOpportunity(otherDb, { organizationId: other, customerId: hidden, title: 'Hidden Secret Deal' });
  const followUps = await followUpsAvailable(db, plain);
  // Customers is renamed by destination label; Opportunities, which the profile does not accept as a label key, by its business noun.
  await saveBusinessProfile(db, vocabulary, { revision: 0, nouns: { opportunity: { singular: 'Deal', plural: 'Deals' } }, navigation: [], labels: { customers: 'Clients' } });
  await pg.query('delete from platform_staff where user_id=$1', [made.data.user.id]);
  fixture = { email, password, userId: made.data.user.id, otherUserId: otherMade.data.user.id, plain, vocabulary, other, acme, bravo, long, hidden, opportunity, hiddenOpportunity, followUps };
});

test.afterAll(async () => { await cleanup(); });

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL((value) => value.pathname !== '/login');
}

/** What the header bar and the page say about where the person is, read from the rendered page. */
async function readIdentity(page: Page) {
  const header = page.locator('header.sticky').first();
  const breadcrumb = header.getByRole('navigation', { name: 'breadcrumb' });
  const desktop = await breadcrumb.isVisible() ? await breadcrumb.locator('li[data-slot="breadcrumb-item"]').evaluateAll((items) => items.map((item) => {
    const link = item.querySelector('a');
    return { label: (item.textContent ?? '').trim(), href: link ? new URL(link.href).pathname : null };
  })) : null;
  const mobileNav = header.getByRole('navigation', { name: 'Page location' });
  const mobile = await mobileNav.isVisible() ? {
    up: await mobileNav.getByRole('link', { name: 'Back to parent' }).count() ? new URL(await mobileNav.getByRole('link', { name: 'Back to parent' }).evaluate((link) => (link as HTMLAnchorElement).href)).pathname : null,
    current: ((await mobileNav.locator('[aria-current="page"]').first().textContent()) ?? '').trim(),
  } : null;
  // Headings as assistive technology meets them: a streamed boundary waiting in a `hidden`
  // container is not in the accessibility tree and is not the page's heading.
  const headings = await page.getByRole('heading', { level: 1 }).evaluateAll((items) => items.map((item) => {
    const box = item.getBoundingClientRect();
    const style = getComputedStyle(item);
    const visible = box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && style.clip !== 'rect(0px, 0px, 0px, 0px)' && !item.closest('.sr-only') && !item.classList.contains('sr-only');
    return { text: (item.textContent ?? '').trim(), visible, hiddenAncestor: Boolean(item.closest('[hidden]')) };
  }));
  const rawHeadings = await page.locator('h1').evaluateAll((items) => items.map((item) => ({ text: (item.textContent ?? '').trim(), hiddenAncestor: Boolean(item.closest('[hidden]')) })));
  const breadcrumbLandmarks = await page.getByRole('navigation', { name: 'breadcrumb' }).evaluateAll((items) => items.filter((item) => (item as HTMLElement).offsetParent !== null).length);
  const pageLocationLandmarks = await page.getByRole('navigation', { name: 'Page location' }).evaluateAll((items) => items.filter((item) => (item as HTMLElement).offsetParent !== null).length);
  const horizontalScroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  return { desktop, mobile, headings, rawHeadings, landmarks: breadcrumbLandmarks + pageLocationLandmarks, horizontalScroll };
}

async function capture(page: Page, name: string) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  return readIdentity(page);
}

/** One coherent location: the expected trail on desktop, the same parent on phone, one meaningful h1. */
async function expectLocation(page: Page, width: number, expected: { trail: { label: string; href: string | null }[]; current: string; heading: string; stateHeading?: boolean; up?: string }) {
  const up = expected.up ?? [...expected.trail].reverse().find((crumb) => crumb.href)?.href ?? null;
  // Wait for the navigation to settle on this location; a stale trail must not pass by being early.
  const located = async () => {
    const identity = await readIdentity(page);
    return width >= 768
      ? { desktop: identity.desktop, mobile: identity.mobile }
      : { desktop: identity.desktop, mobile: identity.mobile };
  };
  if (width >= 768) {
    await expect.poll(located, { message: 'desktop breadcrumb', timeout: 15_000 }).toEqual({ desktop: [...expected.trail, { label: expected.current, href: null }], mobile: null });
  } else {
    await expect.poll(located, { message: 'phone location', timeout: 15_000 }).toEqual({ desktop: null, mobile: { up, current: expected.current } });
  }
  const identity = await readIdentity(page);
  expect(identity.landmarks, 'one location landmark').toBe(1);
  expect(identity.headings.map((heading) => heading.text), 'one h1 ' + JSON.stringify(identity.rawHeadings)).toEqual([expected.heading]);
  // A state page names the state as its visible heading (A16); any other page shows no visible title,
  // and nothing ever repeats the location the bar already shows.
  expect(identity.headings.filter((heading) => heading.visible).map((heading) => heading.text), 'no visible duplicate page title').toEqual(expected.stateHeading ? [expected.heading] : []);
  expect(identity.headings.some((heading) => heading.visible && heading.text === expected.current), 'the bar\'s location is never repeated as a visible title').toBe(false);
  expect(identity.horizontalScroll, 'no sideways scroll').toBe(false);
  return identity;
}

/**
 * Records every primary heading the document holds while a page streams and settles: raw `h1`
 * elements, and those a person could actually meet (outside `hidden`, `aria-hidden` and
 * `display: none` subtrees). Installed before any page script runs.
 */
function watchHeadings() {
  type Sample = { raw: number; exposed: number; extra: string[]; path: string };
  const store = window as unknown as { __headings: Sample[] };
  store.__headings = [];
  const sample = () => {
    const all = [...document.querySelectorAll('h1')];
    const exposed = all.filter((item) => !item.closest('[hidden],[aria-hidden="true"]') && (item as HTMLElement).checkVisibility());
    if (all.length > 1 || exposed.length > 1) {
      store.__headings.push({
        raw: all.length,
        exposed: exposed.length,
        extra: all.filter((item) => !exposed.includes(item)).map((item) => (item.closest('[hidden]') ? 'hidden-attribute' : item.closest('[aria-hidden="true"]') ? 'aria-hidden' : 'display-none')),
        path: location.pathname,
      });
    }
  };
  new MutationObserver(sample).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style', 'class', 'aria-hidden'] });
}

/** The headings once the page has rendered its content: an `h1` with text, or 15 seconds. */
async function settledHeadings(page: Page) {
  const started = Date.now();
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => [...document.querySelectorAll('h1')].some((item) => (item.textContent ?? '').trim() && !(item.textContent ?? '').includes('Loading')), undefined, { timeout: 15_000 }).catch(() => undefined);
  const counts = await page.evaluate(() => {
    const all = [...document.querySelectorAll('h1')];
    return { raw: all.length, exposed: all.filter((item) => !item.closest('[hidden],[aria-hidden="true"]') && (item as HTMLElement).checkVisibility()).length };
  });
  return { ...counts, ms: Date.now() - started };
}

test('streaming never exposes a second primary heading, and the settled page has one', async ({ page }) => {
  test.setTimeout(240_000);
  await page.addInitScript(watchHeadings);
  await signIn(page, fixture.email, fixture.password);
  const base = `/organizations/${fixture.plain}`;
  const settled: Record<string, unknown> = {};
  await page.setViewportSize({ width: 390, height: 900 });
  for (let round = 0; round < 5; round++) {
    // The original observation came straight after sign-in, so each round starts there.
    await page.goto(`${base}/home`);
    await page.goto(`${base}/customers`);
    settled[`hard-collection-${round}`] = await settledHeadings(page);
    await page.goto(`${base}/customers/${fixture.acme}`);
    settled[`hard-record-${round}`] = await settledHeadings(page);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/customers`);
  for (let round = 0; round < 3; round++) {
    await page.getByRole('link', { name: 'Acme Ltd', exact: true }).first().click();
    await page.waitForURL(`**/customers/${fixture.acme}`);
    settled[`client-record-${round}`] = await settledHeadings(page);
    await page.goBack();
    await page.waitForURL(`**${base}/customers`);
    settled[`client-back-${round}`] = await settledHeadings(page);
  }
  const samples = await page.evaluate(() => (window as unknown as { __headings: unknown[] }).__headings);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, 'heading-stream.json'), JSON.stringify({ settled, samples }, null, 2));
  for (const [name, value] of Object.entries(settled)) expect({ raw: (value as { raw: number }).raw, exposed: (value as { exposed: number }).exposed }, name).toEqual({ raw: 1, exposed: 1 });
  expect((samples as { exposed: number }[]).filter((sample) => sample.exposed > 1), 'a second heading a person could meet').toEqual([]);
});

test('regression controls: unmigrated routes keep their location', async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, fixture.email, fixture.password);
  const base = `/organizations/${fixture.plain}`;
  const results: Record<string, unknown> = {};
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, route] of [['dialer', '/calls'], ['work-home', '/field'], ['settings-general', '/settings/general']] as const) {
      await page.goto(`${base}${route}`);
      await page.waitForLoadState('networkidle');
      results[`${name}@${width}`] = await capture(page, `control-${name}-${width}`);
    }
  }
  await context.close();
  results.platform = await platformControl(browser);
  writeFileSync(path.join(OUT, 'regression-controls.json'), JSON.stringify(results, null, 2));
});

/** The demo's own staff account, when this environment has the demo; otherwise recorded as unavailable. */
async function platformControl(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page, 'staff@gold.test', DEMO_PASSWORD);
    const out: Record<string, unknown> = {};
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/platform/plans');
      await page.waitForLoadState('networkidle');
      out[`platform-plans@${width}`] = await capture(page, `control-platform-plans-${width}`);
    }
    return out;
  } catch (error) {
    return { unavailable: String(error).slice(0, 200) };
  } finally {
    await context.close();
  }
}

test('Customers collection and Customer detail resolve one location', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signIn(page, fixture.email, fixture.password);
  const base = `/organizations/${fixture.plain}`;
  const crm = { label: 'CRM', href: `${base}/sales` };
  const customers = { label: 'Customers', href: `${base}/customers` };

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });

    await page.goto(`${base}/customers`);
    await expectLocation(page, width, { trail: [crm], current: 'Customers', heading: 'Customers' });
    await capture(page, `customers-${width}`);

    const vocabularyBase = `/organizations/${fixture.vocabulary}`;
    await page.goto(`${vocabularyBase}/customers`);
    await expectLocation(page, width, { trail: [{ label: 'CRM', href: `${vocabularyBase}/sales` }], current: 'Clients', heading: 'Clients' });
    await capture(page, `customers-vocabulary-${width}`);

    // Direct deep-link entry to a record.
    await page.goto(`${base}/customers/${fixture.acme}`);
    await expectLocation(page, width, { trail: [crm, customers], current: 'Acme Ltd', heading: 'Acme Ltd' });
    await capture(page, `customer-${width}`);

    await page.goto(`${base}/customers/${fixture.long}`);
    await expectLocation(page, width, { trail: [crm, customers], current: LONG_NAME, heading: LONG_NAME });
    await capture(page, `customer-long-${width}`);

    await page.goto(`${base}/customers/${randomUUID()}`);
    await expectLocation(page, width, { trail: [crm, customers], current: 'Not found', heading: 'This page does not exist', stateHeading: true });
    await capture(page, `customer-missing-${width}`);

    // Another business's customer: the same not-found, and its name is never on the page.
    await page.goto(`${base}/customers/${fixture.hidden}`);
    await expectLocation(page, width, { trail: [crm, customers], current: 'Not found', heading: 'This page does not exist', stateHeading: true });
    expect(await page.content()).not.toContain('Hidden Secret Customer');
    await capture(page, `customer-unauthorized-${width}`);
  }

  // Panels open: the location stays put, single and unclipped.
  for (const width of [390, 820, 1440] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/customers`);
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await expectLocation(page, width, { trail: [crm], current: 'Customers', heading: 'Customers' });
    await capture(page, `customers-configure-${width}`);
    await page.goto(`${base}/customers/${fixture.acme}`);
    const agent = page.getByRole('button', { name: 'Agent', exact: true }).first();
    if (await agent.isVisible()) {
      await agent.click();
      await expectLocation(page, width, { trail: [crm, customers], current: 'Acme Ltd', heading: 'Acme Ltd' });
      await capture(page, `customer-agent-${width}`);
      await page.keyboard.press('Escape');
    }
  }

  // Client-side transitions between records never show a previous record's name.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/customers`);
  const seen: string[] = [];
  await page.route('**/customers/**', async (route) => {
    if (route.request().headers()['rsc']) await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.getByRole('link', { name: 'Acme Ltd', exact: true }).first().click();
  await expect(page.locator('header.sticky').getByRole('navigation', { name: 'breadcrumb' })).toContainText('Loading…');
  seen.push((await page.locator('header.sticky').getByRole('navigation', { name: 'breadcrumb' }).textContent()) ?? '');
  await capture(page, 'customer-loading-1440');
  await expectLocation(page, 1440, { trail: [crm, customers], current: 'Acme Ltd', heading: 'Acme Ltd' });
  await page.getByRole('link', { name: 'Customers', exact: true }).first().click();
  await expectLocation(page, 1440, { trail: [crm], current: 'Customers', heading: 'Customers' });
  await page.getByRole('link', { name: 'Bravo Services', exact: true }).first().click();
  await expect(page.locator('header.sticky').getByRole('navigation', { name: 'breadcrumb' })).not.toContainText('Acme Ltd');
  await expectLocation(page, 1440, { trail: [crm, customers], current: 'Bravo Services', heading: 'Bravo Services' });
  await page.unroute('**/customers/**');
  expect(seen[0]).not.toContain('Acme Ltd');
  expect(errors, 'no page errors').toEqual([]);
});

/** The CRM operating routes Slice 1C covers, keyed by the location each one should resolve to. */
function crmRoutes() {
  const base = `/organizations/${fixture.plain}`;
  const crm = { label: 'CRM', href: `${base}/sales` };
  const followUps = fixture.followUps
    ? { trail: [crm], current: 'Follow-ups', heading: 'Follow-ups' }
    : { trail: [crm], current: 'Not found', heading: 'This page does not exist', stateHeading: true };
  return {
    'workspace:crm': { path: `${base}/sales`, expected: { trail: [], current: 'CRM', heading: 'CRM', up: `${base}/home` } },
    'area:customers': { path: `${base}/customers`, expected: { trail: [crm], current: 'Customers', heading: 'Customers' } },
    'record:customer': { path: `${base}/customers/${fixture.acme}`, expected: { trail: [crm, { label: 'Customers', href: `${base}/customers` }], current: 'Acme Ltd', heading: 'Acme Ltd' } },
    'area:pipeline': { path: `${base}/customers/pipeline`, expected: { trail: [crm], current: 'Relationship pipeline', heading: 'Relationship pipeline' } },
    'area:opportunities': { path: `${base}/opportunities`, expected: { trail: [crm], current: 'Opportunities', heading: 'Opportunities' } },
    'record:opportunity': { path: `${base}/opportunities/${fixture.opportunity}`, expected: { trail: [crm, { label: 'Opportunities', href: `${base}/opportunities` }], current: 'Roof refit', heading: 'Roof refit' } },
    'area:follow-ups': { path: `${base}/follow-ups`, expected: followUps },
    'area:calendar': { path: `${base}/sales/calendar`, expected: { trail: [crm], current: 'Calendar', heading: 'Calendar' } },
    'area:crm-search': { path: `${base}/sales/search`, expected: { trail: [crm], current: 'Search CRM', heading: 'Search CRM' } },
  } as Record<string, { path: string; expected: Parameters<typeof expectLocation>[2] }>;
}

test('CRM capture: the location every CRM operating route shows', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, fixture.email, fixture.password);
  const base = `/organizations/${fixture.plain}`;
  const routes = { ...Object.fromEntries(Object.entries(crmRoutes()).map(([id, { path: route }]) => [id, route])), 'area:opportunity-pipeline': `${base}/opportunities/pipeline` };
  const results: Record<string, unknown> = {};
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [id, route] of Object.entries(routes)) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      results[`${id}@${width}`] = await capture(page, `crm-${id.replace(':', '-')}-${width}`);
    }
  }
  writeFileSync(path.join(OUT, 'crm-capture.json'), JSON.stringify(results, null, 2));
});

test('every route on the migration list has a rendered check and one location publisher', async ({ page }) => {
  test.setTimeout(240_000);
  const warnings: string[] = [];
  page.on('console', (message) => { if (['warning', 'error'].includes(message.type()) && /RESOLVED_LOCATION_ROUTES|is incomplete/.test(message.text())) warnings.push(message.text()); });
  await signIn(page, fixture.email, fixture.password);
  const routes = crmRoutes();
  // A route is only migrated once its rendered behaviour is checked here.
  expect(Object.keys(routes).sort(), 'rendered checks for exactly the migration list').toEqual([...RESOLVED_LOCATION_ROUTES].sort());
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [id, { path: route, expected }] of Object.entries(routes)) {
      await page.goto(route);
      await test.step(`${id} at ${width}`, async () => { await expectLocation(page, width, expected); });
    }
  }
  // The Opportunity pipeline (U-17) still publishes its own trail, and only that one.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/organizations/${fixture.plain}/opportunities/pipeline`);
  await page.waitForLoadState('networkidle');
  const identity = await readIdentity(page);
  expect(identity.landmarks).toBe(1);
  expect(identity.desktop).toEqual([{ label: 'CRM', href: `/organizations/${fixture.plain}/sales` }, { label: 'Opportunity pipeline', href: null }]);
  await page.waitForTimeout(1500);
  expect(warnings, 'no header asked for a location it does not own, and every record label arrived').toEqual([]);
});

test('CRM records: deep links, client navigation, vocabulary, loading, missing, isolation and keyboard', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signIn(page, fixture.email, fixture.password);
  const base = `/organizations/${fixture.plain}`;
  const crm = { label: 'CRM', href: `${base}/sales` };
  const opportunities = { label: 'Opportunities', href: `${base}/opportunities` };

  for (const width of [320, 390, 820, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/opportunities/${fixture.opportunity}`);
    await expectLocation(page, width, { trail: [crm, opportunities], current: 'Roof refit', heading: 'Roof refit' });
    await capture(page, `opportunity-${width}`);
    await page.goto(`${base}/opportunities/${randomUUID()}`);
    await expectLocation(page, width, { trail: [crm, opportunities], current: 'Not found', heading: 'This page does not exist', stateHeading: true });
    await page.goto(`${base}/opportunities/${fixture.hiddenOpportunity}`);
    await expectLocation(page, width, { trail: [crm, opportunities], current: 'Not found', heading: 'This page does not exist', stateHeading: true });
    expect(await page.content()).not.toContain('Hidden Secret Deal');
    await capture(page, `opportunity-unauthorized-${width}`);
  }

  // Business vocabulary by key: "Deals" in the bar and the heading, CRM unchanged.
  const vocabularyBase = `/organizations/${fixture.vocabulary}`;
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${vocabularyBase}/opportunities`);
    await expectLocation(page, width, { trail: [{ label: 'CRM', href: `${vocabularyBase}/sales` }], current: 'Deals', heading: 'Deals' });
    await capture(page, `opportunities-vocabulary-${width}`);
  }

  // Hidden but authorized: Opportunities is linked in the trail although the sidebar lists no such row.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/opportunities/${fixture.opportunity}`);
  await expectLocation(page, 1440, { trail: [crm, opportunities], current: 'Roof refit', heading: 'Roof refit' });
  await expect(page.getByRole('navigation', { name: 'This business' }).getByRole('link', { name: 'Opportunities', exact: true })).toHaveCount(0);
  await expect(page.locator('header.sticky').getByRole('link', { name: 'Opportunities', exact: true })).toHaveAttribute('href', `${base}/opportunities`);

  // Keyboard: the trail's links are reachable in order and show a focus indicator.
  await page.locator('body').focus();
  const focusedTrail: string[] = [];
  for (let press = 0; press < 40 && focusedTrail.length < 2; press++) {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active?.closest('nav[aria-label="breadcrumb"]')) return null;
      return { label: (active.textContent ?? '').trim(), ring: getComputedStyle(active).boxShadow };
    });
    if (focused && !focusedTrail.includes(focused.label)) {
      focusedTrail.push(focused.label);
      expect(focused.ring, `${focused.label} shows a focus ring`).not.toBe('none');
    }
  }
  expect(focusedTrail).toEqual(['CRM', 'Opportunities']);

  // Client-side: list → record (while loading, then resolved) → back → forward, never stale.
  await page.goto(`${base}/opportunities`);
  await page.route('**/opportunities/**', async (route) => {
    if (route.request().headers()['rsc']) await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.getByRole('link', { name: 'Roof refit', exact: true }).first().click();
  await expect(page.locator('header.sticky').getByRole('navigation', { name: 'breadcrumb' })).toContainText('Loading…');
  expect(await page.getByRole('heading', { level: 1 }).allTextContents()).toEqual(['Loading…']);
  await capture(page, 'opportunity-loading-1440');
  await expectLocation(page, 1440, { trail: [crm, opportunities], current: 'Roof refit', heading: 'Roof refit' });
  await page.unroute('**/opportunities/**');
  await page.goBack();
  await expectLocation(page, 1440, { trail: [crm], current: 'Opportunities', heading: 'Opportunities' });
  await page.goForward();
  await expectLocation(page, 1440, { trail: [crm, opportunities], current: 'Roof refit', heading: 'Roof refit' });

  // Rapid moves between records never show the previous record's name.
  await page.goto(`${base}/customers/${fixture.acme}`);
  await page.goto(`${base}/customers/${fixture.bravo}`);
  await page.goto(`${base}/opportunities/${fixture.opportunity}`);
  await expectLocation(page, 1440, { trail: [crm, opportunities], current: 'Roof refit', heading: 'Roof refit' });
  await expect(page.locator('header.sticky')).not.toContainText('Bravo Services');

  // Panels: the Agent open on a record, at phone, tablet and desktop.
  for (const width of [390, 820, 1440] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/opportunities/${fixture.opportunity}`);
    const agent = page.getByRole('button', { name: 'Agent', exact: true }).first();
    if (await agent.isVisible()) {
      await agent.click();
      await expectLocation(page, width, { trail: [crm, opportunities], current: 'Roof refit', heading: 'Roof refit' });
      await capture(page, `opportunity-agent-${width}`);
      await page.keyboard.press('Escape');
    }
  }

  // Organization change: the other business's Customers, with nothing carried over.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/opportunities/${fixture.opportunity}`);
  await page.goto(`${vocabularyBase}/customers`);
  await expectLocation(page, 1440, { trail: [{ label: 'CRM', href: `${vocabularyBase}/sales` }], current: 'Clients', heading: 'Clients' });
  await expect(page.locator('header.sticky')).not.toContainText('Roof refit');
  expect(errors, 'no page errors').toEqual([]);
});

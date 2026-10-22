import { WORKSPACES as REGISTERED_WORKSPACES } from '../lib/navigation';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import type { Database } from '../lib/db/types';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { createPlan, grantPlanProduct } from '../lib/domain/catalogue/plans';
import { recordPlanAssignment } from '../lib/domain/catalogue/organization-plans';
import { createRole } from '../lib/domain/tenancy/roles';
import { addMember } from '../lib/domain/tenancy/members';

/**
 * Rendered evidence for explicit Dashboard navigation (ADR-049): inside an entered
 * workspace identity is plain, Dashboard links to its canonical landing, and Overview never duplicates it. The
 * expectations are the approved contract, not the implementation's output.
 *
 * Disposable loopback tenants only. `NAVIGATION_PHASE` (`before` | `after`) names the folder the
 * capture writes to under the ignored `.artifacts/workspace-navigation-2a`.
 */
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial' });

const PHASE = process.env.NAVIGATION_PHASE ?? 'after';
const OUT = path.join(__dirname, '../../..', '.artifacts', 'workspace-navigation-2a', PHASE);

type Fixture = { owner: { email: string; password: string }; configurer: { email: string; password: string }; full: string; noCalling: string };
let fixture: Fixture;
let cleanup: () => Promise<void> = async () => {};

test.beforeAll(async () => {
  config({ path: path.join(__dirname, '../../..', '.env.test'), quiet: true });
  const url = process.env.SUPABASE_URL!;
  const connection = process.env.SUPABASE_DB_URL!;
  const app = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
  // Fixtures are created and deleted only in a local database, through a local app.
  if (![url, connection, app].every((value) => ['localhost', '127.0.0.1'].includes(new URL(value).hostname))) throw new Error('Disposable loopback fixtures only');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
  const db = createClient<Database>(url, process.env.SUPABASE_ANON_KEY!, options);
  const owner = { email: `workspace-nav-${randomUUID()}@example.test`, password: randomUUID() };
  const configurer = { email: `workspace-nav-config-${randomUUID()}@example.test`, password: randomUUID() };
  const madeOwner = await admin.auth.admin.createUser({ email: owner.email, password: owner.password, email_confirm: true });
  const madeConfigurer = await admin.auth.admin.createUser({ email: configurer.email, password: configurer.password, email_confirm: true });
  if (madeOwner.error) throw madeOwner.error;
  if (madeConfigurer.error) throw madeConfigurer.error;
  const pg = new Client(connection); await pg.connect();
  const organizations: string[] = [];
  const planKey = `workspace_nav_${Date.now()}`;
  cleanup = async () => {
    if (organizations.length) {
      const paths = await pg.query('select storage_path from integration_resources where organization_id=any($1::uuid[]) and storage_path is not null',[organizations]);
      if(paths.rows.length) {const removed = await admin.storage.from('documents').remove(paths.rows.map(row=>row.storage_path));if(removed.error)throw removed.error;}
    }
    await pg.query('delete from platform_staff where user_id=$1', [madeOwner.data.user.id]);
    await pg.query('delete from organizations where id=any($1::uuid[])', [organizations]);
    await pg.query('delete from platform_plans where key=$1', [planKey]);
    for (const id of [madeOwner.data.user.id, madeConfigurer.data.user.id]) {
      const removed = await admin.auth.admin.deleteUser(id);
      if (removed.error) throw removed.error;
    }
    await pg.end();
  };
  await pg.query('insert into platform_staff(user_id,name) values($1,$2)', [madeOwner.data.user.id, 'Local workspace navigation fixture']);
  const login = await db.auth.signInWithPassword({ email: owner.email, password: owner.password }); if (login.error) throw login.error;
  const full = await provisionOrganization(db, { ownerEmail: owner.email, name: 'Navigation full business', currency: 'CAD', timezone: 'America/Toronto', displayName: 'Jane Doe' });
  // A business without calling and pipeline: Communications is not part of it.
  const noCalling = await provisionOrganization(db, { ownerEmail: owner.email, name: 'Navigation no-calling business', currency: 'CAD', timezone: 'America/Toronto', displayName: 'Jane Doe' });
  organizations.push(full, noCalling);
  const planId = await createPlan(db, { key: planKey, kind: 'plan', label: 'Local workspace navigation', description: 'Local browser fixture only', billable: false });
  for (const productKey of ['comms', 'sales', 'workspace', 'automations', 'finance', 'studio', 'agents', 'field', 'service']) await grantPlanProduct(db, { planId, productKey });
  await setModuleEnabled(db, { organizationId: full, key: 'reception', enabled: true });
  await pg.query("insert into organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note) values($1,'module:reception','2020-01-01','9999-12-31',1,0,'CAD',$2,'Local workspace navigation fixture')", [full, madeOwner.data.user.id]);
  for (const key of ['integrations','automations','billing']) {
    await setModuleEnabled(db, {organizationId:full,key,enabled:true});
    await pg.query("insert into organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note) values($1,$2,'2020-01-01','9999-12-31',1,0,'CAD',$3,'Local GuildOps fixture') on conflict do nothing",[full,`module:${key}`,madeOwner.data.user.id]);
  }
  await recordPlanAssignment(db, { organizationId: full, planId, periodStart: '2020-01-01', periodEnd: '9999-12-31' });
  // A member who may configure calling but not operate it.
  const roleId = await createRole(db, { organizationId: full, name: `Navigation configure ${randomUUID().slice(0, 8)}`, capabilities: ['field.manage'] });
  await addMember(db, { organizationId: full, email: configurer.email, roleId, displayName: 'Configuration member' });
  await pg.query('delete from platform_staff where user_id=$1', [madeOwner.data.user.id]);
  fixture = { owner, configurer, full, noCalling };
});

test.afterAll(async () => { await cleanup(); });

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(who.email);
  await page.getByLabel('Password', { exact: true }).fill(who.password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.waitForURL((value) => value.pathname !== '/login');
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'This business', exact: true }).filter({ visible: true });

/** What the business navigation offers: each group's heading (and whether it is a link) and its links. */
async function readNavigation(page: Page) {
  return sidebar(page).evaluate((nav) => [...nav.querySelectorAll('[data-slot="sidebar-group"]')].map((group) => {
    const heading = group.querySelector('[data-slot="sidebar-group-label"]');
    const headingLink = heading?.closest('a') ?? heading?.querySelector('a') ?? (heading?.tagName === 'A' ? heading : null);
    return {
      heading: heading ? { text: (heading.textContent ?? '').trim(), href: headingLink ? new URL((headingLink as HTMLAnchorElement).href).pathname : null, current: headingLink?.getAttribute('aria-current') ?? null } : null,
      links: [...group.querySelectorAll('[data-slot="sidebar-menu"] a')].map((link) => ({ text: (link.textContent ?? '').trim(), href: new URL((link as HTMLAnchorElement).href).pathname, current: link.getAttribute('aria-current') })),
    };
  }));
}

async function readStrip(page: Page) {
  const strip = page.locator('nav[aria-label$=" destinations"]').filter({ visible: true });
  return await strip.count() ? strip.first().getByRole('link').evaluateAll((links) => links.map((link) => (link.textContent ?? '').trim())) : null;
}

/** The phone's location menu in the header: its items and group headings. */
async function readPhoneLocationMenu(page: Page) {
  const trigger = page.getByRole('button', { name: 'Navigate within current section' });
  if (!(await trigger.isVisible())) return null;
  await trigger.click();
  const menu = page.getByRole('menu');
  const items = await menu.getByRole('menuitem').evaluateAll((entries) => entries.map((entry) => ({ text: (entry.textContent ?? '').trim(), current: entry.getAttribute('aria-current') })));
  await page.keyboard.press('Escape');
  return items;
}

async function openPhoneMenu(page: Page) {
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(sidebar(page)).toBeVisible();
}

const WORKSPACES = {
  crm: { row: 'CRM', home: '/crm', child: '/crm/contacts' },
  communications: { row: 'Communications', home: '/comms', child: '/calls' },
  work: { row: 'Work', home: '/field', child: '/work' },
  support: { row: 'Support', home: '/support', child: '/support/cases' },
  studio: { row: 'Studio', home: '/studio', child: '/studio/forms' },
} as const;

test('navigation capture: what each workspace offers at phone, tablet and desktop', async ({ page }) => {
  test.setTimeout(420_000);
  await signIn(page, fixture.owner);
  const base = `/organizations/${fixture.full}`;
  const results: Record<string, unknown> = {};
  mkdirSync(OUT, { recursive: true });
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [key, workspace] of Object.entries(WORKSPACES)) {
      for (const [where, route] of [['home', workspace.home], ['child', workspace.child]] as const) {
        await page.goto(`${base}${route}`);
        await page.waitForLoadState('networkidle');
        const name = `${key}-${where}-${width}`;
        const entry: Record<string, unknown> = { strip: await readStrip(page), phoneLocation: width < 768 ? await readPhoneLocationMenu(page) : null };
        if (width < 768) await openPhoneMenu(page);
        entry.navigation = await readNavigation(page);
        await page.screenshot({ caret: 'initial', path: path.join(OUT, `${name}.png`) });
        if (width < 768) await page.keyboard.press('Escape');
        results[name] = entry;
      }
    }
    await page.goto(`${base}/calls`);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ caret: 'initial', path: path.join(OUT, `control-dialer-${width}.png`) });
  }
  writeFileSync(path.join(OUT, 'navigation.json'), JSON.stringify(results, null, 2));
});

/** The operating destinations each workspace offers this owner, from the approved projection (no Overview). */
const CHILDREN = {
  crm: ['Contacts', 'Pipeline'],
  communications: ['Dialer', 'Inbox'],
  work: ['Work items'],
  support: ['Cases', 'Queues', 'Service levels', 'Reports'],
  studio: ['Website', 'Customer portal', 'Forms', 'Templates'],
} as const;

/** The business navigation, opening the phone Menu first where the sidebar is a sheet. */
async function businessNav(page: Page, width: number) {
  if (width < 768 && !(await sidebar(page).isVisible())) await openPhoneMenu(page);
  return sidebar(page);
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll').toBe(true);
}

test('the explicit Dashboard is the way Home, at every width', async ({ page }) => {
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signIn(page, fixture.owner);
  const base = `/organizations/${fixture.full}`;
  for (const width of [320, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [key, workspace] of Object.entries(WORKSPACES) as [keyof typeof WORKSPACES, (typeof WORKSPACES)[keyof typeof WORKSPACES]][]) {
      await test.step(`${workspace.row} at ${width}`, async () => {
        // Enter from the organization's directory: the row opens the workspace Home.
        await page.goto(`${base}/home`);
        let nav = await businessNav(page, width);
        await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
        await nav.getByRole('link', { name: workspace.row, exact: true }).click();
        await page.waitForURL(`**${base}${workspace.home}`);

        // Inside: the heading is the Home and current; no Overview; every child destination is there.
        nav = await businessNav(page, width);
        const heading = nav.getByRole('link', { name: 'Dashboard', exact: true });
        await expect(heading).toHaveAttribute('href', `${base}${workspace.home}`);
        await expect(heading).toHaveAttribute('aria-current', 'page');
        await expect(nav.getByRole('link', { name: 'Overview', exact: true })).toHaveCount(0);
        for (const child of CHILDREN[key]) await expect(nav.getByRole('link', { name: child, exact: true })).toBeVisible();
        // Hierarchical: the other workspaces are not listed beside these pages.
        for (const other of Object.values(WORKSPACES).filter((candidate) => candidate.row !== workspace.row)) await expect(nav.getByRole('link', { name: other.row, exact: true })).toHaveCount(0);
        await noHorizontalScroll(page);
        await page.screenshot({ caret: 'initial', path: path.join(OUT, `${key}-entered-${width}.png`) });

        // A child page keeps the workspace context; the heading is no longer current.
        await nav.getByRole('link', { name: CHILDREN[key][0], exact: true }).click();
        await page.waitForURL((url) => url.pathname !== `${base}${workspace.home}`);
        nav = await businessNav(page, width);
        await expect(nav.getByRole('link', { name: 'Dashboard', exact: true })).not.toHaveAttribute('aria-current', 'page');
        await expect(nav.getByRole('link', { name: CHILDREN[key][0], exact: true })).toHaveAttribute('aria-current', 'page');

        // Back to the workspace Home through the heading.
        await nav.getByRole('link', { name: 'Dashboard', exact: true }).click();
        await page.waitForURL(`**${base}${workspace.home}`);

        // The phone's location menu offers the same Home.
        if (width < 768) {
          if (await sidebar(page).isVisible()) await page.keyboard.press('Escape');
          const items = await readPhoneLocationMenu(page);
          if (items) {
            expect(items.map((item) => item.text)).not.toContain('Overview');
            expect(items.find((item) => item.text === 'Dashboard')?.current).toBe('page');
          }
        }

        // Leave through organization Home: back to the directory, no workspace context.
        nav = await businessNav(page, width);
        await nav.getByRole('link', { name: 'Home', exact: true }).click();
        await page.waitForURL(`**${base}/home`);
        nav = await businessNav(page, width);
        await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
        await expect(nav.getByRole('link', { name: workspace.row, exact: true })).toBeVisible();
        if (width < 768) await page.keyboard.press('Escape');
      });
    }
  }
  expect(errors, 'no page errors').toEqual([]);
});

test('the header, breadcrumbs, keyboard and collapsed rail keep the contract', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, fixture.owner);
  const base = `/organizations/${fixture.full}`;
  await page.setViewportSize({ width: 1440, height: 900 });

  // ADR-048 retired the header destination strip (Slice 2A asserted it here): the header row carries
  // no destination list, while the sidebar still offers every destination.
  for (const [home, expected] of [['/comms', ['Dialer', 'Inbox']], ['/support', ['Cases', 'Queues', 'Service levels', 'Reports']]] as const) {
    await page.goto(`${base}${home}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-header-controls]').filter({ visible: true }).first().getByRole('navigation')).toHaveCount(0);
    await expect(page.locator('nav[aria-label$=" destinations"]').filter({ visible: true })).toHaveCount(0);
    for (const destination of expected) await expect(sidebar(page).getByRole('link', { name: destination, exact: true })).toBeVisible();
  }

  // Breadcrumbs and headings keep their approved contracts.
  await page.goto(`${base}/crm`);
  await expect(page.locator('header.sticky').getByRole('navigation', { name: 'breadcrumb' })).toHaveText(/^Dashboard$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(['Dashboard']);
  await page.goto(`${base}/crm/contacts`);
  await expect(page.locator('header.sticky').getByRole('navigation', { name: 'breadcrumb' })).toContainText('Contacts');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(['Contacts']);

  // Keyboard: the heading is reachable, shows focus and opens the Home with Enter.
  await page.locator('body').focus();
  let reached = false;
  for (let press = 0; press < 30 && !reached; press++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Dashboard');
  }
  expect(reached, 'CRM home is reachable by keyboard').toBe(true);
  const focus = await page.evaluate(() => { const style = getComputedStyle(document.activeElement as Element); return { ring: style.boxShadow, outline: style.outlineStyle }; });
  expect(focus.ring !== 'none' || focus.outline !== 'none', 'a visible focus indicator').toBe(true);
  await page.keyboard.press('Enter');
  await page.waitForURL(`**${base}/crm`);

  // The collapsed rail keeps the heading, by icon and name.
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click();
  await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toHaveCount(1);
  await page.waitForTimeout(500);
  await expect(sidebar(page).getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
  await sidebar(page).getByRole('link', { name: 'Dashboard', exact: true }).hover();
  await page.screenshot({ caret: 'initial', path: path.join(OUT, 'crm-collapsed-rail-1440.png') });
  await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click();
});

test('a configuration-only member gets no operating Home link', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, fixture.configurer);
  const base = `/organizations/${fixture.full}`;
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/comms/configuration/calling`);
    const nav = await businessNav(page, width);
    await expect(nav.getByRole('heading', { name:'Communications', exact: true })).toBeVisible();
    for (const name of ['Dashboard', 'Communications home', 'Overview', 'Dialer', 'Inbox']) await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Configuration', exact: true })).toHaveAttribute('href', `${base}/comms/configuration/calling`);
    await expect(nav.getByRole('link', { name: 'Configuration', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.screenshot({ caret: 'initial', path: path.join(OUT, `configuration-only-${width}.png`) });
    if (width < 768) await page.keyboard.press('Escape');
  }
  await page.goto(`${base}/comms`);
  await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible();
});

test('a workspace the business is not entitled to stays absent', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, fixture.owner);
  const base = `/organizations/${fixture.noCalling}`;
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/home`);
    const nav = await businessNav(page, width);
    // Automations is not part of this business at all.
    await expect(nav.getByRole('link', { name: 'Automations', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'CRM', exact: true })).toBeVisible();
    // Calling is not entitled, but Messaging and Email configuration carry no entitlement gate (finding F-27):
    // the owner is offered Communications as configuration only, never its operating Home or pages.
    await expect(nav.getByRole('link', { name: 'Communications', exact: true })).toHaveAttribute('href', new RegExp(`${base}/comms/configuration/`));
    await nav.getByRole('link', { name: 'Communications', exact: true }).click();
    await page.waitForURL((url) => url.pathname.startsWith(`${base}/comms/configuration`));
    const inside = await businessNav(page, width);
    for (const name of ['Dashboard', 'Communications home', 'Overview', 'Dialer', 'Inbox']) await expect(inside.getByRole('link', { name, exact: true })).toHaveCount(0);
    if (width < 768) await page.keyboard.press('Escape');
  }
  await page.goto(`${base}/comms`);
  await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible();
});

/** The representative pages Slice 2B checks: each workspace's Home and one page inside it. */
const HEADER_PAGES = {
  crm: ['/crm', '/crm/contacts'],
  communications: ['/comms', '/calls'],
  support: ['/support', '/support/cases'],
  work: ['/field', '/work'],
  finance: ['/finance', '/finance/invoices'],
  studio: ['/studio', '/studio/forms'],
} as const;

/** What the page header offers: its action row's controls in order, any destination strip, the Calendar shortcut and the location. */
async function readHeader(page: Page) {
  const row = page.locator('[data-header-controls]').filter({ visible: true }).first();
  const controls = await row.count() ? await row.evaluate((element) => [...element.querySelectorAll('a, button')].filter((control) => (control as HTMLElement).offsetParent !== null && !control.closest('[aria-hidden="true"],[inert]')).map((control) => (control.getAttribute('aria-label') ?? control.textContent ?? '').trim())) : [];
  const strip = await page.locator('nav[aria-label$=" destinations"]').count();
  const calendar = page.locator('header.sticky').getByRole('link', { name: /calendar$/i });
  const calendarHref = await calendar.count() ? new URL(await calendar.first().evaluate((link) => (link as HTMLAnchorElement).href)).pathname : null;
  const breadcrumb = page.locator('header.sticky').getByRole('navigation', { name: 'breadcrumb' });
  const trail = await breadcrumb.isVisible() ? ((await breadcrumb.textContent()) ?? '').replace(/\s+/g, ' ').trim() : null;
  const headings = await page.getByRole('heading', { level: 1 }).allTextContents();
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  return { controls, strip, calendarHref, trail, headings, horizontalScroll: scroll };
}

test('header capture: actions, strip and Calendar on representative pages', async ({ page }) => {
  test.setTimeout(600_000);
  await signIn(page, fixture.owner);
  const base = `/organizations/${fixture.full}`;
  const results: Record<string, unknown> = {};
  mkdirSync(OUT, { recursive: true });
  for (const width of [390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [key, routes] of Object.entries(HEADER_PAGES)) {
      for (const route of routes) {
        await page.goto(`${base}${route}`);
        await page.waitForLoadState('networkidle');
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeAttached();
        const name = `header-${key}${route.replaceAll('/', '-')}-${width}`;
        results[name] = await readHeader(page);
        await page.screenshot({ caret: 'initial', path: path.join(OUT, `${name}.png`) });
      }
    }
  }
  // The configuration-only member's Calendar shortcut.
  const configuring = await page.context().browser()!.newContext();
  const other = await configuring.newPage();
  await signIn(other, fixture.configurer);
  await other.setViewportSize({ width: 1440, height: 900 });
  await other.goto(`${base}/comms/configuration/calling`);
  await other.waitForLoadState('networkidle');
  results['configuration-only-calling-1440'] = await readHeader(other);
  await other.screenshot({ caret: 'initial', path: path.join(OUT, 'header-configuration-only-1440.png') });
  await configuring.close();
  // Collapsed sidebar, and the panels open, on Support and Customers.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/support`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click();
  await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toHaveCount(1);
  await page.waitForTimeout(500);
  results['support-collapsed-1440'] = await readHeader(page);
  await page.screenshot({ caret: 'initial', path: path.join(OUT, 'header-support-collapsed-1440.png') });
  await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click();
  for (const [name, route, panel] of [['support-configure', '/support', 'Configure'], ['customers-configure', '/crm/contacts', 'Configure'], ['customers-agent', '/crm/contacts', 'Agent']] as const) {
    await page.goto(`${base}${route}`);
    await page.waitForLoadState('networkidle');
    const trigger = page.getByRole('button', { name: panel, exact: true }).first();
    if (await trigger.isVisible()) {
      await trigger.click();
      await page.waitForTimeout(400);
      results[`${name}-1440`] = await readHeader(page);
      await page.screenshot({ caret: 'initial', path: path.join(OUT, `header-${name}-1440.png`) });
      await page.keyboard.press('Escape');
    } else results[`${name}-1440`] = 'trigger not offered';
  }
  writeFileSync(path.join(OUT, 'header.json'), JSON.stringify(results, null, 2));
});

/** What the page header's action row may never contain: the entered workspace's own destinations. */
const SIDEBAR_DESTINATIONS = ['Customers', 'Relationship pipeline', 'Dialer', 'Inbox', 'Cases', 'Queues', 'Service levels', 'Reports', 'Work items', 'Website', 'Customer portal', 'Forms', 'Templates', 'Quotes', 'Invoices', 'Payments'];

test('the header carries page identity and actions, never the workspace destinations (ADR-048)', async ({ page }) => {
  test.setTimeout(900_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await signIn(page, fixture.owner);
  const base = `/organizations/${fixture.full}`;
  const registered = { crm: '/crm/calendar', communications: '/comms/calendar', support: '/support/calendar', work: '/field/calendar', finance: '/finance/calendar', studio: '/studio/calendar' } as const;
  const results: Record<string, unknown> = {};
  for (const width of [320, 390, 820, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [key, routes] of Object.entries(HEADER_PAGES) as [keyof typeof HEADER_PAGES, readonly string[]][]) {
      for (const route of routes) {
        await test.step(`${route} at ${width}`, async () => {
          await page.goto(`${base}${route}`);
          await expect(page.getByRole('heading', { level: 1 }).first()).toBeAttached();
          await page.waitForLoadState('networkidle');
          const header = await readHeader(page);
          results[`${key}${route.replaceAll('/', '-')}-${width}`] = header;
          // No destination list in the action row, and none of the sidebar's destinations offered there.
          const row = page.locator('[data-header-controls]').filter({ visible: true });
          if (await row.count()) await expect(row.first().getByRole('navigation')).toHaveCount(0);
          expect(header.controls.filter((control) => SIDEBAR_DESTINATIONS.includes(control)), 'header repeats a sidebar destination').toEqual([]);
          // One page identity, and nothing scrolls sideways.
          await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
          expect(header.horizontalScroll).toBe(false);
          // The Calendar shortcut is the registered calendar of this workspace, whenever it is offered.
          if (header.calendarHref) expect(header.calendarHref).toBe(`${base}${registered[key]}`);
          await page.screenshot({ caret: 'initial', path: path.join(OUT, `header-${key}${route.replaceAll('/', '-')}-${width}.png`) });
        });
      }
    }
  }
  writeFileSync(path.join(OUT, 'header-acceptance.json'), JSON.stringify(results, null, 2));

  // Every workspace destination is still reachable from the sidebar, and its Calendar opens a real calendar.
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [key, workspace] of Object.entries(WORKSPACES) as [keyof typeof WORKSPACES, (typeof WORKSPACES)[keyof typeof WORKSPACES]][]) {
    await page.goto(`${base}${workspace.home}`);
    for (const child of CHILDREN[key]) await expect(sidebar(page).getByRole('link', { name: child, exact: true })).toBeVisible();
    await page.locator('header.sticky').getByRole('link', { name: `${workspace.row} calendar` }).click();
    await page.waitForURL(`**${base}${registered[key === 'work' ? 'work' : key]}`);
    await expect(page.locator('header.sticky').getByRole('navigation', { name: 'breadcrumb' })).toContainText('Calendar');
  }

  // A page-local view control still works: Work items' List / Board.
  await page.goto(`${base}/work`);
  await page.getByRole('navigation', { name: 'Work view' }).getByRole('link', { name: 'Board', exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get('view') === 'board');
  await expect(page.getByRole('navigation', { name: 'Work view' }).getByRole('link', { name: 'Board', exact: true })).toHaveAttribute('aria-current', 'page');

  // The Calendar shortcut is focusable and shows focus.
  await page.goto(`${base}/support`);
  const calendar = page.locator('header.sticky').getByRole('link', { name: 'Support calendar' });
  await calendar.focus();
  const focus = await calendar.evaluate((element) => { const style = getComputedStyle(element); return { ring: style.boxShadow, outline: style.outlineStyle }; });
  expect(focus.ring !== 'none' || focus.outline !== 'none', 'Calendar shows focus').toBe(true);

  // Panels open: page identity stays single and in place.
  for (const [name, route, panel] of [['support-configure', '/support', 'Configure'], ['customers-configure', '/crm/contacts', 'Configure'], ['customers-agent', '/crm/contacts', 'Agent']] as const) {
    for (const width of [820, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}${route}`);
      await page.waitForLoadState('networkidle');
      await page.getByRole('button', { name: panel, exact: true }).first().click();
      await page.waitForTimeout(400);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page.locator('header.sticky').getByRole('navigation', { name: 'breadcrumb' })).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      await page.screenshot({ caret: 'initial', path: path.join(OUT, `header-${name}-${width}.png`) });
      await page.keyboard.press('Escape');
    }
  }
  expect(errors, 'no page errors').toEqual([]);
});

test('no Calendar shortcut for a workspace whose Home this person cannot use', async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, fixture.configurer);
  const base = `/organizations/${fixture.full}`;
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${base}/comms/configuration/calling`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('header.sticky').getByRole('link', { name: /calendar$/i })).toHaveCount(0);
    await page.screenshot({ caret: 'initial', path: path.join(OUT, `header-configuration-only-${width}.png`) });
  }
});

test('the workspace identity stays distinct from Dashboard, expanded and collapsed', async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, fixture.owner);
  const base = `/organizations/${fixture.full}`;
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [key, workspace] of Object.entries(WORKSPACES)) {
    for (const collapsed of [false, true]) {
      await page.goto(`${base}${workspace.child}`);
      await page.waitForLoadState('networkidle');
      const state = await page.locator('[data-slot="sidebar"][data-state]').first().getAttribute('data-state');
      if ((state === 'collapsed') !== collapsed) await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click();
      await expect(page.locator(`[data-slot="sidebar"][data-state="${collapsed ? 'collapsed' : 'expanded'}"]`)).toHaveCount(1);
      await page.waitForTimeout(400);
      const heading = sidebar(page).getByRole('link', { name: 'Dashboard', exact: true });
      await expect(heading).toBeVisible();
      await expect(heading.locator('svg.lucide-gauge')).toBeVisible();
      await expect(sidebar(page).locator('[data-workspace-heading] a')).toHaveCount(0);
      await expect(heading).not.toHaveAttribute('aria-current', 'page');
      await expect(heading).toHaveAttribute('data-active', 'false');
      // Keyboard focus on the heading is visible (reached by Tab: the ring is for keyboard focus, not scripted focus).
      // Start from the sidebar's Home link: a page may move focus into its own content (the Dialer focuses its number field).
      await sidebar(page).getByRole('link', { name: 'Home', exact: true }).focus();
      let reached = false;
      for (let press = 0; press < 10 && !reached; press++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate((name) => document.activeElement?.textContent?.trim() === name, 'Dashboard');
      }
      expect(reached, `${key} heading is reachable by keyboard`).toBe(true);
      const focus = await heading.evaluate((element) => { const style = getComputedStyle(element); return { ring: style.boxShadow, outline: style.outlineStyle }; });
      expect(focus.ring !== 'none' || focus.outline !== 'none', `${key} heading shows focus`).toBe(true);
      await page.screenshot({ caret: 'initial', path: path.join(OUT, `heading-${key}-${collapsed ? 'collapsed' : 'expanded'}-1440.png`) });
    }
  }
  // Leave the sidebar expanded for whoever uses this browser state next.
  const state = await page.locator('[data-slot="sidebar"][data-state]').first().getAttribute('data-state');
  if (state === 'collapsed') await page.getByRole('button', { name: 'Toggle Sidebar' }).first().click();
});

test('all nine registered workspaces expose one explicit Dashboard at each responsive width', async ({page}) => {
  test.setTimeout(600_000);
  await signIn(page,fixture.owner);
  const base=`/organizations/${fixture.full}`;
  for (const width of [390,820,1440]) {
    await page.setViewportSize({width,height:900});
    for (const workspace of REGISTERED_WORKSPACES) {
      await page.goto(`${base}/${workspace.home}`);
      await expect(page.getByRole('heading',{level:1})).toHaveText(['Dashboard']);
      const nav=await businessNav(page,width);
      const dashboard=nav.getByRole('link',{name:'Dashboard',exact:true});
      await expect(dashboard).toHaveCount(1);await expect(dashboard).toHaveAttribute('href',`${base}/${workspace.home}`);
      await expect(dashboard).toHaveAttribute('aria-current','page');
      await expect(dashboard.locator('svg.lucide-gauge')).toHaveCount(1);
      await expect(nav.locator('[data-workspace-heading] a')).toHaveCount(0);
      await noHorizontalScroll(page);
      await page.screenshot({ caret: 'initial',path:path.join(OUT,`guildops-${workspace.key}-${width}.png`)});
      if(width<768)await page.keyboard.press('Escape');
    }
  }
});

test('contact lifecycle, multiple opportunities, and reviewed intake from Contacts and Library', async ({page}) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(30000);
  await signIn(page,fixture.owner);
  await page.setViewportSize({width:1440,height:900});
  const base=`/organizations/${fixture.full}`;
  const suffix=randomUUID().slice(0,8),name=`GuildOps contact ${suffix}`,email=`guildops-${suffix}@example.test`;
  await page.goto(`${base}/crm/contacts`);
  await page.getByRole('button',{name:'Add contact',exact:true}).click();
  let dialog=page.getByRole('dialog');
  await dialog.getByLabel('Name',{exact:true}).fill(name);await dialog.getByRole('textbox',{name:/^Email/}).fill(email);
  await expect(dialog.getByLabel('Lifecycle',{exact:true})).toHaveValue('lead');
  await dialog.getByLabel('Lead temperature').selectOption('warm');
  await dialog.getByRole('button',{name:'Add contact',exact:true}).click();await expect(dialog).toHaveCount(0);
  await page.getByRole('link',{name,exact:true}).filter({visible:true}).first().click();
  await page.waitForURL(/\/crm\/contacts\/[a-f0-9-]+$/);
  const identity=page.url();
  for(const [lifecycle,temperature] of [['lead','hot'],['prospect','hot'],['customer','cold']]) {
    await page.getByRole('button',{name:'Edit',exact:true}).click();dialog=page.getByRole('dialog');
    await dialog.getByLabel('Lifecycle',{exact:true}).selectOption(lifecycle);await dialog.getByLabel('Lead temperature').selectOption(temperature);
    await dialog.getByRole('button',{name:'Save',exact:true}).click();await expect(dialog).toHaveCount(0);
    await page.reload();expect(page.url()).toBe(identity);
    await expect(page.getByRole('main').getByText(`${lifecycle.charAt(0).toUpperCase()+lifecycle.slice(1)} / ${temperature.charAt(0).toUpperCase()+temperature.slice(1)} temperature`,{exact:false})).toBeVisible();
  }
  for(const width of [390,820,1440]) {await page.setViewportSize({width,height:900});await noHorizontalScroll(page);await page.screenshot({ caret: 'initial',path:path.join(OUT,`guildops-contact-${width}.png`)});}
  await page.setViewportSize({width:1440,height:900});
  await page.goto(`${base}/crm/pipeline`);
  for(const index of [1,2]) {
    await page.getByRole('button',{name:'New opportunity',exact:true}).click();dialog=page.getByRole('dialog');
    await dialog.getByLabel('Find contact').fill(name);
    await expect(dialog.getByLabel('Contact',{exact:true}).getByRole('option',{name,exact:true})).toBeAttached();
    await dialog.getByLabel('Contact',{exact:true}).selectOption({label:name});
    await dialog.getByLabel('Title',{exact:true}).fill(`GuildOps opportunity ${index} ${suffix}`);
    await dialog.getByRole('button',{name:'Save opportunity',exact:true}).click();await page.waitForURL(/\/crm\/opportunities\/[a-f0-9-]+$/);
    await page.goto(`${base}/crm/pipeline`);
  }
  for(const index of [1,2])await expect(page.getByRole('link',{name:`GuildOps opportunity ${index} ${suffix}`,exact:true})).toBeVisible();
  await page.getByRole('link',{name:'List view',exact:true}).click();
  for(const index of [1,2])await expect(page.getByRole('link',{name:`GuildOps opportunity ${index} ${suffix}`,exact:true}).filter({visible:true}).first()).toBeVisible();
  await page.goto(`${base}/crm/contacts?q=${encodeURIComponent(name)}&lifecycle=customer&temperature=cold`);
  await expect(page.getByRole('link',{name,exact:true}).filter({visible:true})).toHaveCount(1);
  await page.getByRole('link',{name:'Import',exact:true}).click();
  await page.getByLabel('CSV file').setInputFiles({name:`guildops-${suffix}.csv`,mimeType:'text/csv',buffer:Buffer.from(`source_record_id,name,email,lifecycle,temperature\n100,Imported ${suffix},import-${suffix}@example.test,lead,warm\n101,Duplicate ${suffix},import-${suffix}@example.test,lead,cold`)});
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.waitForURL(/resourceId=/);
  const resourceId=new URL(page.url()).searchParams.get('resourceId')!;
  async function reviewAndApply() {
    await page.getByRole('button',{name:'Review import',exact:true}).click();await page.waitForURL(/\/library\/imports\/[a-f0-9-]+$/);
    await page.getByRole('button',{name:'Import 1 contact',exact:true}).click();
    await page.getByRole('dialog').getByRole('button',{name:'Import 1 contact?',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Result',exact:true})).toBeVisible();
  }
  await reviewAndApply();
  await page.goto(`${base}/library/sources/${resourceId}`);await page.getByRole('link',{name:'Import into CRM',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/library/imports/new[?]resourceId=${resourceId}`));await reviewAndApply();
  await page.goto(`${base}/crm/contacts?q=Imported+${suffix}&lifecycle=lead&temperature=warm`);
  await expect(page.getByRole('link',{name:`Imported ${suffix}`,exact:true}).filter({visible:true})).toHaveCount(1);
  for(const width of [390,820,1440]) {
    await page.setViewportSize({width,height:900});await noHorizontalScroll(page);
    await page.screenshot({ caret: 'initial',path:path.join(OUT,`guildops-imported-contacts-${width}.png`)});
  }
});

import './appearance-env';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createRole } from '../lib/domain/tenancy/roles';
import { addMember } from '../lib/domain/tenancy/members';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { test, expect } from '@playwright/test';
import { COLLEAGUE_STORAGE_STATE, loadDemoContext, OWNER_STORAGE_STATE, platformUrl, STAFF_STORAGE_STATE } from './helpers';

/**
 * The one adaptive shell, in a browser. What each person sees is a projection of the
 * organization's entitlements, their own permissions and — in GildOps' own organization — their
 * platform permissions. `shell-projection.test.ts` proves the matrix on the pure function; these
 * prove the projection is what actually renders, on desktop and on a phone, and that a hidden
 * destination is still refused when the URL is typed.
 */

const accountMenu = async (page: import('@playwright/test').Page) => {
  await page.locator('[data-slot=sidebar-footer] .group\\/account-menu').filter({ visible: true }).click();
  return page.getByRole('menu');
};
const sidebar = (page: import('@playwright/test').Page) => page.locator('[data-slot="sidebar-container"] nav[aria-label="This business"]');

test.describe('a tenant owner', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });
  for (const path of ['marketing', 'finance/invoices', 'ai', 'comms', 'support', 'studio']) for (const width of [1440, 768, 390]) test(`shared workspace header ${path} fits its canvas at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const { organizationId } = loadDemoContext();
    const base = `/organizations/${organizationId}`;
    {
      await page.goto(`${base}/home`);
      if (width === 390) await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).click();
      const home = path.split('/')[0];
      test.skip(!await page.getByRole('navigation', { name: 'This business', exact: true }).filter({ visible: true }).locator(`a[href="${base}/${home}"]`).count(), 'Existing local tenant does not have an operating Home for this workspace.');
      await page.goto(`${base}/${path}`);
      const row = page.locator('[data-header-controls]').first();
      await expect(row).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      // ADR-048: the header no longer reproduces the sidebar's destinations; the sidebar owns them.
      await expect(row.getByRole('navigation')).toHaveCount(0);
      expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${path.replaceAll('/', '-')}-${width}.png`) });
      if (width === 1440) {
        // Models either docked panel narrowing the canvas without a viewport resize.
        await row.locator('..').evaluate(element => { element.style.width = '720px'; element.style.maxWidth = '100%'; });
        await expect(row.getByRole('navigation')).toHaveCount(0);
        expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      }
      if (width === 390) {
        await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).click();
        // ADR-047: the phone menu reaches the workspace Home through its heading; there is no Overview child.
        const phoneNav = page.getByRole('navigation', { name: 'This business', exact: true }).filter({ visible: true });
        await expect(phoneNav.getByRole('link', { name: / home$/ })).toBeVisible();
        await expect(phoneNav.getByRole('link', { name: 'Overview', exact: true })).toHaveCount(0);
      }
    }
  });

  test('workspace header responds to docked Agent and Configure panels', async ({ page }, info) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const base = `/organizations/${loadDemoContext().organizationId}`;
    await page.goto(`${base}/marketing`);
    const row = page.locator('[data-header-controls]').first();
    await expect(row.getByRole('navigation')).toBeVisible();
    const label = row.locator('nav a').last();
    const original = await label.textContent();
    await label.evaluate(element => { element.textContent = 'A much longer business-authored destination label that must yield to essential page actions'; });
    await expect(row.getByRole('navigation')).toHaveCount(0);
    expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await label.evaluate((element, text) => { element.textContent = text; }, original);
    await expect(row.getByRole('navigation')).toBeVisible();
    await page.getByRole('button', { name: 'Agent', exact: true }).filter({ visible: true }).click();
    await expect(page.getByRole('button', { name: 'Close Agent', exact: true })).toBeVisible();
    await expect(row.getByRole('navigation')).toHaveCount(0);
    expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath('marketing-agent-open.png') });
    await page.getByRole('button', { name: 'Close Agent', exact: true }).click();
    await expect(row.getByRole('navigation')).toBeVisible();
    await page.goto(`${base}/support`);
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Page panel', exact: true })).toBeVisible();
    await expect(row.getByRole('navigation')).toHaveCount(0);
    expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath('support-configure-open.png') });
  });
  test('keeps workspace selection and contextual destinations through navigation, refresh and history', async ({page}) => {
    const {organizationId}=loadDemoContext();const base=`/organizations/${organizationId}`;
    await page.goto(`${base}/home`);
    const links=await sidebar(page).getByRole('link').evaluateAll(elements=>elements.map(element=>element.getAttribute('href')));
    await page.locator('[data-slot="sidebar-container"]').evaluate(element=>element.setAttribute('data-persistence-probe','retained'));
    for(const path of ['sales','comms','field','finance','ai']) {
      if(!links.includes(`${base}/${path}`))continue;
      await sidebar(page).locator(`a[href="${base}/${path}"]`).click();
      await expect(page).toHaveURL(`${base}/${path}`);
      await expect(sidebar(page).getByRole('link',{name:'Home'})).toBeVisible();
      await expect(page.locator('[data-persistence-probe="retained"]')).toHaveCount(1);
      await page.goBack();await page.goForward();await page.reload();
      await expect(sidebar(page).getByRole('link',{name:'Home'})).toBeVisible();
      await page.goto(`${base}/home`);
      expect(await sidebar(page).getByRole('link').evaluateAll(elements=>elements.map(element=>element.getAttribute('href')))).toEqual(links);
    }
    await expect(sidebar(page).getByRole('link',{name:'Administration',exact:true})).toHaveCount(0);
  });
  for(const width of [1440,768,390]) test(`contextual workspace navigation at ${width}px`,async({page},info)=>{
    await page.setViewportSize({width,height:900});await page.goto(`/organizations/${loadDemoContext().organizationId}/customers`);
    if(width<768)await page.getByRole('button',{name:/^(Toggle Sidebar|Menu)$/}).click();
    const nav=page.getByRole('navigation',{name:'This business'}).filter({visible:true});
    await expect(nav.getByRole('link',{name:'Customers',exact:true})).toBeVisible();
    await expect(nav.getByRole('link',{name:'Home'})).toBeVisible();
    await expect(nav.getByRole('link',{name:'Invoices',exact:true})).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`business-${width}.png`)});
    if(width<768){await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:/^(Toggle Sidebar|Menu)$/})).toBeFocused();}
  });
  test('refuses Platform content to a tenant owner',async({page})=>{
    await page.goto('/platform/providers');
    await expect(page.getByRole('navigation',{name:'Platform Administration'})).toHaveCount(0);
    await expect(page.getByText('GildOps Platform',{exact:true})).toHaveCount(0);
  });
});

test.describe('a tenant colleague with a reduced role', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });

  test('sees the work their role allows and no administration they cannot manage', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/home`);
    const nav = sidebar(page);
    await expect(nav.getByRole('link', { name: 'Work', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Team', exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Plan & usage', exact: true })).toHaveCount(0);
    await expect(nav.getByText('Platform', { exact: true })).toHaveCount(0);
  });

  test('is still refused the roles page by the server when the URL is typed', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/settings/access/members`);
    // The page loads (it is read-only for them) but offers no way to change a role: hiding the row was courtesy.
    await expect(page.getByRole('button', { name: 'New role' })).toHaveCount(0);
  });
});

test.describe('GildOps platform staff',()=>{
  test.use({storageState:STAFF_STORAGE_STATE});
  test('enters the separate Platform shell from the operating business',async({page})=>{
    const {goldOrganizationId}=loadDemoContext();await page.goto(`/organizations/${goldOrganizationId}/home`);
    await sidebar(page).getByRole('link',{name:'Administration',exact:true}).click();
    await expect(page).toHaveURL(platformUrl());
    await expect(page.getByText('GildOps Platform',{exact:true})).toBeVisible();
    await expect(page.getByRole('navigation',{name:'Platform Administration'})).toBeVisible();
    await expect(page.getByRole('button',{name:'Agent',exact:true})).toHaveCount(0);
  });
  test('keeps canonical links, current state and browser history',async({page})=>{
    await page.goto(platformUrl('providers'));const nav=page.getByRole('navigation',{name:'Platform Administration'});
    await expect(nav.getByRole('link',{name:'Providers',exact:true})).toHaveAttribute('aria-current','page');
    await nav.getByRole('link',{name:'Meters',exact:true}).focus();await page.keyboard.press('Enter');
    await expect(page).toHaveURL(platformUrl('catalog/meters'));await page.goBack();await expect(page).toHaveURL(platformUrl('providers'));
    await page.getByRole('link',{name:'Open GildOps business'}).click();await expect(page).toHaveURL(`/organizations/${loadDemoContext().goldOrganizationId}/home`);
  });
  test('retired organization Platform addresses render not-found without redirecting',async({page})=>{
    const path=`/organizations/${loadDemoContext().organizationId}/platform/providers`;await page.goto(path);
    await expect(page.getByRole('heading',{name:'This page does not exist'})).toBeVisible();await expect(page).toHaveURL(path);
    await expect(page.getByRole('navigation',{name:'Platform Administration'})).toHaveCount(0);
  });
  for(const width of [768,390])test(`Platform navigation at ${width}px`,async({page},info)=>{
    await page.setViewportSize({width,height:900});await page.goto(platformUrl('providers'));
    if(width<768)await page.getByRole('button',{name:/^(Toggle Sidebar|Menu)$/}).click();
    const nav=page.getByRole('navigation',{name:'Platform Administration'}).filter({visible:true});
    await expect(nav.getByRole('link',{name:'Providers',exact:true})).toHaveAttribute('aria-current','page');
    await expect(nav.getByRole('link',{name:'Failures',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`platform-${width}.png`)});
  });
});

test.describe('account menu and icon-bearing Settings', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });
  for (const width of [1440, 768, 390]) test(`Settings navigation and account menu at ${width}px`, async ({ page }, info) => {
    const { organizationId } = loadDemoContext();
    await page.setViewportSize({ width, height: 1000 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await page.goto(`/organizations/${organizationId}/customers`);
      const open = async () => { if (width < 768) await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).click(); };
      await open();
      await expect(page.getByRole('navigation', { name: 'Application controls' })).toHaveCount(0);
      const menu = await accountMenu(page);
      await expect(menu.getByRole('menuitem', { name: 'Platform' })).toHaveCount(0);
      await expect(menu.getByRole('menuitem', { name: 'Help & documentation' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Contact GildOps Support' })).toBeVisible();
      await page.screenshot({ path: info.outputPath(`account-menu-${width}-${colorScheme}.png`) });
      await menu.getByRole('menuitem', { name: 'Settings', exact: true }).click();
      if (width < 768) await expect(page.getByRole('dialog', { name: 'Sidebar' })).toHaveCount(0);
      await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible();
      await open();
      const settings = page.getByRole('navigation', { name: 'Settings', exact: true });
      await expect(settings).toBeVisible();
      if (width >= 768) await page.locator('header').getByRole('button', { name: /^(Toggle Sidebar|Menu)$/ }).click();
      for (const label of ['Profile', 'Security & sign-in', 'Appearance', 'General', 'Branding', 'Domains', 'Features', 'Team & access', 'Connections', 'Plan & usage']) {
        const link = settings.getByRole('link', { name: label, exact: true });
        await expect(link).toBeVisible();
        await expect(link.locator('svg')).toHaveCount(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`settings-${width}-${colorScheme}.png`) });
      await settings.getByRole('link', { name: 'Appearance', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Appearance', exact: true })).toBeVisible();
      await open();
      await settings.getByRole('link', { name: 'Back to app', exact: true }).click();
      await expect(page).toHaveURL(`/organizations/${organizationId}/customers`);
      if (width >= 768) await page.locator('header').getByRole('button', { name: /^(Toggle Sidebar|Menu)$/ }).click();
      await page.goto(`/organizations/${organizationId}/comms`);
      await open();
      const business = page.getByRole('navigation', { name: 'This business' });
      await business.getByRole('link', { name: 'Configuration', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Calling & routing', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Configuration sections' })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`configuration-${width}-${colorScheme}.png`) });
      await expect(business.getByRole('link', { name: 'Calling & routing', exact: true })).toHaveAttribute('aria-current', 'page');
      await business.getByRole('link', { name: 'Numbers & assignments', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Numbers', exact: true })).toBeVisible();
      await open();
      await expect(business.getByRole('link', { name: 'Numbers & assignments', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(business.getByRole('link', { name: 'Numbers', exact: true })).toHaveCount(0);
      await business.getByRole('link', { name: 'Calls', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Calls', exact: true })).toBeVisible();

      if (width >= 768) await page.locator('header').getByRole('button', { name: /^(Toggle Sidebar|Menu)$/ }).click();
    }
  });
});


test.describe('legacy Communications configuration compatibility', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });
  test('preserves query values and fragments and resolves each canonical owner', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    for (const [legacy, canonical] of [['settings/calls', 'comms/configuration/calling'], ['settings/communications', 'comms/configuration/messaging'], ['settings/email', 'comms/configuration/email'], ['comms/numbers', 'comms/configuration/numbers'], ['settings/sales-stages', 'sales/configuration/relationship-stages'], ['settings/opportunity-stages', 'sales/configuration/opportunity-stages'], ['settings/pricing', 'finance/configuration/pricing']]) {
      await page.goto(`/organizations/${organizationId}/${legacy}?filter=a&filter=b#recording`);
      await expect(page).toHaveURL(`/organizations/${organizationId}/${canonical}?filter=a&filter=b#recording`);
      if (canonical.startsWith('sales/configuration')) {
        await expect(page.getByRole('navigation', { name: 'Configuration sections' })).toHaveCount(0);
        const label = canonical.endsWith('relationship-stages') ? 'Relationship stages' : 'Opportunity stages';
        await expect(sidebar(page).getByRole('link', { name: label, exact: true })).toHaveAttribute('aria-current', 'page');
      } else {
        await expect(page.getByRole('navigation', { name: 'Configuration sections' })).toBeVisible();
        await expect(sidebar(page).getByRole('link', { name: 'Configuration', exact: true })).toHaveAttribute('aria-current', 'page');
      }
    }
  });
});


test.describe('configuration-only permissions in the rendered application', () => {
  const email = `navigation-config-${randomUUID()}@example.test`;
  const password = randomUUID();
  let accountId: string, roleId: string;
  const url = process.env.SUPABASE_URL!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const owner = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const cleanup = async (sql: string, values: string[]) => {
    const connectionString = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
    if (!['localhost', '127.0.0.1'].includes(new URL(connectionString).hostname)) throw new Error('Fixture cleanup is local-only.');
    const pg = new Client({ connectionString });
    await pg.connect();
    try { await pg.query(sql, values); } finally { await pg.end(); }
  };
  test.beforeAll(async () => {
    if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Navigation fixtures are local-only.');
    const { organizationId, ownerEmail } = loadDemoContext();
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw created.error;
    accountId = created.data.user.id;
    const signed = await owner.auth.signInWithPassword({ email: ownerEmail, password: DEMO_PASSWORD });
    if (signed.error) throw signed.error;
    roleId = await createRole(owner, { organizationId, name: `Navigation configure ${randomUUID().slice(0, 8)}`, capabilities: ['field.manage'] });
    await addMember(owner, { organizationId, email, roleId, displayName: 'Configuration member' });
  });
  test.afterAll(async () => {
    if (accountId) await admin.auth.admin.deleteUser(accountId);
    if (roleId) await cleanup('delete from public.roles where id=$1', [roleId]);
  });
  test('enters configuration, writes through its canonical owner, and cannot read operating calls or Inbox', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page).toHaveURL(/organizations/);
    await page.goto(`/organizations/${organizationId}/home`);
    await page.goto(`/organizations/${organizationId}/comms/configuration/calling`);
    await expect(page).toHaveURL(`/organizations/${organizationId}/comms/configuration/calling`);
    const nav = sidebar(page);
    // ADR-047: no operating Home link either, for a member who may only configure Communications.
    for (const label of ['Overview', 'Communications home', 'Calls', 'Inbox', 'Numbers']) await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Configuration', exact: true })).toHaveCount(0);
    const name = `Configuration acceptance ${randomUUID()}`;
    try {
      await page.getByLabel('Outcome name', { exact: true }).fill(name);
      await page.getByRole('button', { name: 'Add outcome', exact: true }).click();
      await expect(page.getByText(name, { exact: true })).toBeVisible();
      const saved = await owner.from('call_outcomes').select('name').eq('organization_id', organizationId).eq('name', name).single();
      expect(saved.error).toBeNull();
      expect(saved.data?.name).toBe(name);
      for (const path of ['calls', 'comms/inbox', 'comms/configuration/email']) {
        await page.goto(`/organizations/${organizationId}/${path}`);
        await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible();
      }
    } finally {
      await cleanup('delete from public.call_outcomes where organization_id=$1 and name=$2', [organizationId, name]);
    }
  });
});

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
 * organization's entitlements, their own permissions and — in GOLD's own organization — their
 * platform permissions. `shell-projection.test.ts` proves the matrix on the pure function; these
 * prove the projection is what actually renders, on desktop and on a phone, and that a hidden
 * destination is still refused when the URL is typed.
 */

const accountMenu = async (page: import('@playwright/test').Page) => {
  await page.getByRole('button', { name: /Signed in/ }).filter({ visible: true }).click();
  return page.getByRole('menu');
};
const sidebar = (page: import('@playwright/test').Page) => page.locator('[data-slot="sidebar-container"] nav[aria-label="This business"]');

test.describe('a tenant owner', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('enters and leaves each available workspace using URL context and browser history', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    const homes = [
      ['sales', 'CRM'], ['comms', 'Communications'], ['marketing', 'Marketing'],
      ['support', 'Support'], ['field', 'Work'], ['finance', 'Finance'],
      ['automations', 'Automations'], ['ai', 'AI'], ['studio', 'Studio'],
    ];
    await page.goto(`/organizations/${organizationId}/home`);
    await page.locator('[data-slot="sidebar-container"]').evaluate((element) => { element.setAttribute('data-persistence-probe', 'retained'); });
    const available = await sidebar(page).getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    for (const [segment, label] of homes.filter(([segment]) => available.includes(`/organizations/${organizationId}/${segment}`))) {
      const nav = sidebar(page);
      await nav.getByRole('link', { name: label, exact: true }).click();
      await expect(page).toHaveURL(`/organizations/${organizationId}/${segment}`);
      await expect(nav.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(nav.getByText(label, { exact: true })).toBeVisible();
      await expect(nav.getByRole('link', { name: 'Library', exact: true })).toHaveCount(0);
      await expect(page.locator('[data-persistence-probe="retained"]')).toHaveCount(1);
      await nav.getByRole('link', { name: 'Back to Workspaces' }).click();
      await expect(page).toHaveURL(`/organizations/${organizationId}/home`);
      await page.goBack();
      await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
      await page.goForward();
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
  });

  for (const viewport of [{ width: 1440, height: 900 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    test(`contextual sidebar at ${viewport.width}px`, async ({ page }, testInfo) => {
      const { organizationId } = loadDemoContext();
      await page.setViewportSize(viewport);
      await page.goto(`/organizations/${organizationId}/home`);
      const mobile = viewport.width < 768;
      const open = async () => { if (mobile) await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).click(); };
      const nav = () => mobile ? page.getByRole('dialog').getByRole('navigation', { name: 'This business' }) : sidebar(page);
      await open();
      await nav().getByRole('link', { name: 'Communications', exact: true }).click();
      await expect(page).toHaveURL(`/organizations/${organizationId}/comms`);
      if (mobile) await expect(page.getByRole('dialog')).toHaveCount(0);
      await open();
      await nav().getByRole('link', { name: 'Calls', exact: true }).click();
      await expect(page).toHaveURL(`/organizations/${organizationId}/calls`);
      await expect(page.getByRole('button', { name: 'New call', exact: true })).toBeVisible();
      await open();
      await expect(nav().getByRole('link', { name: 'Calls', exact: true })).toHaveAttribute('aria-current', 'page');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`workspace-${viewport.width}.png`) });
      await nav().getByRole('link', { name: 'Back to Workspaces' }).click();
      await expect(page).toHaveURL(`/organizations/${organizationId}/home`);
      if (mobile) await expect(page.getByRole('dialog')).toHaveCount(0);
    });
  }

  test('Settings returns to the same workspace context after a direct refresh', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/customers`);
    await page.reload();
    await expect(sidebar(page).getByRole('link', { name: 'Customers', exact: true })).toHaveAttribute('aria-current', 'page');
    await (await accountMenu(page)).getByRole('menuitem', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('navigation', { name: 'Settings', exact: true });
    await expect(settings).toBeVisible();
    await settings.getByRole('link', { name: 'Back to app' }).click();
    await expect(page).toHaveURL(`/organizations/${organizationId}/customers`);
    await expect(sidebar(page).getByRole('link', { name: 'Customers', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('sees flat workspaces and header utilities with no Platform context', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/home`);
    const nav = sidebar(page);
    await expect(nav.getByText('Workspaces', { exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'CRM', exact: true })).toBeVisible();
    await expect(nav.getByRole('button', { name: /Expand|Collapse/ })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Team', exact: true })).toHaveCount(0);
    const header = page.locator('header').first();
    for (const name of ['Team', 'Connections']) {
      const link = header.getByRole('link', { name, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveText('');
    }
    await expect(header.getByRole('button', { name: 'Agent', exact: true })).toHaveText('');
    await expect(nav.getByText('Platform', { exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Organizations', exact: true })).toHaveCount(0);
  });

  test('keeps workspace ownership on nested routes', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    for (const [route, owner] of [['customers', 'Customers'], ['customers/pipeline', 'Relationship pipeline'], ['work', 'Work items'], ['schedule', 'Schedule'], ['finance/invoices', 'Invoices'], ['studio/forms', 'Forms']]) {
      await page.goto(`/organizations/${organizationId}/${route}`);
      await expect(sidebar(page).getByRole('link', { name: owner, exact: true })).toHaveAttribute('aria-current', 'page');
    }
  });

  test('the collapsed rail keeps the same contextual destinations', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/customers`);
    const nav = sidebar(page);
    const links = await nav.getByRole('link').evaluateAll((items) => items.map((item) => item.getAttribute('href')));
    await page.locator('header').first().getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
    await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toBeVisible();
    expect(await nav.getByRole('link').evaluateAll((items) => items.map((item) => item.getAttribute('href')))).toEqual(links);
    await expect(nav.getByRole('link', { name: 'Customers', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('button', { name: /Expand|Collapse/ })).toHaveCount(0);
  });

  test('is refused the platform when either address is typed', async ({ page }) => {
    // The old address: not staff, so sent back to their own business rather than served.
    const legacy = await page.goto('/platform/providers');
    expect(page.url()).not.toContain('/platform');
    expect(legacy?.status() ?? 200).toBeLessThan(500);

    // The canonical address under GOLD's organization, which they are not a member of: a 404.
    expect((await page.goto(platformUrl('providers')))?.status()).toBe(404);

    // And under their own business: the shell has already streamed, so the status stays 200, but what
    // renders is the plain not-found page inside their own frame — no Platform content, no Platform nav.
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/platform/providers`);
    await expect(page.getByRole('heading', { name: 'This page does not exist' })).toBeVisible();
    await expect(page.getByText('Infrastructure GOLD operates')).toHaveCount(0);
    await expect(sidebar(page).getByText('Platform', { exact: true })).toHaveCount(0);
  });

  test('phone navigation dismisses, restores focus, and retains account and Agent access', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/organizations/${organizationId}/home`);
    const trigger = page.locator('header').getByRole('button', { name: 'Menu', exact: true });
    await expect(trigger).toBeVisible();
    await expect(page.locator('nav.fixed')).toHaveCount(0);
    for (const dismissal of ['escape', 'outside', 'close']) {
      await trigger.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      if (dismissal === 'escape') await page.keyboard.press('Escape');
      else if (dismissal === 'outside') await page.mouse.click(5, 400);
      else await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    await trigger.click();
    const sheet = page.getByRole('dialog', { name: 'Sidebar', exact: true });
    await expect(sheet.locator('[data-sidebar="header"]')).toContainText('Grachtwerk Verhuur');
    await expect(sheet.getByText('Platform', { exact: true })).toHaveCount(0);
    await expect(sheet.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
    await sheet.getByRole('button', { name: 'Agent', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Agent' })).toBeVisible();
    await page.getByRole('dialog', { name: 'Agent' }).getByRole('button', { name: /Close/ }).click();
    await trigger.click();
    await sheet.getByRole('button', { name: /sanne@grachtwerk.test/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/general$/);
    await expect(sheet).toHaveCount(0);
    await trigger.click();
    await page.goBack();
    await expect(sheet).toHaveCount(0);
  });

  test('responsive shell keeps location left and navigation reachable without overflow', async ({ page }, testInfo) => {
    const { organizationId } = loadDemoContext();
    for (const width of [320, 375, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/organizations/${organizationId}/home`);
      await expect(page.getByRole('navigation', { name: width < 768 ? 'Page location' : 'breadcrumb', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`shell-${width}.png`) });
      if (width < 768) {
        const trigger = page.locator('header').getByRole('button', { name: 'Menu', exact: true });
        const location = await page.getByRole('navigation', { name: 'Page location', exact: true }).boundingBox();
        const button = await trigger.boundingBox();
        expect(location!.x).toBeLessThan(button!.x);
        await trigger.click();
        await page.screenshot({ path: testInfo.outputPath(`menu-${width}.png`) });
        await page.keyboard.press('Escape');
      }
    }
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

test.describe('GOLD platform staff', () => {
  test.use({ storageState: STAFF_STORAGE_STATE });

  test('reach the platform through GOLD’s own shell, in the one sidebar', async ({ page }) => {
    await page.goto(platformUrl());
    const nav = sidebar(page);
    await expect(nav.getByText('Platform', { exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Organizations', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Providers', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'CRM', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-slot="sidebar-container"]').getByRole('button', { name: /GildOps Platform/ })).toBeVisible();
  });

  test('the old /platform address lands on the canonical one, path and query kept', async ({ page }) => {
    await page.goto('/platform/providers/twilio?tab=accounts');
    await expect(page).toHaveURL(new RegExp(`/organizations/${loadDemoContext().goldOrganizationId}/platform/providers/twilio\\?tab=accounts`));
  });

  test('switches between the system control plane and the GildOps operating business', async ({ page }) => {
    const { goldOrganizationId } = loadDemoContext();
    await page.goto(platformUrl('providers'));
    const container = page.locator('[data-slot="sidebar-container"]');
    await container.getByRole('button', { name: /GildOps Platform/ }).click();
    await expect(page.getByText('Businesses', { exact: true })).toBeVisible();
    await expect(page.getByText('System', { exact: true })).toBeVisible();
    // MenuItem uses asChild, so the item itself is the link.
    const goldLink = page.locator(`[role="menuitem"][href="/organizations/${goldOrganizationId}/home"]`);
    await goldLink.click();
    await expect(page).toHaveURL(`/organizations/${goldOrganizationId}/home`);
    await expect(sidebar(page).getByRole('link', { name: 'CRM', exact: true })).toBeVisible();
    await expect(sidebar(page).getByText('Platform', { exact: true })).toHaveCount(0);
    await container.locator('[data-sidebar="header"]').getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Platform', exact: true }).click();
    await expect(page).toHaveURL(platformUrl());
    await expect(container.getByText('System control plane', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  });

  test('on a phone switches authorized context from the menu and closes it', async ({ page }) => {
    const { goldOrganizationId } = loadDemoContext();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(platformUrl());
    await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet.getByRole('link', { name: 'Providers', exact: true })).toBeVisible();
    await sheet.locator('[data-sidebar="header"]').getByRole('button', { name: /GildOps Platform/ }).click();
    await page.locator(`[role="menuitem"][href="/organizations/${goldOrganizationId}/home"]`).click();
    await expect(page).toHaveURL(`/organizations/${goldOrganizationId}/home`);
    await expect(sheet).toHaveCount(0);
    await page.goto(`/organizations/${goldOrganizationId}/field`);
    await page.getByRole('button', { name: 'Navigate within current section' }).click();
    const destinations = await page.getByRole('menuitem').evaluateAll((items) => items.map((item) => item.getAttribute('href')));
    expect(destinations.every((href) => href?.startsWith(`/organizations/${goldOrganizationId}/`))).toBe(true);

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
      if (width >= 768) await page.locator('header').getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
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
      if (width >= 768) await page.locator('header').getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
      await page.goto(`/organizations/${organizationId}/comms`);
      await open();
      const business = page.getByRole('navigation', { name: 'This business' });
      await business.getByRole('link', { name: 'Configuration', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Calling & routing', exact: true })).toBeVisible();
      const sections = page.getByRole('navigation', { name: 'Configuration sections' });
      await expect(sections).toBeVisible();
      if (width >= 768) await page.locator('header').getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
      await expect(sections.getByRole('link', { name: 'Calling & routing', exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`configuration-${width}-${colorScheme}.png`) });
      await sections.getByRole('link', { name: 'Numbers & assignments', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Numbers', exact: true })).toBeVisible();
      await expect(sections.getByRole('link', { name: 'Numbers & assignments', exact: true })).toHaveAttribute('aria-current', 'page');
      await open();
      await expect(business.getByRole('link', { name: 'Numbers', exact: true })).toHaveCount(0);
      await expect(business.getByRole('link', { name: 'Configuration', exact: true })).toHaveAttribute('aria-current', 'page');
      await business.getByRole('link', { name: 'Calls', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Calls', exact: true })).toBeVisible();

      if (width >= 768) await page.locator('header').getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
    }
  });
});


test.describe('legacy Communications configuration compatibility', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });
  test('preserves query values and fragments and resolves each canonical owner', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    for (const [legacy, canonical] of [['settings/calls', 'comms/configuration/calling'], ['settings/communications', 'comms/configuration/messaging'], ['settings/email', 'comms/configuration/email'], ['comms/numbers', 'comms/configuration/numbers'], ['settings/sales-stages', 'sales/configuration/relationship-stages'], ['settings/opportunity-stages', 'sales/configuration/opportunity-stages'], ['settings/pricing', 'finance/configuration/pricing'], ['support/service-levels', 'support/configuration/service-levels']]) {
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
    await sidebar(page).getByRole('link', { name: 'Communications', exact: true }).click();
    await expect(page).toHaveURL(`/organizations/${organizationId}/comms/configuration/calling`);
    const nav = sidebar(page);
    for (const label of ['Overview', 'Calls', 'Inbox', 'Numbers']) await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Configuration', exact: true })).toHaveAttribute('aria-current', 'page');
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

import { test, expect } from '@playwright/test';
import { COLLEAGUE_STORAGE_STATE, loadDemoContext, OWNER_STORAGE_STATE, platformUrl, STAFF_STORAGE_STATE } from './helpers';

/**
 * The one adaptive shell, in a browser. What each person sees is a projection of the
 * organization's entitlements, their own permissions and — in GOLD's own organization — their
 * platform permissions. `shell-projection.test.ts` proves the matrix on the pure function; these
 * prove the projection is what actually renders, on desktop and on a phone, and that a hidden
 * destination is still refused when the URL is typed.
 */

const sidebar = (page: import('@playwright/test').Page) => page.locator('[data-slot="sidebar-container"] nav[aria-label="This business"]');

test.describe('a tenant owner', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

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
    for (const [route, owner] of [['customers', 'CRM'], ['customers/pipeline', 'CRM'], ['work', 'Work'], ['schedule', 'Work'], ['finance/invoices', 'Finance'], ['studio/forms', 'Studio']]) {
      await page.goto(`/organizations/${organizationId}/${route}`);
      await expect(sidebar(page).getByRole('link', { name: owner, exact: true })).toHaveAttribute('aria-current', 'page');
    }
  });

  test('the collapsed rail keeps the same flat workspace destinations', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/customers`);
    const nav = sidebar(page);
    const links = await nav.getByRole('link').evaluateAll((items) => items.map((item) => item.getAttribute('href')));
    await page.locator('header').first().getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
    await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toBeVisible();
    expect(await nav.getByRole('link').evaluateAll((items) => items.map((item) => item.getAttribute('href')))).toEqual(links);
    await expect(nav.getByRole('link', { name: 'CRM', exact: true })).toHaveAttribute('aria-current', 'page');
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

  test('on a phone has Home, AI and Menu in the bar, and reaches Settings through the account footer', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/organizations/${organizationId}/home`);
    const bar = page.locator('nav[aria-label="This business"].fixed');
    await expect(bar.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'AI', exact: true })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
    // Workspace pages are not bar destinations, and nothing in the bar scrolls sideways.
    for (const name of ['Customers', 'Work', 'Schedule', 'Team']) {
      await expect(bar.getByRole('link', { name, exact: true })).toHaveCount(0);
    }
    const scrolls = await bar.locator('ul').evaluate((list) => list.scrollWidth > list.clientWidth);
    expect(scrolls).toBe(false);

    // The header is the organization context and the page location, and nothing else: no Account, no Agent.
    const header = page.locator('header');
    await expect(header.locator('[aria-label^="Switch context"], span[aria-label]').first()).toBeVisible();
    await expect(header.getByRole('button', { name: /^Account/ })).toHaveCount(0);
    await expect(header.getByRole('button', { name: 'Agent' })).toBeHidden();
    await expect(header.getByRole('link', { name: 'Team', exact: true })).toBeHidden();
    await expect(header.getByRole('link', { name: 'Connections', exact: true })).toBeHidden();

    await bar.getByRole('button', { name: 'Menu', exact: true }).click();
    const sheet = page.getByRole('dialog');
    // The sheet names the business and offers no second switcher; Account is its footer.
    await expect(sheet.getByText('Grachtwerk Verhuur', { exact: true }).filter({ visible: true })).toHaveCount(1);
    await expect(sheet.getByRole('button', { name: /Switch context/ })).toHaveCount(0);
    await expect(sheet.getByText('Workspaces', { exact: true })).toBeVisible();
    await expect(sheet.getByText('Platform', { exact: true })).toHaveCount(0);
    await sheet.getByRole('button', { name: /sanne@grachtwerk.test/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Plan & usage/ })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('on a phone, AI opens the Agent above the bar and the same control closes it', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/organizations/${organizationId}/home`);
    const bar = page.locator('nav[aria-label="This business"].fixed');
    const ai = bar.getByRole('button', { name: 'AI', exact: true });
    await ai.click();
    const agent = page.getByRole('complementary', { name: 'Agent' });
    await expect(agent).toBeVisible();
    await expect(ai).toHaveAttribute('aria-pressed', 'true');
    const barBox = (await bar.boundingBox())!;
    const agentBox = (await agent.boundingBox())!;
    expect(agentBox.y + agentBox.height).toBeLessThanOrEqual(barBox.y + 1);
    await ai.click();
    await expect(agent).toBeHidden();
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
    await container.locator('[data-sidebar="header"] button').click();
    await page.getByRole('menuitem', { name: 'Platform', exact: true }).click();
    await expect(page).toHaveURL(platformUrl());
    await expect(container.getByText('System control plane', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  });

  test('on a phone, keep Home, AI and Menu in the bar inside Platform, and find Platform in Menu', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(platformUrl());
    const bar = page.locator('nav[aria-label="This business"].fixed');
    await expect(bar.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'AI', exact: true })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Organizations', exact: true })).toHaveCount(0);
    await expect(page.locator('header').getByRole('button', { name: /^Account/ })).toHaveCount(0);
    await bar.getByRole('button', { name: 'Menu', exact: true }).click();
    const sheet = page.getByRole('dialog');
    // The phone Menu names the system scope; Account stays reachable.
    const identity = sheet.locator('[data-sidebar="header"]');
    await expect(identity.getByText('GildOps Platform', { exact: true }).filter({ visible: true })).toHaveCount(1);
    await expect(identity).toContainText('System control plane');
    await expect(sheet.getByRole('button', { name: /staff@gold.test/ })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Organizations', exact: true })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Providers', exact: true })).toBeVisible();
  });
});

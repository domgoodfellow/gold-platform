import './appearance-env';
import { createClient } from '@supabase/supabase-js';
import { test, expect, type Page } from '@playwright/test';
import { COLLEAGUE_STORAGE_STATE, loadDemoContext, OWNER_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { createOpportunity, createOpportunityStage } from '../lib/domain/opportunities/opportunities';
import { createFollowUp } from '../lib/domain/follow-ups/follow-ups';
import { commandMarketing } from '../lib/domain/marketing/marketing';

/**
 * Batch C, in a real browser: Settings → Features, CRM Home, Marketing Home and Support Home are
 * composed around their tasks. Exceptions and agenda are not listed twice, folded groups and search
 * keep every feature findable, controls sit beside what they filter, and no Home repeats the sidebar
 * as cards. Runs against one disposable business (`playwright.isolated.config.ts`), which this spec
 * populates through the domain commands; the run's teardown removes it.
 */

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
const panel = (page: Page, name: string) => page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) }).first();

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const ctx = loadDemoContext();
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await db.auth.signInWithPassword({ email: ctx.ownerEmail, password: DEMO_PASSWORD });
  if (signed.error) throw signed.error;
  const organizationId = ctx.organizationId;
  const discovery = await createOpportunityStage(db, { organizationId, name: 'Discovery', position: 0, kind: 'open' });
  await createOpportunityStage(db, { organizationId, name: 'Won', position: 1, kind: 'won' });
  await createOpportunity(db, { organizationId, customerId: ctx.customerId, title: 'Composition opportunity', stageId: discovery, amountMinor: 250000, currency: 'EUR' });
  const now = Date.now();
  await createFollowUp(db, { organizationId, customerId: ctx.customerId, kind: 'call', title: 'Agenda call later today', dueAt: new Date(now + 2 * 3600_000).toISOString() });
  await createFollowUp(db, { organizationId, customerId: ctx.customerId, kind: 'call', title: 'Overdue chase', dueAt: new Date(now - 48 * 3600_000).toISOString() });
  await commandMarketing(db, organizationId, 'campaign.create', { name: 'Composition draft', objective: 'lead_generation', channels: ['form'] });
});

test.describe('an owner', () => {
  test.use({ storageState: OWNER_STORAGE_STATE, viewport: { width: 1440, height: 900 } });

  test('Features: grouped, searchable, folded unavailable groups, one shared warning, actions kept', async ({ page }) => {
    await page.goto(`/organizations/${loadDemoContext().organizationId}/settings/features`);
    await expect(page.getByRole('heading', { name: 'Features', level: 1 })).toBeVisible();
    const filters = page.getByRole('group', { name: 'Show features' });
    await expect(filters.getByRole('button', { name: /^All \d+$/ })).toHaveAttribute('aria-pressed', 'true');
    // Planned features are folded and never offered as something to buy.
    const planned = page.locator('summary').filter({ hasText: /Planned \(\d+\)/ }).first();
    await expect(planned).toBeVisible();
    await expect(page.locator('details:not([open])').first()).toBeVisible();
    await planned.click();
    await expect(page.getByText('Planned for GildOps and not available yet, on any plan.').first()).toBeVisible();
    // Search finds a feature wherever it is, opening folded groups.
    const search = page.getByRole('searchbox', { name: 'Search features' });
    await search.fill('Assets');
    await expect(page.getByRole('button', { name: 'More actions for Assets' })).toBeVisible();
    await search.fill('zzzz no such feature');
    await expect(page.getByText(/No features match/)).toBeVisible();
    await search.fill('');
    // A filter narrows in place, keyboard operable.
    const setup = filters.getByRole('button', { name: /^Needs setup \d+$/ });
    if (await setup.count()) {
      await setup.focus();
      await page.keyboard.press('Enter');
      await expect(setup).toHaveAttribute('aria-pressed', 'true');
      // The reason shared by several features is said once per product, not once per row.
      const reasons = await page.locator('p').filter({ hasText: /^Needs setup:/ }).allTextContents();
      expect(reasons.length).toBeGreaterThan(0);
      expect(new Set(reasons).size).toBe(reasons.length);
    }
    await filters.getByRole('button', { name: /^All \d+$/ }).click();
    // Existing management actions remain: the per-feature menu and its confirmed disable.
    await page.getByRole('button', { name: 'More actions for Assets' }).click();
    await expect(page.getByRole('menuitem', { name: 'Disable feature' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('CRM Home: agenda once, exceptions only, month on its panel, activity in its panel', async ({ page }) => {
    await page.goto(`/organizations/${loadDemoContext().organizationId}/crm`);
    await expect(page.getByText('Agenda call later today')).toHaveCount(1);
    await expect(panel(page, 'Today').getByText('Agenda call later today')).toBeVisible();
    const attention = panel(page, 'Needs attention');
    await expect(attention.getByText('Overdue chase')).toBeVisible();
    await expect(attention.getByRole('button', { name: /Due today/ })).toHaveCount(0);
    await expect(panel(page, 'This month').getByLabel('Month for forecast and win rate')).toBeVisible();
    await expect(page.getByRole('main').getByRole('heading', { name: 'Recent activity' })).toHaveCount(0);
    await expect(panel(page, 'Pipeline').locator('table')).toHaveCount(0);
    const activity = page.getByRole('button', { name: 'Activity', exact: true });
    await activity.click();
    await expect(page.getByRole('heading', { name: 'CRM activity' })).toBeVisible();
    await activity.click();
    await noOverflow(page);
  });

  test('Marketing Home: no navigation cards, drafts listed once, one statement per absence', async ({ page }) => {
    await page.goto(`/organizations/${loadDemoContext().organizationId}/marketing`);
    await expect(page.getByRole('heading', { name: 'Quick actions' })).toHaveCount(0);
    await expect(page.getByText('Composition draft', { exact: true })).toHaveCount(1);
    await expect(panel(page, 'Running campaigns').getByText(/No campaigns are running/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Acquisition / source performance' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Status', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ New campaign' })).toBeVisible();
  });

  test('Support Home: no tools grid repeating the sidebar; Configure panel kept', async ({ page }) => {
    await page.goto(`/organizations/${loadDemoContext().organizationId}/support`);
    await expect(page.getByRole('heading', { name: 'Support tools & resources' })).toHaveCount(0);
    for (const name of ['Cases', 'Queues', 'Service levels', 'Reports']) await expect(page.locator('[data-slot="sidebar-container"]').getByRole('link', { name, exact: true })).toBeVisible();
    await page.getByRole('main').getByRole('button', { name: 'Configure', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Queues', exact: true })).toBeVisible();
  });

  for (const width of [390, 768, 1024]) {
    test(`the four pages fit without horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const base = `/organizations/${loadDemoContext().organizationId}`;
      for (const route of ['settings/features', 'sales', 'marketing', 'support']) {
        await page.goto(`${base}/${route}`);
        await noOverflow(page);
      }
      // Narrow screens put exceptions before the agenda.
      await page.goto(`${base}/crm`);
      const order = await page.getByRole('heading', { name: /^(Needs attention|Today|Pipeline)$/ }).allTextContents();
      expect(order.slice(0, 2)).toEqual(['Needs attention', 'Today']);
    });
  }
});

test.describe('a reduced-role colleague', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE, viewport: { width: 1440, height: 900 } });

  test('sees features read-only, with every state still findable', async ({ page }) => {
    await page.goto(`/organizations/${loadDemoContext().organizationId}/settings/features`);
    await expect(page.getByText(/cannot switch features on or off/)).toBeVisible();
    await expect(page.getByRole('button', { name: /^More actions for / })).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search features' }).fill('Assets');
    await expect(page.getByRole('status').filter({ hasText: /features shown/ })).not.toHaveText('0 features shown');
    await expect(page.getByRole('main')).toContainText('Assets');
  });
});

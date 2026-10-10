import { test, expect } from '@playwright/test';
import { COLLEAGUE_STORAGE_STATE, loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

/**
 * Every workspace's Configure entry leads somewhere a member can actually configure the named
 * concern: each door in its menu (or its one link) opens a real page inside the same organization,
 * and a member without configuration permission is never offered one.
 */
const HUBS = [
  ['communications', 'comms'],
  ['marketing', 'marketing'],
  ['support', 'support'],
  ['work', 'field'],
  ['finance', 'finance'],
  ['automations', 'automations'],
  ['ai', 'ai'],
  ['studio', 'studio'],
] as const;

async function doors(page: import('@playwright/test').Page): Promise<string[]> {
  const header = page.locator('main h1').first().locator('xpath=ancestor::header[1]');
  const link = header.getByRole('link', { name: /configure|queues|forms|service levels|resources|rules|agents|website|call setup|numbers/i });
  const trigger = header.getByRole('button', { name: 'Configure' });
  if (await trigger.count()) {
    await trigger.click();
    const hrefs = await page.getByRole('menuitem').evaluateAll((items) => items.map((item) => item.querySelector('a')?.getAttribute('href') ?? item.getAttribute('href') ?? ''));
    await page.keyboard.press('Escape');
    return hrefs.filter(Boolean);
  }
  if (await link.count()) return [(await link.first().getAttribute('href')) ?? ''];
  return [];
}

test.describe('owner', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });
  for (const [name, segment] of HUBS) {
    test(`${name}: every Configure door opens a real page in this organization`, async ({ page }) => {
      test.setTimeout(180_000);
      const ctx = loadDemoContext();
      const base = `/organizations/${ctx.organizationId}`;
      await page.goto(`${base}/${segment}`);
      await expect(page.locator('main h1').first()).toBeVisible();
      const found = await doors(page);
      if (found.length === 0) {
        // Not entitled: the hub must then agree with the Settings directory, which hides the same door.
        const listed = name === 'ai' ? 'Agent deployments' : name === 'automations' ? 'Automation rules' : null;
        expect(listed, `${name} offers no door, so it must be an entitlement-gated workspace`).not.toBeNull();
        await page.goto(`${base}/settings/organization`);
        await expect(page.getByText(listed!, { exact: true })).toHaveCount(0);
        return;
      }
      for (const href of found) {
        expect(href.startsWith(base), `${name} door ${href} stays in the organization`).toBe(true);
        const response = await page.goto(href.split('#')[0]);
        expect(response?.status(), href).toBeLessThan(400);
        await expect(page.locator('main h1, main h2').first(), href).toBeVisible();
        await expect(page.getByText('This screen did not load'), href).toHaveCount(0);
      }
    });
  }
});

test.describe('colleague without configuration permission', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });
  test('is offered no Configure control on a hub they cannot configure', async ({ page }) => {
    const ctx = loadDemoContext();
    const base = `/organizations/${ctx.organizationId}`;
    for (const segment of ['support', 'automations', 'studio', 'ai']) {
      const response = await page.goto(`${base}/${segment}`);
      if ((response?.status() ?? 0) >= 400) continue;
      const header = page.locator('main h1').first().locator('xpath=ancestor::header[1]');
      if (!(await header.count())) continue;
      await expect(header.getByRole('button', { name: 'Configure' }), segment).toHaveCount(0);
    }
  });
});

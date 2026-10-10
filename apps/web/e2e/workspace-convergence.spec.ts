import { test, expect, type Page } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

/**
 * One design language across the nine workspaces and Home. For each hub: it renders one page
 * identity, does not overflow horizontally at desktop, tablet and phone widths in light and dark,
 * and paints no hard-coded palette colour — every colour on screen is one of the roles, so a custom
 * brand cannot be defeated by a local blue and dark mode cannot be defeated by a local light fill.
 *
 * BRANDING_SHOTS=<dir> additionally keeps a full-page screenshot per combination.
 */
const SHOTS = process.env.BRANDING_SHOTS;

const HUBS = [
  ['home', 'home'],
  ['crm', 'sales'],
  ['communications', 'comms'],
  ['marketing', 'marketing'],
  ['support', 'support'],
  ['work', 'field'],
  ['finance', 'finance'],
  ['automations', 'automations'],
  ['ai', 'ai'],
  ['studio', 'studio'],
] as const;

const SIZES = [
  ['desktop', { width: 1440, height: 900 }],
  ['tablet', { width: 820, height: 1180 }],
  ['phone', { width: 390, height: 844 }],
] as const;

/** Tailwind's default palette steps, as the `rgb()` values a stray `text-blue-600` would compute to. */
const PALETTE_LITERALS = new Set([
  'rgb(37, 99, 235)', 'rgb(29, 78, 216)', 'rgb(239, 246, 255)', 'rgb(219, 234, 254)', 'rgb(147, 197, 253)', 'rgb(59, 130, 246)',
  'rgb(225, 29, 72)', 'rgb(255, 241, 242)', 'rgb(254, 205, 211)', 'rgb(244, 63, 94)',
  'rgb(217, 119, 6)', 'rgb(255, 251, 235)', 'rgb(245, 158, 11)',
  'rgb(5, 150, 105)', 'rgb(236, 253, 245)', 'rgb(16, 185, 129)',
  'rgb(100, 116, 139)', 'rgb(241, 245, 249)', 'rgb(226, 232, 240)', 'rgb(248, 250, 252)', 'rgb(148, 163, 184)', 'rgb(71, 85, 105)',
  'rgb(124, 58, 237)', 'rgb(245, 243, 255)',
]);

async function stray(page: Page): Promise<string[]> {
  return page.evaluate((literals) => {
    const found = new Set<string>();
    const set = new Set(literals);
    for (const el of document.querySelectorAll<HTMLElement>('main *, [data-brand] main *')) {
      const style = getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'borderTopColor'] as const) {
        if (set.has(style[prop])) found.add(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')} ${prop}=${style[prop]}`);
      }
    }
    return [...found].slice(0, 8);
  }, [...PALETTE_LITERALS]);
}


for (const scheme of ['light', 'dark'] as const) {
  for (const [name, segment] of HUBS) {
    test(`${name} hub is coherent in ${scheme}: one h1, no overflow at any width, no stray palette colour`, async ({ page }) => {
      const ctx = loadDemoContext();
      await page.emulateMedia({ colorScheme: scheme });
      for (const [sizeName, size] of SIZES) {
        await page.setViewportSize(size);
        const response = await page.goto(`/organizations/${ctx.organizationId}/${segment}`);
        expect(response?.status(), `${name} ${sizeName}`).toBeLessThan(400);
        await page.waitForLoadState('networkidle').catch(() => undefined);
        await expect(page.locator('main h1, [data-brand] h1').first()).toBeVisible();
        expect(await page.locator('main h1').count(), `${name} ${sizeName} h1 count`).toBeLessThanOrEqual(1);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${name} ${scheme} ${sizeName} overflows horizontally`).toBeLessThanOrEqual(0);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}-${scheme}-${sizeName}.png`, fullPage: true });
        if (sizeName === 'desktop') expect(await stray(page), `${name} ${scheme} stray palette colours`).toEqual([]);
      }
    });
  }
}

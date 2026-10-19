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
        await expect(page).not.toHaveURL(/\/login(?:[?#]|$)/);
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

/**
 * A custom brand reaches primary actions while segmented view selection remains neutral
 * and semantic roles keep their own colours.
 */
test('a custom brand colours primary actions while shared view selection and semantic roles remain independent', async ({ page }) => {
  test.setTimeout(240_000);
  const ctx = loadDemoContext();
  const branding = `/organizations/${ctx.organizationId}/settings/branding`;
  const reset = async () => {
    await page.goto(branding);
    const use = page.getByRole('button', { name: 'Use platform default' });
    if (await use.isEnabled()) {
      await use.click();
      await page.getByRole('button', { name: 'Save appearance' }).click();
      await expect(page.getByText('Saved.')).toBeVisible();
    }
  };
  try {
    await reset();
    await page.getByRole('button', { name: 'Teal', exact: true }).click();
    await page.getByRole('button', { name: 'Save appearance' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();

    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const [name, segment] of [['crm', 'sales'], ['support', 'support'], ['ai', 'ai'], ['marketing', 'marketing'], ['finance', 'finance']] as const) {
        await page.goto(`/organizations/${ctx.organizationId}/${segment}`);
        await expect(page.locator('main h1').first()).toBeVisible();
        const accents = await page.evaluate(() => getComputedStyle(document.querySelector('[data-brand]')!).getPropertyValue('--accent').trim());
        expect(accents, `${name} ${scheme}`).toBe('#0f766e');
        const danger = await page.evaluate(() => getComputedStyle(document.querySelector('[data-brand]')!).getPropertyValue('--danger').trim());
        expect(danger, `${name} ${scheme} danger role unchanged`).not.toBe('#0f766e');
      }
      await page.goto(`/organizations/${ctx.organizationId}/ai`);
      const current = page.locator('nav[aria-label="AI destinations"] a[aria-current="page"]');
      await expect(current.locator('..')).toHaveAttribute('data-variant', 'segmented');
      await expect(current).toHaveCSS('border-bottom-width', '0px');
      await expect(current).toHaveCSS('font-weight', '600');
      expect(await current.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    }
  } finally {
    await page.emulateMedia({ colorScheme: 'light' });
    await reset();
  }
});


test('Library destinations and Work views use shared accessible URL navigation', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const { organizationId } = loadDemoContext();
  const base = `/organizations/${organizationId}`;
  for (const [sizeName, size] of SIZES) {
    await page.setViewportSize(size);
    await page.goto(`${base}/library`);
    const directory = page.getByRole('navigation', { name: 'Library destinations', exact: true });
    await expect(directory.getByRole('link')).toHaveCount(8);
    await expect(page.getByRole('navigation', { name: 'Library', exact: true })).toHaveCount(0);
    const files = directory.getByRole('link', { name: 'Files', exact: true });
    await files.focus();
    await expect(files).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${base}/library/files`);
    const nav = page.getByRole('navigation', { name: 'Library', exact: true });
    await expect(nav.getByRole('link')).toHaveCount(9);
    await expect(nav.getByRole('link', { name: 'Files', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(nav).toHaveAttribute('data-variant', 'segmented');
    expect(await nav.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await nav.screenshot({ path: testInfo.outputPath(`library-${sizeName}.png`) });
    await nav.getByRole('link', { name: 'Templates', exact: true }).click();
    await expect(page).toHaveURL(`${base}/library/templates`);
    await page.goBack();
    await expect(page).toHaveURL(`${base}/library/files`);
    await page.goto(`${base}/work`);
    const work = page.getByRole('navigation', { name: 'Work view', exact: true });
    await expect(work.getByRole('link', { name: 'List', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(work.getByRole('link', { name: 'Dispatch board', exact: true })).toHaveAttribute('href', `${base}/work/dispatch`);
    await work.getByRole('link', { name: 'Board', exact: true }).click();
    await expect(page).toHaveURL(/view=board/);
    await expect(page.getByRole('navigation', { name: 'Work view', exact: true }).getByRole('link', { name: 'Board', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(page).toHaveURL(`${base}/work`);
  }
});

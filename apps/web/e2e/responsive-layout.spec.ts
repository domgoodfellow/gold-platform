import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';
import { createClient } from '@supabase/supabase-js';
import { scheduleWorkItem, unscheduleWorkItem } from '../lib/domain/scheduling/schedule';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import type { Db } from '../lib/db/types';

const captures = path.resolve(__dirname, '../../../.artifacts/responsive-layout');
const sizes = [
  { width: 390, height: 844 }, { width: 768, height: 1024 },
  { width: 1024, height: 768 }, { width: 1440, height: 900 },
  { width: 1920, height: 1080 }, { width: 2560, height: 1440 },
  { width: 3440, height: 1440 },
];

test('marketing uses the available viewport width, with readable text and usable navigation', async ({ page }) => {
  mkdirSync(captures, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.locator('[data-marketing-home]')).toBeVisible();
    await expect(page.locator('h1')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const box = await page.locator('[data-marketing-site] > main').boundingBox();
    expect(box!.width).toBe(size.width);
    const geometry = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('[data-marketing-site] > main')!;
      const header = document.querySelector<HTMLElement>('[data-marketing-site] > header')!;
      const footer = document.querySelector<HTMLElement>('.marketing-footer-inner')!;
      const copy = document.querySelector<HTMLElement>('.ms-hero-copy > p');
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        gutters: [main, header, footer].map(node => parseFloat(getComputedStyle(node).paddingLeft)),
        copyWidth: copy?.getBoundingClientRect().width ?? 0,
        heroLinks: [...document.querySelectorAll<HTMLAnchorElement>('[data-fragment-group="hero"] a.ms-hero-group')].map(node => {
          const rect = node.getBoundingClientRect();
          return { width: rect.width, height: rect.height, text: node.textContent?.trim() };
        }),
      };
    });
    expect(geometry.overflow).toBe(false);
    expect(new Set(geometry.gutters).size).toBe(1);
    expect(geometry.copyWidth).toBeLessThanOrEqual(544);
    expect(geometry.heroLinks.length).toBeGreaterThan(0);
    for (const link of geometry.heroLinks) {
      expect(link.width, link.text).toBeGreaterThan(0);
      expect(link.height, link.text).toBeGreaterThanOrEqual(40);
    }
    await page.screenshot({ path: path.join(captures, `marketing-${size.width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: /menu/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test.describe('dashboard geometry', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('a populated chart fills its panel and keeps the same values in its accessible table', async ({ page }) => {
    const { organizationId, ownerEmail, workItemId } = loadDemoContext();
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }) as Db;
    const signed = await db.auth.signInWithPassword({ email: ownerEmail, password: DEMO_PASSWORD });
    if (signed.error) throw signed.error;
    try {
      await scheduleWorkItem(db, { workItemId, startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString(), resourceIds: [] });
      for (const size of [sizes[3], sizes[5]]) {
        await page.setViewportSize(size);
        await page.goto(`/organizations/${organizationId}/field`);
        const chart = page.getByRole('main').locator('[data-dashboard-page]:visible [data-widget-id="volume"]');
        const plot = chart.getByRole('group', { name: /^Scheduled work\./ });
        await expect(plot).toBeVisible();
        await expect.poll(async () => (await plot.boundingBox())!.height).toBeGreaterThanOrEqual(160);
        await chart.getByText('View as table', { exact: true }).click();
        await expect(chart.getByRole('table').getByRole('cell', { name: '1 job', exact: true })).toBeVisible();
        mkdirSync(captures, { recursive: true });
        await page.screenshot({ path: path.join(captures, `work-populated-${size.width}.png`), fullPage: true });
      }
    } finally {
      await unscheduleWorkItem(db, { workItemId });
    }
  });

  test('a taller window expands the same dashboard without changing its records', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/organizations/${organizationId}/finance`);
    const surface = page.getByRole('main').locator('[data-dashboard-page]:visible');
    const panel = surface.getByRole('region', { name: 'Getting started', exact: true });
    await expect(panel).toBeVisible();
    const original = (await panel.boundingBox())!;
    const content = await panel.innerText();
    await page.setViewportSize({ width: 1440, height: 1440 });
    await expect.poll(async () => (await panel.boundingBox())!.height).toBeGreaterThan(original.height + 300);
    expect(await panel.innerText()).toBe(content);
    await page.setViewportSize({ width: 1440, height: 600 });
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toBeInViewport();
  });

  for (const route of ['home', 'crm', 'field', 'finance', 'comms', 'marketing', 'support']) {
    test(`${route} keeps panels useful when empty and fills the available workspace`, async ({ page }) => {
      test.setTimeout(180_000);
      mkdirSync(captures, { recursive: true });
      const { organizationId } = loadDemoContext();
      const geometry: unknown[] = [];
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      for (const size of [sizes[0], sizes[1], sizes[3], sizes[4], sizes[5], { width: 1280, height: 600 }]) {
        await page.setViewportSize(size);
        await page.goto(`/organizations/${organizationId}/${route}`);
        const surface = page.getByRole('main').locator('[data-dashboard-page]:visible');
        await expect(surface).toBeVisible();
        const panels = surface.locator('[data-slot="operational-panel"], [data-dashboard-panel], [data-dashboard-grid] [data-slot="chart-panel"]');
        await expect(panels.first()).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        await expect.poll(() => panels.evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().height >= 207))).toBe(true);
        const measured = await surface.evaluate(node => {
          const main = node.closest('main')!;
          const mainStyle = getComputedStyle(main);
          const header = main.querySelector('header');
          const pageBox = node.getBoundingClientRect();
          return {
            height: pageBox.height,
            available: main.clientHeight - (header?.getBoundingClientRect().height ?? 0) - parseFloat(mainStyle.paddingTop) - parseFloat(mainStyle.paddingBottom) - 64,
            overflow: document.documentElement.scrollWidth > innerWidth || main.scrollWidth > main.clientWidth,
            panels: [...node.querySelectorAll<HTMLElement>('[data-slot="operational-panel"], [data-slot="chart-panel"]')].map(panel => ({ title: panel.getAttribute('aria-label') ?? panel.querySelector('h3')?.textContent, height: panel.getBoundingClientRect().height })),
            emptyCharts: [...node.querySelectorAll<HTMLElement>('[data-slot="chart-state"]')].map(state => ({ height: state.getBoundingClientRect().height, text: state.textContent })),
          };
        });
        expect(measured.overflow).toBe(false);
        expect(measured.height).toBeGreaterThanOrEqual(measured.available);
        for (const chart of measured.emptyCharts) expect(chart.height).toBeGreaterThanOrEqual(160);
        geometry.push({ size, ...measured });
        await page.screenshot({ path: path.join(captures, `${route}-${size.width}x${size.height}.png`), fullPage: true });
        // The application's main scroller must leave the last panel reachable on short screens.
        await panels.last().scrollIntoViewIfNeeded();
        await expect(panels.last()).toBeInViewport();
      }
      writeFileSync(path.join(captures, `${route}-geometry.json`), JSON.stringify(geometry, null, 2));
      expect(errors).toEqual([]);
    });
  }
});

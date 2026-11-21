import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

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

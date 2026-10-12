import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const resolveFromWeb = createRequire(`${process.cwd()}/package.json`);
const axeSource = readFileSync(resolveFromWeb.resolve('axe-core/axe.min.js'), 'utf8');

test('all presets and schemes: responsive, accessible, interactive and scoped overlays', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/dev/design-system');
  await expect(page.getByRole('heading', { name: 'Visual system preview' })).toBeVisible();
  // Development HMR may finish CSS after the route has compiled; wait for the active tokens.
  await expect.poll(() => page.locator('[data-visual-system][data-appearance=light]').first().evaluate((element) => getComputedStyle(element).getPropertyValue('--danger').trim())).toBe('#b91c1c');
  for (const preset of ['Minimal', 'Layered', 'Expressive']) {
    for (const scheme of ['light', 'dark']) {
      const scope = page.getByRole('region', { name: `${preset} ${scheme}`, exact: true });
      await scope.scrollIntoViewIfNeeded();
      await expect(scope.getByRole('textbox', { name: 'Contact email' })).toHaveAttribute('aria-invalid', 'true');
      await expect(scope.getByRole('button', { name: 'Saving…' })).toBeDisabled();
      await scope.getByRole('button', { name: 'Outline', exact: true }).hover();
      await scope.getByRole('button', { name: /products/i }).click();
      await expect(scope.getByRole('button', { name: /products/i })).toHaveAttribute('aria-pressed', 'true');
      const week = scope.getByRole('tab', { name: 'Week' });
      await week.focus();
      await page.keyboard.press('ArrowLeft');
      await expect(scope.getByRole('tab', { name: 'Day' })).toHaveAttribute('aria-selected', 'true');
      const trigger = scope.getByRole('button', { name: 'Open modal' });
      await trigger.click();
      const modal = page.getByRole('dialog', { name: 'Design preview modal' });
      await expect(modal).toBeVisible();
      if (preset === 'Expressive') await modal.screenshot({ path: testInfo.outputPath(`modal-${scheme}.png`) });
      expect(await modal.evaluate((element) => element.closest('[data-appearance]')?.getAttribute('data-appearance'))).toBe(scheme);
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      await scope.getByRole('button', { name: 'Open menu' }).click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      if (preset === 'Expressive') await menu.screenshot({ path: testInfo.outputPath(`menu-${scheme}.png`) });
      expect(await menu.evaluate((element) => element.closest('[data-visual-preset]')?.getAttribute('data-visual-preset'))).toBe(preset.toLowerCase());
      await page.keyboard.press('Escape');
      await scope.getByRole('button', { name: /Resource filter/ }).click();
      await page.getByRole('radio', { name: 'Assigned to me' }).click();
      await expect(scope.getByRole('button', { name: 'Resource filter: Assigned to me' })).toBeVisible();
      await scope.screenshot({ path: testInfo.outputPath(`${preset}-${scheme}.png`) });
    }
  }
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const result = await (window as unknown as { axe: { run: () => Promise<{ violations: { id: string; nodes: { html: string; failureSummary: string }[] }[] }> } }).axe.run();
    return result.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => ({ html: node.html, summary: node.failureSummary })) }));
  });
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.getByRole('combobox', { name: 'Component density' }).selectOption('compact');
  const height = await page.locator('[data-visual-system] [data-slot=input]').first().evaluate((element) => element.getBoundingClientRect().height);
  expect(height).toBeGreaterThanOrEqual(testInfo.project.name === 'phone' ? 44 : 32);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const transition = await page.locator('[data-visual-system] [data-slot=button]').first().evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(parseFloat(transition)).toBeLessThan(0.01);
});

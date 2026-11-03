import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chooseOption, selectedLabel, selectFieldValue } from '../select-field';

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
      // One focus indicator: a keyboard outline in the scope's own text colour on the control's edge —
      // no box-shadow ring, no gap — on a button, a text field and a selection trigger alike.
      const ink = scheme === 'dark' ? 'rgb(237, 237, 237)' : 'rgb(23, 23, 23)';
      for (const control of [scope.getByRole('button', { name: 'Open modal' }), scope.getByRole('textbox', { name: 'Display name' }), scope.getByRole('combobox', { name: 'Preview status' })]) {
        await control.focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
        await expect(control).toBeFocused();
        await expect.poll(() => control.evaluate((element) => { const style = getComputedStyle(element); return [style.outlineStyle, style.outlineWidth, style.outlineOffset, style.outlineColor, /\d+px \d+px 0px [1-9]/.test(style.boxShadow)]; })).toEqual(['solid', '2px', '0px', ink, false]);
      }
      // The styled Select portals inside the scope, marks its choice, refuses a disabled one and returns focus.
      const status = scope.getByRole('combobox', { name: 'Preview status' });
      await expect(selectedLabel(status)).toHaveText('Open');
      await page.keyboard.press('Enter');
      const statuses = page.getByRole('listbox');
      await expect(statuses.getByRole('option', { name: 'Open' })).toHaveAttribute('aria-selected', 'true');
      await expect(statuses.getByRole('option', { name: 'Closed' })).toHaveAttribute('data-disabled', '');
      const content = page.locator('[data-slot=select-content]');
      expect(await content.evaluate((element) => [element.closest('[data-visual-preset]')?.getAttribute('data-visual-preset'), element.closest('[data-appearance]')?.getAttribute('data-appearance')])).toEqual([preset.toLowerCase(), scheme]);
      // Its corners follow the scope's shape, like the trigger it opened from.
      expect(await content.evaluate((element) => getComputedStyle(element).borderTopLeftRadius)).toBe(await scope.locator('[data-slot=select-trigger]').first().evaluate((element) => getComputedStyle(element).borderTopLeftRadius));
      if (preset === 'Expressive') await page.screenshot({ path: testInfo.outputPath(`select-open-${scheme}.png`) });
      await page.keyboard.press('Escape');
      await expect(statuses).toHaveCount(0);
      await expect(status).toBeFocused();
      await chooseOption(status, 'No status');
      await expect(selectedLabel(status)).toHaveText('No status');
      await expect(selectFieldValue(status)).toHaveValue('');
      // The long list is searchable in the same box; typing filters and Enter chooses.
      const contact = scope.getByRole('combobox', { name: 'Preview contact' });
      await contact.click();
      const search = page.getByRole('textbox', { name: 'Search Preview contact' });
      await expect(search).toBeFocused();
      await search.fill('contact 07');
      await expect(page.getByRole('listbox').getByRole('option')).toHaveText(['Contact 07']);
      await page.keyboard.press('Enter');
      await expect(selectedLabel(contact)).toHaveText('Contact 07');
      await expect(contact).toBeFocused();
      await expect(selectFieldValue(contact)).toHaveValue('contact-7');
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
  await chooseOption(page.getByRole('combobox', { name: 'Component density' }), 'compact');
  const height = await page.locator('[data-visual-system] [data-slot=input]').first().evaluate((element) => element.getBoundingClientRect().height);
  expect(height).toBeGreaterThanOrEqual(testInfo.project.name === 'phone' ? 44 : 32);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const transition = await page.locator('[data-visual-system] [data-slot=button]').first().evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(parseFloat(transition)).toBeLessThan(0.01);
});


test('navigation wraps, variants stay independent and links retain browser history', async ({ page }, testInfo) => {
  await page.goto('/dev/design-system');
  await chooseOption(page.getByRole('combobox', { name: 'Component density' }), 'compact');
  for (const preset of ['Minimal', 'Layered', 'Expressive']) {
    for (const scheme of ['light', 'dark']) {
      const scope = page.getByRole('region', { name: `${preset} ${scheme}`, exact: true });
      const nav = scope.getByRole('navigation', { name: `${preset.toLowerCase()} ${scheme} sibling views` });
      await expect(nav).toHaveAttribute('data-variant', 'segmented');
      await expect(nav.getByRole('link')).toHaveCount(9);
      await nav.scrollIntoViewIfNeeded();
      const current = nav.getByRole('link', { name: 'Files', exact: true });
      await expect(current).toHaveAttribute('aria-current', 'page');
      await expect(current).toHaveCSS('border-bottom-width', '0px');
      await expect.poll(() => current.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
      expect(await nav.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      expect(await nav.evaluate(el => getComputedStyle(el).overflowX)).toBe('visible');
      expect(await current.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(testInfo.project.name === 'phone' ? 44 : 32);
      const line = scope.getByRole('tablist', { name: 'Example detail views' });
      await expect(line).toHaveAttribute('data-variant', 'line');
      await expect(line.getByRole('tab', { name: 'Overview' })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await expect(line.getByRole('tab', { name: 'Overview' })).toHaveCSS('border-bottom-width', '2px');
      const day = scope.getByRole('tab', { name: 'Day', exact: true });
      await day.focus();
      await page.keyboard.press('ArrowRight');
      await expect(scope.getByRole('tab', { name: 'Week', exact: true })).toBeFocused();
      const directory = scope.getByRole('navigation', { name: `${preset.toLowerCase()} ${scheme} destinations` });
      await expect(directory.getByRole('listitem')).toHaveCount(2);
      await expect(directory.getByRole('link', { name: /Files/ })).toHaveAttribute('aria-current', 'page');
      await nav.screenshot({ path: testInfo.outputPath(`view-nav-${preset}-${scheme}.png`) });
      await directory.screenshot({ path: testInfo.outputPath(`navigation-${preset}-${scheme}.png`) });
    }
  }
  const files = page.getByRole('navigation', { name: 'minimal light sibling views' }).getByRole('link', { name: 'Files', exact: true });
  await files.focus();
  await expect(files).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/view=files/);
  await page.goBack();
  await expect(page).toHaveURL(/\/dev\/design-system$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

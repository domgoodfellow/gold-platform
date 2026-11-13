import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';
import { createClient } from '@supabase/supabase-js';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { createWebsite, listSiteTemplates } from '../lib/domain/public-site/public-site';
import { createCustomer } from '../lib/domain/customers/customers';
import { setBrand } from '../lib/domain/branding/brand';
import { saveAppearance } from '../lib/domain/identity/appearance';
import type { Db } from '../lib/db/types';
import { chooseOption } from './select-field';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const phase = process.env.VISUAL_SYSTEM_PHASE === 'before' ? 'before' : 'after';
test.use({ storageState: OWNER_STORAGE_STATE });
test('application canvas, draft preview and shared interaction hierarchy', async ({ page }) => {
  test.setTimeout(600_000);
  const { organizationId, ownerEmail } = loadDemoContext();
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const signed = await db.auth.signInWithPassword({ email: ownerEmail, password: DEMO_PASSWORD });
  if (signed.error) throw signed.error;
  const org = `/organizations/${organizationId}`;
  await setBrand(db as Db, { organizationId, accent: '#2563eb', secondary: '#7c3aed', highlight: '#d97706', headingFont: 'sans', bodyFont: 'sans' });
  const templates = await listSiteTemplates(db as Db);
  await createWebsite(db as Db, { organizationId, templateKey: templates[0]?.key });
  for (let index = 0; index < 16; index++) await createCustomer(db as Db, { organizationId, name: `Sample contact ${String(index + 1).padStart(2, '0')}`, email: `sample-${index}@example.test` });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const warnings = new Set<string>();
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') warnings.add(message.text().split('\n')[0]); });
  const shot = (name: string) => page.screenshot({ path: path.join(__dirname, '../../../.artifacts/visual-system', phase, `${name}.png`) });
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      const saved = await db.from('account_appearance_preferences').upsert({ user_id: signed.data.user!.id, appearance: scheme, preset: 'expressive', background: 'grid', motion: 'reduced' });
      if (saved.error) throw saved.error;
      for (const [name, route, text] of [
        ['appearance', `/settings/account/appearance?org=${organizationId}`, 'Visual style'],
        ['home', `${org}/home`, 'Needs attention'],
        ['contacts', `${org}/crm/contacts`, 'Sample contact 01'],
        ['studio', `${org}/studio`, 'Website'],
        ['website', `${org}/studio/website`, 'Canvas'],
        ['branding', `${org}/settings/branding`, 'Primary'],
      ]) {
        await page.goto(route);
        await expect(page.getByRole('main')).toContainText(text);
        await expect(page.locator('[data-account-appearance]')).toHaveAttribute('data-background', 'grid');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        if (phase === 'after') {
          await expect(page.locator('main > [data-slot=application-canvas-background]')).toHaveCount(1);
          await expect(page.locator('[data-slot=workspace-intro] [data-decorative-background]')).toHaveCount(0);
          const layer = page.locator('main > [data-slot=application-canvas-background]');
          const start = await layer.boundingBox();
          const header = await page.locator('main > header').boundingBox();
          expect(Math.abs(start!.y - (header!.y + header!.height))).toBeLessThan(2);
          expect(start!.height).toBeGreaterThan(500);
          await page.getByRole('main').evaluate(element => { element.scrollTop = element.scrollHeight; });
          const end = await layer.boundingBox();
          expect(Math.abs(start!.y - end!.y)).toBeLessThan(2);
          await page.getByRole('main').evaluate(element => { element.scrollTop = 0; });
        }
        if (name === 'appearance') {
          await expect(page.getByLabel('Theme', { exact: true })).toContainText(scheme === 'light' ? 'Light' : 'Dark');
          await shot(`${name}-${scheme}-${width}`);
          await page.getByTestId('appearance-preview').scrollIntoViewIfNeeded();
          await shot(`appearance-preview-${scheme}-${width}`);
        } else await shot(`${name}-${scheme}-${width}`);
      }
    }
  }
  console.log(`${phase} console warning types: ${JSON.stringify([...warnings])}`);
  if (phase === 'before') return;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/settings/account/appearance?org=${organizationId}`);
  const shell = page.locator('[data-account-appearance]');
  const preview = page.getByTestId('appearance-preview');
  const axe = readFileSync(createRequire(`${process.cwd()}/package.json`).resolve('axe-core/axe.min.js'), 'utf8');
  for (const preset of ['Minimal', 'Layered', 'Expressive']) {
    await page.getByRole('radio', { name: preset, exact: true }).locator('..').click();
    await expect(preview).toHaveAttribute('data-visual-preset', preset.toLowerCase());
    await expect(shell).toHaveAttribute('data-visual-preset', 'expressive');
    for (const scheme of ['light', 'dark']) {
      await chooseOption(page.getByLabel('Preview theme', { exact: true }), scheme);
      await preview.scrollIntoViewIfNeeded();
      const selected = preview.getByRole('button', { name: 'All', exact: true });
      expect(await selected.evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
      expect(await selected.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(await preview.getByRole('button', { name: 'Customers', exact: true }).evaluate(el => getComputedStyle(el).backgroundColor));
      expect(await preview.evaluate(el => getComputedStyle(el).getPropertyValue('--accent').trim())).toBe('#2563eb');
      await selected.focus(); await page.keyboard.press('Tab');
      const focus = preview.getByRole('button', { name: 'Customers', exact: true });
      await expect(focus).toBeFocused();
      expect(await focus.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
      const disabled = preview.getByRole('button', { name: 'Export', exact: true });
      await expect(disabled).toBeDisabled();
      await page.addScriptTag({ content: axe });
      const violations = await preview.evaluate(async el => (window as unknown as { axe: { run: (element: Element) => Promise<{ violations: { id: string; nodes: { failureSummary: string }[] }[] }> } }).axe.run(el));
      expect(violations.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.failureSummary) }))).toEqual([]);
      await shot(`preview-${preset.toLowerCase()}-${scheme}`);
    }
  }
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    await preview.scrollIntoViewIfNeeded();
    await shot(`preview-expressive-dark-${width}`);
    expect(await preview.locator('[data-slot=preview-main]').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  for (const [label, value] of [['None', 'none'], ['Ambient gradient', 'gradient'], ['Fine grid', 'grid'], ['Ambient 3D', 'ambient3d']]) {
    await chooseOption(page.getByLabel('Background', { exact: true }), value);
    const layer = preview.locator('[data-slot=application-canvas-background]');
    await expect(layer).toHaveCount(value === 'none' ? 0 : 1);
    await expect(shell).toHaveAttribute('data-background', 'grid');
    await preview.scrollIntoViewIfNeeded(); await shot(`background-${label.toLowerCase().replaceAll(' ', '-')}`);
  }
  await page.getByRole('button', { name: 'Open preview filter' }).click();
  await expect(preview.locator('[data-slot=popover-content]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open preview filter' })).toBeFocused();
  await page.getByRole('button', { name: 'Open preview dialog' }).click();
  await expect(preview.locator('[role=dialog]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open preview dialog' })).toBeFocused();
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await chooseOption(page.getByLabel('Background', { exact: true }), 'gradient');
  await page.getByRole('button', { name: 'Save appearance' }).click();
  await expect(shell).toHaveAttribute('data-background', 'gradient');
  await page.reload();
  await expect(shell).toHaveAttribute('data-background', 'gradient');
  expect((await db.from('account_appearance_preferences').select('background').single()).data?.background).toBe('gradient');
  for (const value of ['none', 'grid', 'ambient3d']) {
    await chooseOption(page.getByLabel('Background', { exact: true }), value);
    await page.getByRole('button', { name: 'Save appearance' }).click();
    if (value === 'none') await expect(shell).not.toHaveAttribute('data-background');
    else await expect(shell).toHaveAttribute('data-background', value);
    await page.goto(`${org}/home`);
    await expect(page.getByRole('main')).toContainText('Needs attention');
    await expect(page.locator('main > [data-slot=application-canvas-background]')).toHaveCount(value === 'none' ? 0 : 1);
    if (value !== 'none') expect(await page.locator('main > [data-slot=application-canvas-background]').evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
    await shot(`home-background-${value}`);
    if (value === 'ambient3d') console.log(`Ambient 3D renderer: ${await page.locator('main > [data-slot=application-canvas-background] [data-decorative-background]').getAttribute('data-decorative-background')}`);
    await page.goto(`/settings/account/appearance?org=${organizationId}`);
  }
  for (const preset of ['Minimal', 'Layered', 'Expressive']) {
    const radio = page.getByRole('radio', { name: preset, exact: true });
    await radio.locator('..').click();
    if (await page.getByRole('button', { name: 'Save appearance' }).isEnabled()) {
      await page.getByRole('button', { name: 'Save appearance' }).click();
      await expect(shell).toHaveAttribute('data-visual-preset', preset.toLowerCase());
    }
    await page.goto(`${org}/crm/contacts`);
    await expect(page.getByRole('main')).toContainText('Sample contact 01');
    await shot(`contacts-${preset.toLowerCase()}`);
    await page.goto(`/settings/account/appearance?org=${organizationId}`);
  }
  await page.goto(`${org}/studio/website`);
  await expect(page.locator('[data-public-design]').first()).toBeVisible();
  await expect(page.locator('[data-public-design] [data-decorative-background]')).toHaveCount(0);
  expect(await page.locator('[data-public-design]').first().evaluate(el => getComputedStyle(el).getPropertyValue('--visual-selected-mix').trim())).toBe('0%');
  await page.goto('/portal/unavailable');
  await expect(page.locator('[data-account-appearance], [data-slot=application-canvas-background]')).toHaveCount(0);
  await page.goto(`/settings/account/appearance?org=${organizationId}`);
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await expect(shell).not.toHaveAttribute('data-background');
  await expect(shell).not.toHaveAttribute('data-visual-preset');
  expect((await db.from('account_appearance_preferences').select()).data).toEqual([]);
  expect(errors).toEqual([]);
});

test('canvas preserves operator dialogs, nested selects and pressed feedback', async ({ page }) => {
  test.skip(phase === 'before', 'Baseline captures are in the screen matrix.');
  test.setTimeout(180_000);
  const { organizationId, ownerEmail } = loadDemoContext();
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const signed = await db.auth.signInWithPassword({ email: ownerEmail, password: DEMO_PASSWORD });
  if (signed.error) throw signed.error;
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const appearance of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: appearance, reducedMotion: 'reduce' });
      await saveAppearance(db as Db, { appearance, background: 'grid', preset: 'expressive', motion: 'reduced' });
      await page.goto(`/organizations/${organizationId}/crm/configuration/fields`);
      const trigger = page.getByRole('button', { name: /New field/ });
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'New field' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel('Label', { exact: true })).toBeFocused();
      expect(await dialog.evaluate(el => el.closest('[data-account-appearance]')?.getAttribute('data-appearance'))).toBe(appearance);
      const type = dialog.getByLabel('Type', { exact: true });
      await type.click();
      await expect(page.getByRole('listbox')).toBeVisible();
      await page.screenshot({ path: path.join(__dirname, '../../../.artifacts/visual-system/after', `crm-overlay-${appearance}-${width}.png`) });
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
    }
  }
  await page.goto(`/settings/account/appearance?org=${organizationId}`);
  const choice = page.getByTestId('appearance-preview').getByRole('button', { name: 'Customers', exact: true });
  await choice.scrollIntoViewIfNeeded();
  const idle = await choice.evaluate(el => getComputedStyle(el).backgroundColor);
  await choice.hover();
  expect(await choice.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(idle);
  await page.mouse.down();
  expect(await choice.evaluate(el => getComputedStyle(el).boxShadow)).toContain('inset');
  await page.mouse.up();
  await expect(choice).toHaveAttribute('aria-pressed', 'true');
  expect(await choice.evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
});

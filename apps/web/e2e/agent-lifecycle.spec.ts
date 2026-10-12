import { devices, expect, test, type Page } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

/**
 * Agent's lazy-mount lifecycle, in a real browser (Phase C, Slice 12/13). `agent-trigger.test.tsx`
 * proves the mechanism — the registered content never mounts before first open, and survives a
 * close — against a minimal harness; this proves the same lifecycle end to end, through the real
 * shell, the real Server Action (`loadAgentBootstrapAction`) and a real network round trip.
 *
 * Every assertion reads the DOM a person would see — a role, a visible label, text content —
 * never an internal React flag, so a change to *how* the lazy mount is implemented cannot make
 * this pass for the wrong reason.
 */

test.use({ storageState: OWNER_STORAGE_STATE });

test.describe('Agent: closed, open, usable, closed, reopened', () => {
  test('starts closed, opens on demand, becomes usable, and keeps its state across a close and reopen', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/home`);

    const trigger = page.getByRole('button', { name: 'Agent', exact: true });
    const panel = page.getByRole('complementary', { name: 'Agent' });

    // Closed: the trigger says so, and nothing the panel would show is in the page at all —
    // this is the lazy-mount contract, not merely a hidden drawer.
    await expect(trigger).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('textbox', { name: 'Message to the Agent' })).toHaveCount(0);

    // Open: the trigger presses, and the panel becomes visible.
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-pressed', 'true');
    await expect(panel).toBeVisible();

    // Loading, if it is observable at all, is a transient status region — real network latency
    // may resolve before this assertion runs, so it is checked only when still present rather
    // than required.
    const loading = panel.getByRole('status').filter({ hasText: 'Loading' });
    if (await loading.isVisible().catch(() => false)) {
      await expect(loading).toBeHidden({ timeout: 10_000 });
    }

    // Usable: the full conversation grammar is there — composer, History — whether or not a
    // provider is configured. A machine with none left configured (this one, by default: no
    // `ANTHROPIC_API_KEY`) still shows every bit of it; only sending is switched off, which is
    // the deliberate distinction `agent-conversations.test.ts` already holds for the deployment
    // that cannot answer, not something this spec should paper over with a provider-shaped
    // assumption.
    const composer = page.getByRole('textbox', { name: 'Message to the Agent' });
    await expect(composer).toBeVisible();
    await expect(page.getByRole('button', { name: 'History' })).toBeVisible();
    const canAnswer = await composer.isEnabled();

    if (canAnswer) {
      // A draft, typed but never sent, is the state a remount would lose.
      await composer.fill('What is booked today with nobody assigned?');
    }

    // Close: the trigger un-presses and the panel is hidden again.
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-pressed', 'false');
    await expect(panel).toBeHidden();

    // Reopen: the same composer — proof the subtree was kept mounted rather than torn down and
    // rebuilt (which a regression to eager-unmount would lose), checked by the one fact that
    // distinguishes "kept" from "rebuilt from the same bootstrap data": an unsent draft, when a
    // provider is configured to make one possible at all.
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-pressed', 'true');
    if (canAnswer) {
      await expect(composer).toHaveValue('What is booked today with nobody assigned?');
    } else {
      await expect(composer).toBeVisible();
    }
  });
});

async function openAgent(page: Page, width: number) {
  if (width < 768) {
    await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Agent', exact: true }).click();
  } else {
    await page.locator('header').getByRole('button', { name: 'Agent', exact: true }).click();
  }
  const panel = page.getByRole(width < 768 ? 'dialog' : 'complementary', { name: 'Agent', exact: true });
  await expect(panel.getByRole('button', { name: 'History', exact: true })).toBeVisible();
  return panel;
}

test('phone Menu hands focus to fullscreen Agent, nested popovers consume Escape, and close restores Menu', async ({ page }) => {
  const { organizationId } = loadDemoContext();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/organizations/${organizationId}/resources`);
  const route = page.url();
  const requests: string[] = [];
  page.on('request', (request) => { if (request.method() === 'POST' && request.headers()['next-action']) requests.push(request.url()); });
  const panel = await openAgent(page, 390);
  await expect(panel).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('[data-mobile="true"]')).toHaveCount(0);
  expect(await panel.evaluate((element) => element.matches(':modal') && element.contains(document.activeElement))).toBe(true);
  const bootstrapRequests = requests.length;
  expect(bootstrapRequests).toBe(1);
  await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).evaluate((element) => (element as HTMLElement).focus());
  expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  const composer = panel.getByRole('textbox', { name: 'Message to the Agent' });
  const originalComposer = await composer.elementHandle();
  const canAnswer = await composer.isEnabled();
  if (canAnswer) await composer.fill('Keep this unsent phone draft');
  for (const name of ['History', 'Configure', 'Context']) {
    const trigger = panel.getByRole('button', { name, exact: true });
    await trigger.click();
    const popup = page.locator('[data-slot="popover-content"]');
    await expect(popup).toBeVisible();
    expect(await popup.evaluate((element) => Boolean(element.closest('dialog[open]')))).toBe(true);
    const bounds = (await popup.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
    await expect(panel).toBeVisible();
    await expect(trigger).toBeFocused();
  }
  for (let step = 0; step < 25; step++) {
    await page.keyboard.press('Tab');
    // Native dialog may pass through the browser chrome at the edge, but never the inert application.
    expect(await panel.evaluate((element) => document.activeElement === document.body || element.contains(document.activeElement))).toBe(true);
  }
  const main = page.locator('main');
  const scrollBefore = await main.evaluate((element) => element.scrollTop);
  await page.mouse.move(180, 300);
  await page.mouse.wheel(0, 500);
  expect(await main.evaluate((element) => element.scrollTop)).toBe(scrollBefore);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  const menu = page.locator('header').getByRole('button', { name: 'Menu', exact: true });
  await expect(menu).toBeFocused();
  for (let cycle = 0; cycle < 2; cycle++) {
    await openAgent(page, 390);
    expect(await composer.evaluate((element, previous) => element === previous, originalComposer)).toBe(true);
    if (canAnswer) await expect(composer).toHaveValue('Keep this unsent phone draft');
    await panel.getByRole('button', { name: 'Close Agent' }).click();
    await expect(menu).toBeFocused();
  }
  expect(requests.length).toBe(bootstrapRequests);
  await expect(page).toHaveURL(route);
  await page.getByRole('button', { name: 'Navigate within current section' }).click();
  await page.getByRole('menuitem', { name: 'Schedule', exact: true }).click();
  await expect(page).toHaveURL(`/organizations/${organizationId}/schedule`);
  await openAgent(page, 390);
  expect(await composer.evaluate((element, previous) => element === previous, originalComposer)).toBe(true);
  expect(requests.length).toBe(bootstrapRequests);
});

test('Agent occupies the phone viewport and retains tablet overlay and desktop resizing in both appearances', async ({ page }, testInfo) => {
  const { organizationId } = loadDemoContext();
  test.setTimeout(90000);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [width, height] of [[320, 700], [375, 812], [390, 844], [768, 1024], [1024, 768], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await page.goto(`/organizations/${organizationId}/home`);
      const panel = await openAgent(page, width);
      const bounds = (await panel.boundingBox())!;
      expect(bounds.y).toBeCloseTo(0, 0);
      expect(bounds.height).toBeCloseTo(height, 0);
      if (width < 768) {
        expect(bounds.x).toBeCloseTo(0, 0);
        expect(bounds.width).toBeCloseTo(width, 0);
      } else {
        expect(bounds.x).toBeGreaterThan(0);
        expect(bounds.x + bounds.width).toBeCloseTo(width, 0);
        if (width < 1280) expect(bounds.width).toBeCloseTo(448, 0);
        await expect(panel).not.toHaveAttribute('aria-modal');
      }
      await expect(panel.getByText(/signed-in operator scope/)).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const composerBounds = (await panel.getByRole('textbox', { name: 'Message to the Agent' }).boundingBox())!;
      expect(composerBounds.y + composerBounds.height).toBeLessThan(height);
      await page.screenshot({ animations: 'disabled', path: testInfo.outputPath(`agent-${scheme}-${width}.png`) });
      if (width === 1440) {
        const resize = panel.getByRole('separator', { name: 'Resize Agent' });
        const initial = Number(await resize.getAttribute('aria-valuenow'));
        await resize.focus();
        await resize.press('ArrowLeft');
        await expect(resize).toHaveAttribute('aria-valuenow', String(Math.min(600, initial + 24)));
        await resize.press('ArrowRight');
        await expect(resize).toHaveAttribute('aria-valuenow', String(initial));
      }
    }
  }
});

test('phone to tablet to desktop transitions preserve the conversation element without another bootstrap', async ({ page }) => {
  const { organizationId } = loadDemoContext();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/organizations/${organizationId}/home`);
  let requests = 0;
  page.on('request', (request) => { if (request.method() === 'POST' && request.headers()['next-action']) requests++; });
  const panel = await openAgent(page, 390);
  const composer = await panel.getByRole('textbox', { name: 'Message to the Agent' }).elementHandle();
  for (const width of [768, 1440, 1720, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const current = page.getByRole(width < 768 ? 'dialog' : 'complementary', { name: 'Agent', exact: true });
    await expect(current).toBeVisible();
    expect(await current.getByRole('textbox', { name: 'Message to the Agent' }).evaluate((element, previous) => element === previous, composer)).toBe(true);
  }
  await page.getByRole('dialog', { name: 'Agent' }).getByRole('button', { name: 'Close Agent' }).click();
  await expect(page.locator('header').getByRole('button', { name: 'Menu', exact: true })).toBeFocused();
  expect(requests).toBe(1);
});

test('Agent works in a touch-enabled mobile browser viewport', async ({ browser }, testInfo) => {
  const { organizationId } = loadDemoContext();
  const context = await browser.newContext({ ...devices['iPhone 13'], storageState: OWNER_STORAGE_STATE });
  const page = await context.newPage();
  try {
    await page.goto(`/organizations/${organizationId}/home`);
    const menu = page.locator('header').getByRole('button', { name: 'Menu', exact: true });
    await menu.tap();
    await page.getByRole('dialog', { name: 'Sidebar' }).getByRole('button', { name: 'Agent', exact: true }).tap();
    const panel = page.getByRole('dialog', { name: 'Agent', exact: true });
    await expect(panel.getByRole('textbox', { name: 'Message to the Agent' })).toBeVisible();
    expect((await panel.boundingBox())!.height).toBeCloseTo(await page.evaluate(() => visualViewport!.height), 0);
    await panel.getByRole('button', { name: 'Configure', exact: true }).tap();
    await expect(page.getByRole('checkbox', { name: /Include the open record/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.screenshot({ animations: 'disabled', path: testInfo.outputPath('agent-mobile-emulation-390.png') });
    await panel.getByRole('button', { name: 'Close Agent' }).tap();
    await menu.tap();
    await expect(page.getByRole('dialog', { name: 'Sidebar' })).toBeVisible();
  } finally { await context.close(); }
});

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test, expect, type FrameLocator, type Page } from '@playwright/test';
import { Client } from 'pg';
import { OWNER_STORAGE_STATE } from './helpers';
import { loadStudioFixture, revisionCount, STALE_DRAFT_HEADING } from './studio-fixture';

/**
 * Studio Slice 1 against GildOps' website history as production holds it: an old legacy draft and
 * a newer migration-published homepage. `STUDIO_S1_PHASE=before` only captures the screens.
 */
const PHASE = process.env.STUDIO_S1_PHASE === 'before' ? 'before' : 'after';
const SHOTS = path.join(__dirname, '..', '..', '..', '.artifacts', 'studio-s1', PHASE);
const WIDTHS = [['desktop', 1440, 900], ['tablet', 768, 1024], ['phone', 390, 844]] as const;
const CONNECTION = () => process.env.SUPABASE_DB_URL!;

mkdirSync(SHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });

test.use({ storageState: OWNER_STORAGE_STATE });

test.describe.serial(`Studio stabilization (${PHASE})`, () => {
  test('screens at every reference width, and looking creates no revision', async ({ page }) => {
    const fixture = loadStudioFixture();
    const base = `/organizations/${fixture.organizationId}/studio`;
    const before = await revisionCount(CONNECTION(), fixture.organizationId);
    const errors: string[] = [];
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('pageerror', (error) => errors.push(error.message));

    for (const [name, width, height] of WIDTHS) {
      await page.setViewportSize({ width, height });

      await page.goto(base);
      await expect(page.getByText('Website overview').first()).toBeVisible();
      await page.waitForTimeout(1500);
      await shot(page, `dashboard-${name}`);

      await page.goto(`${base}/website`);
      await expect(page.getByText(new RegExp(`Revision ${fixture.draftNumber}`)).first()).toBeVisible();
      await page.waitForTimeout(800);
      await shot(page, `workbench-${name}`);

      await page.goto(`/preview/${fixture.organizationId}/${fixture.publishedId}`);
      await page.waitForTimeout(800);
      await shot(page, `revision-preview-${name}`);

      await page.goto(`${base}/templates?kind=website`);
      await page.getByRole('button', { name: /^Preview Local service business/ }).click();
      await page.waitForTimeout(800);
      await shot(page, `template-preview-${name}`);
      await page.keyboard.press('Escape');
    }

    expect(await revisionCount(CONNECTION(), fixture.organizationId)).toBe(before);
    if (PHASE === 'after') expect(errors).toEqual([]);
  });

  test('draws the same published revision live, in the full preview and in the Dashboard thumbnail', async ({ page }) => {
    test.skip(PHASE === 'before', 'The before phase only captures the screens.');
    const fixture = loadStudioFixture();
    const home = (scope: Page | FrameLocator) => scope.locator('[data-marketing-home]');
    // React's per-render ids, and the light the LightingController writes as the reader scrolls
    // (`--light`, `--light-y`, `data-shimmer`): runtime decoration, not content or layout.
    const normalise = (html: string) => html
      .replace(/«r[0-9a-z]+»|:r[0-9a-z]+:|_r_[0-9a-z]+_/g, 'ID')
      .replace(/ data-shimmer="[^"]*"/g, '')
      .replace(/style="([^"]*)"/g, (_, style: string) => `style="${style.replace(/--light(-y)?:\s*[^;]*;?/g, '').replace(/\s*([:;])\s*/g, '$1').replace(/;$/, '')}"`);
    for (const [name, width, height] of WIDTHS) {
      await page.setViewportSize({ width, height });
      await page.goto('/');
      const live = normalise(await home(page).evaluate((element) => element.outerHTML));
      const liveBox = (await home(page).boundingBox())!;
      await page.goto(`/preview/${fixture.organizationId}/${fixture.publishedId}`);
      expect(normalise(await home(page).evaluate((element) => element.outerHTML)), name).toBe(live);
      // Same width, same layout: the compositions measure the same.
      const previewBox = (await home(page).boundingBox())!;
      expect(Math.round(previewBox.width), name).toBe(Math.round(liveBox.width));
      expect(Math.abs(previewBox.height - liveBox.height), name).toBeLessThan(2);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const liveText = await home(page).innerText();
    await page.goto(`/organizations/${fixture.organizationId}/studio`);
    const thumbnail = page.frameLocator('iframe[title^="Revision"]');
    await expect(home(thumbnail)).toBeVisible();
    expect(await home(thumbnail).innerText()).toBe(liveText);
    await expect(page.getByText(`Published · Revision ${fixture.publishedNumber}`)).toBeVisible();
    // A picture: nothing inside is reachable, and the full preview is one action away.
    await expect(page.locator('iframe[title^="Revision"]')).toHaveAttribute('tabindex', '-1');
    await expect(page.getByRole('link', { name: 'Open preview' })).toHaveAttribute('href', `/preview/${fixture.organizationId}/${fixture.publishedId}`);
  });

  test('opens revision history straight from the Dashboard, creating nothing', async ({ page }) => {
    test.skip(PHASE === 'before', 'The before phase only captures the screens.');
    const fixture = loadStudioFixture();
    const before = await revisionCount(CONNECTION(), fixture.organizationId);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/organizations/${fixture.organizationId}/studio`);
    await page.getByRole('link', { name: 'Review publishing & history' }).click();
    await expect(page).toHaveURL(/studio\/website\?panel=history/);
    const list = page.getByRole('list', { name: 'Revisions' });
    await expect(list).toBeVisible();
    await expect(list.getByText('Live')).toBeVisible();
    await expect(list.getByText('Working')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore revision 1 as a draft' })).toBeDisabled();
    await shot(page, 'history-from-dashboard');
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(page).not.toHaveURL(/panel=history/);
    expect(await revisionCount(CONNECTION(), fixture.organizationId)).toBe(before);
  });

  test('resizes, collapses and maximizes the workbench, and changes the canvas width without creating a revision', async ({ page }) => {
    test.skip(PHASE === 'before', 'The before phase only captures the screens.');
    const fixture = loadStudioFixture();
    const before = await revisionCount(CONNECTION(), fixture.organizationId);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/organizations/${fixture.organizationId}/studio/website`);
    const canvas = page.frameLocator('iframe[title^="Canvas"]');
    await expect(canvas.getByRole('heading', { name: STALE_DRAFT_HEADING })).toBeVisible();
    for (const [label, width] of [['Tablet', 768], ['Mobile', 390], ['Desktop', 1440]] as const) {
      await page.getByRole('group', { name: 'Canvas width' }).getByRole('button', { name: label }).click();
      await expect(page.locator('iframe[title^="Canvas"]')).toHaveAttribute('style', new RegExp(`width: ${width}px`));
    }
    // Selecting a section in the canvas opens its editor.
    await canvas.getByRole('button', { name: 'Select the Hero section' }).click();
    await expect(page.getByLabel('Heading')).toHaveValue(STALE_DRAFT_HEADING);

    const resize = page.getByRole('separator', { name: 'Resize Structure' });
    await resize.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(resize).toHaveAttribute('aria-valuenow', '256');
    const structure = page.locator('section[aria-label="Structure"]');
    expect(Math.round((await structure.boundingBox())!.width)).toBe(256);
    await page.getByRole('button', { name: 'Hide Structure' }).click();
    await expect(structure).toBeHidden();
    await page.getByRole('button', { name: 'Maximize canvas' }).click();
    await expect(page.locator('section[aria-label="Inspector"]')).toBeHidden();
    await shot(page, 'workbench-maximized');
    await page.getByRole('button', { name: 'Restore panels' }).click();
    await expect(page.locator('section[aria-label="Inspector"]')).toBeVisible();
    await expect(page.getByLabel('Heading')).toHaveValue(STALE_DRAFT_HEADING);
    await page.getByRole('button', { name: 'Show Structure' }).click();
    // Remembered for this editor in this browser.
    await page.reload();
    await expect(page.getByRole('separator', { name: 'Resize Structure' })).toHaveAttribute('aria-valuenow', '256');
    expect(await revisionCount(CONNECTION(), fixture.organizationId)).toBe(before);
  });

  test('keeps every screen inside the viewport at desktop, tablet and phone widths', async ({ page }) => {
    test.skip(PHASE === 'before', 'The before phase only captures the screens.');
    const fixture = loadStudioFixture();
    for (const [name, width, height] of WIDTHS) {
      await page.setViewportSize({ width, height });
      for (const url of [`/organizations/${fixture.organizationId}/studio`, `/organizations/${fixture.organizationId}/studio/website`, `/preview/${fixture.organizationId}/${fixture.publishedId}`]) {
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${url} at ${name}`).toBeLessThanOrEqual(0);
      }
    }
  });

  test('previews a website template page by page at each width, and closes back to the collection', async ({ page }) => {
    test.skip(PHASE === 'before', 'The before phase only captures the screens.');
    const fixture = loadStudioFixture();
    const before = await revisionCount(CONNECTION(), fixture.organizationId);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/organizations/${fixture.organizationId}/studio/templates?kind=website`);
    await page.getByRole('searchbox', { name: 'Search templates' }).fill('service');
    const trigger = page.getByRole('button', { name: 'Preview Local service business' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Local service business' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('navigation', { name: 'Pages' }).getByRole('button', { name: 'Services' }).click();
    const frame = dialog.frameLocator('iframe');
    await expect(frame.getByRole('heading', { name: 'The work we do' })).toBeVisible();
    for (const [label, width] of [['Mobile', 390], ['Tablet', 768]] as const) {
      await dialog.getByRole('button', { name: label }).click();
      await expect(dialog.locator('iframe')).toHaveAttribute('style', new RegExp(`width: ${width}px`));
    }
    await expect(frame.getByRole('heading', { name: 'The work we do' })).toBeVisible();
    // The page scrolls inside the preview body; nothing overflows sideways.
    const body = dialog.locator('[data-preview-body]');
    expect(await body.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await shot(page, 'template-preview-services-tablet');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(page).toHaveURL(/kind=website/);
    await expect(page.getByRole('searchbox', { name: 'Search templates' })).toHaveValue('service');
    expect(await revisionCount(CONNECTION(), fixture.organizationId)).toBe(before);
  });

  test('refuses to publish the stale draft over the newer revision unless confirmed, then discards and restores it', async ({ page }) => {
    test.skip(PHASE === 'before', 'The before phase only captures the screens.');
    const fixture = loadStudioFixture();
    const pg = new Client(CONNECTION());
    await pg.connect();
    const status = async (id: string) => (await pg.query<{ status: string }>('select status from public.public_site_revisions where id = $1', [id])).rows[0]!.status;
    const pointer = async () => (await pg.query<{ id: string }>('select current_published_revision_id as id from public.public_sites where organization_id = $1', [fixture.organizationId])).rows[0]!.id;
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/organizations/${fixture.organizationId}/studio/website`);
      await expect(page.getByText('Draft is based on an older revision.')).toBeVisible();
      await expect(page.getByText(`Publishing this draft would replace revision ${fixture.publishedNumber}.`)).toBeVisible();
      await page.getByRole('button', { name: 'Send for review' }).click();
      await expect(page.getByText('Read-only while in review', { exact: true })).toBeVisible();

      // Publishing asks first, naming the revision it would replace; cancelling publishes nothing.
      await page.getByRole('button', { name: 'Publish' }).click();
      const confirm = page.getByRole('dialog');
      await expect(confirm.getByRole('button', { name: `Replace revision ${fixture.publishedNumber}` })).toBeVisible();
      await shot(page, 'stale-publish-confirmation');
      await confirm.getByRole('button', { name: 'Cancel' }).click();
      expect(await pointer()).toBe(fixture.publishedId);

      // Discarding the persisted draft keeps the published revision and the draft's record.
      const before = await revisionCount(CONNECTION(), fixture.organizationId);
      await page.getByRole('button', { name: 'Discard draft' }).click();
      await shot(page, 'discard-confirmation');
      await page.getByRole('dialog').getByRole('button', { name: `Discard revision ${fixture.draftNumber}` }).click();
      await expect(page.getByText(`Revision ${fixture.publishedNumber} · Published`)).toBeVisible();
      expect(await status(fixture.draftId)).toBe('discarded');
      expect(await pointer()).toBe(fixture.publishedId);
      expect(await revisionCount(CONNECTION(), fixture.organizationId)).toBe(before);
      const audit = (await pg.query(`select payload from public.events where organization_id = $1 and entity_id = $2 and action = 'public_site.draft_discarded'`, [fixture.organizationId, fixture.draftId])).rows[0];
      expect(audit.payload).toMatchObject({ was_stale: true, previous_status: 'in_review' });

      // Restoring it copies it forward as a new draft based on the published revision: no longer stale.
      await page.getByRole('button', { name: 'History' }).click();
      await page.getByRole('button', { name: `Restore revision ${fixture.draftNumber} as a draft` }).click();
      await expect(page.getByText(`Revision ${fixture.publishedNumber + 1} · Draft`)).toBeVisible();
      await expect(page.getByText('Draft is based on an older revision.')).toBeHidden();
      await expect(page.frameLocator('iframe[title^="Canvas"]').getByRole('heading', { name: STALE_DRAFT_HEADING })).toBeVisible();
      expect(await revisionCount(CONNECTION(), fixture.organizationId)).toBe(before + 1);
      expect(await pointer()).toBe(fixture.publishedId);
      await shot(page, 'restored-draft');
    } finally {
      await pg.end();
    }
  });
});

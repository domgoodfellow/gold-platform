import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE, provisionBrowserOrganization } from './helpers';
import { getOrganization } from '../lib/domain/tenancy/organizations';
import { listWorkItemTypes } from '../lib/domain/work-items/types';
import { listRoles } from '../lib/domain/tenancy/roles';
import { listPendingInvitations } from '../lib/domain/tenancy/invitations';
import type { BusinessShape } from '../lib/domain/configuration/configure';
import { chooseOption } from './select-field';

async function capture(page: Page, path: string) {
  await expect(page.getByText('This screen did not load', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path, fullPage: true });
}

test.describe('configuration onboarding', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });
  test.setTimeout(180_000);

  test('review, edit, apply and launch a provisioned organization through the browser', async ({ page }, info) => {
    const { organizationId: existingId } = loadDemoContext();
    const { organizationId, owner } = await provisionBrowserOrganization(`Onboarding acceptance ${randomUUID().slice(0, 6)}`);
    const root = `/organizations/${organizationId}`;
    await page.goto(`${root}/setup?step=business`);
    await expect(page.getByRole('heading', { name: 'Set up your organization', exact: true })).toBeVisible();
    await page.getByLabel('Business name', { exact: true }).fill('Browser-confirmed business');
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect.poll(async () => (await getOrganization(owner, organizationId))?.name).toBe('Browser-confirmed business');
    await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled();
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await capture(page, info.outputPath(`01-setup-business-${width}.png`));
      await page.goto(`${root}/setup?step=review`);
      await expect(page.getByRole('heading', { name: 'Review and launch', exact: true })).toBeVisible();
      await capture(page, info.outputPath(`02-readiness-${width}.png`));
      await page.goto(`${root}/setup?step=business`);
    }

    await page.goto(`${root}/settings/access/roles`);
    await page.getByRole('link', { name: 'New role', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Acceptance colleague');
    await page.getByRole('button', { name: 'Create role', exact: true }).click();
    await expect.poll(async () => (await listRoles(owner, { organizationId })).map((role) => role.name)).toContain('Acceptance colleague');
    await page.goto(`${root}/settings/access/invitations`);
    await page.getByRole('button', { name: 'Add member', exact: true }).click();
    await page.getByLabel('Email address', { exact: true }).fill('configuration-colleague@example.test');
    await chooseOption(page.getByLabel('Role', { exact: true }), { label: 'Acceptance colleague' });
    await page.getByRole('button', { name: 'Send invitation', exact: true }).click();
    await expect.poll(async () => (await listPendingInvitations(owner, { organizationId })).map((invite) => invite.email)).toContain('configuration-colleague@example.test');
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByText('configuration-colleague@example.test', { exact: true }).filter({ visible: true })).toBeVisible();
    await capture(page, info.outputPath('22-populated-invitations-390.png'));

    // Explicit local review document, not generated production data or a provider response.
    const shape: BusinessShape = { typeName: 'Acceptance request', schedulable: false, statuses: ['Received', 'Complete'], transitions: [[0, 1]], fields: {}, prices: [], hours: [], roles: [], modules: [] };
    const actor = await owner.auth.getUser();
    const inserted = await owner.from('configuration_proposals').insert({ organization_id: organizationId, created_by: actor.data.user!.id, description: 'Local browser acceptance: a reviewed request workflow.', drafted_by: 'browser acceptance fixture', shape }).select('id').single();
    expect(inserted.error).toBeNull();
    await page.goto(`${root}/setup/proposal`);
    await expect(page.getByLabel('Kind of work 1 name')).toHaveValue('Acceptance request');
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const parts = page.getByRole('group', { name: 'Parts of this setup' });
      for (const [group, number] of [['Work', '03'], ['Prices', '04'], ['Team', '05'], ['Records', '06'], ['Features', '07']] as const) {
        await parts.getByRole('button', { name: group, exact: true }).click();
        await expect(parts.getByRole('button', { name: group, exact: true })).toHaveAttribute('aria-pressed', 'true');
        await capture(page, info.outputPath(`${number}-proposal-${group}-${width}.png`));
      }
    }
    await page.getByRole('group', { name: 'Parts of this setup' }).getByRole('button', { name: 'Work', exact: true }).click();
    await page.getByLabel('Kind of work 1 name').fill('Reviewed request');
    await expect(page.getByRole('button', { name: 'Apply this setup', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Apply this setup', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Apply this setup', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Apply setup', exact: true }).click();
    await expect.poll(async () => (await listWorkItemTypes(owner, { organizationId })).map((type) => type.name)).toContain('Reviewed request');
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${root}/setup?step=operations`);
      await capture(page, info.outputPath(`23-guided-operations-${width}.png`));
      await page.goto(`${root}/setup?step=review`);
      await capture(page, info.outputPath(`24-partial-setup-${width}.png`));
    }
    await page.goto(`${root}/setup?step=review`);
    await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture(page, info.outputPath('08-launch-confirmation-390.png'));
    await page.getByRole('button', { name: 'Launch organization', exact: true }).click();
    await expect(page).toHaveURL(`${root}/home`);
    expect((await getOrganization(owner, organizationId))?.operationalState).toBe('live');
    // Settings has no landing page: it opens on General for an administrator.
    await page.goto(`/organizations/${existingId}/settings`);
    await expect(page).toHaveURL(`/organizations/${existingId}/settings/general`);
    await expect(page.getByRole('heading', { level: 1, name: 'General', exact: true })).toBeVisible();
    await expect(page.getByText('Browser-confirmed business', { exact: true })).toHaveCount(0);
  });

  test('all Settings scopes remain usable at desktop, tablet and phone widths', async ({ page }, info) => {
    const { organizationId } = loadDemoContext();
    const root = `/organizations/${organizationId}/settings`;
    const errors: string[] = [];
    // A development build's React profiler reports a redirect page's timing as "cannot have a negative
    // time stamp" (the root, /organization and /connections/apps redirect). It is not an application
    // error and a production build never raises it, so that one message is not counted.
    page.on('pageerror', (error) => { if (!/cannot have a negative time stamp/.test(error.message)) errors.push(error.message); });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [path, number] of [['', '09'], ['/organization', '10'], ['/general', '11'], ['/account/profile', '12'], ['/account/security', '13'], ['/access/members', '14'], ['/access/roles', '15'], ['/features', '16'], ['/connections', '17'], ['/connections/apps', '18'], ['/plan', '19'], ['/access/invitations', '21']] as const) {
        const destination = path === '/account/profile'
          ? `/settings/account?org=${organizationId}`
          : path === '/account/security'
            ? `/settings/account/security?org=${organizationId}`
            : `${root}${path}`;
        await page.goto(destination);
        // A first visit compiles the page in a development build, which can take longer than the default wait.
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('This page does not exist', { exact: true })).toHaveCount(0);
        if (path === '/account/profile') await expect(page.getByLabel('Given name', { exact: true })).toBeVisible();
        if (path === '/account/security') await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
        await capture(page, info.outputPath(`${number}-${path.replaceAll('/', '-') || 'settings'}-${width}.png`));
        if (path === '/access/roles') {
          await page.getByRole('link', { name: 'New role', exact: true }).click();
          await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
          await expect(page.getByRole('button', { name: 'Create role', exact: true })).toBeVisible();
          await capture(page, info.outputPath(`20-role-editor-${width}.png`));
          await page.goBack();
        }
      }
      // Below desktop width the Settings sidebar, and its search, opens from the header.
      await page.goto(root);
      await expect(page).toHaveURL(`${root}/general`);
      if (width < 768) await page.locator('header').getByRole('button', { name: 'Menu', exact: true }).click();
      else if (await page.locator('[data-slot="sidebar"][data-state="collapsed"]').count()) await page.locator('header').getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
      const search = page.getByRole('searchbox', { name: 'Search settings', exact: true }).filter({ visible: true });
      await search.fill('timezone');
      await expect(page.getByRole('link', { name: /^General/ })).toBeVisible();
      await search.fill('no such setting');
      await expect(page.getByText(/No settings match/)).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});

test.describe('reduced configuration authority', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });
  test('hides permission-dependent setup destinations and feature mutation controls', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/setup?step=people`);
    await expect(page.getByRole('navigation', { name: 'Setup steps' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish setup', exact: true })).toHaveCount(0);
    await page.goto(`/organizations/${organizationId}/settings/features`);
    await expect(page.getByRole('heading', { name: 'Features', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Feature options/ })).toHaveCount(0);
    await expect(page.getByText(/cannot switch features on or off/)).toBeVisible();
  });
});

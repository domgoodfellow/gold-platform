import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE, provisionBrowserOrganization } from './helpers';
import { getOrganization } from '../lib/domain/tenancy/organizations';
import { listWorkItemTypes } from '../lib/domain/work-items/types';
import { listRoles } from '../lib/domain/tenancy/roles';
import { listPendingInvitations } from '../lib/domain/tenancy/invitations';
import type { BusinessShape } from '../lib/domain/configuration/configure';

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
    await page.getByLabel('Organization name', { exact: true }).fill('Browser-confirmed business');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await getOrganization(owner, organizationId))?.name).toBe('Browser-confirmed business');
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await capture(page, info.outputPath(`01-setup-business-${width}.png`));
      await page.goto(`${root}/setup?step=review`);
      await expect(page.getByRole('heading', { name: 'Review and launch', exact: true })).toBeVisible();
      await capture(page, info.outputPath(`02-readiness-${width}.png`));
      await page.goto(`${root}/setup?step=business`);
    }

    await page.goto(`${root}/settings/access/roles`);
    await page.getByRole('button', { name: 'New role', exact: true }).click();
    await page.getByLabel('Role name').fill('Acceptance colleague');
    await page.getByRole('button', { name: 'Create role', exact: true }).click();
    await expect.poll(async () => (await listRoles(owner, { organizationId })).map((role) => role.name)).toContain('Acceptance colleague');
    await page.goto(`${root}/settings/access/invitations`);
    await page.getByRole('button', { name: 'Add member', exact: true }).click();
    await page.getByLabel('Email address', { exact: true }).fill('configuration-colleague@example.test');
    await page.getByLabel('Role', { exact: true }).selectOption({ label: 'Acceptance colleague' });
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
    await expect(page.getByLabel('What you call the work')).toHaveValue('Acceptance request');
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [group, number] of [['operations', '03'], ['finance', '04'], ['people', '05'], ['data', '06'], ['features', '07']] as const) {
        await page.getByRole('button', { name: group, exact: true }).click();
        await capture(page, info.outputPath(`${number}-proposal-${group}-${width}.png`));
      }
    }
    await page.getByRole('button', { name: 'operations', exact: true }).click();
    await page.getByLabel('What you call the work').fill('Reviewed request');
    await expect(page.getByRole('button', { name: 'Apply this setup', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Apply this setup', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Apply this setup', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Apply reviewed setup', exact: true }).click();
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
    await page.goto(`/organizations/${existingId}/settings`);
    await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
    await expect(page.getByText('Browser-confirmed business', { exact: true })).toHaveCount(0);
  });

  test('all Settings scopes remain usable at desktop, tablet and phone widths', async ({ page }, info) => {
    const { organizationId } = loadDemoContext();
    const root = `/organizations/${organizationId}/settings`;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const [path, number] of [['', '09'], ['/organization', '10'], ['/general', '11'], ['/account/profile', '12'], ['/account/security', '13'], ['/access/members', '14'], ['/access/roles', '15'], ['/features', '16'], ['/connections', '17'], ['/connections/apps', '18'], ['/plan', '19'], ['/access/invitations', '21']] as const) {
        const destination = path === '/account/profile'
          ? `/settings/account?org=${organizationId}`
          : path === '/account/security'
            ? `/settings/account/security?org=${organizationId}`
            : `${root}${path}`;
        await page.goto(destination);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByText('This page does not exist', { exact: true })).toHaveCount(0);
        if (path === '/account/profile') await expect(page.getByLabel('Given name', { exact: true })).toBeVisible();
        if (path === '/account/security') await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
        await capture(page, info.outputPath(`${number}-${path.replaceAll('/', '-') || 'settings'}-${width}.png`));
        if (path === '/access/roles') {
          await page.getByRole('button', { name: 'New role', exact: true }).click();
          await expect(page.getByLabel('Role name')).toBeVisible();
          await expect(page.getByRole('button', { name: 'Create role', exact: true })).toBeVisible();
          await capture(page, info.outputPath(`20-role-drawer-${width}.png`));
          await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
        }
      }
      await page.goto(root);
      await page.getByLabel('Search settings').fill('timezone');
      await expect(page.getByRole('link', { name: /^General/ })).toBeVisible();
      await page.getByLabel('Search settings').fill('no such setting');
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

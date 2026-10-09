import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { OWNER_STORAGE_STATE, provisionBrowserOrganization } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });
test.setTimeout(90_000);

for (const width of [1440, 390]) {
  test(`Setup remains voluntary and launch opens Home at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { organizationId, owner } = await provisionBrowserOrganization(`Lifecycle Co ${randomUUID().slice(0, 4)}`);
    const root = `/organizations/${organizationId}`;
    const before = await owner.from('organizations').select('operational_state').eq('id', organizationId).single();
    expect(before.data?.operational_state).toBe('setup');

    // Home remains the canonical organization entry; Settings offers the setup journey.
    await page.goto(root);
    await expect(page).toHaveURL(`${root}/home`);
    await page.goto(`${root}/settings`);
    await page.getByRole('link', { name: 'Continue organization setup', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Set up your organization', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Setup steps' })).toBeVisible();
    await page.goto(`${root}/setup?step=review`);
    await expect(page.getByText('This organization is ready to operate.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Work items', exact: true })).toHaveAttribute('href', `${root}/work/configuration`);

    // Visiting an operating workspace neither launches nor traps a setup organization.
    await page.goto(`${root}/home`);
    const stillSetup = await owner.from('organizations').select('operational_state').eq('id', organizationId).single();
    expect(stillSetup.data?.operational_state).toBe('setup');
    await page.goto(`${root}/setup?step=review`);
    await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
    await page.getByRole('button', { name: 'Launch organization', exact: true }).click();
    await expect(page).toHaveURL(`${root}/home`);

    await page.goto(`${root}/settings`);
    await page.getByRole('link', { name: 'Review readiness', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Organization setup', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Finish setup', exact: true })).toHaveCount(0);
    await page.goto(root);
    await expect(page).toHaveURL(`${root}/home`);
  });
}

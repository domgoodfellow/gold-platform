import { test, expect, type Locator } from '@playwright/test';
import { loadDemoContext, COLLEAGUE_STORAGE_STATE, OWNER_STORAGE_STATE } from './helpers';
import { restoreDemoRoles } from './restore-demo-roles';

// These specs reassign the demo members' roles. Restore them after every test, pass or fail, so one failure cannot demote the owner for every spec that follows.
test.afterEach(async () => { await restoreDemoRoles(); });

/**
 * Two known P0 gaps: `assignRole` and `revokePortalInvite`
 * existed in the domain layer, tested, with no screen that reached either. This proves both are
 * now reachable and usable through the rendered application — not a re-proof of `assign_role`'s
 * own invariant or `revokePortalInvite`'s own refusal, which `tests/integration/database/roles.test.ts` and
 * `tests/integration/database/portal.test.ts` already hold against real Postgres/RLS.
 *
 * Fixture names below come straight from `scripts/demo/businesses.ts`'s `GRACHTWERK` business —
 * the owner ("Sanne de Vries") holds the founding role and is its only `role.manage` holder; the
 * colleague ("Joris Bakker") holds a reduced role with neither `role.manage` nor
 * `customer.create`, added by `run.ts` specifically so a capability boundary is something to
 * look at rather than read about.
 */

async function optionValue(select: Locator, label: string): Promise<string> {
  const value = await select.locator('option', { hasText: label }).getAttribute('value');
  if (!value) throw new Error(`No <option> labelled "${label}" in this select.`);
  return value;
}

test.describe('People & Roles — reassigning an existing member', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('changes a member to another configured role, and the change persists', async ({
    page,
  }) => {
    const ctx = loadDemoContext();
    await page.goto(`/organizations/${ctx.organizationId}/settings/access/members`);

    const row = page.getByRole('row', { name: 'Joris Bakker' });
    await expect(row).toBeVisible();
    const select = row.getByRole('combobox', { name: 'Role' });
    await expect(select).toHaveValue(await optionValue(select, 'Werfmedewerker'));

    await select.selectOption({ label: 'Admin' });
    await expect(select).toHaveValue(await optionValue(select, 'Admin'));
    await expect(row.getByRole('alert')).toHaveCount(0);

    // Reload from a clean navigation, proving the change was written, not only reflected
    // optimistically in this one client.
    await page.reload();
    const reloadedRow = page.getByRole('row', { name: 'Joris Bakker' });
    const reloadedSelect = reloadedRow.getByRole('combobox', { name: 'Role' });
    await expect(reloadedSelect).toHaveValue(await optionValue(reloadedSelect, 'Admin'));

    // Leave the fixture as it was found — this demo data persists between runs.
    await reloadedSelect.selectOption({ label: 'Werfmedewerker' });
    await expect(reloadedSelect).toHaveValue(await optionValue(reloadedSelect, 'Werfmedewerker'));
    await expect(reloadedRow.getByRole('alert')).toHaveCount(0);
  });

  test('refuses to leave nobody who can manage roles, and reverts the control', async ({
    page,
  }) => {
    const ctx = loadDemoContext();
    await page.goto(`/organizations/${ctx.organizationId}/settings/access/members`);

    const row = page.getByRole('row', { name: 'Sanne de Vries' });
    await expect(row).toBeVisible();
    const select = row.getByRole('combobox', { name: 'Role' });
    const adminValue = await optionValue(select, 'Admin');
    await expect(select).toHaveValue(adminValue);

    // Sanne is the organization's only role.manage holder — moving her off Admin would leave
    // nobody who can manage roles, which `assign_role` refuses as a cross-row invariant.
    await select.selectOption({ label: 'Werfmedewerker' });

    await expect(row.getByText('That would leave nobody able to manage roles here.')).toBeVisible();
    // The control shows what is actually still assigned, not the rejected choice.
    await expect(select).toHaveValue(adminValue);
  });
});

test.describe('People & Roles — a caller without role.manage', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });

  test('sees roles as labels, never as an editable control', async ({ page }) => {
    const ctx = loadDemoContext();
    await page.goto(`/organizations/${ctx.organizationId}/settings/access/members`);

    await expect(page.getByRole('combobox', { name: 'Role' })).toHaveCount(0);
    const row = page.getByRole('row', { name: 'Joris Bakker' });
    await expect(row.getByText('Werfmedewerker')).toBeVisible();
  });
});

test.describe('Customer Portal — making and revoking a link', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('makes a portal link, then revokes it into history', async ({ page }) => {
    const ctx = loadDemoContext();
    await page.goto(`/organizations/${ctx.organizationId}/customers/${ctx.customerId}`);

    await page.getByRole('button', { name: 'Make a portal link' }).click();

    const createdLink = page.getByLabel('Send this to the customer. Anyone holding it is them.');
    await expect(createdLink).toBeVisible();
    const link = await createdLink.inputValue();
    expect(link).toContain('/portal/');

    // `PortalInviteList` orders Active newest first (`listPortalInvites`'s own order), so the
    // link just made is the first row under the Active heading — found by DOM adjacency
    // (`GroupHeading` immediately followed by its `DividedList`) rather than by searching for
    // its value, which Playwright has no built-in matcher for.
    const activeList = page.locator('h3:has-text("Active") + ul');
    await expect(activeList).toBeVisible();
    const newestActiveRow = activeList.locator('li').first();
    await expect(newestActiveRow.getByRole('textbox')).toHaveValue(link);

    await newestActiveRow.getByRole('button', { name: 'Revoke' }).click();

    // The link stops being offered as active — the operator can no longer act on it — and the
    // customer's history shows it existed and was withdrawn, rather than disappearing.
    await expect(page.getByRole('heading', { name: 'Withdrawn' })).toBeVisible();
    const withdrawnList = page.locator('h3:has-text("Withdrawn") + ul');
    await expect(withdrawnList.locator('li').first()).toContainText('withdrawn');
  });
});

test.describe('Customer Portal — a caller without customer.create', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });

  test('sees why, not a way to manage portal access', async ({ page }) => {
    const ctx = loadDemoContext();
    await page.goto(`/organizations/${ctx.organizationId}/customers/${ctx.customerId}`);

    await expect(page.getByRole('button', { name: 'Make a portal link' })).toHaveCount(0);
    await expect(
      page.getByText("cannot manage this customer's portal access", { exact: false }),
    ).toBeVisible();
  });
});

import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loadDemoContext, OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE } from './helpers';
import { chooseOption } from './select-field';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { listMembers } from '../lib/domain/tenancy/members';
import { updateRoleCapabilities } from '../lib/domain/tenancy/roles';
import { inviteMember, listPendingInvitations, revokeInvitation } from '../lib/domain/tenancy/invitations';

test.describe('canonical Settings routes', () => {
  test.setTimeout(90_000);
  test.use({ storageState: OWNER_STORAGE_STATE });

  for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    test(`every Settings destination is reached from the sidebar at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const { organizationId } = loadDemoContext();
      const root = `/organizations/${organizationId}/settings`;
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));

      // Settings has no landing page: it opens on the first destination the member may use.
      await page.goto(root);
      await expect(page).toHaveURL(`${root}/general`);
      await expect(page.getByRole('heading', { level: 1, name: 'General', exact: true })).toBeVisible();

      const open = async (name: string) => {
        if (viewport.width < 768) await page.getByRole('button', { name: 'Menu', exact: true }).click();
        await page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name, exact: true }).click();
      };
      for (const [name, path, heading] of [
        ['Members', 'access/members', 'Members'],
        ['Invitations', 'access/invitations', 'Invitations'],
        ['Roles & permissions', 'access/roles', 'Roles & permissions'],
        ['Access history', 'access/history', 'Access history'],
        ['Connections', 'connections', 'Connections'],
        ['Plan & usage', 'plan', 'Plan & usage'],
        ['Branding', 'branding', 'Branding'],
      ] as const) {
        await open(name);
        await expect(page).toHaveURL(`${root}/${path}`);
        await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible();
        // Access pages are sidebar destinations; no tab strip repeats them.
        await expect(page.getByRole('navigation', { name: 'Access views' })).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
      await page.screenshot({ path: testInfo.outputPath(`settings-${viewport.width}.png`), fullPage: true });

      // Connections keeps its own sibling views, and the business's credentials stay beside them.
      await page.goto(`${root}/connections`);
      await page.getByRole('link', { name: 'Secrets & credentials', exact: true }).click();
      await expect(page).toHaveURL(`${root}/secrets`);

      // Account is the person's own, reached from the same sidebar.
      await open('Security & sign-in');
      await expect(page.getByLabel('Current password', { exact: true })).toBeVisible();
      await page.getByLabel('Current password', { exact: true }).fill('incorrect password');
      await page.getByLabel('New password', { exact: true }).fill('a candidate password never installed');
      await page.getByLabel('Confirm new password', { exact: true }).fill('a candidate password never installed');
      await page.getByRole('button', { name: 'Change password', exact: true }).click();
      await expect(page.getByRole('alert').filter({ hasText: 'Your current password is incorrect.' })).toContainText('Your current password is incorrect.');
      expect(errors).toEqual([]);
    });

    test(`a role suggestion can be reviewed, saved, changed and deleted at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const { organizationId } = loadDemoContext();
      const root = `/organizations/${organizationId}/settings`;
      await page.goto(`${root}/general`);
      const previousIndustry = await page.getByLabel('Industry').inputValue();
      await page.getByLabel('Industry').fill('Professional services');
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Business profile saved' })).toBeVisible();

      await page.goto(`${root}/access/roles/new`);
      await chooseOption(page.getByLabel('Start from', { exact: true }), { label: /suggested for/ });
      await expect(page.getByLabel('Name', { exact: true })).not.toHaveValue('');
      const name = `Access review ${viewport.width}`;
      await page.getByLabel('Name', { exact: true }).fill(name);
      await page.getByRole('searchbox', { name: 'Search permissions' }).fill('contacts');
      await page.getByRole('checkbox', { name: 'Add contacts', exact: true }).check();
      await page.getByRole('checkbox', { name: 'Edit contacts and move them between relationship stages', exact: true }).check();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`new-role-${viewport.width}.png`), fullPage: true });
      await page.getByRole('button', { name: 'Create role', exact: true }).click();
      await expect(page).toHaveURL(`${root}/access/roles`);
      await expect(page.getByText('Role created', { exact: true })).toBeVisible();
      await page.getByRole('link', { name, exact: true }).click();
      await expect(page.getByRole('checkbox', { name: 'Add contacts', exact: true })).toBeChecked();
      await page.getByRole('checkbox', { name: 'Add contacts', exact: true }).uncheck();
      page.once('dialog', (dialog) => dialog.dismiss());
      await page.getByRole('link', { name: 'Cancel', exact: true }).click();
      await expect(page.getByLabel('Name', { exact: true })).toHaveValue(name);
      await page.getByRole('button', { name: 'Save role', exact: true }).click();
      await expect(page.getByText('Role saved', { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('checkbox', { name: 'Add contacts', exact: true })).not.toBeChecked();
      await expect(page.getByRole('button', { name: 'Save role', exact: true })).toBeDisabled();
      await page.getByRole('button', { name: 'Delete role', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete role', exact: true }).click();
      await expect(page).toHaveURL(`${root}/access/roles`);
      await expect(page.getByText('Role deleted', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
      await page.goto(`${root}/access/history`);
      await expect(page.getByText(`Deleted the role ${name}`, { exact: true }).filter({ visible: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (viewport.width >= 768) {
        expect(await page.locator('[data-slot="table-container"]').filter({ visible: true }).evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      }
      await page.screenshot({ path: testInfo.outputPath(`access-history-${viewport.width}.png`), fullPage: true });

      await page.goto(`${root}/general`);
      await page.getByLabel('Industry').fill(previousIndustry);
      await page.getByRole('button', { name: 'Save changes', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Business profile saved' })).toBeVisible();
    });
  }

  test('legacy organization URLs redirect directly to canonical Settings destinations', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    for (const [legacy, canonical] of [
      ['pricing', 'finance/catalog'],
      ['fields', 'crm/configuration/fields'],
      ['roles?view=roles', 'settings/access/roles'],
      ['integrations?view=browse', 'settings/connections?catalog=open'],
    ] as const) {
      // Some addresses pass through more than one redirect; wait for the last one to settle before
      // the next address, or the next navigation interrupts it.
      await page.goto(`/organizations/${organizationId}/${legacy}`);
      await expect(page).toHaveURL(`/organizations/${organizationId}/${canonical}`);
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveURL(`/organizations/${organizationId}/${canonical}`);
    }
  });

  test('a personal Account page names Settings in the bar and itself once, as its title', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/settings/account/security?org=${organizationId}`);
    const trail = page.getByRole('navigation', { name: 'breadcrumb' });
    await expect(trail.getByText('Settings', { exact: true })).toBeVisible();
    // The bar names the section; the page title is the one statement of the page (ADR-047).
    await expect(trail.getByText('Security & sign-in', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Security & sign-in', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Security & sign-in', exact: true })).toHaveAttribute('aria-current', 'page');
  });
});

test.describe('a role manager can only give permissions they hold', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });
  test('limits permission checkboxes, role assignments, invitations and resends', async ({ page }) => {
    const { organizationId, ownerEmail } = loadDemoContext();
    const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const login = await db.auth.signInWithPassword({ email: ownerEmail, password: DEMO_PASSWORD });
    if (login.error) throw login.error;
    const members = await listMembers(db, { organizationId });
    const colleague = members.find((member) => member.userId !== login.data.user.id)!;
    const admin = members.find((member) => member.userId === login.data.user.id)!;
    const email = `higher-role-${Date.now()}@example.test`;
    let invitationId: string | undefined;
    try {
      await updateRoleCapabilities(db, { roleId: colleague.role.id, name: colleague.role.name, capabilities: ['role.manage', 'customer.create'] });
      await inviteMember(db, { organizationId, email, roleId: admin.role.id });
      invitationId = (await listPendingInvitations(db, { organizationId })).find((invitation) => invitation.email === email)!.id;
      const root = `/organizations/${organizationId}/settings/access`;
      await page.goto(`${root}/roles/new`);
      await expect(page.getByRole('checkbox', { name: 'Add contacts', exact: true })).toBeEnabled();
      await expect(page.getByRole('checkbox', { name: 'Edit contacts and move them between relationship stages', exact: true })).toBeDisabled();
      await chooseOption(page.getByLabel('Start from', { exact: true }), { label: 'Administrator' });
      await expect(page.getByRole('checkbox', { name: 'Add contacts', exact: true })).toBeChecked();
      await expect(page.getByRole('checkbox', { name: 'Edit contacts and move them between relationship stages', exact: true })).not.toBeChecked();
      // Discard this unsaved starting point before the next navigation.
      await chooseOption(page.getByLabel('Start from', { exact: true }), { label: 'Nothing ticked' });
      await page.goto(`${root}/members`);
      const role = page.getByRole('combobox', { name: `Role for ${colleague.displayName}`, exact: true });
      await role.click();
      await expect(page.getByRole('option', { name: 'Admin', exact: true })).toHaveAttribute('aria-disabled', 'true');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Add member', exact: true }).click();
      await page.getByRole('dialog').getByRole('combobox', { name: 'Role', exact: true }).click();
      await expect(page.getByRole('option', { name: 'Admin', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await page.goto(`${root}/invitations`);
      const invitation = page.getByRole('row').filter({ hasText: email });
      await expect(invitation.getByText('Resending requires all permissions in this role.')).toBeVisible();
      await expect(invitation.getByRole('button', { name: 'Resend', exact: true })).toHaveCount(0);
      await page.goto(`${root}/history`);
      await expect(page.getByText(`Invited ${email} as Admin`, { exact: true }).filter({ visible: true })).toBeVisible();
    } finally {
      if (invitationId) await revokeInvitation(db, { id: invitationId });
      await updateRoleCapabilities(db, { roleId: colleague.role.id, name: colleague.role.name, capabilities: colleague.role.capabilities });
    }
  });
});

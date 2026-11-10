import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { COLLEAGUE_STORAGE_STATE, loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

test('organization Connect accounts retain their scope, health and accessible layout across workspaces', async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  const { organizationId, ownerEmail } = loadDemoContext();
  const base = `/organizations/${organizationId}`;
  const databaseUrl = process.env.SUPABASE_DB_URL!;
  if (!['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)) throw new Error('Local fixtures only.');
  const pg = new Client(databaseUrl);
  await pg.connect();
  const accountIds: string[] = [];
  try {
    await page.goto(`${base}/comms`);
    const trigger = page.getByRole('button', { name: /^Connect(?:\.|$)/ });
    await trigger.click();
    await expect(page.getByText('No connected accounts.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage connections', exact: true })).toHaveAttribute('href', `${base}/settings/connections`);
    await page.keyboard.press('Escape');
    const owner = (await pg.query<{ id: string }>('select id from auth.users where email=$1', [ownerEmail])).rows[0];
    // Stored metadata only: no vendor credential, OAuth grant or provider request is manufactured.
    for (const [connector, label, status] of [
      ['google_workspace', 'Browser fixture Google account', 'active'],
      ['microsoft_365', 'Browser fixture Microsoft account with a deliberately long organization label', 'needs_attention'],
    ]) {
      const made = await pg.query<{ id: string }>('insert into integration_connections(organization_id,connector_key,account_label,status,connected_by) values($1,$2,$3,$4,$5) returning id', [organizationId, connector, label, status, owner.id]);
      accountIds.push(made.rows[0].id);
    }
    await pg.query("insert into integration_resources(organization_id,connection_id,resource_type,display_name,external_id,status) values($1,$2,'google_sheet','Browser fixture leads sheet','fixture-spreadsheet','active')", [organizationId, accountIds[0]]);

    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${base}/crm/contacts`);
      await expect(trigger).toHaveAccessibleName('Connect. 1 account needs attention.');
      await trigger.focus();
      await page.keyboard.press('Enter');
      const popover = page.getByRole('dialog', { name: 'Connections', exact: true });
      await expect(popover.getByText('Relevant to CRM', { exact: true })).toBeVisible();
      await expect(popover.getByText('Other accounts', { exact: true })).toBeVisible();
      await expect(popover.getByText('Needs attention', { exact: true })).toBeVisible();
      await expect(popover.getByRole('link', { name: /^Browser fixture Google/ })).toHaveAttribute('href', `${base}/settings/connections/${accountIds[0]}`);
      await expect(popover.getByRole('link', { name: 'Browse apps', exact: true })).toHaveAttribute('href', `${base}/settings/connections?catalog=open&workspace=crm#app-library`);
      await expect(popover.getByRole('link', { name: /^Reconnect/ })).toHaveCount(0);
      await expect.poll(async () => {
        const rect = await popover.boundingBox();
        return !!rect && rect.x >= 0 && rect.x + rect.width <= width && rect.y >= 0 && rect.y + rect.height <= 900;
      }).toBe(true);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`connect-${width}.png`), fullPage: true });
      await page.keyboard.press('Escape');
      await expect(popover).toHaveCount(0);
      await expect(trigger).toBeFocused();

      await page.goto(`${base}/crm/contacts?import=1&connection=${accountIds[0]}`);
      const importer = page.getByRole('dialog', { name: 'Import contacts', exact: true });
      await expect(importer.getByRole('combobox', { name: 'Spreadsheet', exact: true })).toContainText('Browser fixture leads sheet');
      await expect(importer.getByRole('textbox', { name: 'Range', exact: true })).toBeVisible();
      await expect(importer.getByRole('button', { name: 'Continue to mapping' })).toBeVisible();
      await expect(importer.getByRole('link', { name: /^Connect / })).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`contact-import-${width}.png`), fullPage: true });
      await page.keyboard.press('Escape');
      await expect(importer).toBeHidden();
    }

    await page.goto(`${base}/comms`);
    await trigger.click();
    const popover = page.getByRole('dialog', { name: 'Connections', exact: true });
    await expect(popover.getByText('Relevant to Communications', { exact: true })).toBeVisible();
    await expect(popover.getByText('Other accounts', { exact: true })).toHaveCount(0);
    await pg.query("update integration_connections set status='active' where id=$1", [accountIds[1]]);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(trigger).toHaveAccessibleName('Connect');
    await expect(popover.getByText('Connected', { exact: true })).toHaveCount(2);
    await popover.getByRole('link', { name: 'Manage connections', exact: true }).click();
    await expect(page).toHaveURL(`${base}/settings/connections`);
    await page.goBack();
    await expect(page).toHaveURL(`${base}/comms`);

    const denied = await browser.newContext({ storageState: COLLEAGUE_STORAGE_STATE });
    try {
      const member = await denied.newPage();
      await member.goto(`${base}/crm/contacts?import=1`);
      await expect(member.getByRole('dialog', { name: 'Import contacts', exact: true })).toHaveCount(0);
      await expect(member.getByRole('button', { name: /^Connect(?:\.|$)/ })).toHaveCount(0);
      expect(await member.content()).not.toContain('Browser fixture Google account');
      expect(await member.content()).not.toContain('Browser fixture Microsoft account');
    } finally { await denied.close(); }
  } finally {
    await pg.query('delete from integration_resources where organization_id=$1 and connection_id=any($2::uuid[])', [organizationId, accountIds]);
    await pg.query('delete from integration_connections where organization_id=$1 and id=any($2::uuid[])', [organizationId, accountIds]);
    await pg.end();
  }
});

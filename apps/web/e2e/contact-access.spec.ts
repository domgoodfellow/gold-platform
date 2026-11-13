import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Database } from '../lib/db/types';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { createContact } from '../lib/domain/contacts/contacts';
import { createTask } from '../lib/domain/tasks/tasks';
import { createRole, updateRoleCapabilities } from '../lib/domain/tenancy/roles';
import { addMember } from '../lib/domain/tenancy/members';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';

test.use({ storageState: { cookies: [], origins: [] }, hasTouch: true });

/**
 * Who may view, add, edit and delete contacts, and take people off the call list, as each kind of
 * member actually meets it in the browser: what is offered, what is refused when addressed
 * directly, and that removing a permission changes what the person can reach.
 */
test('contact permissions: each role sees and does only what it holds, and deletion keeps what must be kept', async ({ page, browser }, testInfo) => {
  test.setTimeout(420_000);
  config({ path: path.join(__dirname, '../../..', '.env.test'), quiet: true });
  const url = process.env.SUPABASE_URL!;
  const connection = process.env.SUPABASE_DB_URL!;
  if (![url, connection].every(value => ['localhost', '127.0.0.1'].includes(new URL(value).hostname))) throw new Error('Disposable loopback fixtures only');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
  const person = async (label: string) => {
    const email = `access-${label}-${randomUUID()}@example.test`, password = randomUUID();
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (made.error) throw made.error;
    const db = createClient<Database>(url, process.env.SUPABASE_ANON_KEY!, options);
    const login = await db.auth.signInWithPassword({ email, password }); if (login.error) throw login.error;
    return { email, password, db, id: made.data.user.id };
  };
  const signIn = async (target: Page, who: { email: string; password: string }) => {
    await target.goto('/login'); await target.getByLabel('Email', { exact: true }).fill(who.email); await target.getByLabel('Password', { exact: true }).fill(who.password);
    await target.getByRole('button', { name: 'Log in', exact: true }).click(); await target.waitForURL(value => value.pathname !== '/login');
  };
  const as = async (b: Browser, who: { email: string; password: string }, width = 1440) => {
    const context = await b.newContext({ storageState: { cookies: [], origins: [] }, hasTouch: true, viewport: { width, height: width === 390 ? 844 : 1000 } });
    const tab = await context.newPage(); await signIn(tab, who); return tab;
  };
  const fitsWidth = (target: Page) => target.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
  const notFound = (target: Page) => expect(target.getByText('This page does not exist')).toBeVisible();

  const pg = new Client(connection); await pg.connect();
  const [owner, outsider, viewer, creator, editor, caller, tasker, remover] = await Promise.all(['owner', 'outsider', 'viewer', 'creator', 'editor', 'caller', 'tasker', 'remover'].map(person));
  try {
    await pg.query('insert into platform_staff(user_id,name) values($1,$2),($3,$4)', [owner.id, 'Local access fixture', outsider.id, 'Local access fixture']);
    const organizationId = await provisionOrganization(owner.db, { ownerEmail: owner.email, name: 'Contact access business', currency: 'CAD' });
    const otherOrg = await provisionOrganization(outsider.db, { ownerEmail: outsider.email, name: 'Another business', currency: 'CAD' });
    await pg.query('delete from platform_staff where user_id = any($1)', [[owner.id, outsider.id]]);
    await setModuleEnabled(owner.db, { organizationId, key: 'reception', enabled: true });
    await pg.query("insert into organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note) values($1,'module:reception','2020-01-01','9999-12-31',1,0,'CAD',$2,'Local contact access fixture')", [organizationId, owner.id]);
    const lena = await createContact(owner.db, { organizationId, name: 'Listed Lena', phone: '+14165550301', contactType: 'person' });
    const kai = await createContact(owner.db, { organizationId, name: 'Kept Kai', email: 'kai@example.test', contactType: 'person' });
    const pia = await createContact(owner.db, { organizationId, name: 'Plain Pia', contactType: 'person' });
    await createContact(outsider.db, { organizationId: otherOrg, name: 'Foreign Fay' });
    await createTask(owner.db, { organizationId, customerId: lena, kind: 'call', title: 'Renewal call', dueAt: new Date().toISOString() });
    await createTask(owner.db, { organizationId, customerId: kai, kind: 'email', title: 'Send quote', dueAt: new Date().toISOString() });
    const role = (name: string, capabilities: string[]) => createRole(owner.db, { organizationId, name, capabilities });
    const roles = {
      viewer: await role('Contact viewer', ['customer.read']),
      creator: await role('Adds contacts', ['customer.create']),
      editor: await role('Contact editor', ['customer.read', 'customer.update']),
      caller: await role('Caller', ['call.place', 'follow_up.manage', 'message.send']),
      tasker: await role('Task manager', ['customer.read', 'follow_up.manage', 'call.place']),
      remover: await role('Call list keeper', ['customer.read', 'follow_up.manage', 'call.place', 'call_list.remove']),
    };
    for (const [key, who] of [['viewer', viewer], ['creator', creator], ['editor', editor], ['caller', caller], ['tasker', tasker], ['remover', remover]] as const) {
      await addMember(owner.db, { organizationId, email: who.email, roleId: roles[key] });
    }
    const base = `/organizations/${organizationId}`;

    // Administrator: Archive, Restore and Delete permanently, at every width.
    await signIn(page, owner);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(`${base}/crm/contacts/${kai}`);
      await page.getByRole('button', { name: 'More actions for Kept Kai', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Delete permanently', exact: true }).click();
      const blocked = page.getByRole('alertdialog', { name: 'Kept Kai can’t be deleted' });
      await expect(blocked.getByRole('list', { name: 'Records that must be kept' })).toContainText('Tasks, including calls on the call list');
      await expect(blocked.getByRole('button', { name: 'Delete permanently' })).toHaveCount(0);
      expect(await fitsWidth(page)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`delete-blocked-${width}.png`) });
      await blocked.getByRole('button', { name: 'Close', exact: true }).click();
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'More actions for Kept Kai', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Archive contact', exact: true }).click();
    const archive = page.getByRole('alertdialog', { name: 'Archive Kept Kai?' });
    await page.screenshot({ path: testInfo.outputPath('archive-confirm-1440.png') });
    await archive.getByRole('button', { name: 'Archive contact', exact: true }).click();
    await expect(page.getByText('Archived Kept Kai.')).toBeVisible();
    await expect(page.getByText('Archived', { exact: true })).toBeVisible();
    await page.goto(`${base}/crm/contacts?q=Kai`);
    await expect(page.getByRole('link', { name: 'Kept Kai' })).toHaveCount(0);
    await page.goto(`${base}/crm/contacts?q=Kai&archived=1`);
    await expect(page.getByRole('link', { name: 'Kept Kai' }).first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('archived-filter-1440.png') });
    await page.goto(`${base}/crm/contacts/${kai}`);
    await page.getByRole('button', { name: 'More actions for Kept Kai', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Restore contact', exact: true }).click();
    await page.getByRole('alertdialog', { name: 'Restore Kept Kai?' }).getByRole('button', { name: 'Restore contact', exact: true }).click();
    await expect(page.getByText('Restored Kept Kai.')).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/crm/contacts/${pia}`);
    await page.getByRole('button', { name: 'More actions for Plain Pia', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Delete permanently', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete Plain Pia permanently?' });
    await page.screenshot({ path: testInfo.outputPath('delete-confirm-390.png') });
    await confirm.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await expect(page.getByText('Deleted Plain Pia.')).toBeVisible();
    await page.waitForURL(value => value.pathname === `${base}/crm/contacts`);
    expect((await pg.query('select id from contacts where id = $1', [pia])).rows).toEqual([]);
    expect((await pg.query("select actor_id from events where entity_id = $1 and action = 'customer.deleted'", [pia])).rows).toEqual([{ actor_id: owner.id }]);
    expect((await pg.query("select status from crm_tasks where customer_id = $1", [kai])).rows).toEqual([{ status: 'open' }]);

    // Viewer and editor: see contacts; neither is offered archive or delete; only the editor edits.
    const viewing = await as(browser, viewer);
    await viewing.goto(`${base}/crm/contacts/${lena}`);
    await expect(viewing.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
    await expect(viewing.getByRole('button', { name: 'More actions for Listed Lena' })).toHaveCount(0);
    const editing = await as(browser, editor, 768);
    await editing.goto(`${base}/crm/contacts/${lena}`);
    await expect(editing.getByRole('button', { name: /^Edit/ }).first()).toBeVisible();
    await expect(editing.getByRole('button', { name: 'More actions for Listed Lena' })).toHaveCount(0);
    await editing.screenshot({ path: testInfo.outputPath('editor-768.png') });

    // Adds contacts without viewing them: no Contacts in navigation or by address; adds from CRM Home.
    const adding = await as(browser, creator);
    await adding.goto(`${base}/crm`);
    await expect(adding.getByRole('link', { name: 'Contacts', exact: true })).toHaveCount(0);
    await adding.goto(`${base}/crm/contacts`); await notFound(adding);
    await adding.goto(`${base}/crm/contacts/${lena}`); await notFound(adding);
    await adding.goto(`${base}/crm?create=1`);
    const intake = adding.getByRole('dialog');
    await intake.getByRole('radio', { name: /Person/ }).check({ force: true });
    await intake.getByLabel('Name', { exact: true }).fill('Blind Bea');
    await intake.getByRole('button', { name: 'Save contact', exact: true }).click();
    await expect(adding.getByRole('dialog', { name: 'Contact added' })).toBeVisible();
    await expect(adding.getByRole('link', { name: 'View contact' })).toHaveCount(0);
    await adding.screenshot({ path: testInfo.outputPath('creator-added-1440.png') });

    // Places calls without viewing contacts: the call list shows who and the number, nothing more.
    const calling = await as(browser, caller, 390);
    await calling.goto(`${base}/crm/contacts`); await notFound(calling);
    await calling.goto(`${base}/calls`);
    const switcher = calling.getByRole('group', { name: 'Dialer region' });
    const entry = calling.getByRole('button', { name: /Listed Lena.*Renewal call/ });
    await expect(async () => {
      if (await switcher.isVisible()) await switcher.getByRole('button', { name: 'Call list', exact: true }).click();
      await expect(entry).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(calling.getByRole('button', { name: 'Add to list', exact: true })).toHaveCount(0);
    await expect(calling.getByRole('button', { name: 'Actions for Listed Lena' })).toHaveCount(0);
    await expect(calling.getByRole('link', { name: 'Open contact' })).toHaveCount(0);
    expect(await fitsWidth(calling)).toBe(true);
    await calling.screenshot({ path: testInfo.outputPath('caller-dialer-390.png') });

    // Manages tasks but may not take people off the call list; then one who may.
    const tasking = await as(browser, tasker);
    await tasking.goto(`${base}/calls`);
    await expect(tasking.getByRole('button', { name: /Listed Lena.*Renewal call/ })).toBeVisible();
    await expect(tasking.getByRole('button', { name: 'Actions for Listed Lena' })).toHaveCount(0);
    const keeping = await as(browser, remover, 768);
    await keeping.goto(`${base}/calls`);
    const actions = keeping.getByRole('button', { name: 'Actions for Listed Lena', exact: true });
    const keeperSwitch = keeping.getByRole('group', { name: 'Dialer region' });
    await expect(async () => {
      if (await keeperSwitch.isVisible()) await keeperSwitch.getByRole('button', { name: 'Call list', exact: true }).click();
      await expect(actions).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await actions.click();
    await keeping.getByRole('menuitem', { name: 'Remove from list', exact: true }).click();
    await keeping.getByRole('alertdialog', { name: 'Remove Listed Lena from the call list?' }).getByRole('button', { name: 'Remove from list', exact: true }).click();
    await expect(keeping.getByText('Removed Listed Lena from the call list.')).toBeVisible();
    expect((await pg.query("select t.status, c.name from crm_tasks t join contacts c on c.id = t.customer_id where t.customer_id = $1 and t.kind = 'call'", [lena])).rows).toEqual([{ status: 'cancelled', name: 'Listed Lena' }]);

    // Another business's owner cannot open this business's contact.
    const foreign = await as(browser, outsider);
    await foreign.goto(`${base}/crm/contacts/${lena}`);
    await expect(foreign.getByText('This business is not available')).toBeVisible();

    // Taking View contacts away changes what the person can reach on the next page.
    await viewing.goto(`${base}/crm/contacts`);
    await expect(viewing.getByRole('link', { name: 'Listed Lena' }).first()).toBeVisible();
    await updateRoleCapabilities(owner.db, { roleId: roles.viewer, name: 'Contact viewer', capabilities: [] });
    await viewing.goto(`${base}/crm/contacts`); await notFound(viewing);
    await viewing.goto(`${base}/crm/contacts/${lena}`); await notFound(viewing);
  } finally {
    await pg.end();
  }
});

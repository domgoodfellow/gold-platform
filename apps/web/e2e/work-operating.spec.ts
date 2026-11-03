import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { loadDemoContext, OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { createCustomer } from '../lib/domain/customers/customers';
import { createLocation } from '../lib/domain/locations/locations';
import { createWorkItemType } from '../lib/domain/work-items/types';
import { createWorkItemStatus } from '../lib/domain/work-items/statuses';
import { createWorkItem } from '../lib/domain/work-items/work-items';
import { createResource } from '../lib/domain/resources/resources';
import { createResourceRequirement } from '../lib/domain/work-items/requirements';
import { scheduleWorkItem } from '../lib/domain/scheduling/schedule';
import { createRole } from '../lib/domain/tenancy/roles';
import { addMember } from '../lib/domain/tenancy/members';
import { BUSINESSES } from '../scripts/demo/businesses';
import { addOperatingHours } from '../lib/domain/scheduling/operating-hours';
import { todayInZone, zonedTimeToInstant } from '../lib/domain/scheduling/window';
import { chooseOption, selectFieldValue } from './select-field';

async function capture(page: Page, file: string) {
  // Expand only the shell's scroll frame for a full-content artifact; restore before interacting.
  const style = await page.addStyleTag({ content: '[data-slot="sidebar-wrapper"] { height: auto !important; overflow: visible !important; } [data-slot="sidebar-inset"] { overflow: visible !important; }' });
  await page.screenshot({ path: file, fullPage: true, caret: 'hide' });
  await style.evaluate(el => el.parentNode?.removeChild(el));
}

test.describe('Work operating journey', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });
  test('configures, creates, dispatches, reschedules and checks operational consistency', async ({ page }, testInfo) => {
    test.setTimeout(300000);
    loadEnv({ path: path.join(__dirname, '../../..', '.env.test') });
    const url = process.env.SUPABASE_URL!;
    if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Work fixtures are local only.');
    const opts = { auth: { persistSession: false, autoRefreshToken: false } };
    const staff = createClient(url, process.env.SUPABASE_ANON_KEY!, opts);
    const owner = createClient(url, process.env.SUPABASE_ANON_KEY!, opts);
    for (const [db, email] of [[staff, 'staff@gold.test'], [owner, loadDemoContext().ownerEmail]] as const) {
      const { error } = await db.auth.signInWithPassword({ email, password: DEMO_PASSWORD }); if (error) throw error;
    }
    const organizationId = await provisionOrganization(staff, { ownerEmail: loadDemoContext().ownerEmail, name: `Work acceptance ${Date.now()}`, displayName: 'Work owner', currency: 'CAD', timezone: 'America/Toronto' });
    const base = `/organizations/${organizationId}`;
    const today = todayInZone('America/Toronto');
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${base}/field`);
    await expect(page.getByRole('region', { name: 'Today', exact: true })).toContainText('No committed work');
    await testInfo.attach('operating-context', { body: JSON.stringify({ organizationId, base, today }), contentType: 'application/json' });
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await capture(page, testInfo.outputPath(`work-empty-${width}.png`));
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    // A business with only one Work door (nothing scheduled yet is entitled) gets a named link; one with several gets a menu.
    const configure = page.getByRole('button', { name: 'Configure' });
    if (await configure.count()) {
      await configure.click();
      await page.getByRole('menuitem', { name: 'Work types & workflow' }).click();
    } else {
      await page.getByRole('link', { name: 'Work types & workflow' }).click();
    }
    await page.getByLabel('Type name', { exact: true }).fill('Service visit');
    await page.getByRole('radio', { name: /^Scheduled/ }).check();
    await page.getByRole('button', { name: 'Add type', exact: true }).click();
    await expect(page.getByRole('navigation', { name: 'Kind of work' })).toContainText('Service visit');
    await page.getByRole('tab', { name: 'Workflow', exact: true }).click();
    for (const name of ['Ready', 'Working']) {
      await page.getByLabel('Status name', { exact: true }).fill(name);
      await page.getByRole('button', { name: 'Add status', exact: true }).click();
      await expect(page.getByLabel('Status name', { exact: true })).toHaveValue('');
    }
    await chooseOption(page.getByLabel('Move from', { exact: true }), { label: 'Ready' });
    await chooseOption(page.getByLabel('Move to', { exact: true }), { label: 'Working' });
    await page.getByRole('button', { name: 'Allow move', exact: true }).click();
    await expect(page.getByText('Ready → Working', { exact: true })).toBeVisible();
    const type = (await owner.from('work_item_types').select('id').eq('organization_id', organizationId).single()).data!;
    const statuses = (await owner.from('work_item_statuses').select('id,name').eq('type_id', type.id)).data!;
    const ready = statuses.find(s => s.name === 'Ready')!;
    await page.goto(`${base}/resources`);
    for (const [name, resourceClass] of [['Alex Smith', 'person'], ['Service Van', 'vehicle'], ['Inspection kit', 'equipment']] as const) {
      await page.getByRole('button', { name: 'Add resource', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: 'New resource', exact: true });
      await drawer.getByLabel('Name', { exact: true }).fill(name);
      await chooseOption(drawer.getByLabel('Type', { exact: true }), resourceClass);
      await drawer.getByRole('button', { name: 'Add resource', exact: true }).click();
      await expect(drawer).toHaveCount(0);
    }
    const resources = (await owner.from('resources').select('id,name').eq('organization_id', organizationId)).data!;
    const alex = resources.find(r => r.name === 'Alex Smith')!;
    await createResourceRequirement(owner, { typeId: type.id, resourceClass: 'person', quantity: 1, capabilityIds: [] });
    await createResourceRequirement(owner, { typeId: type.id, resourceClass: 'vehicle', quantity: 1, capabilityIds: [] });
    const customerId = await createCustomer(owner, { organizationId, name: 'Maple Dental' });
    const locationId = await createLocation(owner, { organizationId, label: 'Maple Dental clinic', address: '120 King St, Toronto' });
    await page.goto(`${base}/schedule/configuration`);
    const day = new Intl.DateTimeFormat('en', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${today}T12:00:00Z`));
    await page.getByLabel(`${day} opens at`, { exact: true }).fill('08:00');
    await page.getByLabel(`${day} closes at`, { exact: true }).fill('18:00');
    const hourForm = page.getByLabel(`${day} opens at`, { exact: true }).locator('..');
    await hourForm.getByRole('button', { name: '+ Add period', exact: true }).click();
    await expect(page.getByText('08:00–18:00', { exact: true })).toBeVisible();
    for (let dow = 1; dow <= 7; dow++) {
      const currentDow = new Date(`${today}T12:00:00Z`).getUTCDay() || 7;
      if (dow !== currentDow) await addOperatingHours(owner, { organizationId, dayOfWeek: dow, opensAt: '08:00', closesAt: '18:00' });
    }
    await page.goto(`${base}/field`);
    await page.getByRole('link', { name: 'New work', exact: true }).click();
    const createDrawer = page.getByRole('form', { name: 'Create work', exact: true });
    await createDrawer.getByLabel('Job title', { exact: true }).fill('Dental emergency inspection');
    await chooseOption(createDrawer.getByLabel('Customer', { exact: true }), customerId);
    await chooseOption(createDrawer.getByLabel('Location', { exact: true }), locationId);
    await createDrawer.getByRole('button', { name: 'Create work', exact: true }).click();
    await expect(page).toHaveURL(`${base}/work?type=${type.id}`);
    await page.goto(`${base}/field`);
    const work = (await owner.from('work_items').select('id').eq('organization_id', organizationId).single()).data!;
    await page.getByRole('link', { name: 'Dispatch board', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Selected work', exact: true })).toContainText('Dental emergency inspection');
    const inspector = page.getByRole('region', { name: 'Selected work', exact: true });
    await inspector.getByText('Assign / reassign', { exact: true }).click();
    const assignment = inspector.locator('details').filter({ has: page.getByText('Assign / reassign', { exact: true }) });
    await assignment.getByRole('checkbox', { name: 'Alex Smith', exact: true }).check();
    await assignment.getByRole('checkbox', { name: 'Service Van', exact: true }).check();
    await assignment.getByRole('button', { name: 'Save resources', exact: true }).click();
    await expect(inspector).toContainText('Person — Alex Smith');
    await inspector.getByText('Schedule / check feasibility', { exact: true }).click();
    const scheduler = inspector.locator('details').filter({ has: page.getByText('Schedule / check feasibility', { exact: true }) });
    await scheduler.getByLabel('Starts', { exact: true }).fill(`${today}T09:00`);
    await scheduler.getByLabel('Ends', { exact: true }).fill(`${today}T10:00`);
    await scheduler.getByRole('button', { name: 'Check this time', exact: true }).click();
    await expect(scheduler.getByRole('status')).toContainText(/can|feasible|available|works/i);
    await scheduler.getByRole('button', { name: 'Schedule', exact: true }).click();
    await expect(inspector).toContainText('09:00–10:00');
    await page.goto(`${base}/schedule?on=${today}&view=day`);
    await expect(page.getByRole('link', { name: /Dental emergency inspection/ }).first()).toBeVisible();
    for (const view of ['week', 'month']) { await page.goto(`${base}/schedule?on=${today}&view=${view}`); await expect(page.getByRole('link', { name: /Dental emergency inspection/ }).first()).toBeVisible(); }
    await page.goto(`${base}/field`);
    await expect(page.getByRole('region', { name: 'Today', exact: true })).toContainText('Dental emergency inspection');
    await page.goto(`${base}/work/dispatch?on=${today}&selected=${work.id}`);
    await inspector.getByText('Schedule / check feasibility', { exact: true }).click();
    await scheduler.getByLabel('Starts', { exact: true }).fill(`${today}T10:00`);
    await scheduler.getByLabel('Ends', { exact: true }).fill(`${today}T11:00`);
    await scheduler.getByRole('button', { name: 'Reschedule', exact: true }).click();
    await expect(inspector).toContainText('10:00–11:00');
    const overlapping = await createWorkItem(owner, { organizationId, statusId: ready.id, title: 'Conflicting job' });
    await expect(scheduleWorkItem(owner, { workItemId: overlapping, resourceIds: [alex.id], startsAt: zonedTimeToInstant(today, '10:30', 'America/Toronto'), endsAt: zonedTimeToInstant(today, '11:30', 'America/Toronto') })).rejects.toThrow();
    await page.goto(`${base}/work?type=${type.id}&view=board`);
    await page.getByRole('region', { name: 'Ready', exact: true }).getByRole('listitem').filter({ hasText: 'Dental emergency inspection' }).getByRole('button', { name: 'Move to Working', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Working', exact: true })).toContainText('Dental emergency inspection');
    await page.goto(`${base}/work/${work.id}`);
    await expect(page.getByText('Working', { exact: true }).first()).toBeVisible();
    await page.goto(`${base}/resources/${alex.id}`);
    await page.getByRole('tab', { name: 'Work', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Dental emergency inspection', exact: true })).toBeVisible();
    const secondType = await createWorkItemType(owner, { organizationId, name: 'Maintenance', schedulable: true });
    const secondStatus = await createWorkItemStatus(owner, { organizationId, typeId: secondType, name: 'Planned' });
    const names = ['North Shore Plumbing', 'Vertex HVAC', 'Aster Electric', 'Lumière Studio', 'Riverside Property'];
    for (let i = 0; i < names.length; i++) {
      const c = await createCustomer(owner, { organizationId, name: names[i] });
      const r = await createResource(owner, { organizationId, name: `Resource ${i + 2}`, resourceClass: i % 2 ? 'vehicle' : 'person' });
      const job = await createWorkItem(owner, { organizationId, statusId: i % 2 ? secondStatus : ready.id, title: `Service ${names[i]}`, customerId: c, locationId });
      await scheduleWorkItem(owner, { workItemId: job, resourceIds: i >= 3 ? [] : [r], startsAt: zonedTimeToInstant(today, `${String(i + 11).padStart(2, '0')}:00`, 'America/Toronto'), endsAt: zonedTimeToInstant(today, `${String(i + 12).padStart(2, '0')}:00`, 'America/Toronto') });
      if (i < 3) await createWorkItem(owner, { organizationId, statusId: ready.id, title: `Unscheduled ${names[i]}`, customerId: c });
    }
    await page.goto(`${base}/field`);
    await page.getByRole('tab', { name: 'Unscheduled (4)', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Needs attention', exact: true })).toContainText('Unscheduled North Shore Plumbing');
    await page.getByRole('region', { name: 'Needs attention', exact: true }).getByRole('link', { name: 'View all', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Work queue', exact: true })).toContainText('Unscheduled North Shore Plumbing');
    await page.getByLabel('Search', { exact: true }).fill('Unscheduled Vertex');
    await page.getByRole('button', { name: 'Apply filters', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Work queue', exact: true }).getByRole('listitem')).toHaveCount(1);
    await page.getByRole('link', { name: 'Map', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Assignment board', exact: true })).toContainText(/Map services are not configured|No coordinates recorded/);
    await page.goto(`${base}/field`);
    await page.getByRole('region', { name: 'Upcoming work', exact: true }).getByRole('link', { name: 'View work', exact: false }).click();
    await expect(selectFieldValue(page.getByRole('combobox', { name: 'Assignment state', exact: true }))).toHaveValue('upcoming');
    await expect(page.getByRole('region', { name: 'Work queue', exact: true }).getByRole('listitem')).toHaveCount(6);
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base}/field`);
      await expect(page.getByRole('region', { name: 'Today', exact: true })).toContainText('Dental emergency inspection');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await capture(page, testInfo.outputPath(`work-populated-${width}.png`));
      await page.goto(`${base}/work/dispatch?on=${today}&selected=${work.id}`);
      await expect(inspector).toContainText('Dental emergency inspection');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await capture(page, testInfo.outputPath(`dispatch-${width}.png`));
    }
    const readOnlyRole = await createRole(owner, { organizationId, name: 'Read only', capabilities: [] });
    await addMember(owner, { organizationId, email: BUSINESSES[0].member.email, roleId: readOnlyRole });
    const readOnlyContext = await page.context().browser()!.newContext({ storageState: COLLEAGUE_STORAGE_STATE });
    const reader = await readOnlyContext.newPage();
    await reader.goto(`${base}/field`);
    await expect(reader.getByRole('link', { name: 'New work', exact: true })).toHaveCount(0);
    await expect(reader.getByRole('link', { name: 'Configure Work', exact: true })).toHaveCount(0);
    await reader.goto(`${base}/work/dispatch?selected=${work.id}`);
    await expect(reader.getByRole('region', { name: 'Selected work', exact: true })).toContainText('Your role cannot assign or schedule work.');
    await expect(reader.getByRole('button', { name: 'Save resources', exact: true })).toHaveCount(0);
    await readOnlyContext.close();
    expect(errors).toEqual([]);
  });
});

test.describe('Work reduced role', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });
  test('withholds operational writes and refuses foreign records', async ({ page }) => {
    const ctx = loadDemoContext();
    await page.goto(`/organizations/${ctx.organizationId}/field`);
    await expect(page.getByRole('link', { name: 'New work', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Configure Work', exact: true })).toHaveCount(0);
    await page.goto(`/organizations/${ctx.organizationId}/work/dispatch`);
    await expect(page.getByRole('button', { name: 'Save resources', exact: true })).toHaveCount(0);
    await page.goto(`/organizations/${ctx.goldOrganizationId}/work/dispatch`);
    await expect(page.getByRole('heading', { name: 'Dispatch board', exact: true })).toHaveCount(0);
  });
});

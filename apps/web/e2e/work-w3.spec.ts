import path from 'node:path';
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { Client } from 'pg';
import { provisionFinanceBusiness, signInOwner, ZONE } from './finance-fixtures';
import { guardedShot } from './visual-guard';
import { COLLEAGUE_STORAGE_STATE, OWNER_STORAGE_STATE } from './helpers';
import { createWorkItemType } from '../lib/domain/work-items/types';
import { createWorkItemStatus } from '../lib/domain/work-items/statuses';
import { createWorkItemTransition } from '../lib/domain/work-items/transitions';
import { createResourceRequirement } from '../lib/domain/work-items/requirements';
import { createWorkItem } from '../lib/domain/work-items/work-items';
import { createResource } from '../lib/domain/resources/resources';
import { scheduleWorkItem } from '../lib/domain/scheduling/schedule';
import { addOperatingHours } from '../lib/domain/scheduling/operating-hours';
import { createResourceAvailabilityException } from '../lib/domain/scheduling/resource-availability';
import { createCustomer } from '../lib/domain/customers/customers';
import { shiftDate, todayInZone, zonedTimeToInstant } from '../lib/domain/scheduling/window';
import { getWorkItem } from '../lib/domain/work-items/work-items';
import { createRole } from '../lib/domain/tenancy/roles';
import { addMember } from '../lib/domain/tenancy/members';
import { createLocation, setLocationCoordinates } from '../lib/domain/locations/locations';
import { workOperations } from '../lib/application/work/operations';
import type { Db } from '../lib/db/types';
import { chooseOption } from './select-field';


const PHASE = process.env.W3_PHASE === 'before' ? 'before' : 'after';
const OUT = path.join(__dirname, '..', '..', '..', '.artifacts', 'work-w3', PHASE);
type Seeded = { organizationId: string; serviceTypeId: string; estimateTypeId: string; stages: Record<string, string>; items: Record<string, string> };

/** A populated business: every record through the domain commands the application calls. */
async function populateWorkBusiness(db: Db, organizationId: string): Promise<Seeded> {
  const today = todayInZone(ZONE);
  const at = (day: string, time: string) => zonedTimeToInstant(day, time, ZONE);
  for (let day = 1; day <= 7; day++) await addOperatingHours(db, { organizationId, dayOfWeek: day, opensAt: '08:00', closesAt: '17:00' });
  const serviceTypeId = await createWorkItemType(db, { organizationId, name: 'Service call', schedulable: true });
  const stages: Record<string, string> = {};
  for (const [key, name, position] of [['requested', 'Requested', 0], ['scheduled', 'Scheduled', 1], ['progress', 'In progress', 2], ['done', 'Done', 3]] as const) stages[key] = await createWorkItemStatus(db, { organizationId, typeId: serviceTypeId, name, position });
  for (const [from, to] of [['requested', 'scheduled'], ['scheduled', 'progress'], ['progress', 'done']] as const) await createWorkItemTransition(db, { organizationId, typeId: serviceTypeId, fromStatusId: stages[from], toStatusId: stages[to] });
  await createResourceRequirement(db, { typeId: serviceTypeId, resourceClass: 'person', quantity: 1, capabilityIds: [] });
  await createResourceRequirement(db, { typeId: serviceTypeId, resourceClass: 'vehicle', quantity: 1, capabilityIds: [] });
  const estimateTypeId = await createWorkItemType(db, { organizationId, name: 'Estimate', schedulable: false });
  stages.draft = await createWorkItemStatus(db, { organizationId, typeId: estimateTypeId, name: 'Draft', position: 0 });
  stages.sent = await createWorkItemStatus(db, { organizationId, typeId: estimateTypeId, name: 'Sent', position: 1 });
  await createWorkItemTransition(db, { organizationId, typeId: estimateTypeId, fromStatusId: stages.draft, toStatusId: stages.sent });

  const alex = await createResource(db, { organizationId, name: 'Alex Chen', resourceClass: 'person' });
  const sam = await createResource(db, { organizationId, name: 'Sam Rivera', resourceClass: 'person' });
  const van = await createResource(db, { organizationId, name: 'Van 2', resourceClass: 'vehicle' });
  const customers: Record<string, string> = {};
  for (const name of ['Maple Dental', 'Vertex HVAC', 'Riverside Property', 'Aster Electric']) customers[name] = await createCustomer(db, { organizationId, name });

  const items: Record<string, string> = {};
  const job = async (key: string, title: string, statusId: string, customer?: string, when?: [string, string, string], resourceIds: string[] = []) => {
    items[key] = await createWorkItem(db, { organizationId, title, statusId, customerId: customer ? customers[customer] : null });
    if (when) await scheduleWorkItem(db, { workItemId: items[key], startsAt: at(when[0], when[1]), endsAt: at(when[0], when[2]), resourceIds });
  };
  await job('covered', 'Furnace tune-up', stages.scheduled, 'Maple Dental', [today, '09:00', '10:30'], [alex, van]);
  await job('shortfall', 'Leak inspection', stages.scheduled, 'Vertex HVAC', [today, '11:00', '12:00'], [sam]);
  await job('unassigned', 'Thermostat install', stages.scheduled, 'Riverside Property', [today, '14:00', '15:00']);
  await job('afterHours', 'Emergency boiler call', stages.progress, 'Aster Electric', [today, '18:00', '19:00'], [alex, van]);
  // Time off recorded after the booking: nothing moves, and the projection reports the conflict.
  await createResourceAvailabilityException(db, { resourceId: alex, startsAt: at(today, '17:30'), endsAt: at(today, '20:00'), reason: 'Appointment' });
  await job('tomorrow', 'Duct cleaning', stages.scheduled, 'Maple Dental', [shiftDate(today, 1), '10:00', '12:00'], [alex, van]);
  await job('later', 'AC repair', stages.scheduled, 'Vertex HVAC', [shiftDate(today, 3), '13:00', '14:00'], [sam, van]);
  await job('crossMidnight', 'Overnight inspection', stages.scheduled, 'Maple Dental');
  await scheduleWorkItem(db, { workItemId: items.crossMidnight, startsAt: at(today, '23:00'), endsAt: at(shiftDate(today, 1), '01:00'), resourceIds: [] });
  const locationId = await createLocation(db, { organizationId, label: 'Toronto workshop', address: '120 King St, Toronto' });
  await setLocationCoordinates(db, { id: locationId, latitude: 43.65, longitude: -79.38 });
  await db.from('work_items').update({ location_id: locationId }).eq('id', items.covered).throwOnError();
  await job('allDay', 'All-day unassigned commitment', stages.scheduled);
  await scheduleWorkItem(db, { workItemId: items.allDay, startsAt: at(today, '00:00'), endsAt: at(shiftDate(today, 1), '00:00'), resourceIds: [] });
  await job('daySeven', 'Seventh local date', stages.scheduled, undefined, [shiftDate(today, 7), '10:00', '11:00']);
  await job('dayEight', 'Eighth local date', stages.scheduled, undefined, [shiftDate(today, 8), '10:00', '11:00']);
  await job('backlogA', 'Water heater check', stages.requested, 'Riverside Property');
  await job('backlogB', 'Rooftop unit inspection', stages.requested);
  await job('estimate', 'Boiler replacement estimate', stages.draft, 'Aster Electric');
  // Recent history, so the seven-day volume has shape; each resource has one job per slot.
  for (let back = 1; back <= 6; back++) {
    for (const [time, end, who] of [['08:00', '09:00', alex], ['10:00', '11:00', sam], ['13:00', '14:00', alex]] as const) {
      if ((back + time.length) % 4 === 0 && time === '13:00') continue;
      await job(`past-${back}-${time}`, `Maintenance visit ${back}${time.slice(0, 2)}`, stages.scheduled, 'Maple Dental', [shiftDate(today, -back), time, end], [who, van]);
    }
  }
  return { organizationId, serviceTypeId, estimateTypeId, stages, items };
}


test.use({ storageState: OWNER_STORAGE_STATE });
test('Work W3 dispatch, calendar and resource assignment', async ({ page, browser }) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const owner = await signInOwner();
  const db = owner.db as unknown as Db;
  const seeded = await populateWorkBusiness(db, await provisionFinanceBusiness(owner, `W3 ${PHASE} ${Date.now()}`));
  const base = `/organizations/${seeded.organizationId}`;
  const date = todayInZone(ZONE);
  const dispatch = `${base}/work/dispatch?on=${date}`;
  const selected = `${dispatch}&selected=${seeded.items.covered}`;
  const shots = async (name: string, url: string, act?: () => Promise<void>) => {
    for (const width of [390, 768, 1024, 1440, 2000]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.goto(url);
      await expect(page.getByRole('main')).toContainText(name.startsWith('calendar') ? 'Schedule' : 'Dispatch');
      if (act) await act();
      await guardedShot(page, { url, content: act && PHASE === 'after' ? page.getByRole('dialog') : page.getByRole('main') }, { path: path.join(OUT, `${name}-${width}.png`), fullPage: true });
      if (PHASE === 'after') expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
  };
  for (const mode of ['list', 'schedule', 'map']) await shots(`dispatch-${mode}`, `${selected}&mode=${mode}`);
  for (const assignment of ['unscheduled', 'unassigned', 'shortfall', 'conflict']) await shots(`dispatch-${assignment}`, `${dispatch}&assignment=${assignment}`);
  for (const view of ['day', 'week']) await shots(`calendar-${view}`, `${base}/schedule?on=${date}&view=${view}`);
  for (const operation of ['assign', 'schedule']) await shots(`form-${operation}`, selected, async () => {
    if (PHASE === 'before') await page.getByRole('region', { name: 'Selected work', exact: true }).getByText(operation === 'assign' ? 'Assign / reassign' : 'Schedule / check feasibility', { exact: true }).click();
    else await page.getByRole('button', { name: operation === 'assign' ? 'Assign resources' : 'Reschedule', exact: true }).click();
  });
  if (PHASE === 'before') return;
  for (const width of [390, 768, 1024, 1440, 2000]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(dispatch);
    await page.getByRole('main').locator('[data-slot="collection-toolbar"] summary').click();
    const panel = page.getByRole('main').locator('[data-slot="filter-panel"]');
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await expect(panel.getByRole('button', { name: 'Apply filters' })).toBeInViewport();
    await guardedShot(page, { url: dispatch, content: panel }, { path: path.join(OUT, `filters-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const queue = page.getByRole('region', { name: 'Work queue', exact: true });
  const inspector = page.getByRole('region', { name: 'Selected work', exact: true });
  // Dashboard counts and Dispatch use the same authoritative filter, including a cross-midnight item.
  const data = await workOperations(db, seeded.organizationId, date, ZONE);
  await page.goto(`${base}/field?on=${date}`);
  await page.getByRole('region', { name: 'Upcoming', exact: true }).getByRole('link', { name: /^View all/ }).click();
  await expect(page).toHaveURL(/assignment=upcoming/);
  await page.goto(`${dispatch}&assignment=upcoming`);
  await expect(queue.locator('h2').locator('..')).toContainText(String(data.upcoming.total));
  await expect(queue).toContainText('Duct cleaning');
  await expect(queue).toContainText('Seventh local date');
  await expect(queue).not.toContainText('Eighth local date');
  await expect(queue).not.toContainText('All-day unassigned commitment');
  await expect(queue).not.toContainText('Furnace tune-up');
  await expect(queue).toContainText('Overnight inspection');
  await page.goto(`${dispatch}&assignment=scheduled`);
  await expect(queue.locator('h2').locator('..')).toContainText(String(data.todayCount));
  await expect(queue).toContainText('All-day unassigned commitment');
  await expect(queue).toContainText('Overnight inspection');
  // Incompatible selection never leaks a Work record into a filtered inspector.
  await page.goto(`${selected}&assignment=unscheduled`);
  await expect(inspector).toContainText('no longer matches these filters');
  await page.goto(`${dispatch}&selected=not-a-uuid`);
  await expect(inspector).toContainText('unavailable');
  // Type changes clear a status, pagination and selection while retaining date/search/presentation.
  await page.goto(`${dispatch}&type=${seeded.serviceTypeId}&status=${seeded.stages.scheduled}&page=2&mode=map`);
  await chooseOption(page.getByRole('combobox', { name: 'Work type', exact: true }), seeded.estimateTypeId);
  await expect(page).toHaveURL(new RegExp(`type=${seeded.estimateTypeId}`));
  for (const key of ['status', 'page', 'selected']) expect(new URL(page.url()).searchParams.has(key)).toBe(false);
  await expect(inspector).toContainText('does not use scheduling');
  await expect(inspector.getByRole('button', { name: 'Schedule', exact: true })).toHaveCount(0);
  // Search submits URL state and starts at the first page; chips, Reset, reload and history restore it.
  await page.goto(`${dispatch}&page=2`);
  await page.getByRole('searchbox', { name: 'Search work' }).fill('Leak');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page).toHaveURL(/q=Leak/);
  expect(new URL(page.url()).searchParams.has('page')).toBe(false);
  await expect(queue).toContainText('Leak inspection');
  await expect(queue.locator('li')).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('searchbox')).toHaveValue('Leak');
  await page.getByRole('link', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await page.goBack();
  await expect(page.getByRole('searchbox')).toHaveValue('Leak');
  await page.goForward();
  await expect(page.getByRole('searchbox')).toHaveValue('');
  // Advanced filters submit together, retain presentation, expose active chips and exact matches.
  await page.goto(`${dispatch}&mode=schedule`);
  await page.getByRole('main').locator('[data-slot="collection-toolbar"] summary').click();
  await chooseOption(page.getByRole('combobox', { name: 'Resource', exact: true }), { label: 'Alex Chen' });
  await chooseOption(page.getByRole('combobox', { name: 'Assignment state', exact: true }), 'scheduled');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page).toHaveURL(/resource=/);
  expect(new URL(page.url()).searchParams.get('mode')).toBe('schedule');
  await expect(page.getByRole('group', { name: 'Active filters' })).toContainText('Resource: Alex Chen');
  await expect(queue).toContainText('Furnace tune-up');
  await expect(queue).not.toContainText('Leak inspection');
  await page.getByRole('link', { name: 'Reset', exact: true }).click();
  await page.getByRole('main').locator('[data-slot="collection-toolbar"] summary').click();
  await chooseOption(page.getByRole('combobox', { name: 'Resource class', exact: true }), 'vehicle');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByRole('group', { name: 'Active filters' })).toContainText('Class: Vehicle');
  await expect(queue).not.toContainText('Leak inspection');
  // Explicit selected records survive paging and reload, even off the visible page.
  await page.goto(selected);
  await queue.getByRole('link', { name: 'Next', exact: true }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(inspector).toContainText('Furnace tune-up');
  await page.reload();
  await expect(inspector).toContainText('Furnace tune-up');
  // Staffing has no invented time conflict before a time exists.
  await page.goto(`${dispatch}&selected=${seeded.items.backlogA}`);
  await expect(inspector).toContainText('Not yet staffed');
  await expect(inspector).toContainText('Choose a time');
  // Dirty Cancel asks; Keep editing and Discard preserve focus behavior.
  const assignButton = inspector.getByRole('button', { name: 'Assign resources', exact: true });
  await assignButton.click();
  let dialog = page.getByRole('dialog', { name: 'Assign resources', exact: true });
  await dialog.getByRole('checkbox', { name: 'Alex Chen', exact: true }).check();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Keep editing' }).click();
  await expect(dialog.getByRole('checkbox', { name: 'Alex Chen', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(assignButton).toBeFocused();
  // Save participants without a time; then schedule the same Work through the canonical form.
  await assignButton.click();
  await dialog.getByRole('checkbox', { name: 'Alex Chen', exact: true }).check();
  await dialog.getByRole('checkbox', { name: 'Van 2', exact: true }).check();
  await dialog.getByRole('button', { name: 'Save resources' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(assignButton).toBeFocused();
  let work = (await getWorkItem(db, { organizationId: seeded.organizationId, workItemId: seeded.items.backlogA }))!;
  expect(work.window).toBeNull();
  expect(work.resources.map(r => r.label).sort()).toEqual(['Alex Chen', 'Van 2']);
  await inspector.getByRole('button', { name: 'Schedule', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Schedule', exact: true });
  await dialog.getByLabel('Starts', { exact: true }).fill(`${date}T09:15`);
  await dialog.getByLabel('Ends', { exact: true }).fill(`${date}T10:00`);
  const before = await getWorkItem(db, { organizationId: seeded.organizationId, workItemId: seeded.items.backlogA });
  await dialog.getByRole('button', { name: 'Check this time' }).click();
  await expect(dialog.getByRole('status')).toContainText(/feasible/i);
  expect(await getWorkItem(db, { organizationId: seeded.organizationId, workItemId: seeded.items.backlogA })).toEqual(before);
  await dialog.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('Starts', { exact: true })).toHaveValue(`${date}T09:15`);
  await expect(dialog.getByRole('checkbox', { name: 'Alex Chen', exact: true })).toBeChecked();
  expect((await getWorkItem(db, { organizationId: seeded.organizationId, workItemId: seeded.items.backlogA }))!.window).toBeNull();
  await dialog.getByLabel('Starts', { exact: true }).fill(`${date}T15:00`);
  await dialog.getByLabel('Ends', { exact: true }).fill(`${date}T16:00`);
  await dialog.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(inspector).toContainText('15:00');
  work = (await getWorkItem(db, { organizationId: seeded.organizationId, workItemId: seeded.items.backlogA }))!;
  expect(work.window!.startsAt).toBe(zonedTimeToInstant(date, '15:00', ZONE));
  await inspector.getByRole('link', { name: 'View in Schedule' }).click();
  await expect(page.getByRole('main')).toContainText('Water heater check');
  // Conflicting assignment is refused atomically and retains the checklist.
  const clash = await createWorkItem(db, { organizationId: seeded.organizationId, statusId: seeded.stages.scheduled, title: 'Concurrent unassigned visit' });
  await scheduleWorkItem(db, { workItemId: clash, startsAt: zonedTimeToInstant(date, '09:15', ZONE), endsAt: zonedTimeToInstant(date, '10:00', ZONE), resourceIds: [] });
  await page.goto(`${dispatch}&selected=${clash}`);
  await inspector.getByRole('button', { name: 'Assign resources' }).click();
  dialog = page.getByRole('dialog', { name: 'Assign resources' });
  await dialog.getByRole('checkbox', { name: 'Alex Chen', exact: true }).check();
  await dialog.getByRole('button', { name: 'Save resources' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: 'Alex Chen', exact: true })).toBeChecked();
  expect((await getWorkItem(db, { organizationId: seeded.organizationId, workItemId: clash }))!.resources).toEqual([]);
  await dialog.getByRole('checkbox', { name: 'Alex Chen', exact: true }).uncheck();
  await dialog.getByRole('checkbox', { name: 'Sam Rivera', exact: true }).check();
  await dialog.getByRole('button', { name: 'Save resources' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(inspector).toContainText('Sam Rivera');
  // Reschedule and Clear schedule preserve existing command semantics and submitter identity.
  await inspector.getByRole('button', { name: 'Reschedule', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Reschedule' });
  await dialog.getByLabel('Starts', { exact: true }).fill(`${date}T12:00`);
  await dialog.getByLabel('Ends', { exact: true }).fill(`${date}T13:00`);
  await dialog.getByRole('button', { name: 'Reschedule', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(inspector).toContainText('12:00');
  await inspector.getByRole('button', { name: 'Reschedule', exact: true }).click();
  await dialog.getByRole('button', { name: 'Clear schedule' }).click();
  await expect(dialog).toHaveCount(0);
  expect((await getWorkItem(db, { organizationId: seeded.organizationId, workItemId: clash }))!.window).toBeNull();
  // Reduced role: UI is gated and an already-open form is refused after permission revocation.
  const pg = new Client(process.env.SUPABASE_DB_URL!);
  await pg.connect();
  const fixtures = JSON.parse(readFileSync(path.join(process.env.E2E_FIXTURE_DIR!, 'fixtures.json'), 'utf8')) as { userIds: string[] };
  const colleague = (await pg.query('select email from auth.users where id=$1', [fixtures.userIds[1]])).rows[0].email;
  const role = await createRole(db, { organizationId: seeded.organizationId, name: 'W3 reader', capabilities: ['work_item.schedule'] });
  await addMember(db, { organizationId: seeded.organizationId, email: colleague, roleId: role });
  const context = await browser.newContext({ storageState: COLLEAGUE_STORAGE_STATE });
  try {
    const reduced = await context.newPage();
    await reduced.goto(`${dispatch}&selected=${clash}`);
    await reduced.getByRole('button', { name: 'Assign resources', exact: true }).click();
    const form = reduced.getByRole('dialog', { name: 'Assign resources' });
    await form.getByRole('checkbox', { name: 'Sam Rivera', exact: true }).uncheck();
    await pg.query('update roles set capabilities = array_remove(capabilities, $2) where id=$1', [role, 'work_item.schedule']);
    await form.getByRole('button', { name: 'Save resources' }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    expect((await getWorkItem(db, { organizationId: seeded.organizationId, workItemId: clash }))!.resources.map(r => r.label)).toEqual(['Sam Rivera']);
    await reduced.reload();
    await expect(reduced.getByRole('button', { name: 'Assign resources' })).toHaveCount(0);
    await expect(reduced.getByRole('button', { name: 'Schedule', exact: true })).toHaveCount(0);
  } finally { await pg.end(); await context.close(); }
  // Resolving the active exception removes it from the queue and focuses the selection explanation.
  await scheduleWorkItem(db, { workItemId: clash, startsAt: zonedTimeToInstant(date, '12:00', ZONE), endsAt: zonedTimeToInstant(date, '13:00', ZONE), resourceIds: [] });
  await page.goto(`${dispatch}&assignment=unassigned&selected=${clash}`);
  await inspector.getByRole('button', { name: 'Assign resources', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Assign resources' });
  await dialog.getByRole('checkbox', { name: 'Sam Rivera', exact: true }).check();
  await dialog.getByRole('button', { name: 'Save resources' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(inspector.getByRole('status')).toBeFocused();
  await expect(queue).not.toContainText('Concurrent unassigned visit');
  expect(errors).toEqual([]);

});

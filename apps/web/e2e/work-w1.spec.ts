import path from 'node:path';
import { readFileSync } from 'node:fs';
import { test, expect, type Locator, type Page } from '@playwright/test';
import { Client } from 'pg';
import { provisionFinanceBusiness, signInOwner, ZONE } from './finance-fixtures';
import { guardedShot } from './visual-guard';
import { COLLEAGUE_STORAGE_STATE, OWNER_STORAGE_STATE, loadDemoContext } from './helpers';
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
import { workOperations } from '../lib/application/work/operations';
import type { Db } from '../lib/db/types';

/**
 * Work W1 — Dashboard, Work items and responsive composition, in a real browser against disposable
 * businesses (`playwright.isolated.config.ts`). One business holds representative Work: a schedulable
 * type with stages, transitions and a person + vehicle requirement; a type that is never scheduled;
 * scheduled work with full, partial and no assignment; after-hours work (an availability conflict);
 * unscheduled work; and enough of it to page and to overflow a board column. Further businesses
 * stand for each empty state. Counts are asserted against the domain read model, not restated.
 * `W1_PHASE=before` only captures (the pre-change screens); the default runs the whole contract.
 */
const PHASE = process.env.W1_PHASE === 'before' ? 'before' : 'after';
const OUT = path.join(__dirname, '..', '..', '..', '.artifacts', 'work-w1', PHASE);
const VIEWPORTS = [{ name: '390', width: 390, height: 844 }, { name: '768', width: 768, height: 1024 }, { name: '1024', width: 1024, height: 900 }, { name: '1440', width: 1440, height: 900 }, { name: '2000', width: 2000, height: 995 }] as const;
const main = (page: Page) => page.getByRole('main');
const sidebar = (page: Page) => page.locator('[data-slot="sidebar-container"]');

async function fits(page: Page, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label} scrolls sideways`).toBe(true);
}
async function captureAll(page: Page, name: string, url: string, content: (page: Page) => Locator) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto(url);
    await fits(page, `${name} at ${viewport.name}`);
    await guardedShot(page, { url, content: content(page) }, { path: path.join(OUT, `${name}-${viewport.name}.png`), fullPage: true });
  }
}

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

let owner: Awaited<ReturnType<typeof signInOwner>>;
let seeded: Seeded;
let empty: string; let unstaged: string; let unstagedTypeId: string; let unscheduledOnly: string;

test.use({ storageState: OWNER_STORAGE_STATE });

test.describe.serial('Work W1: Dashboard and Work items', () => {
  test.describe.configure({ timeout: 240_000 });
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    owner = await signInOwner();
    const db = owner.db as unknown as Db;
    const run = Date.now().toString(36);
    seeded = await populateWorkBusiness(db, await provisionFinanceBusiness(owner, `W1 populated ${run}`));
    empty = await provisionFinanceBusiness(owner, `W1 empty ${run}`);
    unstaged = await provisionFinanceBusiness(owner, `W1 unstaged ${run}`);
    unstagedTypeId = await createWorkItemType(db, { organizationId: unstaged, name: 'Site survey', schedulable: true });
    // Only work that is never scheduled: nothing here needs a resource.
    unscheduledOnly = await provisionFinanceBusiness(owner, `W1 desk ${run}`);
    const deskType = await createWorkItemType(db, { organizationId: unscheduledOnly, name: 'Paperwork', schedulable: false });
    await createWorkItemStatus(db, { organizationId: unscheduledOnly, typeId: deskType, name: 'To do', position: 0 });
  });

  test('captures the Dashboard, list and board at every width', async ({ page }) => {
    const base = `/organizations/${seeded.organizationId}`;
    await captureAll(page, 'dashboard-populated', `${base}/field`, p => main(p).getByRole('heading', { name: 'Needs attention' }));
    await captureAll(page, 'list-populated', `${base}/work?type=${seeded.serviceTypeId}`, p => main(p).getByRole('link', { name: /Maintenance visit|Furnace tune-up/ }).first());
    await captureAll(page, 'board-populated', `${base}/work?type=${seeded.serviceTypeId}&view=board`, p => main(p).getByRole('region', { name: /stages/i }).or(main(p).getByRole('region', { name: 'Requested' })).first());
    await captureAll(page, 'dashboard-empty', `/organizations/${empty}/field`, p => main(p));
    await captureAll(page, 'list-empty', `/organizations/${empty}/work`, p => main(p));
  });

  test.describe('contract', () => {
    test.skip(PHASE === 'before', 'The pre-change run only captures.');

    test('Dashboard: Dashboard is selected, no repeated title or timezone, counts match the read model', async ({ page }) => {
      const base = `/organizations/${seeded.organizationId}`;
      const today = todayInZone(ZONE);
      const data = await workOperations(owner.db as unknown as Db, seeded.organizationId, today, ZONE);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${base}/field`);
      await expect(sidebar(page).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
      await expect(sidebar(page).getByRole('link', { name: /^Configuration$/ })).toHaveCount(0);
      await expect(main(page).getByRole('heading', { level: 1, name: 'Work', exact: true })).toHaveCount(0);
      await expect(main(page)).not.toContainText(ZONE);
      const overview = main(page).getByRole('region', { name: 'Work overview' });
      const tile = (label: string) => overview.locator('[data-slot="metric-tile"]').filter({ hasText: label });
      await expect(tile('Scheduled').first()).toContainText(String(data.todayCount));
      await expect(tile('Unassigned')).toContainText(String(data.unassigned.total));
      await expect(tile('Unscheduled')).toContainText(String(data.unscheduled.total));
      await expect(tile('Requirements met')).toContainText(`${data.todayCount - data.shortfalls.total} of ${data.todayCount}`);
      expect(data.todayCount).toBe(4);
      expect(data.unassigned.total).toBe(1);
      expect(data.unscheduled.total).toBe(2);
      expect(data.shortfalls.total).toBeGreaterThanOrEqual(2);
      expect(data.conflicts.total).toBe(1);
      // Each attention category says how many and links to its filtered Dispatch view.
      const attention = main(page).getByRole('region', { name: 'Needs attention' });
      for (const [label, count, assignment] of [['Unassigned', data.unassigned.total, 'unassigned'], ['Requirement gaps', data.shortfalls.total, 'shortfall'], ['Availability', data.conflicts.total, 'conflict'], ['Unscheduled', data.unscheduled.total, 'unscheduled']] as const) {
        const button = attention.getByRole('button', { name: new RegExp(`^${label}`) });
        await expect(button).toContainText(String(count));
        await button.click();
        await expect(attention.getByRole('link', { name: /^View all/ })).toHaveAttribute('href', new RegExp(`/work/dispatch\\?.*assignment=${assignment}`));
      }
      // Today lists the selected day's work; a row opens the authoritative Work record.
      const todayPanel = main(page).getByRole('region', { name: 'Today' });
      await expect(todayPanel.getByRole('link', { name: 'Furnace tune-up' })).toHaveAttribute('href', `${base}/work/${seeded.items.covered}`);
      await expect(todayPanel).toContainText('Maple Dental');
      // The seven-day volume is the shared chart, and its table equals the read model.
      const chart = main(page).locator('[data-slot="chart"]').filter({ has: page.getByRole('heading', { name: 'Scheduled work' }) });
      await expect(chart).toBeVisible();
      const history = data.history.map(h => h.count);
      expect(history.reduce((a, b) => a + b, 0)).toBeGreaterThan(4);
    });

    test('Dashboard: the selected day drives the counts and the URL', async ({ page }) => {
      const base = `/organizations/${seeded.organizationId}`;
      const tomorrow = shiftDate(todayInZone(ZONE), 1);
      const data = await workOperations(owner.db as unknown as Db, seeded.organizationId, tomorrow, ZONE);
      await page.goto(`${base}/field`);
      await main(page).getByLabel('Work date').fill(tomorrow);
      await main(page).getByLabel('Work date').press('Enter');
      await expect(page).toHaveURL(`${base}/field?on=${tomorrow}`);
      const overview = main(page).getByRole('region', { name: 'Work overview' });
      await expect(overview.locator('[data-slot="metric-tile"]').filter({ hasText: 'Scheduled' }).first()).toContainText(String(data.todayCount));
      expect(data.todayCount).toBe(1);
    });

    test('Work items: shared toolbar, URL state, type change clears an incompatible status, and pagination is exact', async ({ page }) => {
      const base = `/organizations/${seeded.organizationId}`;
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${base}/work?type=${seeded.serviceTypeId}`);
      await expect(sidebar(page).getByRole('link', { name: 'Work items' })).toHaveAttribute('aria-current', 'page');
      await expect(main(page).locator('[data-slot="collection-toolbar"]')).toBeVisible();
      // List and Board are presentations; Dispatch is a separate action, not a third view.
      const views = main(page).getByRole('navigation', { name: 'Work presentation' });
      await expect(views.getByRole('link')).toHaveText(['List', 'Board']);
      await expect(main(page).getByRole('link', { name: 'Dispatch' })).toHaveAttribute('href', `${base}/work/dispatch`);
      const pg = new Client(process.env.SUPABASE_DB_URL);
      await pg.connect();
      try {
        const total = Number((await pg.query('select count(*) from work_items where organization_id = $1 and type_id = $2', [seeded.organizationId, seeded.serviceTypeId])).rows[0].count);
        await expect(main(page).getByRole('status')).toContainText(`${total} work items`);
        expect(total).toBeGreaterThan(20);
        await main(page).getByRole('link', { name: 'Next' }).click();
        await expect(page).toHaveURL(/page=2/);
        await expect(main(page).getByRole('status')).toContainText(`${total} work items`);
        await expect(main(page).getByText(`Page 2 of ${Math.ceil(total / 20)}`)).toBeVisible();
      } finally { await pg.end(); }
      // A status filter is kept in the URL and shown as a removable chip with Reset.
      await page.goto(`${base}/work?type=${seeded.serviceTypeId}&status=${seeded.stages.requested}`);
      await expect(main(page).getByRole('group', { name: 'Active filters' })).toContainText('Status: Requested');
      await expect(main(page).getByRole('link', { name: 'Reset' })).toBeVisible();
      await expect(main(page).getByRole('status')).toContainText('2 work items');
      // Choosing another type drops a status that belongs to the first one.
      await main(page).getByLabel('Work type').selectOption(seeded.estimateTypeId);
      await expect(page).toHaveURL(new RegExp(`type=${seeded.estimateTypeId}`));
      expect(new URL(page.url()).searchParams.get('status')).toBeNull();
      await expect(main(page).getByRole('link', { name: 'Boiler replacement estimate' })).toBeVisible();
      // Non-schedulable work never shows scheduling or resource gaps.
      await expect(main(page)).not.toContainText('Unscheduled');
      // New work keeps the selected type.
      await expect(main(page).getByRole('link', { name: 'New work' }).first()).toHaveAttribute('href', `${base}/work/new?type=${seeded.estimateTypeId}`);
    });

    test('Board: shared board, exact stage counts, permitted moves only, overflow links to the full stage', async ({ page }) => {
      const base = `/organizations/${seeded.organizationId}`;
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${base}/work?type=${seeded.serviceTypeId}&view=board`);
      const board = main(page).getByRole('region', { name: 'Service call stages' });
      await expect(board).toHaveAttribute('data-slot', 'board');
      const pg = new Client(process.env.SUPABASE_DB_URL);
      await pg.connect();
      try {
        for (const key of ['requested', 'scheduled', 'progress', 'done'] as const) {
          const count = Number((await pg.query('select count(*) from work_items where status_id = $1', [seeded.stages[key]])).rows[0].count);
          const column = board.locator('[data-slot="board-column"]').filter({ has: page.getByRole('heading', { name: { requested: 'Requested', scheduled: 'Scheduled', progress: 'In progress', done: 'Done' }[key], exact: true }) });
          await expect(column.locator('header')).toContainText(String(count));
          if (key === 'scheduled') {
            expect(count).toBeGreaterThan(10);
            await expect(column.getByRole('link', { name: `View all ${count} in Scheduled` })).toHaveAttribute('href', new RegExp(`status=${seeded.stages.scheduled}`));
          }
        }
      } finally { await pg.end(); }
      // Only a configured transition is offered: Requested → Scheduled, never Requested → Done.
      const requested = board.locator('[data-slot="board-card"]').filter({ hasText: 'Water heater check' });
      await expect(requested.getByRole('button', { name: 'Move to Scheduled' })).toBeVisible();
      await expect(requested.getByRole('button', { name: /Move to (Done|In progress)/ })).toHaveCount(0);
      // Searching keeps the Board, with counts for the matches only; a requirement gap shows on its card.
      await page.goto(`${base}/work?type=${seeded.serviceTypeId}&view=board&q=Leak`);
      await expect(main(page).getByRole('status')).toContainText('1 work item matches this view');
      await expect(board.locator('[data-slot="board-card"]').filter({ hasText: 'Leak inspection' })).toContainText(/vehicle/i);
      // The board scrolls inside itself, never the page.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await fits(page, 'board at 390');
    });

    test('Empty organizations: one structure, the distinct missing piece and one next step', async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`/organizations/${empty}/field`);
      await expect(main(page).getByRole('region', { name: 'Work overview' })).toBeVisible();
      await expect(main(page)).toContainText('No work types yet');
      await expect(main(page).getByRole('link', { name: 'Set up work types' })).toHaveAttribute('href', `/organizations/${empty}/work/configuration`);
      await page.goto(`/organizations/${unstaged}/field`);
      await expect(main(page)).toContainText('Site survey has no starting stage');
      await expect(main(page).getByRole('link', { name: 'Add a starting stage' })).toHaveAttribute('href', `/organizations/${unstaged}/work/configuration?type=${unstagedTypeId}`);
      await page.goto(`/organizations/${unscheduledOnly}/field`);
      await expect(main(page)).toContainText('No work yet');
      await expect(main(page)).not.toContainText(/resource/i);
      await page.goto(`/organizations/${empty}/work`);
      await expect(main(page)).toContainText('No work types yet');
    });

    test('Reduced role: only authorized actions, no Configuration row', async ({ browser }) => {
      const { organizationId } = loadDemoContext();
      const pg = new Client(process.env.SUPABASE_DB_URL);
      await pg.connect();
      let capabilities: string[];
      try {
        const fixtures = JSON.parse(readFileSync(path.join(process.env.E2E_FIXTURE_DIR!, 'fixtures.json'), 'utf8')) as { userIds: string[] };
        capabilities = (await pg.query('select r.capabilities from memberships m join roles r on r.id = m.role_id where m.organization_id = $1 and m.user_id <> all($2::uuid[])', [organizationId, [fixtures.userIds[0]]])).rows[0].capabilities;
      } finally { await pg.end(); }
      // A ready type with one job, so neither page is a setup state for the colleague.
      const db = owner.db as unknown as Db;
      const typeId = await createWorkItemType(db, { organizationId, name: `W1 callback ${Date.now().toString(36)}`, schedulable: true });
      await createWorkItem(db, { organizationId, title: 'W1 colleague job', statusId: await createWorkItemStatus(db, { organizationId, typeId, name: 'Open', position: 0 }) });
      const context = await browser.newContext({ storageState: COLLEAGUE_STORAGE_STATE });
      const page = await context.newPage();
      try {
        for (const route of ['field', `work?type=${typeId}`]) {
          await page.goto(`/organizations/${organizationId}/${route}`);
          await expect(main(page)).toBeVisible();
          await expect(main(page).getByRole('link', { name: 'New work' })).toHaveCount(capabilities.includes('work_item.create') ? 1 : 0);
          if (!capabilities.includes('field.manage')) {
            await expect(main(page).getByRole('link', { name: /Set up work types|Work types & workflow/ })).toHaveCount(0);
            await expect(main(page).getByRole('button', { name: 'Configure' })).toHaveCount(0);
          }
          await expect(sidebar(page).getByRole('link', { name: /^Configuration$/ })).toHaveCount(0);
          await fits(page, `${route} for the colleague`);
        }
      } finally { await context.close(); }
    });
  });
});

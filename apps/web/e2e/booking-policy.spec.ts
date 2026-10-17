import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { setTypeBookingPolicy } from '../lib/domain/work-items/types';
import { createResource } from '../lib/domain/resources/resources';
import { createResourceCapability } from '../lib/domain/resources/resource-capabilities';
import { createResourceRequirement } from '../lib/domain/work-items/requirements';
import { createWorkItemStatus, updateWorkItemStatus } from '../lib/domain/work-items/statuses';
import { createWorkItemTransition } from '../lib/domain/work-items/transitions';
import { createWorkItemType, setTypeBookable } from '../lib/domain/work-items/types';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { getOrganization, updateOrganization } from '../lib/domain/tenancy/organizations';
import { setResourceWorkingHours } from '../lib/domain/scheduling/resource-availability';
import { getEffectiveBookingPolicy, type BookingPolicy } from '../lib/domain/booking/policy';
import { createWorkItem } from '../lib/domain/work-items/work-items';
import { scheduleWorkItem } from '../lib/domain/scheduling/schedule';
import { recordCommercialTerm } from '../lib/domain/commercial/terms';
import { asPlatformStaff, foundBusiness } from '../tests/support/founding';

/**
 * Booking policy in a real browser: what a visitor is offered under notice, same-day, horizon and
 * cadence; a multi-resource booking that still works under them; and a customer rescheduling or
 * cancelling their own booking, with the business's cutoffs. Each business here is its own, founded
 * for this file, so nothing depends on the demo's hours or on the time of day it is run.
 *
 * `E2E_SHOTS=<dir>` writes screenshots; they are evidence for a reviewer, never compared.
 */

loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test') });
const STRANGER = { storageState: { cookies: [], origins: [] } };
const SHOTS = process.env.E2E_SHOTS ?? '';
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

test.use(STRANGER);
test.describe.configure({ mode: 'serial' });

type Shop = {
  owner: SupabaseClient;
  email: string;
  password: string;
  organizationId: string;
  slug: string;
  typeId: string;
  bookedId: string;
  cancelledId: string;
  alex: string;
  van1: string;
};

let pg: Client;
let shop: Shop;

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
};
/** The policy form itself: it sits well below the fold of a long configuration page. */
const shotPolicyForm = async (page: Page, name: string) => {
  if (!SHOTS) return;
  const form = page.getByRole('heading', { name: 'When customers can book' }).locator('xpath=ancestor::form');
  await form.scrollIntoViewIfNeeded();
  await form.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};
const noHorizontalScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const card = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Fitting' }) });
const times = async (page: Page) =>
  (await card(page).getByRole('button', { name: /^\d{1,2}:\d{2}$/ }).allTextContents()).map((text) => text.trim());

const policyOf = async (): Promise<BookingPolicy> => (await getEffectiveBookingPolicy(shop.owner as never, { organizationId: shop.organizationId, typeId: shop.typeId }))!;
const setPolicy = async (patch: Partial<BookingPolicy>) =>
  setTypeBookingPolicy(shop.owner as never, { typeId: shop.typeId, policy: { ...(await policyOf()), ...patch } });

async function asStranger(browser: Browser, viewport?: { width: number; height: number }) {
  const context = await browser.newContext({ ...STRANGER, viewport });
  return { context, page: await context.newPage() };
}

async function open(page: Page, date: string) {
  await page.goto(`/book/${shop.slug}?on=${date}`);
  await expect(page.getByText('Times shown are in')).toBeVisible();
}

/** Book the first (or named) time on a day as a new visitor; returns the confirmation address. */
async function book(browser: Browser, date: string, at?: string) {
  const { context, page } = await asStranger(browser);
  await open(page, date);
  await card(page).getByRole('button', { name: at ?? /^\d{1,2}:\d{2}$/ }).first().click();
  await page.getByPlaceholder('Your name').fill('Ariane');
  await page.getByPlaceholder('Email').fill(`ariane-${randomUUID().slice(0, 6)}@example.test`);
  await page.getByRole('button', { name: /^Book / }).click();
  await expect(page.getByText(/Your booking is confirmed/)).toBeVisible();
  return { context, page, workItemId: page.url().split('/').pop()! };
}

/** A fixture's move of a booking to a real instant, past the capability guard the customer functions use. */
async function moveWindow(workItemId: string, from: string, to: string) {
  await pg.query('begin');
  try {
    await pg.query("select set_config('app.customer_change_work_item_id', $1, true)", [workItemId]);
    await pg.query(`update public.work_items set scheduled_during = tstzrange(${from}, ${to}, '[)') where id = $1`, [workItemId]);
    await pg.query('commit');
  } catch (error) {
    await pg.query('rollback');
    throw error;
  }
}

test.beforeAll(async () => {
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();

  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `policy-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  const owner = createClient(SUPABASE_URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const signIn = await owner.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;

  const organizationId = (await foundBusiness({ ownerEmail: email, name: 'Policy Garage', displayName: 'Founder', timezone: 'UTC', currency: 'EUR' })) as string;
  const o = owner as never;
  const typeId = await createWorkItemType(o, { organizationId, name: 'Fitting', schedulable: true });
  const bookedId = await createWorkItemStatus(o, { organizationId, typeId, name: 'Booked' });
  const cancelledId = await createWorkItemStatus(o, { organizationId, typeId, name: 'Cancelled' });
  await updateWorkItemStatus(o, { id: cancelledId, name: 'Cancelled', position: 1, releasesResource: true, marksComplete: false });
  await createWorkItemTransition(o, { organizationId, typeId, fromStatusId: bookedId, toStatusId: cancelledId });

  // Always-open resources, so the time of day this runs at changes nothing: a person and two vans.
  const tire = await createResourceCapability(o, { organizationId, name: 'Tire service' });
  const mobile = await createResourceCapability(o, { organizationId, name: 'Mobile service' });
  await createResourceRequirement(o, { typeId, resourceClass: 'person', quantity: 1, capabilityIds: [tire] });
  await createResourceRequirement(o, { typeId, resourceClass: 'vehicle', quantity: 1, capabilityIds: [mobile] });
  const everyDay = [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, opensAt: '00:00', closesAt: '23:59' }));
  const make = async (name: string, resourceClass: 'person' | 'vehicle', capabilityIds: string[]) => {
    const id = await createResource(o, { organizationId, name, resourceClass, capabilityIds });
    await setResourceWorkingHours(o, { resourceId: id, periods: everyDay });
    return id;
  };
  const alex = await make('Alex', 'person', [tire]);
  const van1 = await make('Van 1', 'vehicle', [mobile]);
  await make('Van 2', 'vehicle', [mobile]);

  const org = await getOrganization(o, organizationId);
  const slug = `policy-${randomUUID().slice(0, 8)}`;
  await updateOrganization(o, { id: organizationId, name: org!.name, timezone: 'UTC', currency: 'EUR', bufferMinutes: 0, slug });
  await setModuleEnabled(o, { organizationId, key: 'booking', enabled: true });
  // Switched on *and* paid for, so the operator's own screens show the booking controls.
  await recordCommercialTerm(await asPlatformStaff(), {
    organizationId,
    productKey: 'module:booking',
    periodStart: new Date().toISOString().slice(0, 10),
    periodEnd: '9999-12-31',
    priceMinor: 0,
    note: 'E2E fixture: booking switched on and paid for.',
  });
  await setTypeBookable(o, { id: typeId, statusId: bookedId, durationMinutes: 60 });

  shop = { owner, email, password, organizationId, slug, typeId, bookedId, cancelledId, alex, van1 };
  await setPolicy({ cadenceMinutes: 60, cancellationStatusId: cancelledId });
});

test.afterAll(async () => {
  await pg.end();
});

test('the owner sets booking limits in words, and they are kept', async ({ browser }) => {
  const { context, page } = await asStranger(browser, { width: 1440, height: 1000 });
  await page.goto('/login');
  await page.getByLabel('Email').fill(shop.email);
  await page.getByLabel('Password').fill(shop.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.waitForURL((url) => url.pathname.startsWith('/organizations'));
  await page.goto(`/organizations/${shop.organizationId}/work/configuration?type=${shop.typeId}&tab=booking`);
  await expect(page.getByRole('heading', { name: 'When customers can book' })).toBeVisible();
  await shotPolicyForm(page, 'policy-config-desktop');

  await page.getByLabel('Start times every, in minutes').fill('15');
  await page.getByLabel('How much notice is required?').fill('2');
  await page.getByLabel('Notice unit').selectOption('hours');
  await page.getByLabel('How far ahead can customers book, in days?').fill('7');
  await page.getByLabel('Allow same-day booking').uncheck();
  await page.getByLabel('Reschedule cutoff unit').selectOption('hours');
  await page.getByLabel('Customers can reschedule until').fill('12');
  await page.getByLabel('Cancellation cutoff unit').selectOption('hours');
  await page.getByLabel('Customers can cancel until').fill('6');
  await page.getByLabel('A cancelled booking moves to').selectOption({ label: 'Cancelled' });
  await page.getByRole('button', { name: 'Save booking limits' }).click();
  await expect.poll(async () => (await policyOf()).customerCancellationCutoffMinutes).toBe(360);
  expect(await policyOf()).toEqual({
    cadenceMinutes: 15,
    minimumNoticeMinutes: 120,
    maximumHorizonDays: 7,
    allowSameDay: false,
    customerRescheduleCutoffMinutes: 720,
    customerCancellationCutoffMinutes: 360,
    cancellationStatusId: shop.cancelledId,
  });

  // The same form says what it stored, in the owner's units, and refuses nonsense in words.
  await page.reload();
  await expect(page.getByLabel('How much notice is required?')).toHaveValue('2');
  await expect(page.getByLabel('Notice unit')).toHaveValue('hours');
  await page.getByLabel('How far ahead can customers book, in days?').fill('-5');
  await page.getByRole('button', { name: 'Save booking limits' }).click();
  expect(await policyOf()).toMatchObject({ maximumHorizonDays: 7 });
  await context.close();

  const mobile = await asStranger(browser, { width: 390, height: 900 });
  await mobile.page.goto('/login');
  await mobile.page.getByLabel('Email').fill(shop.email);
  await mobile.page.getByLabel('Password').fill(shop.password);
  await mobile.page.getByRole('button', { name: 'Log in' }).click();
  await mobile.page.waitForURL((url) => url.pathname.startsWith('/organizations'));
  await mobile.page.goto(`/organizations/${shop.organizationId}/work/configuration?type=${shop.typeId}&tab=booking`);
  await expect(mobile.page.getByRole('heading', { name: 'When customers can book' })).toBeVisible();
  expect(await noHorizontalScroll(mobile.page)).toBe(true);
  await shotPolicyForm(mobile.page, 'policy-config-mobile');
  await mobile.context.close();
});

test('cadence: a one-hour appointment is offered on the quarter hour', async ({ browser }) => {
  await setPolicy({ cadenceMinutes: 15, minimumNoticeMinutes: 0, maximumHorizonDays: 365, allowSameDay: true });
  const { context, page } = await asStranger(browser, { width: 1440, height: 900 });
  await open(page, day(2));
  const offered = await times(page);
  expect(offered.slice(0, 5)).toEqual(['00:00', '00:15', '00:30', '00:45', '01:00']);
  await shot(page, 'public-cadence-desktop');
  await context.close();
});

test('minimum notice: nothing sooner than two hours from now is offered, and a day inside it says why', async ({ browser }) => {
  await setPolicy({ cadenceMinutes: 30, minimumNoticeMinutes: 120 });
  const { context, page } = await asStranger(browser);
  const before = Date.now();
  await open(page, day(0));
  const earliest = before + 120 * 60_000;
  for (const label of await times(page)) {
    const [h, m] = label.split(':').map(Number);
    expect(Date.UTC(Number(day(0).slice(0, 4)), Number(day(0).slice(5, 7)) - 1, Number(day(0).slice(8, 10)), h, m)).toBeGreaterThanOrEqual(earliest - 60_000);
  }
  await setPolicy({ minimumNoticeMinutes: 2 * 1440 });
  await open(page, day(0));
  await expect(page.getByText('Bookings need at least 2 days notice.')).toBeVisible();
  await shot(page, 'public-notice-desktop');
  await open(page, day(3));
  expect((await times(page)).length).toBeGreaterThan(0);
  await context.close();
});

test('same-day off: today has no times and says so, and tomorrow still does', async ({ browser }) => {
  await setPolicy({ minimumNoticeMinutes: 0, allowSameDay: false });
  const { context, page } = await asStranger(browser);
  await open(page, day(0));
  await expect(page.getByText('Same-day bookings are not taken here.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Previous day' })).toHaveCount(0);
  await shot(page, 'public-same-day-desktop');
  await open(page, day(1));
  expect((await times(page)).length).toBeGreaterThan(0);
  await context.close();
});

test('horizon: seven days ahead is the last day offered, and navigation stops there', async ({ browser }) => {
  await setPolicy({ allowSameDay: true, maximumHorizonDays: 7 });
  const { context, page } = await asStranger(browser);
  await open(page, day(6));
  await expect(page.getByRole('link', { name: 'Next day' })).toBeVisible();
  await open(page, day(7));
  expect((await times(page)).length).toBeGreaterThan(0);
  await expect(page.getByRole('link', { name: 'Next day' })).toHaveCount(0);
  await open(page, day(8));
  await expect(page.getByText('Bookings open up to 7 days ahead.')).toBeVisible();
  expect((await times(page)).length).toBe(0);
  await shot(page, 'public-horizon-desktop');
  await context.close();
});

test('a person and a vehicle are still booked together under the policy', async ({ browser }) => {
  await setPolicy({ cadenceMinutes: 30, maximumHorizonDays: 30 });
  const { context, workItemId } = await book(browser, day(2), '10:00');
  const rows = await pg.query('select resource_id from public.work_item_resource_assignments where work_item_id = $1', [workItemId]);
  expect(rows.rowCount).toBe(2);
  await context.close();
});

test('a customer reschedules their own booking: the same booking, a new time, and new people when needed', async ({ browser }) => {
  await setPolicy({ cadenceMinutes: 30, customerRescheduleCutoffMinutes: 720, customerCancellationCutoffMinutes: 360 });
  const { context, page, workItemId } = await book(browser, day(3), '10:00');
  const confirmation = page.url();
  await shot(page, 'customer-confirmation-desktop');

  // Staff hold Van 1 at 14:00 on the same day; the move needs Van 2.
  const staffJob = await createWorkItem(shop.owner as never, { organizationId: shop.organizationId, title: 'Staff job', statusId: shop.bookedId, resourceIds: [shop.van1] });
  await scheduleWorkItem(shop.owner as never, { workItemId: staffJob, startsAt: `${day(3)}T14:00:00.000Z`, endsAt: `${day(3)}T15:00:00.000Z` });

  await page.getByRole('link', { name: 'Reschedule' }).click();
  await expect(page.getByRole('heading', { name: 'Choose a new time' })).toBeVisible();
  await shot(page, 'customer-reschedule-desktop');
  await page.getByRole('button', { name: '14:00' }).click();
  await page.getByRole('button', { name: /^Move my booking to 14:00/ }).click();
  await expect(page).toHaveURL(confirmation);
  await expect(page.getByText(/14:00/)).toBeVisible();

  const after = await pg.query('select to_char(lower(scheduled_during) at time zone \'UTC\', \'HH24:MI\') as t from public.work_items where id = $1', [workItemId]);
  expect(after.rows[0].t).toBe('14:00');
  const people = await pg.query('select resource_id from public.work_item_resource_assignments where work_item_id = $1', [workItemId]);
  expect(people.rows.map((row) => row.resource_id)).toContain(shop.alex);
  expect(people.rows.map((row) => row.resource_id)).not.toContain(shop.van1);
  expect(Number((await pg.query('select count(*) n from public.work_items where id = $1', [workItemId])).rows[0].n)).toBe(1);
  await context.close();
});

test('inside the cutoff, the change is not offered and the server refuses it too', async ({ browser }) => {
  const { context, page, workItemId } = await book(browser, day(4), '09:00');
  await moveWindow(workItemId, "now() + interval '2 hours'", "now() + interval '3 hours'");
  await page.reload();
  await expect(page.getByRole('link', { name: 'Reschedule' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel this booking' })).toHaveCount(0);
  await expect(page.getByText(/too close to the appointment to reschedule online/)).toBeVisible();
  await shot(page, 'customer-cutoff-desktop');

  // Straight to the address anyway: the refusal is the database's, not a hidden button.
  await page.goto(`/book/${shop.slug}/${workItemId}/reschedule`);
  await expect(page.getByRole('alert').filter({ hasText: 'too close' })).toContainText('too close to the appointment to reschedule online');
  await context.close();
});

test('a customer cancels before the cutoff: the booking stays on record and the people are free again', async ({ browser }) => {
  const { context, page, workItemId } = await book(browser, day(5), '11:00');
  await page.getByRole('button', { name: 'Cancel this booking' }).click();
  await page.getByRole('button', { name: 'Yes, cancel it' }).click();
  await expect(page.getByText('Your booking has been cancelled.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel this booking' })).toHaveCount(0);
  await shot(page, 'customer-cancelled-desktop');

  const row = await pg.query('select status_id from public.work_items where id = $1', [workItemId]);
  expect(row.rows[0].status_id).toBe(shop.cancelledId);

  // The same time is on offer to the next visitor.
  const next = await asStranger(browser);
  await open(next.page, day(5));
  expect(await times(next.page)).toContain('11:00');
  await next.context.close();
  await context.close();
});

test('a late cancellation is not offered, and the booking is left as it was', async ({ browser }) => {
  const { context, page, workItemId } = await book(browser, day(6), '09:30');
  await moveWindow(workItemId, "now() + interval '5 hours'", "now() + interval '6 hours'");
  await page.reload();
  await expect(page.getByRole('button', { name: 'Cancel this booking' })).toHaveCount(0);
  const row = await pg.query('select status_id from public.work_items where id = $1', [workItemId]);
  expect(row.rows[0].status_id).toBe(shop.bookedId);
  await context.close();
});

test('phone width: booking, confirmation and reschedule do not scroll sideways', async ({ browser }) => {
  const { context, page, workItemId } = await book(browser, day(7), '10:00').then(async (result) => {
    await result.context.close();
    const fresh = await asStranger(browser, { width: 390, height: 900 });
    await open(fresh.page, day(7));
    expect(await noHorizontalScroll(fresh.page)).toBe(true);
    await shot(fresh.page, 'public-booking-mobile');
    await fresh.page.getByRole('button', { name: /^\d{1,2}:\d{2}$/ }).first().click();
    await fresh.page.getByPlaceholder('Your name').fill('Mobile Visitor');
    await fresh.page.getByPlaceholder('Email').fill(`m-${randomUUID().slice(0, 6)}@example.test`);
    await fresh.page.getByRole('button', { name: /^Book / }).click();
    await expect(fresh.page.getByText(/Your booking is confirmed/)).toBeVisible();
    return { context: fresh.context, page: fresh.page, workItemId: fresh.page.url().split('/').pop()! };
  });
  expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, 'customer-confirmation-mobile');
  await page.goto(`/book/${shop.slug}/${workItemId}/reschedule`);
  await expect(page.getByRole('heading', { name: 'Choose a new time' })).toBeVisible();
  expect(await noHorizontalScroll(page)).toBe(true);
  await shot(page, 'customer-reschedule-mobile');
  await context.close();
});

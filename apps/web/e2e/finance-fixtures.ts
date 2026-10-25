import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { config as loadEnv } from 'dotenv';
import { loadDemoContext } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { getOrganization, updateOrganization } from '../lib/domain/tenancy/organizations';
import { createCustomer } from '../lib/domain/customers/customers';
import { createWorkItemType } from '../lib/domain/work-items/types';
import { createWorkItemStatus } from '../lib/domain/work-items/statuses';
import { createWorkItem } from '../lib/domain/work-items/work-items';
import { createPriceBookItem } from '../lib/domain/pricing/price-book';
import { addPricedLine } from '../lib/domain/pricing/prices';
import { issueInvoice, recordPayment } from '../lib/domain/billing/invoices';
import { shiftDate, todayInZone, zonedTimeToInstant } from '../lib/domain/scheduling/window';

/**
 * Disposable Finance businesses for the isolated browser run (`playwright.isolated.config.ts`).
 * Each is provisioned by the run's own owner through the same temporary staff door the run's
 * setup uses, and recorded in the run's `fixtures.json` so its teardown removes it. Every record is
 * synthetic and written through the domain commands the application itself calls.
 */
export const ZONE = 'America/Toronto';

export function signInOwner(): Promise<{ db: SupabaseClient; userId: string; ownerEmail: string }> {
  loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test'), quiet: true });
  const url = process.env.SUPABASE_URL!;
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local Finance fixtures only.');
  const { ownerEmail } = loadDemoContext();
  const db = createClient(url, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  return db.auth.signInWithPassword({ email: ownerEmail, password: DEMO_PASSWORD }).then(({ data, error }) => {
    if (error) throw error;
    return { db, userId: data.user.id, ownerEmail };
  });
}

export async function provisionFinanceBusiness(owner: { db: SupabaseClient; userId: string; ownerEmail: string }, name: string): Promise<string> {
  const pg = new Client(process.env.SUPABASE_DB_URL!);
  await pg.connect();
  try {
    await pg.query('insert into platform_staff(user_id,name) values($1,$2) on conflict do nothing', [owner.userId, `Finance E2E ${name}`]);
    const organizationId = await provisionOrganization(owner.db, { ownerEmail: owner.ownerEmail, name, displayName: 'Owner', timezone: ZONE, currency: 'CAD' });
    const manifestPath = path.join(process.env.E2E_FIXTURE_DIR!, 'fixtures.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { organizationIds: string[] };
    manifest.organizationIds.push(organizationId);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    await setModuleEnabled(owner.db, { organizationId, key: 'billing', enabled: true });
    return organizationId;
  } finally {
    await pg.query('delete from platform_staff where user_id=$1', [owner.userId]).catch(() => undefined);
    await pg.end();
  }
}

async function tradeIn(db: SupabaseClient, organizationId: string, currency: string) {
  const organization = (await getOrganization(db, organizationId))!;
  await updateOrganization(db, { id: organizationId, name: organization.name, timezone: organization.timezone, bufferMinutes: organization.bufferMinutes, slug: organization.slug, currency });
}

/** What a populated business holds, so a spec can assert against the records rather than restating amounts. */
export type FinanceFixture = { organizationId: string; statusId: string; prices: Record<string, string>; work: Record<string, string>; invoices: Record<string, string> };

/**
 * A business with a varied price book, CAD work in every financial state and one USD job, so
 * per-currency separation is visible. Dates are relative to today in the business's zone: two
 * overdue invoices, one due today, one due later, one settled, plus a correction.
 */
export async function populateFinanceBusiness(db: SupabaseClient, organizationId: string): Promise<FinanceFixture> {
  const today = todayInZone(ZONE);
  const at = (day: string, time = '09:00') => zonedTimeToInstant(day, time, ZONE);
  const prices: Record<string, string> = {};
  for (const [key, name, unit, amount] of [
    ['visit', 'Service visit', 'visit', 14500], ['labour', 'Labour', 'hour', 9550], ['plan', 'Annual maintenance plan', 'year', 120000],
    ['filter', 'Filter replacement', 'each', 3825], ['callout', 'Emergency callout', 'callout', 27500],
  ] as const) prices[key] = await createPriceBookItem(db, { organizationId, name, unit, unitAmountMinor: amount });
  const typeId = await createWorkItemType(db, { organizationId, name: 'Service', schedulable: false });
  const statusId = await createWorkItemStatus(db, { organizationId, typeId, name: 'Open', position: 0 });
  const work: Record<string, string> = {}, invoices: Record<string, string> = {};
  const job = async (key: string, title: string, customer: string, lines: [string, number][]) => {
    const customerId = await createCustomer(db, { organizationId, name: customer });
    work[key] = await createWorkItem(db, { organizationId, statusId, title, customerId });
    for (const [price, quantity] of lines) await addPricedLine(db, { workItemId: work[key], priceBookItemId: prices[price], quantity });
  };
  await job('overdueA', 'Boiler repair', 'Vertex HVAC', [['callout', 1], ['labour', 3]]);
  await job('overdueB', 'Quarterly inspection', 'Maple Dental', [['visit', 2], ['filter', 4]]);
  await job('dueToday', 'Rooftop unit service', 'Aster Electric', [['visit', 1], ['labour', 2]]);
  await job('dueLater', 'Maintenance agreement', 'Riverside Property', [['plan', 1]]);
  await job('settled', 'Filter change', 'Lumière Studio', [['filter', 6]]);
  await job('quoted', 'Heat pump estimate', 'Cedar Tree Properties', [['visit', 1], ['labour', 6], ['filter', 2]]);
  invoices.overdueA = await issueInvoice(db, { workItemId: work.overdueA, issuedAt: at(shiftDate(today, -30)), dueAt: at(shiftDate(today, -9), '12:00') });
  invoices.overdueB = await issueInvoice(db, { workItemId: work.overdueB, issuedAt: at(shiftDate(today, -20)), dueAt: at(shiftDate(today, -2), '12:00') });
  invoices.dueToday = await issueInvoice(db, { workItemId: work.dueToday, issuedAt: at(shiftDate(today, -14)), dueAt: at(today, '23:59') });
  invoices.dueLater = await issueInvoice(db, { workItemId: work.dueLater, issuedAt: at(shiftDate(today, -1)), dueAt: at(shiftDate(today, 21)) });
  invoices.settled = await issueInvoice(db, { workItemId: work.settled, issuedAt: at(shiftDate(today, -6)), dueAt: at(shiftDate(today, 8)) });
  await recordPayment(db, { invoiceId: invoices.overdueA, amountMinor: 20000, receivedAt: at(shiftDate(today, -5)), note: 'Cheque 1042' });
  await recordPayment(db, { invoiceId: invoices.settled, amountMinor: 22950, receivedAt: at(shiftDate(today, -1)), note: 'E-transfer' });
  // A recorded correction: a person reverses part of a receipt with a signed entry, never an edit.
  await recordPayment(db, { invoiceId: invoices.overdueA, amountMinor: -2500, receivedAt: at(today, '08:00'), note: 'Bank fee reversed' });
  // One USD job: the business changes what it trades in, prices one service, quotes and invoices it, then returns to CAD.
  await tradeIn(db, organizationId, 'USD');
  prices.usd = await createPriceBookItem(db, { organizationId, name: 'Cross-border consultation', unit: 'hour', unitAmountMinor: 18000 });
  await job('usd', 'Remote commissioning', 'Lakeside Holdings', [['usd', 2]]);
  invoices.usd = await issueInvoice(db, { workItemId: work.usd, issuedAt: at(shiftDate(today, -3)), dueAt: at(shiftDate(today, 27)) });
  await tradeIn(db, organizationId, 'CAD');
  return { organizationId, statusId, prices, work, invoices };
}

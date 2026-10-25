import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { issueInvoice, recordPayment } from '@/lib/domain/billing/invoices';
import { readFinanceInvoices, readFinancePayments, readFinanceQuotes } from '@/lib/domain/billing/finance-reads';
import { dueSoonWindow, financeFilters, loadFinanceOperating } from '@/lib/application/finance/operating';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createPriceBookItem } from '@/lib/domain/pricing/price-book';
import { addPricedLine } from '@/lib/domain/pricing/prices';
import { ALL_CAPABILITIES, CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { listMembers } from '@/lib/domain/tenancy/members';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { shiftDate, todayInZone, zonedTimeToInstant } from '@/lib/domain/scheduling/window';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Finance V2.0 collections and Dashboard against local PostgreSQL: every view the toolbar offers is
 * a database filter, so the count agrees with the rows; overdue and due soon never share an
 * invoice; a correction is its own negative row; and none of it crosses an organization.
 */
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ZONE = 'America/Toronto';

type Tenant = { db: SupabaseClient; organizationId: string; membershipId: string };
let alice: Tenant, bob: Tenant;
const invoices: Record<string, string> = {};

async function tenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`, password = `pw-${randomUUID()}`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error) throw made.error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const login = await db.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, displayName: 'Founder', timezone: ZONE, currency: 'CAD' }) as string;
  const [membership] = await listMembers(db, { organizationId });
  return { db, organizationId, membershipId: membership.id };
}

beforeAll(async () => {
  [alice, bob] = await Promise.all([tenant('finance-collections-alice'), tenant('finance-collections-bob')]);
  const { db, organizationId } = alice;
  await setModuleEnabled(db, { organizationId, key: 'billing', enabled: true });
  const today = todayInZone(ZONE);
  const at = (day: string, time = '09:00') => zonedTimeToInstant(day, time, ZONE);
  const typeId = await createWorkItemType(db, { organizationId, name: 'Job', schedulable: false });
  const statusId = await createWorkItemStatus(db, { organizationId, typeId, name: 'Open', position: 0 });
  const visit = await createPriceBookItem(db, { organizationId, name: 'Visit', unit: 'visit', unitAmountMinor: 10_000 });
  const job = async (key: string, customer: string, quantity: number) => {
    const customerId = await createCustomer(db, { organizationId, name: customer });
    const id = await createWorkItem(db, { organizationId, statusId, title: `${key} job`, customerId });
    await addPricedLine(db, { workItemId: id, priceBookItemId: visit, quantity });
    return id;
  };
  const overdue = await job('overdue', 'Ash Co', 1), soon = await job('soon', 'Birch Co', 2), later = await job('later', 'Cedar Co', 3), settled = await job('settled', 'Dogwood Co', 4);
  await job('quoted', 'Elm Co', 5);
  invoices.overdue = await issueInvoice(db, { workItemId: overdue, issuedAt: at(shiftDate(today, -20)), dueAt: at(shiftDate(today, -2)) });
  invoices.soon = await issueInvoice(db, { workItemId: soon, issuedAt: at(shiftDate(today, -5)), dueAt: at(shiftDate(today, 3)) });
  invoices.later = await issueInvoice(db, { workItemId: later, issuedAt: at(shiftDate(today, -1)), dueAt: at(shiftDate(today, 30)) });
  invoices.settled = await issueInvoice(db, { workItemId: settled, issuedAt: at(shiftDate(today, -3)), dueAt: at(shiftDate(today, 10)) });
  await recordPayment(db, { invoiceId: invoices.settled, amountMinor: 40_000, receivedAt: at(shiftDate(today, -1)) });
  await recordPayment(db, { invoiceId: invoices.overdue, amountMinor: 3_000, receivedAt: at(shiftDate(today, -1)), note: 'Deposit' });
  await recordPayment(db, { invoiceId: invoices.overdue, amountMinor: -1_000, receivedAt: at(today, '08:00'), note: 'Fee reversed' });
});

describe('Finance collection views are database filters whose counts match their rows', () => {
  it('splits unpaid invoices into overdue and due soon without sharing one, and Due soon equals the Dashboard window', async () => {
    const { db, organizationId } = alice;
    const overdue = await readFinanceInvoices(db, organizationId, { status: 'overdue' });
    const soon = await readFinanceInvoices(db, organizationId, financeFilters({ status: 'due-soon' }, ZONE));
    expect(overdue.rows.map(row => row.id)).toEqual([invoices.overdue]);
    expect(soon.rows.map(row => row.id)).toEqual([invoices.soon]);
    expect(overdue.total).toBe(overdue.rows.length);
    expect(soon.total).toBe(soon.rows.length);
    const window = dueSoonWindow(ZONE);
    expect((await readFinanceInvoices(db, organizationId, { status: 'outstanding', ...window })).total).toBe(soon.total);
  });

  it('feeds the Dashboard the same counts, and a business with records has started', async () => {
    const data = await loadFinanceOperating(alice.db, { organizationId: alice.organizationId, today: todayInZone(ZONE), timezone: ZONE, canReadReports: true });
    expect([data.overdue.total, data.dueSoon.total, data.open.total, data.quotes.total]).toEqual([1, 1, 3, 1]);
    expect(data.started).toBe(true);
    expect(data.cardCollection).toBe('off');
    // 10,000 owed less 3,000 received plus 1,000 reversed, in CAD only.
    expect(data.overdueAmounts).toEqual([{ currency: 'CAD', amount: '8000', count: 0 }]);
  });

  it('orders invoices by due date or largest balance in the database', async () => {
    const { db, organizationId } = alice;
    const byDue = await readFinanceInvoices(db, organizationId, { status: 'outstanding', sort: 'due' });
    expect(byDue.rows.map(row => row.id)).toEqual([invoices.overdue, invoices.soon, invoices.later]);
    const byBalance = await readFinanceInvoices(db, organizationId, { status: 'outstanding', sort: 'outstanding' });
    expect(byBalance.rows.map(row => row.outstandingMinor)).toEqual([30_000, 20_000, 8_000]);
  });

  it('tells receipts from corrections and manual entries from processor ones', async () => {
    const { db, organizationId } = alice;
    const corrections = await readFinancePayments(db, organizationId, { entry: 'corrections' });
    expect(corrections.total).toBe(1);
    expect(corrections.rows[0]).toMatchObject({ amountMinor: -1_000, note: 'Fee reversed', provider: null });
    expect((await readFinancePayments(db, organizationId, { entry: 'receipts' })).total).toBe(2);
    expect((await readFinancePayments(db, organizationId, { source: 'manual' })).total).toBe(3);
    expect((await readFinancePayments(db, organizationId, { source: 'processor' })).total).toBe(0);
    const largest = await readFinancePayments(db, organizationId, { sort: 'amount' });
    expect(largest.rows.map(row => row.amountMinor)).toEqual([40_000, 3_000, -1_000]);
  });

  it('orders quotes by amount and keeps invoiced Work apart from Work still to invoice', async () => {
    const { db, organizationId } = alice;
    const byAmount = await readFinanceQuotes(db, organizationId, { sort: 'amount' });
    expect(byAmount.rows.map(row => row.quoted?.totalMinor)).toEqual([50_000, 40_000, 30_000, 20_000, 10_000]);
    expect((await readFinanceQuotes(db, organizationId, { status: 'not-invoiced' })).rows.map(row => row.title)).toEqual(['quoted job']);
  });
});

describe('Finance views stay inside the organization and its permissions', () => {
  it('shows another business none of these records, whatever view it asks for', async () => {
    for (const filter of [{}, { status: 'overdue' }, financeFilters({ status: 'due-soon' }, ZONE), { sort: 'outstanding' }]) {
      expect((await readFinanceInvoices(bob.db, alice.organizationId, filter)).total).toBe(0);
    }
    expect((await readFinancePayments(bob.db, alice.organizationId, { entry: 'corrections' })).total).toBe(0);
    expect((await readFinanceQuotes(bob.db, alice.organizationId, { sort: 'amount' })).total).toBe(0);
  });

  it('refuses a correction from a role without payment recording, and the history is unchanged', async () => {
    const roleId = await createRole(alice.db, { organizationId: alice.organizationId, name: 'No payments', capabilities: CAPABILITIES.filter(capability => capability !== 'payment.record') });
    await assignRole(alice.db, { membershipId: alice.membershipId, roleId });
    try {
      await expect(recordPayment(alice.db, { invoiceId: invoices.overdue, amountMinor: -500 })).rejects.toThrow('You cannot record payments here.');
    } finally {
      const restored = await createRole(alice.db, { organizationId: alice.organizationId, name: `Owner ${randomUUID().slice(0, 6)}`, capabilities: [...ALL_CAPABILITIES] });
      await assignRole(alice.db, { membershipId: alice.membershipId, roleId: restored });
    }
    expect((await readFinancePayments(alice.db, alice.organizationId, { entry: 'corrections' })).total).toBe(1);
  });
});

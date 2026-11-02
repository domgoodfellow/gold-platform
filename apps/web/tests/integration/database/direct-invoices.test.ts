import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getInvoice,
  getInvoiceForWorkItem,
  invoiceStanding,
  issueDirectInvoice,
  issueInvoice,
  listCustomerInvoices,
  listOrganizationPayments,
  recordPayment,
} from '@/lib/domain/billing/invoices';
import { readFinanceInvoices, readFinancePayments, readFinanceSummary } from '@/lib/domain/billing/finance-reads';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createPriceBookItem, updatePriceBookItem } from '@/lib/domain/pricing/price-book';
import { addPricedLine } from '@/lib/domain/pricing/prices';
import { CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { listMembers } from '@/lib/domain/tenancy/members';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Invoicing a customer directly from the catalog, with no Work item (ADR-051, first slice).
 *
 * The properties held here are the ones a direct invoice could most easily get wrong: the price is
 * the catalog's and never the caller's, a retry is the same invoice, numbering is one sequence per
 * business shared with Work invoices even under concurrent issuance, nothing writes to the financial
 * tables except the issuing functions, and every reader and report that used to reach invoices only
 * through Work still counts a direct one.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string; statusId: string; itemId: string; customerId: string };

let pg: Client;
let alice: Tenant;
let bob: Tenant;

async function signIn(label: string): Promise<{ db: SupabaseClient; userId: string; email: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { db, userId: data.user.id, email };
}

/** A business with Billing switched on and paid for, one catalog item and one customer. */
async function newTenant(label: string): Promise<Tenant> {
  const { db, userId, email } = await signIn(label);
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, displayName: 'Founder', timezone: 'America/Toronto', currency: 'CAD' });
  await pg.query(`insert into public.organization_modules(organization_id,module_key,enabled_by) values($1,'billing',$2) on conflict do nothing`, [organizationId, userId]);
  await pg.query(
    `insert into public.organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note)
     select $1,'module:billing','2020-01-01','9999-12-31',1,0,'CAD',$2,'direct invoice test'
      where not exists (select 1 from public.organization_commercial_terms t where t.organization_id = $1 and t.product_key = 'module:billing')`,
    [organizationId, userId],
  );
  const typeId = await createWorkItemType(db, { schedulable: true, organizationId, name: 'Job' });
  const statusId = await createWorkItemStatus(db, { organizationId, typeId, name: 'Open', position: 0 });
  const itemId = await createPriceBookItem(db, { organizationId, name: 'Consultation', unit: 'hour', unitAmountMinor: 9_550 });
  const customerId = await createCustomer(db, { organizationId, name: `${label} Customer` });
  return { db, userId, organizationId, statusId, itemId, customerId };
}

const issue = (tenant: Tenant, input: Partial<Parameters<typeof issueDirectInvoice>[1]> = {}) =>
  issueDirectInvoice(tenant.db, {
    organizationId: tenant.organizationId,
    customerId: tenant.customerId,
    lines: [{ priceBookItemId: tenant.itemId, quantity: 2 }],
    issuanceKey: randomUUID(),
    ...input,
  });

/** The database function itself, so a request no application path would build can be sent. */
const rpc = (tenant: Tenant, overrides: Record<string, unknown> = {}) =>
  tenant.db.rpc('issue_direct_invoice', {
    p_organization_id: tenant.organizationId,
    p_customer_id: tenant.customerId,
    p_lines: [{ price_book_item_id: tenant.itemId, quantity: 1 }],
    p_issued_at: null as unknown as string,
    p_due_at: null as unknown as string,
    p_issuance_key: randomUUID(),
    ...overrides,
  });

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  [alice, bob] = await Promise.all([newTenant('direct-alice'), newTenant('direct-bob')]);
}, 120_000);

afterAll(async () => {
  await pg?.end();
});

describe('issuing an invoice directly to a customer', () => {
  it('copies the catalog price, names no Work, and is totalled by the one calculation', async () => {
    const id = await issue(alice, { lines: [{ priceBookItemId: alice.itemId, quantity: 3 }] });
    const invoice = await getInvoice(alice.db, { organizationId: alice.organizationId, invoiceId: id });

    expect(invoice).toMatchObject({ source: 'direct', workItemId: null, customerId: alice.customerId, billedTo: 'direct-alice Customer', currency: 'CAD' });
    expect(invoice!.lines).toEqual([expect.objectContaining({ description: 'Consultation', unit: 'hour', unitAmountMinor: 9_550, currency: 'CAD', quantity: 3, position: 1 })]);
    expect(invoiceStanding(invoice!)).toMatchObject({ total: { totalMinor: 28_650, currency: 'CAD' }, paidMinor: 0, outstandingMinor: 28_650, settled: false });
  });

  it('does not move when the catalog is re-priced afterwards', async () => {
    const item = await createPriceBookItem(alice.db, { organizationId: alice.organizationId, name: 'Inspection', unit: 'visit', unitAmountMinor: 5_000 });
    const id = await issue(alice, { lines: [{ priceBookItemId: item, quantity: 1 }] });
    await updatePriceBookItem(alice.db, { id: item, name: 'Inspection', unit: 'visit', unitAmountMinor: 99_000 });
    const invoice = await getInvoice(alice.db, { organizationId: alice.organizationId, invoiceId: id });
    expect(invoice!.lines[0].unitAmountMinor).toBe(5_000);
  });

  it('refuses any line that tries to set a price, discount or description, and anything that is not a whole quantity', async () => {
    for (const line of [
      { price_book_item_id: alice.itemId, quantity: 1, unit_amount_minor: 1 },
      { price_book_item_id: alice.itemId, quantity: 1, discount_minor: 500 },
      { price_book_item_id: alice.itemId, quantity: 1, description: 'Free' },
      { price_book_item_id: alice.itemId, quantity: 0 },
      { price_book_item_id: alice.itemId, quantity: -2 },
      { price_book_item_id: alice.itemId, quantity: 1.5 },
      { price_book_item_id: alice.itemId, quantity: '3' },
      { price_book_item_id: alice.itemId, quantity: 1_000_001 },
      { price_book_item_id: 'not-a-uuid', quantity: 1 },
      { quantity: 1 },
    ]) {
      const { error } = await rpc(alice, { p_lines: [line] });
      expect(error?.code, JSON.stringify(line)).toBe('22023');
    }
    for (const lines of [[], {}, 'lines', null]) {
      const { error } = await rpc(alice, { p_lines: lines });
      expect(error?.code, JSON.stringify(lines)).toBe('22023');
    }
  });

  it('has no argument through which a total, currency or number could be supplied', async () => {
    const { rows } = await pg.query<{ args: string }>(`select pg_get_function_identity_arguments('public.issue_direct_invoice(uuid,uuid,jsonb,timestamptz,timestamptz,uuid)'::regprocedure) as args`);
    expect(rows[0].args).toBe('p_organization_id uuid, p_customer_id uuid, p_lines jsonb, p_issued_at timestamp with time zone, p_due_at timestamp with time zone, p_issuance_key uuid');
  });

  it('refuses a due date before the invoice date, and an issuance with no key', async () => {
    expect((await rpc(alice, { p_issued_at: '2026-10-10T04:00:00Z', p_due_at: '2026-10-09T04:00:00Z' })).error?.code).toBe('22023');
    expect((await rpc(alice, { p_issuance_key: null })).error?.code).toBe('22023');
  });

  it('refuses an item priced in a currency the business does not trade in', async () => {
    const { rows } = await pg.query<{ id: string }>(
      `insert into public.price_book_items(organization_id,name,unit,unit_amount_minor,currency,created_by) values($1,'Imported','each',1000,'USD',$2) returning id`,
      [alice.organizationId, alice.userId],
    );
    await expect(issue(alice, { lines: [{ priceBookItemId: rows[0].id, quantity: 1 }] })).rejects.toMatchObject({ code: 'invoices.currency_unsupported' });
  });
});

describe('who may issue it, and for whom', () => {
  it('refuses a member without invoice.issue', async () => {
    const clerk = await signIn('direct-clerk');
    const roleId = await createRole(alice.db, { organizationId: alice.organizationId, name: `No invoicing ${randomUUID().slice(0, 4)}`, capabilities: CAPABILITIES.filter((c) => c !== 'invoice.issue') });
    await pg.query(`insert into public.memberships(organization_id,user_id,role_id,created_by,display_name) values($1,$2,$3,$4,'Clerk')`, [alice.organizationId, clerk.userId, roleId, alice.userId]);
    const member = (await listMembers(alice.db, { organizationId: alice.organizationId })).find((m) => m.userId === clerk.userId)!;
    await assignRole(alice.db, { membershipId: member.id, roleId });

    const { error } = await clerk.db.rpc('issue_direct_invoice', {
      p_organization_id: alice.organizationId, p_customer_id: alice.customerId, p_lines: [{ price_book_item_id: alice.itemId, quantity: 1 }],
      p_issued_at: null as unknown as string, p_due_at: null as unknown as string, p_issuance_key: randomUUID(),
    });
    expect(error?.code).toBe('42501');
  });

  it('refuses another business, its customers and its catalog items', async () => {
    expect((await rpc(bob, { p_organization_id: alice.organizationId })).error?.code).toBe('42501');
    expect((await rpc(alice, { p_customer_id: bob.customerId })).error?.code).toBe('GD011');
    expect((await rpc(alice, { p_customer_id: randomUUID() })).error?.code).toBe('GD011');
    expect((await rpc(alice, { p_lines: [{ price_book_item_id: bob.itemId, quantity: 1 }] })).error?.code).toBe('GD012');
    expect((await rpc(alice, { p_lines: [{ price_book_item_id: alice.itemId, quantity: 1 }, { price_book_item_id: bob.itemId, quantity: 1 }] })).error?.code).toBe('GD012');
  });

  it('refuses a business whose Billing module is not usable', async () => {
    const { db, userId, email } = await signIn('direct-nobilling');
    const organizationId = await foundBusiness({ ownerEmail: email, name: 'No billing Ltd', displayName: 'Founder', timezone: 'America/Toronto', currency: 'CAD' });
    const itemId = await createPriceBookItem(db, { organizationId, name: 'Thing', unit: 'each', unitAmountMinor: 100 });
    const customerId = await createCustomer(db, { organizationId, name: 'Someone' });
    // Founding switches Billing on; this business switches it off again.
    await pg.query(`delete from public.organization_modules where organization_id = $1 and module_key = 'billing'`, [organizationId]);
    const { error } = await rpc({ db, userId, organizationId, itemId, customerId, statusId: '' });
    expect(error?.code).toBe('42501');
  });

  it('is invisible to another business', async () => {
    const id = await issue(alice);
    expect(await getInvoice(bob.db, { organizationId: alice.organizationId, invoiceId: id })).toBeNull();
    const { data } = await bob.db.from('finance_invoice_records').select('id').eq('id', id);
    expect(data).toEqual([]);
  });

  it('refuses an anonymous caller', async () => {
    const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await anon.rpc('issue_direct_invoice', {
      p_organization_id: alice.organizationId, p_customer_id: alice.customerId, p_lines: [{ price_book_item_id: alice.itemId, quantity: 1 }],
      p_issued_at: null as unknown as string, p_due_at: null as unknown as string, p_issuance_key: randomUUID(),
    });
    expect(error).not.toBeNull();
  });
});

describe('retries and numbering', () => {
  it('returns the same invoice for the same request, and refuses the same key for a different one', async () => {
    const key = randomUUID();
    const first = await issue(alice, { issuanceKey: key });
    const again = await issue(alice, { issuanceKey: key });
    expect(again).toBe(first);
    const { rows } = await pg.query(`select count(*)::int as n from public.invoices where organization_id = $1 and issuance_key = $2`, [alice.organizationId, key]);
    expect(rows[0].n).toBe(1);
    await expect(issue(alice, { issuanceKey: key, lines: [{ priceBookItemId: alice.itemId, quantity: 9 }] })).rejects.toMatchObject({ code: 'invoices.request_reused' });
  });

  it('shares one sequence with Work invoices and stays gapless under concurrent issuance', async () => {
    const work = await createWorkItem(alice.db, { organizationId: alice.organizationId, statusId: alice.statusId, title: 'Concurrent job' });
    await addPricedLine(alice.db, { workItemId: work, priceBookItemId: alice.itemId, quantity: 1 });
    const before = await pg.query<{ n: number }>(`select coalesce(max(number),0)::int as n from public.invoices where organization_id = $1`, [alice.organizationId]);

    const ids = await Promise.all([
      ...Array.from({ length: 8 }, () => issue(alice)),
      issueInvoice(alice.db, { workItemId: work }),
    ]);

    const { rows } = await pg.query<{ number: number; source: string }>(
      `select number, source from public.invoices where organization_id = $1 and id = any($2::uuid[]) order by number`,
      [alice.organizationId, ids],
    );
    expect(rows.map((row) => row.number)).toEqual(Array.from({ length: 9 }, (_, index) => before.rows[0].n + 1 + index));
    expect(rows.filter((row) => row.source === 'work_item')).toHaveLength(1);
  });

  it('keeps per-business numbering: another business starts at its own 1', async () => {
    const fresh = await newTenant('direct-fresh');
    const id = await issue(fresh);
    expect((await getInvoice(fresh.db, { organizationId: fresh.organizationId, invoiceId: id }))!.number).toBe(1);
  });
});

describe('fixed once issued, and written only by the issuing functions', () => {
  it('lets no signed-in member insert, change or delete an invoice, a line or a payment directly', async () => {
    const id = await issue(alice);
    const insertInvoice = await alice.db.from('invoices').insert({ organization_id: alice.organizationId, source: 'direct', customer_id: alice.customerId, billed_to: 'Forged', number: 999_999, currency: 'CAD', created_by: alice.userId, issuance_key: randomUUID(), issuance_fingerprint: 'x' });
    expect(insertInvoice.error).not.toBeNull();
    const insertLine = await alice.db.from('invoice_lines').insert({ organization_id: alice.organizationId, invoice_id: id, description: 'Extra', unit: 'each', unit_amount_minor: 1, currency: 'CAD', quantity: 1, position: 9 });
    expect(insertLine.error).not.toBeNull();
    const insertPayment = await alice.db.from('payments').insert({ organization_id: alice.organizationId, invoice_id: id, amount_minor: 1, currency: 'CAD', created_by: alice.userId });
    expect(insertPayment.error).not.toBeNull();

    await alice.db.from('invoice_lines').update({ unit_amount_minor: 1 }).eq('invoice_id', id);
    await alice.db.from('invoices').update({ billed_to: 'Someone else' }).eq('id', id);
    await alice.db.from('invoice_lines').delete().eq('invoice_id', id);
    await alice.db.from('invoices').delete().eq('id', id);
    const invoice = await getInvoice(alice.db, { organizationId: alice.organizationId, invoiceId: id });
    expect(invoice).toMatchObject({ billedTo: 'direct-alice Customer' });
    expect(invoice!.lines[0].unitAmountMinor).toBe(9_550);
  });

  it('holds the grants and policies to the issuing functions alone', async () => {
    const { rows } = await pg.query<{ relname: string; insert: boolean; update: boolean; delete: boolean }>(
      `select c.relname,
              has_table_privilege('authenticated', c.oid, 'insert') as insert,
              has_table_privilege('authenticated', c.oid, 'update') as update,
              has_table_privilege('authenticated', c.oid, 'delete') as delete
         from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('invoices','invoice_lines','payments') order by 1`,
    );
    expect(rows).toEqual([
      { relname: 'invoice_lines', insert: false, update: false, delete: false },
      { relname: 'invoices', insert: false, update: false, delete: false },
      { relname: 'payments', insert: false, update: false, delete: false },
    ]);
    const policies = await pg.query(`select policyname from pg_policies where tablename in ('invoices','invoice_lines','payments') and cmd <> 'SELECT'`);
    expect(policies.rows).toEqual([]);
    const fns = await pg.query<{ proname: string; secdef: boolean; anon: boolean; authenticated: boolean; config: string[] }>(
      `select p.proname, p.prosecdef as secdef, has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated, p.proconfig as config
         from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('issue_direct_invoice','issue_invoice','record_payment') order by 1`,
    );
    expect(fns.rows).toEqual([
      { proname: 'issue_direct_invoice', secdef: true, anon: false, authenticated: true, config: ['search_path=""'] },
      { proname: 'issue_invoice', secdef: true, anon: false, authenticated: true, config: ['search_path=""'] },
      { proname: 'record_payment', secdef: true, anon: false, authenticated: true, config: ['search_path=""'] },
    ]);
    const numbering = await pg.query(`select has_function_privilege('authenticated', 'app.allocate_invoice_number(uuid)', 'execute') as allowed`);
    expect(numbering.rows[0].allowed).toBe(false);
  });

  it('refuses a source and Work reference that disagree, in the table itself', async () => {
    const work = await createWorkItem(alice.db, { organizationId: alice.organizationId, statusId: alice.statusId, title: 'Mismatch' });
    for (const [source, workItemId, key] of [['direct', work, randomUUID()], ['work_item', null, null], ['direct', null, null], ['work_item', work, randomUUID()]] as const) {
      await expect(pg.query(
        `insert into public.invoices(organization_id,source,work_item_id,customer_id,billed_to,number,currency,created_by,issuance_key,issuance_fingerprint)
         values($1,$2,$3,$4,'x',$5,'CAD',$6,$7,$8)`,
        [alice.organizationId, source, workItemId, alice.customerId, 900_000 + Math.floor(Math.random() * 90_000), alice.userId, key, key ? 'f' : null],
      ), `${source} / ${workItemId ? 'work' : 'no work'} / ${key ? 'key' : 'no key'}`).rejects.toMatchObject({ code: '23514' });
    }
  });

  it('keeps one invoice per Work item, exactly as before', async () => {
    const work = await createWorkItem(alice.db, { organizationId: alice.organizationId, statusId: alice.statusId, title: 'Once only' });
    await addPricedLine(alice.db, { workItemId: work, priceBookItemId: alice.itemId, quantity: 1 });
    await issueInvoice(alice.db, { workItemId: work });
    await expect(issueInvoice(alice.db, { workItemId: work })).rejects.toMatchObject({ code: 'invoices.already_issued' });
    expect((await getInvoiceForWorkItem(alice.db, { organizationId: alice.organizationId, workItemId: work }))!.source).toBe('work_item');
  });
});

describe('money arriving against a direct invoice', () => {
  it('settles by arithmetic and records its event against the invoice, not a Work item', async () => {
    const id = await issue(alice, { lines: [{ priceBookItemId: alice.itemId, quantity: 1 }] });
    const paymentId = await recordPayment(alice.db, { invoiceId: id, amountMinor: 9_550 });
    const invoice = await getInvoice(alice.db, { organizationId: alice.organizationId, invoiceId: id });
    expect(invoiceStanding(invoice!)).toMatchObject({ paidMinor: 9_550, outstandingMinor: 0, settled: true });
    const { rows } = await pg.query(`select entity_type, entity_id from public.events where organization_id = $1 and action = 'payment.recorded' and payload->>'payment_id' = $2`, [alice.organizationId, paymentId]);
    expect(rows).toEqual([{ entity_type: 'invoice', entity_id: id }]);
  });

  it('refuses a payment on another business’s direct invoice', async () => {
    const id = await issue(alice);
    await expect(recordPayment(bob.db, { invoiceId: id, amountMinor: 100 })).rejects.toBeTruthy();
  });
});

describe('every reader and report counts a direct invoice', () => {
  it('appears in the Finance lists, payments, customer history and Dashboard totals', async () => {
    const tenant = await newTenant('direct-reports');
    const work = await createWorkItem(tenant.db, { organizationId: tenant.organizationId, statusId: tenant.statusId, title: 'Work job', customerId: tenant.customerId });
    await addPricedLine(tenant.db, { workItemId: work, priceBookItemId: tenant.itemId, quantity: 1 });
    const workInvoice = await issueInvoice(tenant.db, { workItemId: work });
    const direct = await issue(tenant, { lines: [{ priceBookItemId: tenant.itemId, quantity: 2 }] });
    await recordPayment(tenant.db, { invoiceId: direct, amountMinor: 1_000 });

    const listed = await readFinanceInvoices(tenant.db, tenant.organizationId);
    expect(listed.rows.map((row) => [row.id, row.source, row.workItemId]).sort()).toEqual([[direct, 'direct', null], [workInvoice, 'work_item', work]].sort());

    const payments = await readFinancePayments(tenant.db, tenant.organizationId);
    expect(payments.rows).toEqual([expect.objectContaining({ invoiceId: direct, invoiceSource: 'direct', workItemId: null, amountMinor: 1_000 })]);
    const domainPayments = await listOrganizationPayments(tenant.db, { organizationId: tenant.organizationId });
    expect(domainPayments.map((row) => [row.invoiceId, row.invoiceSource, row.workItemId])).toEqual([[direct, 'direct', null]]);

    const history = await listCustomerInvoices(tenant.db, { organizationId: tenant.organizationId, customerId: tenant.customerId });
    expect(history.map((invoice) => invoice.source).sort()).toEqual(['direct', 'work_item']);

    const summary = await readFinanceSummary(tenant.db, tenant.organizationId, '2020-01-01', '2100-01-01');
    expect(summary.issued).toBe(2);
    expect(summary.outstanding).toEqual([{ currency: 'CAD', amount: String(9_550 + 2 * 9_550 - 1_000), count: 2 }]);
  });

  it('is in the revenue report by customer and by service, and only unattributed by location or resource', async () => {
    const tenant = await newTenant('direct-revenue');
    await issue(tenant, { lines: [{ priceBookItemId: tenant.itemId, quantity: 2 }] });
    const report = (grouping: string, extra: Record<string, unknown> = {}) =>
      tenant.db.rpc('invoiced_and_incurred', { p_organization_id: tenant.organizationId, p_grouping: grouping, ...extra });

    const byCustomer = await report('customer');
    expect(byCustomer.data).toEqual([expect.objectContaining({ group_id: tenant.customerId, currency: 'CAD', invoiced_minor: 19_100 })]);
    const byService = await report('service');
    expect(byService.data).toEqual([expect.objectContaining({ group_label: 'Consultation', invoiced_minor: 19_100 })]);
    const byLocation = await report('location');
    expect(byLocation.data).toEqual([expect.objectContaining({ group_id: null, invoiced_minor: 19_100 })]);
    const filtered = await report('customer', { p_customer_id: tenant.customerId });
    expect(filtered.data).toEqual([expect.objectContaining({ invoiced_minor: 19_100 })]);
    const elsewhere = await report('customer', { p_location_id: randomUUID() });
    expect(elsewhere.data).toEqual([]);
  });
});

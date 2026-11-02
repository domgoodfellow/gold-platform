import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getInvoice,
  invoiceStanding,
  issueDirectInvoice,
  issueInvoiceFromProposal,
  listCustomerInvoices,
  listInvoicesForProposals,
} from '@/lib/domain/billing/invoices';
import { readFinanceInvoice, readFinanceInvoices } from '@/lib/domain/billing/finance-reads';
import {
  acceptCommercialProposal,
  buildCatalogProposal,
  declineCommercialProposal,
  getCommercialProposal,
  listCommercialProposals,
  markCommercialProposalSent,
} from '@/lib/domain/customers/commercial-proposals';
import { createCustomer } from '@/lib/domain/customers/customers';
import { claimProposalInvite, createProposalInvite } from '@/lib/domain/customers/proposal-invites';
import { getPlan } from '@/lib/domain/catalogue/plans';
import { createPriceBookItem, updatePriceBookItem } from '@/lib/domain/pricing/price-book';
import { CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { listMembers } from '@/lib/domain/tenancy/members';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { foundBusiness } from '@/tests/support/founding';
import { seedLegacyPlanProposal } from '@/tests/support/legacy-proposals';

/**
 * Invoicing an accepted commercial proposal (ADR-051, third slice).
 *
 * What is held here: acceptance means the customer accepted (a seller can neither accept for them
 * nor move a sent proposal back), terms never change after building; only an accepted one-off
 * catalog proposal of the caller's own business is invoiced, once, from its own snapshotted lines
 * and never today's catalog; a retry is the same invoice and a race issues one; numbering stays
 * one sequence; and issuing records no payment and provisions nothing.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string; itemId: string; secondItemId: string; customerId: string };

let pg: Client;
let alice: Tenant;
let bob: Tenant;

const anon = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function signIn(label: string): Promise<{ db: SupabaseClient; userId: string; email: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = anon();
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { db, userId: data.user.id, email };
}

/** An ordinary business — not GildOps — with Billing usable, two catalog items and one customer. */
async function newTenant(label: string): Promise<Tenant> {
  const { db, userId, email } = await signIn(label);
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, displayName: 'Founder', timezone: 'America/Toronto', currency: 'CAD' });
  await pg.query(`insert into public.organization_modules(organization_id,module_key,enabled_by) values($1,'billing',$2) on conflict do nothing`, [organizationId, userId]);
  await pg.query(
    `insert into public.organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note)
     select $1,'module:billing','2020-01-01','9999-12-31',1,0,'CAD',$2,'proposal invoice test'
      where not exists (select 1 from public.organization_commercial_terms t where t.organization_id = $1 and t.product_key = 'module:billing')`,
    [organizationId, userId],
  );
  const itemId = await createPriceBookItem(db, { organizationId, name: 'Garden design', unit: 'hour', unitAmountMinor: 12_000 });
  const secondItemId = await createPriceBookItem(db, { organizationId, name: 'Site visit', unit: 'visit', unitAmountMinor: 7_500 });
  const customerId = await createCustomer(db, { organizationId, name: `${label} Customer` });
  return { db, userId, organizationId, itemId, secondItemId, customerId };
}

/** Send a proposal and open it as its recipient, the way the emailed link does. */
async function recipientOf(tenant: Tenant, proposalId: string): Promise<SupabaseClient> {
  await markCommercialProposalSent(tenant.db, { organizationId: tenant.organizationId, proposalId });
  const token = await createProposalInvite(tenant.db, { customerId: tenant.customerId });
  const visitor = anon();
  await claimProposalInvite(visitor, { token });
  return visitor;
}

/** Garden design × 3 and Site visit × 2, sent and accepted by the customer: 36,000 + 15,000. */
async function acceptedProposal(tenant: Tenant): Promise<string> {
  const built = await buildCatalogProposal(tenant.db, {
    organizationId: tenant.organizationId,
    customerId: tenant.customerId,
    lines: [{ priceBookItemId: tenant.itemId, quantity: 3 }, { priceBookItemId: tenant.secondItemId, quantity: 2 }],
  });
  const visitor = await recipientOf(tenant, built.id);
  await acceptCommercialProposal(visitor, { proposalId: built.id });
  return built.id;
}

const rpc = (db: SupabaseClient, proposalId: string, overrides: Record<string, unknown> = {}) =>
  db.rpc('issue_invoice_from_proposal', {
    p_proposal_id: proposalId,
    p_issued_at: null as unknown as string,
    p_due_at: null as unknown as string,
    p_issuance_key: randomUUID(),
    ...overrides,
  });

async function invoiceCount(organizationId: string): Promise<number> {
  const { rows } = await pg.query(`select count(*)::int as n from public.invoices where organization_id = $1`, [organizationId]);
  return rows[0].n;
}

/** Writes as the database owner with triggers off, to build a snapshot no function would ever write. */
async function corrupt(sql: string, params: unknown[]) {
  await pg.query('begin');
  try {
    await pg.query('set local session_replication_role = replica');
    await pg.query(sql, params);
    await pg.query('commit');
  } catch (error) {
    await pg.query('rollback');
    throw error;
  }
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  alice = await newTenant('propinv-alice');
  bob = await newTenant('propinv-bob');
}, 120_000);

afterAll(async () => {
  await pg?.end();
});

describe('a proposal moves forward only', () => {
  it('lets the seller send a draft, and nothing else', async () => {
    const built = await buildCatalogProposal(alice.db, { organizationId: alice.organizationId, customerId: alice.customerId, lines: [{ priceBookItemId: alice.itemId, quantity: 1 }] });
    const table = () => alice.db.from('customer_commercial_proposals');

    // Draft straight to accepted or declined: the seller cannot answer for the customer.
    for (const status of ['accepted', 'declined'] as const) {
      const { error } = await table().update({ status }).eq('id', built.id);
      expect(error?.code).toBe('GD021');
    }

    await markCommercialProposalSent(alice.db, { organizationId: alice.organizationId, proposalId: built.id });
    for (const status of ['draft', 'accepted', 'declined'] as const) {
      const { error } = await table().update({ status }).eq('id', built.id);
      expect(error?.code).toBe('GD021');
    }
    // Terms are not even writable columns for a signed-in client.
    const { error: notes } = await table().update({ notes: 'cheaper' } as never).eq('id', built.id);
    expect(notes).not.toBeNull();

    expect(await getCommercialProposal(alice.db, { organizationId: alice.organizationId, proposalId: built.id })).toMatchObject({ status: 'sent', acceptedAt: null, notes: '' });
  });

  it('refuses sent → draft and any change of terms even to the database owner', async () => {
    const built = await buildCatalogProposal(alice.db, { organizationId: alice.organizationId, customerId: alice.customerId, lines: [{ priceBookItemId: alice.itemId, quantity: 1 }] });
    await markCommercialProposalSent(alice.db, { organizationId: alice.organizationId, proposalId: built.id });

    await expect(pg.query(`update public.customer_commercial_proposals set status = 'draft' where id = $1`, [built.id])).rejects.toMatchObject({ code: 'GD021' });
    await expect(pg.query(`update public.customer_commercial_proposals set catalog_total_minor = 1 where id = $1`, [built.id])).rejects.toMatchObject({ code: 'GD021' });
    await expect(pg.query(`update public.customer_commercial_proposals set notes = 'x' where id = $1`, [built.id])).rejects.toMatchObject({ code: 'GD021' });
  });

  it('keeps the customer’s accept and decline, once each, and an answered proposal never moves again', async () => {
    const acceptedId = await acceptedProposal(alice);
    await expect(pg.query(`update public.customer_commercial_proposals set status = 'sent' where id = $1`, [acceptedId])).rejects.toMatchObject({ code: 'GD021' });
    await expect(pg.query(`update public.customer_commercial_proposals set status = 'declined' where id = $1`, [acceptedId])).rejects.toMatchObject({ code: 'GD021' });

    const declined = await buildCatalogProposal(alice.db, { organizationId: alice.organizationId, customerId: alice.customerId, lines: [{ priceBookItemId: alice.itemId, quantity: 1 }] });
    const visitor = await recipientOf(alice, declined.id);
    await declineCommercialProposal(visitor, { proposalId: declined.id });
    expect(await getCommercialProposal(alice.db, { organizationId: alice.organizationId, proposalId: declined.id })).toMatchObject({ status: 'declined' });
    await expect(pg.query(`update public.customer_commercial_proposals set status = 'accepted' where id = $1`, [declined.id])).rejects.toMatchObject({ code: 'GD021' });
  });
});

describe('invoicing an accepted catalog proposal', () => {
  it('copies the accepted lines and prices, not today’s catalog, and records no payment or provisioning', async () => {
    const tenant = await newTenant('propinv-price');
    const proposalId = await acceptedProposal(tenant);
    // The catalog moves after acceptance.
    await updatePriceBookItem(tenant.db, { id: tenant.itemId, name: 'Garden design (new)', unit: 'hour', unitAmountMinor: 99_900 });
    const handoffsBefore = (await pg.query(`select count(*)::int as n from public.customer_proposal_handoffs`)).rows[0].n;
    const orgsBefore = (await pg.query(`select count(*)::int as n from public.organizations`)).rows[0].n;

    const id = await issueInvoiceFromProposal(tenant.db, { proposalId, issuanceKey: randomUUID() });
    const invoice = await getInvoice(tenant.db, { organizationId: tenant.organizationId, invoiceId: id });

    expect(invoice).toMatchObject({ source: 'proposal', proposalId, workItemId: null, customerId: tenant.customerId, billedTo: 'propinv-price Customer', currency: 'CAD', number: 1 });
    expect(invoice!.lines.map((l) => [l.description, l.unit, l.quantity, l.unitAmountMinor, l.position])).toEqual([
      ['Garden design', 'hour', 3, 12_000, 1],
      ['Site visit', 'visit', 2, 7_500, 2],
    ]);
    expect(invoiceStanding(invoice!)).toMatchObject({ total: { totalMinor: 51_000, currency: 'CAD' }, paidMinor: 0, outstandingMinor: 51_000, settled: false });
    expect(invoice!.payments).toEqual([]);

    // The proposal is not rewritten.
    expect(await getCommercialProposal(tenant.db, { organizationId: tenant.organizationId, proposalId })).toMatchObject({ status: 'accepted', catalogTotalMinor: 51_000 });
    expect((await pg.query(`select count(*)::int as n from public.customer_proposal_handoffs`)).rows[0].n).toBe(handoffsBefore);
    expect((await pg.query(`select count(*)::int as n from public.organizations`)).rows[0].n).toBe(orgsBefore);
    expect((await pg.query(`select count(*)::int as n from public.payments where invoice_id = $1`, [id])).rows[0].n).toBe(0);

    const { rows } = await pg.query(`select action, entity_type, payload from public.events where organization_id = $1 and entity_id = $2`, [tenant.organizationId, id]);
    expect(rows).toEqual([expect.objectContaining({ action: 'invoice.issued', entity_type: 'invoice', payload: expect.objectContaining({ source: 'proposal', proposal_id: proposalId }) })]);
  });

  it('is read by Finance, customer history and the proposal lookup like any other invoice', async () => {
    const tenant = await newTenant('propinv-read');
    const proposalId = await acceptedProposal(tenant);
    const id = await issueInvoiceFromProposal(tenant.db, { proposalId, issuanceKey: randomUUID() });

    expect(await readFinanceInvoice(tenant.db, tenant.organizationId, id)).toMatchObject({ source: 'proposal', proposalId, workItemId: null, total: { totalMinor: 51_000 }, outstandingMinor: 51_000 });
    expect((await readFinanceInvoices(tenant.db, tenant.organizationId)).rows.map((r) => r.id)).toContain(id);
    expect((await listCustomerInvoices(tenant.db, { organizationId: tenant.organizationId, customerId: tenant.customerId })).map((i) => i.id)).toEqual([id]);
    expect(await listInvoicesForProposals(tenant.db, { organizationId: tenant.organizationId, proposalIds: [proposalId] })).toEqual({ [proposalId]: { id, number: 1 } });

    const { data: revenue, error } = await tenant.db.rpc('invoiced_and_incurred', { p_organization_id: tenant.organizationId, p_grouping: 'customer' });
    expect(error).toBeNull();
    expect(revenue).toEqual([expect.objectContaining({ group_id: tenant.customerId, invoiced_minor: 51_000 })]);
  });

  it('returns the same invoice for the same request, and refuses the key reused with other terms', async () => {
    const proposalId = await acceptedProposal(alice);
    const key = randomUUID();
    const first = await issueInvoiceFromProposal(alice.db, { proposalId, issuanceKey: key, issuedAt: '2026-11-02T05:00:00Z' });
    const again = await issueInvoiceFromProposal(alice.db, { proposalId, issuanceKey: key, issuedAt: '2026-11-02T05:00:00Z' });
    expect(again).toBe(first);

    const { error } = await rpc(alice.db, proposalId, { p_issuance_key: key, p_issued_at: '2026-11-03T05:00:00Z' });
    expect(error?.code).toBe('GD014');
  });

  it('never invoices the same proposal twice, under another key or concurrently', async () => {
    const tenant = await newTenant('propinv-race');
    const proposalId = await acceptedProposal(tenant);

    const results = await Promise.all([1, 2, 3, 4].map(() => rpc(tenant.db, proposalId)));
    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    expect(results.filter((r) => r.error).map((r) => r.error!.code)).toEqual(['GD015', 'GD015', 'GD015']);
    expect(await invoiceCount(tenant.organizationId)).toBe(1);

    const { error } = await rpc(tenant.db, proposalId);
    expect(error?.code).toBe('GD015');
    // The database itself refuses a second row, whoever writes it.
    await expect(pg.query(
      `insert into public.invoices (organization_id, source, proposal_id, customer_id, billed_to, number, currency, issued_at, created_by, issuance_key, issuance_fingerprint)
       values ($1, 'proposal', $2, $3, 'x', 99, 'CAD', now(), $4, gen_random_uuid(), 'x')`,
      [tenant.organizationId, proposalId, tenant.customerId, tenant.userId],
    )).rejects.toMatchObject({ code: '23505' });
  });

  it('shares one numbering sequence with direct invoices, with no gaps or repeats', async () => {
    const tenant = await newTenant('propinv-number');
    const proposalId = await acceptedProposal(tenant);
    const direct = () => issueDirectInvoice(tenant.db, { organizationId: tenant.organizationId, customerId: tenant.customerId, lines: [{ priceBookItemId: tenant.itemId, quantity: 1 }], issuanceKey: randomUUID() });

    await direct();
    await Promise.all([rpc(tenant.db, proposalId), direct(), direct()]);
    const { rows } = await pg.query(`select number, source from public.invoices where organization_id = $1 order by number`, [tenant.organizationId]);
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3, 4]);
    expect(rows.filter((r) => r.source === 'proposal')).toHaveLength(1);
  });

  it('cannot be changed afterwards by a signed-in client', async () => {
    const tenant = await newTenant('propinv-immutable');
    const proposalId = await acceptedProposal(tenant);
    const id = await issueInvoiceFromProposal(tenant.db, { proposalId, issuanceKey: randomUUID() });

    await tenant.db.from('invoice_lines').update({ unit_amount_minor: 1 }).eq('invoice_id', id);
    await tenant.db.from('invoice_lines').delete().eq('invoice_id', id);
    await tenant.db.from('invoices').update({ proposal_id: null, billed_to: 'x' } as never).eq('id', id);
    await tenant.db.from('invoices').delete().eq('id', id);
    await tenant.db.from('customer_commercial_proposal_lines').update({ unit_amount_minor: 1 }).eq('proposal_id', proposalId);

    const invoice = await getInvoice(tenant.db, { organizationId: tenant.organizationId, invoiceId: id });
    expect(invoice).toMatchObject({ proposalId, billedTo: 'propinv-immutable Customer' });
    expect(invoiceStanding(invoice!).total).toEqual({ totalMinor: 51_000, currency: 'CAD' });
    expect((await getCommercialProposal(tenant.db, { organizationId: tenant.organizationId, proposalId }))!.lines.map((l) => l.unitAmountMinor)).toEqual([12_000, 7_500]);
    // A proposal behind an invoice cannot be deleted out from under it.
    await expect(pg.query(`delete from public.customer_commercial_proposals where id = $1`, [proposalId])).rejects.toMatchObject({ code: '23503' });
  });
});

describe('what is refused', () => {
  it('a draft, sent or declined proposal', async () => {
    const draft = await buildCatalogProposal(alice.db, { organizationId: alice.organizationId, customerId: alice.customerId, lines: [{ priceBookItemId: alice.itemId, quantity: 1 }] });
    expect((await rpc(alice.db, draft.id)).error?.code).toBe('GD019');
    await markCommercialProposalSent(alice.db, { organizationId: alice.organizationId, proposalId: draft.id });
    expect((await rpc(alice.db, draft.id)).error?.code).toBe('GD019');

    const declined = await buildCatalogProposal(alice.db, { organizationId: alice.organizationId, customerId: alice.customerId, lines: [{ priceBookItemId: alice.itemId, quantity: 1 }] });
    await declineCommercialProposal(await recipientOf(alice, declined.id), { proposalId: declined.id });
    expect((await rpc(alice.db, declined.id)).error?.code).toBe('GD019');
  });

  it('an accepted legacy Platform Plan proposal', async () => {
    const tenant = await newTenant('propinv-legacy');
    const start = await getPlan(tenant.db, 'start');
    const legacy = await seedLegacyPlanProposal({ organizationId: tenant.organizationId, customerId: tenant.customerId, createdBy: tenant.userId, planId: start!.id, currency: 'CAD', billingInterval: 'month' });
    await acceptCommercialProposal(await recipientOf(tenant, legacy.id), { proposalId: legacy.id });

    expect((await rpc(tenant.db, legacy.id)).error?.code).toBe('GD019');
    expect(await invoiceCount(tenant.organizationId)).toBe(0);
  });

  it('another business’s proposal, a member without invoice.issue, a signed-out caller and a business without Billing', async () => {
    const proposalId = await acceptedProposal(bob);
    expect((await rpc(alice.db, proposalId)).error?.code).toBe('42501');
    expect((await rpc(anon(), proposalId)).error).not.toBeNull();

    const clerk = await signIn('propinv-clerk');
    const roleId = await createRole(bob.db, { organizationId: bob.organizationId, name: `No invoicing ${randomUUID().slice(0, 4)}`, capabilities: CAPABILITIES.filter((c) => c !== 'invoice.issue') });
    await pg.query(`insert into public.memberships(organization_id,user_id,role_id,created_by,display_name) values($1,$2,$3,$4,'Clerk')`, [bob.organizationId, clerk.userId, roleId, bob.userId]);
    const member = (await listMembers(bob.db, { organizationId: bob.organizationId })).find((m) => m.userId === clerk.userId)!;
    await assignRole(bob.db, { membershipId: member.id, roleId });
    expect((await rpc(clerk.db, proposalId)).error?.code).toBe('42501');

    const solo = await newTenant('propinv-nobilling');
    const soloProposal = await acceptedProposal(solo);
    await pg.query(`delete from public.organization_modules where organization_id = $1 and module_key = 'billing'`, [solo.organizationId]);
    expect((await rpc(solo.db, soloProposal)).error?.code).toBe('42501');

    expect(await invoiceCount(bob.organizationId)).toBe(0);
    expect(await invoiceCount(solo.organizationId)).toBe(0);
  });

  it('a request without a key, or due before it is issued', async () => {
    const proposalId = await acceptedProposal(alice);
    expect((await rpc(alice.db, proposalId, { p_issuance_key: null })).error?.code).toBe('22023');
    expect((await rpc(alice.db, proposalId, { p_issued_at: '2026-11-10T00:00:00Z', p_due_at: '2026-11-01T00:00:00Z' })).error?.code).toBe('22023');
  });

  it('a snapshot that does not add up, rather than repricing it', async () => {
    const tenant = await newTenant('propinv-corrupt');
    const extraLine = await acceptedProposal(tenant);
    await corrupt(
      `insert into public.customer_commercial_proposal_lines (organization_id, proposal_id, position, price_book_item_id, name, unit, currency, quantity, unit_amount_minor, amount_minor)
       values ($1, $2, 3, gen_random_uuid(), 'Smuggled', 'each', 'CAD', 1, 100, 100)`,
      [tenant.organizationId, extraLine],
    );
    expect((await rpc(tenant.db, extraLine)).error?.code).toBe('GD020');

    const foreign = await acceptedProposal(tenant);
    await corrupt(
      `insert into public.customer_commercial_proposal_lines (organization_id, proposal_id, position, price_book_item_id, name, unit, currency, quantity, unit_amount_minor, amount_minor)
       values ($1, $2, 3, gen_random_uuid(), 'Foreign', 'each', 'USD', 1, 0, 0)`,
      [tenant.organizationId, foreign],
    );
    expect((await rpc(tenant.db, foreign)).error?.code).toBe('GD020');

    const total = await acceptedProposal(tenant);
    await corrupt(`update public.customer_commercial_proposals set catalog_total_minor = 1 where id = $1`, [total]);
    expect((await rpc(tenant.db, total)).error?.code).toBe('GD020');

    expect(await invoiceCount(tenant.organizationId)).toBe(0);
  });
});

describe('proposal history', () => {
  it('keeps every version readable, and only the accepted one is invoiced', async () => {
    const tenant = await newTenant('propinv-history');
    const first = await buildCatalogProposal(tenant.db, { organizationId: tenant.organizationId, customerId: tenant.customerId, lines: [{ priceBookItemId: tenant.itemId, quantity: 5 }] });
    await markCommercialProposalSent(tenant.db, { organizationId: tenant.organizationId, proposalId: first.id });
    const secondId = await acceptedProposal(tenant);
    const id = await issueInvoiceFromProposal(tenant.db, { proposalId: secondId, issuanceKey: randomUUID() });

    const [latest, older] = await listCommercialProposals(tenant.db, { organizationId: tenant.organizationId, customerId: tenant.customerId });
    expect(latest).toMatchObject({ id: secondId, version: 2, supersedesId: first.id, status: 'accepted' });
    expect(older).toMatchObject({ id: first.id, version: 1, status: 'sent', catalogTotalMinor: 60_000 });
    expect(older.lines).toEqual([expect.objectContaining({ name: 'Garden design', quantity: 5, unitAmountMinor: 12_000 })]);
    expect((await rpc(tenant.db, first.id)).error?.code).toBe('GD019');
    expect(await listInvoicesForProposals(tenant.db, { organizationId: tenant.organizationId, proposalIds: [first.id, secondId] })).toEqual({ [secondId]: { id, number: 1 } });
  });
});

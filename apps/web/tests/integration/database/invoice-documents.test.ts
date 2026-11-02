import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definePDFJSModule, extractText, getDocumentProxy } from 'unpdf';
import { issueDirectInvoice, issueInvoice, issueInvoiceFromProposal, recordPayment } from '@/lib/domain/billing/invoices';
import {
  DOCUMENT_BUCKET,
  ensureInvoiceDocument,
  getInvoiceDocumentRecord,
  getInvoicePresentation,
  readInvoiceDocument,
  retainCurrentLogo,
} from '@/lib/domain/billing/invoice-documents';
import { setBrand, uploadLogo } from '@/lib/domain/branding/brand';
import { acceptCommercialProposal, buildCatalogProposal, markCommercialProposalSent } from '@/lib/domain/customers/commercial-proposals';
import { createCustomer } from '@/lib/domain/customers/customers';
import { claimProposalInvite, createProposalInvite } from '@/lib/domain/customers/proposal-invites';
import { claimPortalInvite, createPortalInvite } from '@/lib/domain/portal/portal';
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
 * An issued invoice's presentation and its one canonical PDF (Work Order 2G).
 *
 * What is held here: every source records how the invoice was presented in the transaction that
 * issued it; later branding, logo replacement or catalog prices never reach it; nobody edits or
 * removes it; one PDF is created however many times or concurrently it is asked for, and it is
 * the same bytes for the business and its customer; and no other business, customer or signed-out
 * caller reads either.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// A real 1×1 PNG, so the layout can draw it.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

type Tenant = { db: SupabaseClient; userId: string; organizationId: string; itemId: string; customerId: string; statusId: string };

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

/** An ordinary business — not GildOps — with Billing usable, an identity, a brand, a catalog item and one customer. */
async function newTenant(label: string): Promise<Tenant> {
  const { db, userId, email } = await signIn(label);
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, displayName: 'Founder', timezone: 'America/Halifax', currency: 'CAD' });
  for (const moduleKey of ['billing', 'portal']) {
    await pg.query(`insert into public.organization_modules(organization_id,module_key,enabled_by) values($1,$2,$3) on conflict do nothing`, [organizationId, moduleKey, userId]);
    await pg.query(
      `insert into public.organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note)
       select $1,'module:' || $2,'2020-01-01','9999-12-31',1,0,'CAD',$3,'invoice document test'
        where not exists (select 1 from public.organization_commercial_terms t where t.organization_id = $1 and t.product_key = 'module:' || $2)`,
      [organizationId, moduleKey, userId],
    );
  }
  await pg.query(
    `insert into public.organization_identity(organization_id,legal_name,address_line1,city,region,postal_code,country_code,contact_email,updated_by)
     values($1,$2,'12 Wharf Street','Halifax','NS','B3H 1A1','CA','office@example.test',$3)
     on conflict (organization_id) do update set legal_name = excluded.legal_name`,
    [organizationId, `${label} Holdings Inc.`, userId],
  );
  await setBrand(db, { organizationId, accent: '#1f6feb', headingFont: 'serif', bodyFont: 'sans' });
  const itemId = await createPriceBookItem(db, { organizationId, name: 'Service call', unit: 'visit', unitAmountMinor: 9_550 });
  const customerId = await createCustomer(db, { organizationId, name: `${label} Customer`, email: `${label}-customer@example.test` });
  const typeId = await createWorkItemType(db, { schedulable: true, organizationId, name: 'Job' });
  const statusId = await createWorkItemStatus(db, { organizationId, typeId, name: 'Open', position: 0 });
  return { db, userId, organizationId, itemId, customerId, statusId };
}

const direct = (tenant: Tenant, quantity = 2) => issueDirectInvoice(tenant.db, {
  organizationId: tenant.organizationId, customerId: tenant.customerId, lines: [{ priceBookItemId: tenant.itemId, quantity }],
  issuedAt: null, dueAt: null, issuanceKey: randomUUID(),
});

const presentationRow = async (invoiceId: string) => (await pg.query(`select * from public.invoice_presentations where invoice_id = $1`, [invoiceId])).rows[0];

async function portalCustomer(tenant: Tenant, customerId = tenant.customerId): Promise<SupabaseClient> {
  const token = await createPortalInvite(tenant.db, { customerId });
  const db = anon();
  await claimPortalInvite(db, { token });
  return db;
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  await definePDFJSModule(() => import('unpdf/pdfjs'));
  const { text } = await extractText(await getDocumentProxy(bytes.slice()), { mergePages: true });
  return text as string;
}

async function clerkWithout(tenant: Tenant, capability: string) {
  const clerk = await signIn('docs-clerk');
  const roleId = await createRole(tenant.db, { organizationId: tenant.organizationId, name: `Without ${capability} ${randomUUID().slice(0, 4)}`, capabilities: CAPABILITIES.filter((c) => c !== capability) });
  await pg.query(`insert into public.memberships(organization_id,user_id,role_id,created_by,display_name) values($1,$2,$3,$4,'Clerk')`, [tenant.organizationId, clerk.userId, roleId, tenant.userId]);
  const member = (await listMembers(tenant.db, { organizationId: tenant.organizationId })).find((m) => m.userId === clerk.userId)!;
  await assignRole(tenant.db, { membershipId: member.id, roleId });
  return clerk;
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  alice = await newTenant('docs-alice');
  bob = await newTenant('docs-bob');
}, 120_000);

afterAll(async () => {
  await pg?.end();
});

describe('an invoice records how it was presented, whatever issued it', () => {
  it('records the seller, customer, brand and clock for a Work invoice', async () => {
    const work = await createWorkItem(alice.db, { organizationId: alice.organizationId, statusId: alice.statusId, title: 'Leak', customerId: alice.customerId });
    await addPricedLine(alice.db, { workItemId: work, priceBookItemId: alice.itemId, quantity: 1 });
    const invoiceId = await issueInvoice(alice.db, { workItemId: work });
    const row = await presentationRow(invoiceId);
    expect(row).toMatchObject({
      organization_id: alice.organizationId, layout: 'invoice.standard', layout_version: 1,
      seller_name: 'docs-alice Holdings Inc.', trading_name: 'docs-alice Ltd', address_lines: ['12 Wharf Street', 'Halifax NS B3H 1A1'], country_code: 'CA',
      contact_email: 'office@example.test', bill_to_name: 'docs-alice Customer', bill_to_email: 'docs-alice-customer@example.test',
      accent: '#1f6feb', heading_font: 'serif', body_font: 'sans', timezone: 'America/Halifax', locale: 'en',
    });
    for (const money of ['amount_minor', 'total_minor', 'unit_amount_minor', 'paid_minor', 'status']) expect(row).not.toHaveProperty(money);
  });

  it('records one for a direct invoice and for a proposal invoice', async () => {
    const directId = await direct(alice);
    expect((await presentationRow(directId)).seller_name).toBe('docs-alice Holdings Inc.');

    const built = await buildCatalogProposal(alice.db, { organizationId: alice.organizationId, customerId: alice.customerId, lines: [{ priceBookItemId: alice.itemId, quantity: 1 }] });
    await markCommercialProposalSent(alice.db, { organizationId: alice.organizationId, proposalId: built.id });
    const visitor = anon();
    await claimProposalInvite(visitor, { token: await createProposalInvite(alice.db, { customerId: alice.customerId }) });
    await acceptCommercialProposal(visitor, { proposalId: built.id });
    const proposalInvoice = await issueInvoiceFromProposal(alice.db, { proposalId: built.id, issuedAt: null, dueAt: null, issuanceKey: randomUUID() });
    expect((await presentationRow(proposalInvoice)).bill_to_name).toBe('docs-alice Customer');

    const { rows } = await pg.query(
      `select count(*) filter (where p.invoice_id is null)::int as missing from public.invoices i
         left join public.invoice_presentations p on p.invoice_id = i.id where i.organization_id = $1`, [alice.organizationId]);
    expect(rows[0].missing).toBe(0);
  });

  it('is not changed by later branding, and nobody edits, adds or removes one', async () => {
    const invoiceId = await direct(alice);
    const before = await presentationRow(invoiceId);
    await setBrand(alice.db, { organizationId: alice.organizationId, accent: '#b42318', headingFont: 'mono', bodyFont: 'mono' });
    await pg.query(`update public.organization_identity set legal_name = 'Renamed Inc.' where organization_id = $1`, [alice.organizationId]);
    expect(await presentationRow(invoiceId)).toEqual(before);

    const table = () => alice.db.from('invoice_presentations');
    expect((await table().update({ accent: '#000000' }).eq('invoice_id', invoiceId)).error).not.toBeNull();
    expect((await table().delete().eq('invoice_id', invoiceId)).error).not.toBeNull();
    expect((await table().insert({ ...before, invoice_id: randomUUID() })).error).not.toBeNull();
    await expect(pg.query(`update public.invoice_presentations set accent = '#000000' where invoice_id = $1`, [invoiceId])).rejects.toMatchObject({ code: 'GD021' });
    expect(await presentationRow(invoiceId)).toEqual(before);

    await setBrand(alice.db, { organizationId: alice.organizationId, accent: '#1f6feb', headingFont: 'serif', bodyFont: 'sans' });
    await pg.query(`update public.organization_identity set legal_name = 'docs-alice Holdings Inc.' where organization_id = $1`, [alice.organizationId]);
  });

  it('leaves an invoice issued before presentations existed as it was, and documents it plainly', async () => {
    const invoiceId = await direct(alice, 1);
    await pg.query(`delete from public.invoice_presentations where invoice_id = $1`, [invoiceId]);
    const before = (await pg.query(`select * from public.invoices where id = $1`, [invoiceId])).rows[0];
    expect(await getInvoicePresentation(alice.db, { organizationId: alice.organizationId, invoiceId })).toBeNull();
    await ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId });
    const text = await pdfText((await readInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId })).bytes);
    expect(text).toContain('issued before document details were recorded');
    expect(text).not.toContain('Holdings Inc.');
    expect((await pg.query(`select * from public.invoices where id = $1`, [invoiceId])).rows[0]).toEqual(before);
    expect(await presentationRow(invoiceId)).toBeUndefined();
  });

  it('previews only for someone who may issue invoices, and exposes no internal builder', async () => {
    const preview = await alice.db.rpc('preview_invoice_presentation', { p_organization_id: alice.organizationId, p_customer_id: alice.customerId });
    expect(preview.error).toBeNull();
    expect(preview.data).toMatchObject({ seller_name: 'docs-alice Holdings Inc.', bill_to_name: 'docs-alice Customer' });
    expect(preview.data).not.toHaveProperty('invoice_id');

    expect((await bob.db.rpc('preview_invoice_presentation', { p_organization_id: alice.organizationId, p_customer_id: alice.customerId })).error?.code).toBe('42501');
    const clerk = await clerkWithout(alice, 'invoice.issue');
    expect((await clerk.db.rpc('preview_invoice_presentation', { p_organization_id: alice.organizationId, p_customer_id: alice.customerId })).error?.code).toBe('42501');
    expect((await anon().rpc('preview_invoice_presentation', { p_organization_id: alice.organizationId, p_customer_id: alice.customerId })).error).not.toBeNull();

    const { rows } = await pg.query(
      `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as member, has_function_privilege('anon', p.oid, 'execute') as visitor
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname in ('invoice_presentation_now','capture_invoice_presentation','preview_invoice_presentation','record_invoice_document')
        order by p.proname`);
    expect(rows).toEqual([
      { proname: 'capture_invoice_presentation', member: false, visitor: false },
      { proname: 'invoice_presentation_now', member: false, visitor: false },
      { proname: 'preview_invoice_presentation', member: true, visitor: false },
      { proname: 'record_invoice_document', member: true, visitor: false },
    ]);
    const definer = await pg.query(
      `select p.proname, p.prosecdef, p.proconfig from pg_proc p where p.proname in ('invoice_presentation_now','capture_invoice_presentation','preview_invoice_presentation','record_invoice_document')`);
    for (const fn of definer.rows) {
      expect(fn.prosecdef, fn.proname).toBe(true);
      expect(fn.proconfig, fn.proname).toEqual(['search_path=""']);
    }
  });
});

describe('a logo stays with the invoices issued with it', () => {
  it('keeps the retained copy after the logo is replaced, and never shows it to a customer', async () => {
    await uploadLogo(alice.db, { organizationId: alice.organizationId, file: new File([PNG], 'logo.png', { type: 'image/png' }) });
    await retainCurrentLogo(alice.db, { organizationId: alice.organizationId });
    await retainCurrentLogo(alice.db, { organizationId: alice.organizationId });
    const invoiceId = await direct(alice, 1);
    const logoPath: string = (await presentationRow(invoiceId)).logo_path;
    expect(logoPath).toMatch(new RegExp(`^${alice.organizationId}/logos/`));

    await uploadLogo(alice.db, { organizationId: alice.organizationId, file: new File([PNG], 'logo-2.png', { type: 'image/png' }) });
    const kept = await alice.db.storage.from(DOCUMENT_BUCKET).download(logoPath);
    expect(Buffer.from(await kept.data!.arrayBuffer()).equals(PNG)).toBe(true);
    expect((await presentationRow(invoiceId)).logo_path).toBe(logoPath);

    // Nobody overwrites or removes a retained copy.
    expect((await alice.db.storage.from(DOCUMENT_BUCKET).upload(logoPath, new Blob(['x']), { upsert: true })).error).not.toBeNull();
    await alice.db.storage.from(DOCUMENT_BUCKET).remove([logoPath]);
    expect((await alice.db.storage.from(DOCUMENT_BUCKET).download(logoPath)).data).not.toBeNull();

    const customer = await portalCustomer(alice);
    expect((await customer.storage.from(DOCUMENT_BUCKET).download(logoPath)).data).toBeNull();
    expect((await bob.db.storage.from(DOCUMENT_BUCKET).download(logoPath)).data).toBeNull();

    const record = await ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId });
    expect(record.sizeBytes).toBeGreaterThan(0);
  });
});

describe('one canonical PDF per issued invoice', () => {
  it('creates one document under concurrent requests, and a retry returns it unchanged', async () => {
    const invoiceId = await direct(alice, 3);
    const records = await Promise.all([1, 2, 3].map(() => ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId })));
    expect(new Set(records.map((r) => r.sha256)).size).toBe(1);
    const again = await ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId });
    expect(again).toEqual(records[0]);

    const { rows } = await pg.query(`select count(*)::int as n from public.invoice_documents where invoice_id = $1`, [invoiceId]);
    expect(rows[0].n).toBe(1);
    const events = await pg.query(`select count(*)::int as n from public.events where entity_id = $1 and action = 'invoice.document_created'`, [invoiceId]);
    expect(events.rows[0].n).toBe(1);

    const file = await readInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId });
    expect(createHash('sha256').update(file.bytes).digest('hex')).toBe(again.sha256);
    expect(file.fileName).toMatch(/^invoice-\d+\.pdf$/);
  });

  it('holds the invoice’s own amounts, not today’s catalog, and is not redrawn after branding changes', async () => {
    const invoiceId = await direct(alice, 2);
    await updatePriceBookItem(alice.db, { id: alice.itemId, name: 'Service call', unit: 'visit', unitAmountMinor: 12_000 });
    const record = await ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId });
    const text = await pdfText((await readInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId })).bytes);
    expect(text).toContain('CA$95.50');
    expect(text).toContain('CA$191.00');
    expect(text).not.toContain('CA$120.00');
    expect(text).toContain('docs-alice Holdings Inc.');

    await setBrand(alice.db, { organizationId: alice.organizationId, accent: '#b42318', headingFont: 'mono', bodyFont: 'mono' });
    await recordPayment(alice.db, { invoiceId, amountMinor: 1_000, receivedAt: null, note: '' });
    expect(await ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId })).toEqual(record);
    const after = await readInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId });
    expect(createHash('sha256').update(after.bytes).digest('hex')).toBe(record.sha256);
    await setBrand(alice.db, { organizationId: alice.organizationId, accent: '#1f6feb', headingFont: 'serif', bodyFont: 'sans' });
    await updatePriceBookItem(alice.db, { id: alice.itemId, name: 'Service call', unit: 'visit', unitAmountMinor: 9_550 });
  });

  it('records bytes stored before a failed record instead of drawing a second document', async () => {
    const invoiceId = await direct(alice, 1);
    const path = `${alice.organizationId}/invoices/${invoiceId}/invoice-standard-1-${randomUUID()}.pdf`;
    const orphan = new TextEncoder().encode('%PDF-1.3\n% stored before its record failed\n');
    expect((await alice.db.storage.from(DOCUMENT_BUCKET).upload(path, new Blob([orphan], { type: 'application/pdf' }), { upsert: false })).error).toBeNull();
    const record = await ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId });
    expect(record.sha256).toBe(createHash('sha256').update(orphan).digest('hex'));
    expect(record.storagePath).toBe(path);
  });

  it('cannot be replaced or removed once stored, and no second object is accepted once recorded', async () => {
    const invoiceId = await direct(alice, 1);
    const record = await ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId });
    const bucket = () => alice.db.storage.from(DOCUMENT_BUCKET);
    expect((await bucket().upload(record.storagePath, new Blob(['%PDF-fake']), { upsert: true })).error).not.toBeNull();
    expect((await bucket().upload(`${alice.organizationId}/invoices/${invoiceId}/other.pdf`, new Blob(['%PDF-fake']))).error).not.toBeNull();
    await bucket().remove([record.storagePath]);
    const still = await readInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId });
    expect(createHash('sha256').update(still.bytes).digest('hex')).toBe(record.sha256);
    expect((await alice.db.from('invoice_documents').update({ sha256: '0'.repeat(64) }).eq('invoice_id', invoiceId)).error).not.toBeNull();
    await expect(pg.query(`update public.invoice_documents set sha256 = $2 where invoice_id = $1`, [invoiceId, '0'.repeat(64)])).rejects.toMatchObject({ code: 'GD021' });
  });

  it('refuses a recorder who may not issue invoices, another business, a wrong path and a missing object', async () => {
    const invoiceId = await direct(alice, 1);
    const path = `${alice.organizationId}/invoices/${invoiceId}/invoice-standard-1.pdf`;
    const record = (db: SupabaseClient, storagePath = path) => db.rpc('record_invoice_document', { p_invoice_id: invoiceId, p_storage_path: storagePath, p_sha256: '0'.repeat(64), p_size_bytes: 1, p_renderer: 'invoice-standard-1' });
    expect((await record(bob.db)).error?.code).toBe('42501');
    expect((await record(anon())).error).not.toBeNull();
    const clerk = await clerkWithout(alice, 'invoice.issue');
    expect((await record(clerk.db)).error?.code).toBe('42501');
    expect((await clerk.db.storage.from(DOCUMENT_BUCKET).upload(path, new Blob(['%PDF-fake']))).error).not.toBeNull();
    expect((await record(alice.db, `${bob.organizationId}/invoices/${invoiceId}/invoice-standard-1.pdf`)).error?.code).toBe('22023');
    expect((await record(alice.db)).error?.code).toBe('22023');
    expect(await getInvoiceDocumentRecord(alice.db, { organizationId: alice.organizationId, invoiceId })).toBeNull();
    await expect(ensureInvoiceDocument(bob.db, { organizationId: alice.organizationId, invoiceId })).rejects.toMatchObject({ code: 'invoice_documents.not_found' });
  });
});

describe('who reads an issued document', () => {
  it('the business’s members and the invoice’s own customer read the same bytes; nobody else does', async () => {
    const invoiceId = await direct(alice, 2);
    const record = await ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId });

    const clerk = await clerkWithout(alice, 'invoice.issue');
    const asClerk = await readInvoiceDocument(clerk.db, { organizationId: alice.organizationId, invoiceId });
    expect(createHash('sha256').update(asClerk.bytes).digest('hex')).toBe(record.sha256);

    const customer = await portalCustomer(alice);
    const asCustomer = await readInvoiceDocument(customer, { organizationId: alice.organizationId, invoiceId });
    expect(createHash('sha256').update(asCustomer.bytes).digest('hex')).toBe(record.sha256);
    expect((await customer.from('invoice_presentations').select('invoice_id').eq('invoice_id', invoiceId)).data).toHaveLength(1);

    const neighbourId = await createCustomer(alice.db, { organizationId: alice.organizationId, name: 'Neighbour' });
    const neighbour = await portalCustomer(alice, neighbourId);
    await expect(readInvoiceDocument(neighbour, { organizationId: alice.organizationId, invoiceId })).rejects.toMatchObject({ code: 'invoice_documents.not_found' });
    expect((await neighbour.storage.from(DOCUMENT_BUCKET).download(record.storagePath)).data).toBeNull();
    expect((await neighbour.from('invoice_presentations').select('invoice_id').eq('invoice_id', invoiceId)).data).toEqual([]);

    await expect(readInvoiceDocument(bob.db, { organizationId: alice.organizationId, invoiceId })).rejects.toMatchObject({ code: 'invoice_documents.not_found' });
    expect((await bob.db.storage.from(DOCUMENT_BUCKET).download(record.storagePath)).data).toBeNull();
    expect((await bob.db.from('invoice_documents').select('invoice_id').eq('invoice_id', invoiceId)).data).toEqual([]);
    expect((await bob.db.from('invoice_presentations').select('invoice_id').eq('invoice_id', invoiceId)).data).toEqual([]);

    expect((await anon().storage.from(DOCUMENT_BUCKET).download(record.storagePath)).data).toBeNull();
    expect((await anon().from('invoice_documents').select('invoice_id')).data ?? []).toEqual([]);
    const bucket = await pg.query(`select public from storage.buckets where id = $1`, [DOCUMENT_BUCKET]);
    expect(bucket.rows[0].public).toBe(false);
  });
});

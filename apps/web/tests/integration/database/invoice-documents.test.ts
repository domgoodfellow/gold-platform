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
import { startInvoiceDocumentWriter, WRITER_ID, writerToken } from '@/tests/support/invoice-document-writer';

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
let writer: Awaited<ReturnType<typeof startInvoiceDocumentWriter>>;

const anon = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
/** The storage owner, standing in for bytes placed outside the platform's own paths. */
const admin = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
/** The writer's own role, to prove what it cannot do even when called directly. */
const writerDb = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false }, global: { headers: { Authorization: `Bearer ${writerToken()}` } } });

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
  writer = await startInvoiceDocumentWriter();
  alice = await newTenant('docs-alice');
  bob = await newTenant('docs-bob');
}, 120_000);

afterAll(async () => {
  await writer?.close();
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

    const names = ['invoice_presentation_now', 'capture_invoice_presentation', 'preview_invoice_presentation', 'record_invoice_document',
      'invoice_document_requester', 'invoice_document_source', 'invoice_logo_source', 'record_retained_logo',
      'member_has_capability', 'finance_document_slot_open', 'finance_document_is_referenced', 'writer_stored'];
    const { rows } = await pg.query(
      `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as member, has_function_privilege('anon', p.oid, 'execute') as visitor,
              has_function_privilege('invoice_document_writer', p.oid, 'execute') as writer
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where p.proname = any($1)
        order by p.proname`, [names]);
    // Members may only preview and ask who they are; every write and every builder is the writer's or nobody's.
    expect(rows).toEqual([
      { proname: 'capture_invoice_presentation', member: false, visitor: false, writer: false },
      { proname: 'finance_document_is_referenced', member: false, visitor: false, writer: true },
      { proname: 'finance_document_slot_open', member: false, visitor: false, writer: true },
      { proname: 'invoice_document_requester', member: true, visitor: false, writer: false },
      { proname: 'invoice_document_source', member: false, visitor: false, writer: true },
      { proname: 'invoice_logo_source', member: false, visitor: false, writer: true },
      { proname: 'invoice_presentation_now', member: false, visitor: false, writer: false },
      { proname: 'member_has_capability', member: false, visitor: false, writer: false },
      { proname: 'preview_invoice_presentation', member: true, visitor: false, writer: false },
      { proname: 'record_invoice_document', member: false, visitor: false, writer: true },
      { proname: 'record_retained_logo', member: false, visitor: false, writer: true },
      { proname: 'writer_stored', member: false, visitor: false, writer: false },
    ]);
    const definer = await pg.query(
      `select p.proname, p.prosecdef, p.proconfig from pg_proc p where p.proname = any($1)`, [names]);
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

  it('draws only a copy the writer recorded from the current brand logo, never one placed beside it', async () => {
    const evil = Buffer.concat([PNG.subarray(0, 8), Buffer.from('not the business logo')]);
    await uploadLogo(alice.db, { organizationId: alice.organizationId, file: new File([PNG], 'logo-3.png', { type: 'image/png' }) });
    const brandKey: string = (await pg.query(`select logo_path from public.brand_settings where organization_id = $1`, [alice.organizationId])).rows[0].logo_path;
    // The old retained name for this logo, and a name in the writer's own pattern: neither is a recorded copy.
    for (const name of [`${alice.organizationId}/logos/${brandKey.split('/')[1]}`, `${alice.organizationId}/logos/retained-${randomUUID()}.png`]) {
      expect((await admin().storage.from(DOCUMENT_BUCKET).upload(name, new Blob([evil], { type: 'image/png' }), { contentType: 'image/png' })).error).toBeNull();
    }
    const before = await direct(alice, 1);
    expect((await presentationRow(before)).logo_path).toBeNull();

    const issuer = await clerkWithout(alice, 'organization.manage');
    await retainCurrentLogo(issuer.db, { organizationId: alice.organizationId });
    const retained = (await pg.query(`select * from public.invoice_retained_logos where organization_id = $1 and brand_logo_path = $2`, [alice.organizationId, brandKey])).rows[0];
    expect(retained).toMatchObject({ format: 'png', sha256: createHash('sha256').update(PNG).digest('hex'), created_by: issuer.userId });
    const after = await direct(alice, 1);
    expect((await presentationRow(after)).logo_path).toBe(retained.storage_path);
    const kept = await alice.db.storage.from(DOCUMENT_BUCKET).download(retained.storage_path);
    expect(Buffer.from(await kept.data!.arrayBuffer()).equals(PNG)).toBe(true);
    expect((await ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId: after })).sizeBytes).toBeGreaterThan(0);
    // Nobody records a copy for a logo that is not the business's current one.
    const stale = await writerDb().rpc('record_retained_logo', { p_actor: alice.userId, p_organization_id: alice.organizationId, p_brand_logo_path: `${alice.organizationId}/${randomUUID()}`, p_storage_path: retained.storage_path, p_sha256: retained.sha256, p_size_bytes: Number(retained.size_bytes), p_format: 'png' });
    expect(stale.error?.code).toBe('22023');
    await expect(pg.query(`update public.invoice_retained_logos set sha256 = $2 where storage_path = $1`, [retained.storage_path, '0'.repeat(64)])).rejects.toMatchObject({ code: 'GD021' });
  });

  it('does not draw an earlier logo after the brand logo changes before issue', async () => {
    await uploadLogo(alice.db, { organizationId: alice.organizationId, file: new File([PNG], 'logo-4.png', { type: 'image/png' }) });
    await retainCurrentLogo(alice.db, { organizationId: alice.organizationId });
    // Replaced after the copy was kept and before issue: the new logo has no recorded copy yet.
    await uploadLogo(alice.db, { organizationId: alice.organizationId, file: new File([PNG], 'logo-5.png', { type: 'image/png' }) });
    const invoiceId = await direct(alice, 1);
    expect((await presentationRow(invoiceId)).logo_path).toBeNull();
    const text = await pdfText((await readInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId: (await ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId })).invoiceId })).bytes);
    expect(text).toContain('docs-alice Holdings Inc.');
  });

  it('keeps no logo it cannot draw, and the invoice shows the business name instead', async () => {
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'], 'logo.svg', { type: 'image/svg+xml' });
    await uploadLogo(alice.db, { organizationId: alice.organizationId, file: svg });
    await retainCurrentLogo(alice.db, { organizationId: alice.organizationId });
    const brandKey: string = (await pg.query(`select logo_path from public.brand_settings where organization_id = $1`, [alice.organizationId])).rows[0].logo_path;
    expect((await pg.query(`select 1 from public.invoice_retained_logos where brand_logo_path = $1`, [brandKey])).rows).toEqual([]);
    const invoiceId = await direct(alice, 1);
    expect((await presentationRow(invoiceId)).logo_path).toBeNull();
    const text = await pdfText((await readInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId: (await ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId })).invoiceId })).bytes);
    expect(text).toContain('docs-alice Holdings Inc.');
  });
});

describe('the issued document is the invoice as issued', () => {
  it('states no payment, so a payment before a retried PDF does not change it', async () => {
    const invoiceId = await direct(alice, 1);
    const before = (await pg.query(`select * from public.invoices where id = $1`, [invoiceId])).rows[0];
    const lines = (await pg.query(`select * from public.invoice_lines where invoice_id = $1 order by position`, [invoiceId])).rows;
    const policy = (await pg.query(`select pg_get_expr(polwithcheck, polrelid) as check from pg_policy where polname = 'finance_documents_writer_insert'`)).rows[0].check as string;
    await pg.query(`drop policy finance_documents_writer_insert on storage.objects`);
    try {
      await expect(ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId })).rejects.toMatchObject({ code: 'invoice_documents.store_failed' });
    } finally {
      await pg.query(`create policy finance_documents_writer_insert on storage.objects for insert to invoice_document_writer with check (${policy})`);
    }
    await recordPayment(alice.db, { invoiceId, amountMinor: 4_000, receivedAt: null, note: '' });

    await ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId });
    const text = await pdfText((await readInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId })).bytes);
    expect(text).toContain('CA$95.50');
    for (const absent of ['Payment', 'Paid', 'Outstanding', 'CA$40.00', 'CA$55.50']) expect(text).not.toContain(absent);
    expect((await pg.query(`select * from public.invoices where id = $1`, [invoiceId])).rows[0]).toEqual(before);
    expect((await pg.query(`select * from public.invoice_lines where invoice_id = $1 order by position`, [invoiceId])).rows).toEqual(lines);
  });

  it('creates documents for Work and proposal invoices too', async () => {
    const work = await createWorkItem(alice.db, { organizationId: alice.organizationId, statusId: alice.statusId, title: 'Boiler', customerId: alice.customerId });
    await addPricedLine(alice.db, { workItemId: work, priceBookItemId: alice.itemId, quantity: 3 });
    const workInvoice = await issueInvoice(alice.db, { workItemId: work });
    const built = await buildCatalogProposal(alice.db, { organizationId: alice.organizationId, customerId: alice.customerId, lines: [{ priceBookItemId: alice.itemId, quantity: 4 }] });
    await markCommercialProposalSent(alice.db, { organizationId: alice.organizationId, proposalId: built.id });
    const visitor = anon();
    await claimProposalInvite(visitor, { token: await createProposalInvite(alice.db, { customerId: alice.customerId }) });
    await acceptCommercialProposal(visitor, { proposalId: built.id });
    const proposalInvoice = await issueInvoiceFromProposal(alice.db, { proposalId: built.id, issuedAt: null, dueAt: null, issuanceKey: randomUUID() });
    for (const [invoiceId, total] of [[workInvoice, 'CA$286.50'], [proposalInvoice, 'CA$382.00']] as const) {
      await ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId });
      expect(await pdfText((await readInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId })).bytes)).toContain(total);
    }
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

  it('never adopts an object it did not store, even one named like its own', async () => {
    const invoiceId = await direct(alice, 1);
    // What a member could store before 2G.1, placed here by the storage owner to stand in for it.
    const planted = `${alice.organizationId}/invoices/${invoiceId}/invoice-standard-2-${randomUUID()}.pdf`;
    const bytes = new TextEncoder().encode('%PDF-1.3\n% planted: pay account 000\n%%EOF\n');
    expect((await admin().storage.from(DOCUMENT_BUCKET).upload(planted, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' })).error).toBeNull();

    const record = await ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId });
    expect(record.storagePath).not.toBe(planted);
    expect(record.sha256).not.toBe(createHash('sha256').update(bytes).digest('hex'));
    const text = await pdfText((await readInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId })).bytes);
    expect(text).not.toContain('planted');
    const owner = await pg.query(`select owner_id from storage.objects where bucket_id = $1 and name = $2`, [DOCUMENT_BUCKET, record.storagePath]);
    expect(owner.rows[0].owner_id).toBe(WRITER_ID);

    // Recording the planted object directly is refused too: the writer did not store it.
    const asWriter = writerDb();
    const refused = await asWriter.rpc('record_invoice_document', { p_actor: alice.userId, p_invoice_id: await direct(alice, 1), p_storage_path: planted, p_sha256: '0'.repeat(64), p_size_bytes: bytes.length, p_renderer: 'invoice-standard-2' });
    expect(refused.error?.code).toBe('22023');
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

  it('lets no member store or record a document, whatever they may do', async () => {
    const invoiceId = await direct(alice, 1);
    const path = `${alice.organizationId}/invoices/${invoiceId}/invoice-standard-2-${randomUUID()}.pdf`;
    const issuer = await clerkWithout(alice, 'organization.manage');
    const clerk = await clerkWithout(alice, 'invoice.issue');
    const fake = new Blob(['%PDF-1.3 fake'], { type: 'application/pdf' });
    for (const db of [alice.db, issuer.db, clerk.db, bob.db, anon()]) {
      expect((await db.storage.from(DOCUMENT_BUCKET).upload(path, fake)).error).not.toBeNull();
      expect((await db.storage.from(DOCUMENT_BUCKET).upload(`${alice.organizationId}/logos/retained-${randomUUID()}.png`, new Blob([PNG]))).error).not.toBeNull();
      const record = await db.rpc('record_invoice_document', { p_actor: alice.userId, p_invoice_id: invoiceId, p_storage_path: path, p_sha256: '0'.repeat(64), p_size_bytes: 1, p_renderer: 'invoice-standard-2' });
      expect(record.error).not.toBeNull();
      expect((await db.rpc('record_retained_logo', { p_actor: alice.userId, p_organization_id: alice.organizationId, p_brand_logo_path: 'x', p_storage_path: 'x', p_sha256: '0'.repeat(64), p_size_bytes: 1, p_format: 'png' })).error).not.toBeNull();
      expect((await db.rpc('invoice_document_source', { p_actor: alice.userId, p_organization_id: alice.organizationId, p_invoice_id: invoiceId })).error).not.toBeNull();
    }
    expect(await getInvoiceDocumentRecord(alice.db, { organizationId: alice.organizationId, invoiceId })).toBeNull();
    const { rows } = await pg.query(`select count(*)::int as n from storage.objects where bucket_id = $1 and name like $2`, [DOCUMENT_BUCKET, `${alice.organizationId}/invoices/${invoiceId}/%`]);
    expect(rows[0].n).toBe(0);
  });

  it('asks the writer only on behalf of someone who may issue this invoice', async () => {
    const invoiceId = await direct(alice, 1);
    const clerk = await clerkWithout(alice, 'invoice.issue');
    await expect(ensureInvoiceDocument(clerk.db, { organizationId: alice.organizationId, invoiceId })).rejects.toMatchObject({ code: 'invoice_documents.forbidden' });
    await expect(ensureInvoiceDocument(bob.db, { organizationId: alice.organizationId, invoiceId })).rejects.toMatchObject({ code: 'invoice_documents.forbidden' });
    // Bob's own business, Alice's invoice: the source is resolved from the invoice, not the request.
    await expect(ensureInvoiceDocument(bob.db, { organizationId: bob.organizationId, invoiceId })).rejects.toMatchObject({ code: 'invoice_documents.not_found' });
    // Signed out: refused before any request reaches the writer.
    await expect(ensureInvoiceDocument(anon(), { organizationId: alice.organizationId, invoiceId })).rejects.toThrow();
    const forged = await fetch(`${writer.url}/invoice-documents`, { method: 'POST', headers: { authorization: 'Bearer not-a-token', 'content-type': 'application/json' }, body: JSON.stringify({ command: 'create', organization_id: alice.organizationId, invoice_id: invoiceId }) });
    expect(forged.status).toBe(401);
    expect(await getInvoiceDocumentRecord(alice.db, { organizationId: alice.organizationId, invoiceId })).toBeNull();
    const { rows } = await pg.query(`select count(*)::int as n from storage.objects where bucket_id = $1 and name like $2`, [DOCUMENT_BUCKET, `${alice.organizationId}/invoices/${invoiceId}/%`]);
    expect(rows[0].n).toBe(0);

    // The writer itself records nothing for a person who may not issue, or for another business's invoice.
    const asWriter = writerDb();
    const stranger = await asWriter.rpc('record_invoice_document', { p_actor: clerk.userId, p_invoice_id: invoiceId, p_storage_path: 'x', p_sha256: '0'.repeat(64), p_size_bytes: 1, p_renderer: 'invoice-standard-2' });
    expect(stranger.error?.code).toBe('42501');
    const neighbour = await asWriter.rpc('invoice_document_source', { p_actor: bob.userId, p_organization_id: bob.organizationId, p_invoice_id: invoiceId });
    expect(neighbour.error?.code).toBe('42501');
  });

  it('keeps one recorded object, removes only what it stored and nothing recorded, and retries after a storage failure', async () => {
    const invoiceId = await direct(alice, 2);
    const policy = (await pg.query(`select pg_get_expr(polwithcheck, polrelid) as check from pg_policy where polname = 'finance_documents_writer_insert'`)).rows[0].check as string;
    await pg.query(`drop policy finance_documents_writer_insert on storage.objects`);
    try {
      await expect(ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId })).rejects.toMatchObject({ code: 'invoice_documents.store_failed' });
    } finally {
      await pg.query(`create policy finance_documents_writer_insert on storage.objects for insert to invoice_document_writer with check (${policy})`);
    }
    expect(await getInvoiceDocumentRecord(alice.db, { organizationId: alice.organizationId, invoiceId })).toBeNull();

    const records = await Promise.all([1, 2, 3, 4].map(() => ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId })));
    expect(new Set(records.map((r) => r.storagePath)).size).toBe(1);
    const { rows } = await pg.query(`select name from storage.objects where bucket_id = $1 and name like $2`, [DOCUMENT_BUCKET, `${alice.organizationId}/invoices/${invoiceId}/%`]);
    expect(rows.map((row) => row.name)).toEqual([records[0].storagePath]);

    // The writer cannot remove or replace what was recorded.
    const asWriter = writerDb();
    await asWriter.storage.from(DOCUMENT_BUCKET).remove([records[0].storagePath]);
    expect((await asWriter.storage.from(DOCUMENT_BUCKET).upload(records[0].storagePath, new Blob(['%PDF-x']), { upsert: true })).error).not.toBeNull();
    const file = await readInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId });
    expect(createHash('sha256').update(file.bytes).digest('hex')).toBe(records[0].sha256);
  });

  it('serves no bytes that differ from the recorded checksum', async () => {
    const invoiceId = await direct(alice, 1);
    const record = await ensureInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId });
    // Only the storage owner can do this; it stands in for bytes changed outside the platform.
    expect((await admin().storage.from(DOCUMENT_BUCKET).update(record.storagePath, new Blob(['%PDF-1.3 swapped']), { contentType: 'application/pdf' })).error).toBeNull();
    await expect(readInvoiceDocument(alice.db, { organizationId: alice.organizationId, invoiceId })).rejects.toMatchObject({ code: 'invoice_documents.not_found' });
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

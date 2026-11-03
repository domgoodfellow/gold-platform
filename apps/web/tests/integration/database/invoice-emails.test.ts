import { createHash, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sendIssuedInvoiceEmail } from '@/lib/application/finance/send-invoice-email';
import { DOCUMENT_BUCKET, ensureInvoiceDocument } from '@/lib/domain/billing/invoice-documents';
import { invoiceEmailState, listInvoiceEmails, previewInvoiceEmail } from '@/lib/domain/billing/invoice-emails';
import { issueDirectInvoice } from '@/lib/domain/billing/invoices';
import { readAttachment } from '@/lib/domain/email/messages';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createPriceBookItem } from '@/lib/domain/pricing/price-book';
import { CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { createRole } from '@/lib/domain/tenancy/roles';
import { readyEmailSender, type ReadySender } from '@/tests/support/email-sender';
import { foundBusiness } from '@/tests/support/founding';
import { startInvoiceDocumentWriter } from '@/tests/support/invoice-document-writer';

/**
 * Emailing an issued invoice (Work Order 2H) against local PostgreSQL and storage. What is held
 * here: only a member with invoice.issue and message.send, in the invoice's own business, can send;
 * the sender is the business's own ready default and never a fallback; the recipient is the
 * customer's own address and nothing else; the attachment is the invoice's recorded PDF, in place,
 * with its checksum, and nothing a request names; a submission is sent once and a later send is
 * explicit; delivery state is the message's own, and history keeps who and what as they were.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = { db: SupabaseClient; userId: string; organizationId: string; itemId: string; customerId: string; customerEmail: string; sender: ReadySender };

let pg: Client;
let alice: Tenant;
let bob: Tenant;
let writer: Awaited<ReturnType<typeof startInvoiceDocumentWriter>>;

const anon = () => createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const admin = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

async function signIn(label: string) {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`, password = `pw-${randomUUID()}`;
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = anon();
  const signed = await db.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  return { db, userId: data.user.id, email };
}

async function newTenant(label: string): Promise<Tenant> {
  const { db, userId, email } = await signIn(label);
  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, displayName: 'Founder', timezone: 'America/Halifax', currency: 'CAD' });
  await pg.query(`insert into public.organization_modules(organization_id,module_key,enabled_by) values($1,'billing',$2) on conflict do nothing`, [organizationId, userId]);
  await pg.query(
    `insert into public.organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note)
     select $1,'module:billing','2020-01-01','9999-12-31',1,0,'CAD',$2,'invoice email test'
      where not exists (select 1 from public.organization_commercial_terms t where t.organization_id = $1 and t.product_key = 'module:billing')`,
    [organizationId, userId]);
  const itemId = await createPriceBookItem(db, { organizationId, name: 'Service call', unit: 'visit', unitAmountMinor: 9_550 });
  const customerId = await createCustomer(db, { organizationId, name: `${label} Customer`, email: `${label}-customer@example.test` });
  const sender = await readyEmailSender(pg, db, organizationId);
  return { db, userId, organizationId, itemId, customerId, customerEmail: `${label}-customer@example.test`, sender };
}

async function member(tenant: Tenant, without: string[]) {
  const person = await signIn('mail-member');
  const roleId = await createRole(tenant.db, { organizationId: tenant.organizationId, name: `Without ${without.join(' ')} ${randomUUID().slice(0, 4)}`, capabilities: CAPABILITIES.filter((c) => !without.includes(c)) });
  await pg.query(`insert into public.memberships(organization_id,user_id,role_id,created_by,display_name) values($1,$2,$3,$4,'Member')`, [tenant.organizationId, person.userId, roleId, tenant.userId]);
  return person;
}

/** An issued invoice with its recorded PDF. */
async function invoiceWithPdf(tenant: Tenant, customerId = tenant.customerId) {
  const invoiceId = await issueDirectInvoice(tenant.db, { organizationId: tenant.organizationId, customerId, lines: [{ priceBookItemId: tenant.itemId, quantity: 1 }], issuedAt: null, dueAt: null, issuanceKey: randomUUID() });
  const record = await ensureInvoiceDocument(tenant.db, { organizationId: tenant.organizationId, invoiceId });
  return { invoiceId, record };
}

const recipientOf = (tenant: Tenant) => tenant.customerEmail;
const send = (tenant: Tenant, invoiceId: string, overrides: Partial<Parameters<typeof sendIssuedInvoiceEmail>[1]> = {}, db: SupabaseClient = tenant.db) =>
  sendIssuedInvoiceEmail(db, { organizationId: tenant.organizationId, invoiceId, recipient: recipientOf(tenant), subject: 'Invoice', text: 'Attached.', idempotencyKey: randomUUID(), sendAgain: false, ...overrides });
const queue = (db: SupabaseClient, args: Record<string, unknown>) => db.rpc('queue_invoice_email', { p_subject: 'Invoice', p_text: 'Attached.', p_idempotency_key: randomUUID(), p_send_again: false, ...args } as never);
const count = async (sql: string, args: unknown[]) => (await pg.query(sql, args)).rows[0].n as number;
const messagesFor = (invoiceId: string) => count(`select count(*)::int n from public.invoice_emails where invoice_id = $1`, [invoiceId]);

async function asRole(role: string, sql: string, args: unknown[]) {
  await pg.query('begin');
  try { await pg.query(`set local role ${role}`); await pg.query(sql, args); await pg.query('commit'); } catch (failure) { await pg.query('rollback'); throw failure; }
}

beforeAll(async () => {
  if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  writer = await startInvoiceDocumentWriter();
  alice = await newTenant('mail-alice');
  bob = await newTenant('mail-bob');
}, 120_000);

afterAll(async () => {
  await writer?.close();
  await pg?.end();
});

describe('what an invoice email is', () => {
  it('goes from the business’s own sender to the customer’s own address, carrying the recorded PDF where it is kept', async () => {
    const { invoiceId, record } = await invoiceWithPdf(alice);
    const preview = await previewInvoiceEmail(alice.db, { organizationId: alice.organizationId, invoiceId });
    expect(preview).toMatchObject({ sender: { address: alice.sender.address }, recipient: { address: recipientOf(alice), problem: null }, document: { fileName: expect.stringMatching(/^invoice-\d+\.pdf$/), sizeBytes: record.sizeBytes }, sentBefore: false });

    const outcome = await send(alice, invoiceId);
    const [row] = (await pg.query(`select * from public.invoice_emails where id = $1`, [outcome.invoiceEmailId])).rows;
    expect(row).toMatchObject({ from_address: alice.sender.address, recipient: recipientOf(alice), customer_id: alice.customerId, document_path: record.storagePath, document_sha256: record.sha256, sent_by: alice.userId, sent_again_after: null });
    const [message] = (await pg.query(`select m.intent, d.from_address, d.to_addresses, c.customer_id from public.messages m join public.email_message_details d on d.message_id = m.id join public.conversations c on c.id = m.conversation_id where m.id = $1`, [outcome.messageId])).rows;
    expect(message).toEqual({ intent: 'transactional', from_address: alice.sender.address, to_addresses: [recipientOf(alice)], customer_id: alice.customerId });
    const attachments = (await pg.query(`select storage_bucket, storage_path, sha256, size_bytes, content_type from public.message_attachments where message_id = $1`, [outcome.messageId])).rows;
    expect(attachments).toEqual([{ storage_bucket: 'finance-documents', storage_path: record.storagePath, sha256: record.sha256, size_bytes: String(record.sizeBytes), content_type: 'application/pdf' }]);

    // Communications reads the same bytes back, and they are the recorded ones.
    const id = (await pg.query(`select id from public.message_attachments where message_id = $1`, [outcome.messageId])).rows[0].id as string;
    const file = await readAttachment(alice.db, { organizationId: alice.organizationId, attachmentId: id });
    expect(createHash('sha256').update(file.bytes).digest('hex')).toBe(record.sha256);
    expect(await count(`select count(*)::int n from public.events where entity_id = $1 and action = 'invoice.emailed'`, [invoiceId])).toBe(1);
  });

  it('was never reported delivered because the provider was not reached', async () => {
    const { invoiceId } = await invoiceWithPdf(alice);
    // This run's API has no email runtime, so nothing leaves: the outcome says so, and the message stays queued.
    const outcome = await send(alice, invoiceId);
    expect(outcome.state).toBe('not_sent');
    expect(outcome.detail).toMatch(/Nothing was sent/);
    expect((await pg.query(`select status from public.messages where id = $1`, [outcome.messageId])).rows[0].status).toBe('queued');
  });
});

describe('who may send, from where and to whom', () => {
  it('refuses a member without message.send or without invoice.issue, and anyone outside the business', async () => {
    const { invoiceId } = await invoiceWithPdf(alice);
    for (const without of [['message.send'], ['invoice.issue']]) {
      const person = await member(alice, without);
      expect((await queue(person.db, { p_organization_id: alice.organizationId, p_invoice_id: invoiceId, p_recipient: recipientOf(alice) })).error?.code).toBe('42501');
      expect((await person.db.rpc('invoice_email_preview', { p_organization_id: alice.organizationId, p_invoice_id: invoiceId })).error?.code).toBe('42501');
    }
    expect((await queue(bob.db, { p_organization_id: alice.organizationId, p_invoice_id: invoiceId, p_recipient: recipientOf(alice) })).error?.code).toBe('42501');
    expect((await queue(bob.db, { p_organization_id: bob.organizationId, p_invoice_id: invoiceId, p_recipient: recipientOf(alice) })).error?.code).toBe('42501');
    expect((await queue(anon(), { p_organization_id: alice.organizationId, p_invoice_id: invoiceId, p_recipient: recipientOf(alice) })).error).not.toBeNull();
    expect(await messagesFor(invoiceId)).toBe(0);
  });

  it('refuses another address, even another contact of the same business, and never sends to a suppressed one', async () => {
    const { invoiceId } = await invoiceWithPdf(alice);
    await createCustomer(alice.db, { organizationId: alice.organizationId, name: 'Someone else', email: 'someone-else@example.test' });
    for (const recipient of ['someone-else@example.test', recipientOf(bob), 'attacker@example.test']) {
      expect((await queue(alice.db, { p_organization_id: alice.organizationId, p_invoice_id: invoiceId, p_recipient: recipient })).error?.code).toBe('22023');
    }
    const suppressedCustomer = await createCustomer(alice.db, { organizationId: alice.organizationId, name: 'Bounced', email: 'bounced@example.test' });
    const bounced = await invoiceWithPdf(alice, suppressedCustomer);
    const earlier = await send(alice, invoiceId);
    await pg.query(`insert into public.email_recipient_suppressions(organization_id,email_address,reason,message_id) values($1,'bounced@example.test','bounced',$2)`, [alice.organizationId, earlier.messageId]);
    expect((await previewInvoiceEmail(alice.db, { organizationId: alice.organizationId, invoiceId: bounced.invoiceId })).recipient).toMatchObject({ address: null, problem: expect.stringMatching(/bounced/) });
    expect((await queue(alice.db, { p_organization_id: alice.organizationId, p_invoice_id: bounced.invoiceId, p_recipient: 'bounced@example.test' })).error?.code).toBe('55000');
    expect(await messagesFor(bounced.invoiceId)).toBe(0);
  });

  it('explains a customer with no address, and sends nothing', async () => {
    const silent = await createCustomer(alice.db, { organizationId: alice.organizationId, name: 'No email' });
    const { invoiceId } = await invoiceWithPdf(alice, silent);
    expect((await previewInvoiceEmail(alice.db, { organizationId: alice.organizationId, invoiceId })).recipient).toEqual({ address: null, problem: expect.stringMatching(/no email address/), customerId: silent, confirmedByCustomer: false });
    expect((await queue(alice.db, { p_organization_id: alice.organizationId, p_invoice_id: invoiceId, p_recipient: '' })).error?.code).toBe('55000');
    expect(await messagesFor(invoiceId)).toBe(0);
  });

  it('refuses a business with no ready sender, with no fallback address', async () => {
    const carol = await newTenant('mail-carol');
    const { invoiceId } = await invoiceWithPdf(carol);
    const before = await count(`select count(*)::int n from public.messages where organization_id = $1`, [carol.organizationId]);
    // Not verified any more.
    await pg.query(`select record_email_domain_provisioning($1,$2,'failed',p_provider_account_id=>$3)`, [carol.organizationId, carol.sender.domainId, carol.sender.accountId]);
    expect((await previewInvoiceEmail(carol.db, { organizationId: carol.organizationId, invoiceId })).sender).toEqual({ problem: expect.stringMatching(/not verified|no sending domain|unavailable/) });
    expect((await queue(carol.db, { p_organization_id: carol.organizationId, p_invoice_id: invoiceId, p_recipient: recipientOf(carol) })).error?.code).toBe('55000');
    // No default at all.
    await pg.query(`delete from public.organization_email_sending where organization_id = $1`, [carol.organizationId]);
    const refused = await queue(carol.db, { p_organization_id: carol.organizationId, p_invoice_id: invoiceId, p_recipient: recipientOf(carol) });
    expect(refused.error?.code).toBe('55000');
    expect(refused.error?.message).toMatch(/no default sender/);
    expect(await count(`select count(*)::int n from public.messages where organization_id = $1`, [carol.organizationId])).toBe(before);
  });
});

describe('what it carries', () => {
  it('takes no attachment, path or bytes from a request, and Communications cannot attach a finance document', async () => {
    const args = (await pg.query(`select pg_get_function_identity_arguments('public.queue_invoice_email'::regproc) a`)).rows[0].a as string;
    expect(args).not.toMatch(/jsonb|bytea|path|attachment|sha|from|identity/);
    const { invoiceId, record } = await invoiceWithPdf(alice);
    const forged = await alice.db.rpc('queue_outbound_email', {
      p_organization_id: alice.organizationId, p_email_identity_id: alice.sender.identityId, p_to: recipientOf(alice), p_subject: 'x', p_text: 'x', p_html: null as never,
      p_conversation_id: null as never, p_idempotency_key: randomUUID(), p_customer_id: alice.customerId,
      p_attachments: [{ storage_path: record.storagePath, filename: 'invoice.pdf', content_type: 'application/pdf', size_bytes: record.sizeBytes }],
    });
    expect(forged.error?.code).toBe('42501');
    const bobs = await invoiceWithPdf(bob);
    const across = await alice.db.rpc('queue_outbound_email', {
      p_organization_id: alice.organizationId, p_email_identity_id: alice.sender.identityId, p_to: recipientOf(alice), p_subject: 'x', p_text: 'x', p_html: null as never,
      p_conversation_id: null as never, p_idempotency_key: randomUUID(), p_customer_id: alice.customerId,
      p_attachments: [{ storage_path: `${alice.organizationId}/outbound/../../${bobs.record.storagePath}`, filename: 'invoice.pdf', content_type: 'application/pdf', size_bytes: bobs.record.sizeBytes }],
    });
    expect(across.error).not.toBeNull();
    expect((await alice.db.from('message_attachments').insert({ organization_id: alice.organizationId, message_id: randomUUID(), filename: 'x.pdf', content_type: 'application/pdf', storage_path: record.storagePath, storage_bucket: 'finance-documents', storage_state: 'stored' } as never)).error).not.toBeNull();
    expect(await messagesFor(invoiceId)).toBe(0);
  });

  it('sends nothing for an invoice without a PDF, or one whose bytes no longer match', async () => {
    const bare = await issueDirectInvoice(alice.db, { organizationId: alice.organizationId, customerId: alice.customerId, lines: [{ priceBookItemId: alice.itemId, quantity: 1 }], issuedAt: null, dueAt: null, issuanceKey: randomUUID() });
    expect((await queue(alice.db, { p_organization_id: alice.organizationId, p_invoice_id: bare, p_recipient: recipientOf(alice) })).error?.code).toBe('55000');
    await expect(send(alice, bare)).rejects.toMatchObject({ code: 'invoice_emails.document_unverified' });

    const { invoiceId, record } = await invoiceWithPdf(alice);
    // Only the storage owner can do this; it stands in for bytes changed outside the platform.
    expect((await admin().storage.from(DOCUMENT_BUCKET).update(record.storagePath, new Blob(['%PDF-1.3 swapped']), { contentType: 'application/pdf' })).error).toBeNull();
    await expect(send(alice, invoiceId)).rejects.toMatchObject({ code: 'invoice_emails.document_unverified' });
    expect(await messagesFor(bare) + await messagesFor(invoiceId)).toBe(0);
  });

  it('sends nothing when the PDF is larger than an email may carry', async () => {
    const { invoiceId, record } = await invoiceWithPdf(alice);
    const big = 11 * 1024 * 1024;
    await pg.query('alter table public.invoice_documents disable trigger invoice_documents_final');
    try {
      await pg.query(`update public.invoice_documents set size_bytes = $2 where invoice_id = $1`, [invoiceId, big]);
      await pg.query(`update storage.objects set metadata = jsonb_set(metadata, '{size}', to_jsonb($2::bigint)) where bucket_id = $3 and name = $1`, [record.storagePath, big, DOCUMENT_BUCKET]);
      const refused = await queue(alice.db, { p_organization_id: alice.organizationId, p_invoice_id: invoiceId, p_recipient: recipientOf(alice) });
      expect(refused.error?.code).toBe('54000');
      expect(refused.error?.message).toMatch(/larger than an email may carry/);
    } finally {
      await pg.query('alter table public.invoice_documents enable trigger invoice_documents_final');
    }
    expect(await messagesFor(invoiceId)).toBe(0);
  });
});

describe('once, and honestly', () => {
  it('sends a repeated submission once, and a later send only when asked for explicitly', async () => {
    const { invoiceId } = await invoiceWithPdf(alice);
    const key = randomUUID();
    const [first, again] = [await send(alice, invoiceId, { idempotencyKey: key }), await send(alice, invoiceId, { idempotencyKey: key })];
    expect(again.messageId).toBe(first.messageId);
    expect(await messagesFor(invoiceId)).toBe(1);
    await expect(send(alice, invoiceId)).rejects.toMatchObject({ code: 'invoice_emails.already_sent' });
    const second = await send(alice, invoiceId, { sendAgain: true });
    expect(second.messageId).not.toBe(first.messageId);
    expect((await pg.query(`select sent_again_after from public.invoice_emails where id = $1`, [second.invoiceEmailId])).rows[0].sent_again_after).toBe(first.invoiceEmailId);
    // A key belongs to the invoice it was used for.
    expect((await queue(alice.db, { p_organization_id: alice.organizationId, p_invoice_id: (await invoiceWithPdf(alice)).invoiceId, p_recipient: recipientOf(alice), p_idempotency_key: key })).error?.code).toBe('22023');
  });

  it('reports queued, accepted, delivered and failed as they are recorded, and a provider retry is the same message', async () => {
    const { invoiceId } = await invoiceWithPdf(alice);
    const outcome = await send(alice, invoiceId);
    const state = async () => { const [entry] = await listInvoiceEmails(alice.db, { organizationId: alice.organizationId, invoiceId }); return invoiceEmailState(entry.status, entry.failureReason); };

    // The runtime takes it, the provider is briefly unavailable, and it goes back to the queue.
    await asRole('provider_operator', `select claim_email_for_send($1,$2)`, [alice.organizationId, outcome.messageId]);
    expect((await state()).state).toBe('sending');
    await asRole('provider_operator', `select record_email_send_result($1,$2,'retry',null,'Provider unavailable')`, [alice.organizationId, outcome.messageId]);
    expect(await state()).toMatchObject({ state: 'not_sent', detail: 'Provider unavailable' });
    // The second attempt is accepted, once, whatever is recorded twice.
    await asRole('provider_operator', `select claim_email_for_send($1,$2)`, [alice.organizationId, outcome.messageId]);
    for (let i = 0; i < 2; i += 1) await asRole('provider_operator', `select record_email_send_result($1,$2,'accepted','re_${outcome.messageId}')`, [alice.organizationId, outcome.messageId]);
    expect(await state()).toMatchObject({ state: 'accepted', label: 'Accepted by the email provider' });
    expect(await count(`select count(*)::int n from public.messages where organization_id = $1 and conversation_id = $2`, [alice.organizationId, outcome.conversationId])).toBe(1);
    await asRole('tenant_email_webhook', `select record_email_event($1,'delivered',$2,null,'{}'::jsonb,now())`, [`re_${outcome.messageId}`, `evt-${randomUUID()}`]);
    expect(await state()).toMatchObject({ state: 'delivered', label: 'Delivered' });

    const failed = await send(alice, (await invoiceWithPdf(alice)).invoiceId);
    await asRole('provider_operator', `select claim_email_for_send($1,$2)`, [alice.organizationId, failed.messageId]);
    await asRole('provider_operator', `select record_email_send_result($1,$2,'rejected',null,'Invalid recipient')`, [alice.organizationId, failed.messageId]);
    const [entry] = await listInvoiceEmails(alice.db, { organizationId: alice.organizationId, invoiceId: (await pg.query(`select invoice_id from public.invoice_emails where id = $1`, [failed.invoiceEmailId])).rows[0].invoice_id });
    expect(invoiceEmailState(entry.status, entry.failureReason)).toMatchObject({ state: 'failed', detail: 'Invalid recipient' });
  });

  it('keeps who it went to and from what as they were, and nobody changes the record', async () => {
    const { invoiceId } = await invoiceWithPdf(alice);
    const outcome = await send(alice, invoiceId);
    const before = (await pg.query(`select * from public.invoice_emails where id = $1`, [outcome.invoiceEmailId])).rows[0];
    await pg.query(`update public.contacts set email = 'moved@example.test' where id = $1`, [alice.customerId]);
    await readyEmailSender(pg, alice.db, alice.organizationId);
    expect((await pg.query(`select * from public.invoice_emails where id = $1`, [outcome.invoiceEmailId])).rows[0]).toEqual(before);
    expect((await alice.db.from('invoice_emails').update({ recipient: 'x@example.test' } as never).eq('id', outcome.invoiceEmailId)).error).not.toBeNull();
    expect((await alice.db.from('invoice_emails').insert({ ...before, id: randomUUID() } as never)).error).not.toBeNull();
    await expect(pg.query(`update public.invoice_emails set recipient = 'x@example.test' where id = $1`, [outcome.invoiceEmailId])).rejects.toMatchObject({ code: 'GD021' });
    expect((await bob.db.from('invoice_emails').select('id').eq('id', outcome.invoiceEmailId)).data).toEqual([]);
    await pg.query(`update public.contacts set email = $2 where id = $1`, [alice.customerId, recipientOf(alice)]);
  });

  it('exposes only the preview and the send to members, with definer functions fixed to an empty search path', async () => {
    const names = ['invoice_email_preview', 'queue_invoice_email', 'may_email_invoices', 'invoice_email_recipient'];
    const { rows } = await pg.query(
      `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as member, has_function_privilege('anon', p.oid, 'execute') as visitor, p.prosecdef, p.proconfig
         from pg_proc p where p.proname = any($1) order by p.proname`, [names]);
    expect(rows.map(({ proname, member: m, visitor }) => ({ proname, member: m, visitor }))).toEqual([
      { proname: 'invoice_email_preview', member: true, visitor: false },
      { proname: 'invoice_email_recipient', member: false, visitor: false },
      { proname: 'may_email_invoices', member: false, visitor: false },
      { proname: 'queue_invoice_email', member: true, visitor: false },
    ]);
    for (const fn of rows) expect([fn.proname, fn.prosecdef, fn.proconfig]).toEqual([fn.proname, true, ['search_path=""']]);
  });
});

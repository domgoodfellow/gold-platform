import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { OWNER_STORAGE_STATE } from './helpers';
import { populateFinanceBusiness, provisionFinanceBusiness, signInOwner, type FinanceFixture } from './finance-fixtures';
import { readyEmailSender, type ReadySender } from '../tests/support/email-sender';
import { issueDirectInvoice } from '../lib/domain/billing/invoices';
import { createCustomer } from '../lib/domain/customers/customers';
import { listPriceBookItems } from '../lib/domain/pricing/price-book';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { readManifest } from './isolated-cleanup';

/**
 * Emailing an issued invoice from its Finance inspector, in a real browser (Work Order 2H). An
 * ordinary business -- not GildOps -- with a fixture sender on its own verified domain creates the
 * invoice's PDF, opens Send invoice, reviews the sender, the customer's address and the attached PDF,
 * and sends once. Nothing is ever handed to a real email provider: this run's API has no email
 * runtime, so the message honestly stays queued, and what a provider and its delivery webhook would
 * report is recorded through the same database functions and roles the runtime and webhook use.
 * Screenshots at phone, tablet and desktop go to `.artifacts/invoice-email/current`.
 */
const OUT = path.join(__dirname, '..', '..', '..', '.artifacts', 'invoice-email', 'current');
const VIEWPORTS = [{ name: 'phone', width: 390, height: 844 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'desktop', width: 1440, height: 900 }] as const;
const fits = async (page: Page, label: string) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${label} scrolls sideways`).toBe(true);
const CUSTOMER_EMAIL = 'accounts@vertex-hvac.example.test';

async function withPg<T>(work: (pg: Client) => Promise<T>): Promise<T> {
  const pg = new Client(process.env.SUPABASE_DB_URL!);
  await pg.connect();
  try { return await work(pg); } finally { await pg.end(); }
}
const sql = <T = Record<string, unknown>>(query: string, args: unknown[] = []) => withPg(async (pg) => (await pg.query(query, args)).rows as T[]);
/** What the tenant-email runtime (`provider_operator`) or the delivery webhook (`tenant_email_webhook`) records. */
const asRole = (role: string, query: string, args: unknown[]) => withPg(async (pg) => {
  await pg.query('begin');
  try { await pg.query(`set local role ${role}`); await pg.query(query, args); await pg.query('commit'); } catch (failure) { await pg.query('rollback'); throw failure; }
});

let owner: { db: SupabaseClient; userId: string; ownerEmail: string };
let fx: FinanceFixture;
let sender: ReadySender;
let invoiceId: string;

test.describe.serial('Invoice email', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    owner = await signInOwner();
    const organizationId = await provisionFinanceBusiness(owner, `Invoice email ${Date.now().toString(36)}`);
    fx = await populateFinanceBusiness(owner.db, organizationId);
    sender = await withPg((pg) => readyEmailSender(pg, owner.db, organizationId));
    // Communications, so a send links to its conversation in the Inbox: this run's own plan, which
    // the isolated setup made and its teardown removes, and the module switched on.
    const planKey = readManifest(process.env.E2E_FIXTURE_DIR!)?.planKeys?.[0];
    // Written directly: assigning a plan is platform staff's act, and this business's owner is not staff.
    await sql(
      `insert into public.organization_plan_assignments(organization_id,plan_id,plan_kind,period_start,period_end,assigned_by,note)
       select $1, p.id, p.kind, '2020-01-01', '9999-12-31', $2, 'invoice email browser verification' from public.platform_plans p where p.key = $3`,
      [organizationId, owner.userId, planKey],
    );
    await setModuleEnabled(owner.db, { organizationId, key: 'reception', enabled: true });
    await sql(
      `insert into public.organization_commercial_terms(organization_id,product_key,period_start,period_end,quantity,price_minor,currency,recorded_by,note)
       select $1,'module:reception','2020-01-01','9999-12-31',1,0,'CAD',$2,'invoice email browser verification'
        where not exists (select 1 from public.organization_commercial_terms t where t.organization_id = $1 and t.product_key = 'module:reception')`,
      [organizationId, owner.userId],
    );
    const customerId = await createCustomer(owner.db, { organizationId, name: 'Vertex HVAC Accounts', email: CUSTOMER_EMAIL });
    const labour = (await listPriceBookItems(owner.db, { organizationId })).find((item) => item.name === 'Labour')!;
    invoiceId = await issueDirectInvoice(owner.db, { organizationId, customerId, lines: [{ priceBookItemId: labour.id, quantity: 2 }], issuedAt: null, dueAt: null, issuanceKey: crypto.randomUUID() });
  });

  test('sends the invoice’s own PDF once, from the business’s address to the customer’s, and says only what is known', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize(VIEWPORTS[2]);
    await page.goto(`/organizations/${fx.organizationId}/finance/invoices?invoice=${invoiceId}`);
    const drawer = page.getByRole('dialog', { name: /^Invoice #\d+$/ });
    // No PDF yet: nothing to send until it exists.
    await expect(drawer.getByRole('button', { name: 'Send invoice' })).toHaveCount(0);
    await drawer.getByRole('button', { name: 'Create PDF' }).click();
    await expect(drawer.getByRole('link', { name: 'Download PDF' })).toBeVisible();
    const [record] = await sql<{ storage_path: string; sha256: string }>(`select storage_path, sha256 from public.invoice_documents where invoice_id = $1`, [invoiceId]);

    await drawer.getByRole('button', { name: 'Send invoice' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send invoice' });
    for (const text of [sender.address, CUSTOMER_EMAIL, 'CA$191.00']) await expect(dialog.getByText(text, { exact: true })).toBeVisible();
    await expect(dialog.getByText(/^invoice-\d+\.pdf$/)).toBeVisible();
    await expect(dialog.getByRole('textbox')).toHaveCount(2);
    await expect(dialog.getByLabel('Subject')).toHaveValue(/^Invoice #\d+ from Invoice email /);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expect(dialog.getByRole('button', { name: 'Send invoice' })).toBeVisible();
      await fits(page, `send dialog ${viewport.name}`);
      await page.screenshot({ path: path.join(OUT, `send-dialog-${viewport.name}.png`), fullPage: true });
    }
    await page.setViewportSize(VIEWPORTS[2]);

    await dialog.getByRole('button', { name: 'Send invoice' }).click();
    // This run has no email runtime: the message is kept, and the result says nothing was sent.
    await expect(dialog.getByRole('status')).toContainText('Not sent yet');
    await expect(dialog.getByRole('status')).toContainText('Nothing was sent');
    await expect(dialog.getByText('Delivered')).toHaveCount(0);
    const [sent] = await sql<{ message_id: string; conversation_id: string; from_address: string; recipient: string; document_sha256: string }>(
      `select message_id, conversation_id, from_address, recipient, document_sha256 from public.invoice_emails where invoice_id = $1`, [invoiceId]);
    expect(sent).toMatchObject({ from_address: sender.address, recipient: CUSTOMER_EMAIL, document_sha256: record.sha256 });
    expect(await sql(`select storage_bucket, storage_path, sha256 from public.message_attachments where message_id = $1`, [sent.message_id]))
      .toEqual([{ storage_bucket: 'finance-documents', storage_path: record.storage_path, sha256: record.sha256 }]);
    await expect(dialog.getByRole('link', { name: 'Open conversation' })).toHaveAttribute('href', `/organizations/${fx.organizationId}/comms/inbox/${sent.conversation_id}`);
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();

    // Trying again is the same message, not a second email.
    const history = drawer.getByRole('region', { name: 'Email' }).or(drawer.locator('section[aria-labelledby="inspector-email"]'));
    await expect(history.getByRole('status')).toContainText('Queued');
    await expect(history.getByRole('status')).toContainText('Not handed to the email provider yet.');
    await history.getByRole('button', { name: 'Try sending again' }).click();
    await expect(history.getByRole('status')).toContainText('Not sent: ');
    await expect(history.getByRole('status')).toContainText('Nothing was sent.');
    expect(await sql(`select count(*)::int n from public.invoice_emails where invoice_id = $1`, [invoiceId])).toEqual([{ n: 1 }]);
    expect(await sql(`select count(*)::int n from public.messages where conversation_id = $1`, [sent.conversation_id])).toEqual([{ n: 1 }]);

    // The provider accepts it: accepted, and not yet delivered.
    await asRole('provider_operator', `select claim_email_for_send($1,$2)`, [fx.organizationId, sent.message_id]);
    await asRole('provider_operator', `select record_email_send_result($1,$2,'accepted',$3)`, [fx.organizationId, sent.message_id, `re_${sent.message_id}`]);
    await page.reload();
    await expect(history.getByRole('status')).toContainText('Accepted by the email provider');
    await expect(history.getByText(/: Delivered/)).toHaveCount(0);
    // Then its delivery webhook reports delivery.
    await asRole('tenant_email_webhook', `select record_email_event($1,'delivered',$2,null,'{}'::jsonb,now())`, [`re_${sent.message_id}`, `evt-${crypto.randomUUID()}`]);
    await page.reload();
    await expect(history.getByRole('status')).toContainText(': Delivered');
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await expect(drawer.getByRole('button', { name: 'Send again' })).toBeVisible();
      await fits(page, `inspector ${viewport.name}`);
      await page.screenshot({ path: path.join(OUT, `inspector-${viewport.name}.png`), fullPage: true });
    }

    // The conversation is in Communications, with the PDF attached.
    await page.setViewportSize(VIEWPORTS[2]);
    await page.goto(`/organizations/${fx.organizationId}/comms/inbox/${sent.conversation_id}`);
    await expect(page.getByText(/^invoice-\d+\.pdf/).first()).toBeVisible();
  });

  test('a failed send is reported as failed, and sending again is a separate, confirmed act', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS[2]);
    await page.goto(`/organizations/${fx.organizationId}/finance/invoices?invoice=${invoiceId}`);
    const drawer = page.getByRole('dialog', { name: /^Invoice #\d+$/ });
    await drawer.getByRole('button', { name: 'Send again' }).click();
    const dialog = page.getByRole('dialog', { name: 'Send this invoice again' });
    await expect(dialog.getByText('This invoice was emailed before')).toBeVisible();
    await dialog.getByRole('button', { name: 'Send again' }).click();
    await expect(dialog.getByRole('status')).toContainText('Not sent yet');
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
    const [second] = await sql<{ message_id: string; sent_again_after: string | null }>(`select message_id, sent_again_after from public.invoice_emails where invoice_id = $1 order by created_at desc limit 1`, [invoiceId]);
    expect(second.sent_again_after).not.toBeNull();

    await asRole('provider_operator', `select claim_email_for_send($1,$2)`, [fx.organizationId, second.message_id]);
    await asRole('provider_operator', `select record_email_send_result($1,$2,'rejected',null,'The recipient address was refused.')`, [fx.organizationId, second.message_id]);
    await page.reload();
    const latest = drawer.locator('section[aria-labelledby="inspector-email"]').getByRole('status').first();
    await expect(latest).toContainText('Sent again');
    await expect(latest).toContainText('Not delivered');
    await expect(latest).toContainText('The recipient address was refused.');
    await expect(latest.getByRole('button', { name: 'Try sending again' })).toHaveCount(0);
    expect(await sql(`select count(*)::int n from public.invoice_emails where invoice_id = $1`, [invoiceId])).toEqual([{ n: 2 }]);
  });
});

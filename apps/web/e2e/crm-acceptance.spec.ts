import './appearance-env';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { addContactManually, loadDemoContext, OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { recordConnection } from '../lib/domain/integrations/connections';
import { createPriceBookItem } from '../lib/domain/pricing/price-book';
import { addPricedLine } from '../lib/domain/pricing/prices';
import { issueInvoice, recordPayment } from '../lib/domain/billing/invoices';
import { recordCall } from '../lib/domain/reception/calls';

test.use({ storageState: OWNER_STORAGE_STATE });

async function createContact(page: Page, type: 'person' | 'company', name: string, company?: string) {
  await addContactManually(page, { type, name, company });
  await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible();
}

test('Person and Company identity, multiple affiliations, grouping and classification persist across desktop and mobile', async ({ page }, info) => {
  test.setTimeout(180_000);
  const { organizationId } = loadDemoContext();
  const base = `/organizations/${organizationId}/crm/contacts`;
  const suffix = randomUUID().slice(0, 8);
  const company = `Acceptance Company ${suffix}`;
  const people = [`Acceptance Alice ${suffix}`, `Acceptance Bob ${suffix}`];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base);
  await createContact(page, 'company', company);
  for (const name of people) {
    await page.goto(base);
    await createContact(page, 'person', name, company);
  }
  await page.getByRole('link', { name: people[1], exact: true }).first().click();
  await expect(page).toHaveURL(/\/crm\/contacts\/[a-f0-9-]+$/);
  const identityUrl = page.url();
  await expect(page.getByRole('heading', { name: people[1], exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: company, exact: true }).first()).toBeVisible();
  // V1.4: editing is a focused dialog; classification lives in its Relationship section.
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit contact', exact: true });
  await edit.getByRole('button', { name: 'Relationship', exact: true }).click();
  await edit.getByLabel('Lifecycle', { exact: true }).selectOption('customer');
  await edit.getByLabel('Lead temperature', { exact: true }).selectOption('hot');
  await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(edit).toBeHidden();
  await page.reload();
  expect(page.url()).toBe(identityUrl);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(edit.locator('input[name="contactType"]')).toHaveValue('person');
  await edit.getByRole('button', { name: 'Relationship', exact: true }).click();
  await expect(edit.getByLabel('Lifecycle', { exact: true })).toHaveValue('customer');
  await expect(edit.getByLabel('Lead temperature', { exact: true })).toHaveValue('hot');
  await page.keyboard.press('Escape');
  await page.goto(base);
  const companyLink = page.getByRole('link', { name: company, exact: true }).first();
  const companyId = (await companyLink.getAttribute('href'))!.split('/').pop()!;
  await companyLink.click();
  for (const name of people) await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await page.goto(base);
  // V1.4: less frequent criteria live in the Filters panel.
  await page.getByText('Filters', { exact: true }).click();
  await page.getByLabel('Filter by company', { exact: true }).selectOption(companyId);
  await page.getByLabel('Contact grouping', { exact: true }).selectOption('company');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`companyId=${companyId}`));
  for (const name of people) await expect(page.getByRole('link', { name, exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Contact grouping', { exact: true })).toHaveValue('company');
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`contacts-${width}.png`), fullPage: true });
  }
  const pg = new Client(process.env.SUPABASE_DB_URL);
  await pg.connect();
  try {
    const rows = await pg.query('select id,contact_type,lifecycle,lead_temperature from contacts where organization_id=$1 and name=$2', [organizationId, people[1]]);
    expect(rows.rows).toEqual([{ id: identityUrl.split('/').pop(), contact_type: 'person', lifecycle: 'customer', lead_temperature: 'hot' }]);
  } finally { await pg.end(); }
});

test('Contacts and Library enter reviewed CSV import; repeating the same source preserves identity', async ({ page }, info) => {
  test.setTimeout(180_000);
  const { organizationId } = loadDemoContext();
  const base = `/organizations/${organizationId}`;
  const suffix = randomUUID().slice(0, 8);
  const name = `Imported Person ${suffix}`;
  const csv = `source_record_id,name,email\n${suffix},${name},import-${suffix}@example.test\n${suffix}-duplicate,${name},import-${suffix}@example.test\n`;
  await page.goto(`${base}/crm/contacts`);
  // V1.3: importing starts from the Add contacts intake, which leads to Library's import.
  await page.getByRole('button', { name: 'Add contacts', exact: true }).first().click();
  await page.getByRole('dialog', { name: 'Add contacts' }).getByRole('link', { name: /Import records/ }).click();
  await expect(page).toHaveURL(/\/library\/imports\/new/);
  await page.getByLabel('CSV file', { exact: true }).setInputFiles({ name: `acceptance-${suffix}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Map your columns', exact: true })).toBeVisible();
  const sourceUrl = page.url();
  await page.getByRole('combobox', { name: 'Contact type', exact: true }).selectOption('person');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review changes', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Possible duplicates', exact: true }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('import-review.png'), fullPage: true });
  await page.getByRole('link', { name: 'Ready', exact: true }).click();
  await page.getByRole('button', { name: 'Import 1 contact', exact: true }).click();
  const confirmation = page.getByRole('dialog');
  await confirmation.getByRole('button', { name: /Import 1 contact/ }).click();
  await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'View contacts', exact: true }).click();
  await page.getByRole('link', { name, exact: true }).first().click();
  await expect(page).toHaveURL(/\/crm\/contacts\/[a-f0-9-]+$/);
  const identity = page.url();
  await page.goto(sourceUrl);
  await page.getByRole('combobox', { name: 'Contact type', exact: true }).selectOption('person');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  // A newly reviewed mapping proposes an update to the existing contact, not a
  // second identity. Reconfirm it and prove the persisted cardinality and ID.
  await expect(page.getByRole('button', { name: 'Import 1 contact', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Import 1 contact', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Import 1 contact/ }).click();
  await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Possible duplicates', exact: true }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('import-duplicate-review.png'), fullPage: true });
  await page.goto(`${base}/library/sources`);
  await page.getByRole('link', { name: /Import/, exact: false }).first().click();
  await expect(page).toHaveURL(/\/library\/imports\/new/);
  await page.goto(identity);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const pg = new Client(process.env.SUPABASE_DB_URL);
  await pg.connect();
  try {
    expect((await pg.query('select id from contacts where organization_id=$1 and name=$2', [organizationId, name])).rows).toEqual([{ id: identity.split('/').pop() }]);
  } finally { await pg.end(); }
});

test.describe('CRM limited membership', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });
  test('does not offer contact creation or import', async ({ page }) => {
    await page.goto(`/organizations/${loadDemoContext().organizationId}/crm/contacts`);
    await expect(page.getByRole('button', { name: 'Add contacts', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Import', exact: true })).toHaveCount(0);
  });
});

test('an existing contact keeps Work, financial, call and opportunity associations when classified', async ({ page }) => {
  test.setTimeout(120_000);
  const { organizationId, ownerEmail, customerId, workItemId } = loadDemoContext();
  const base = `/organizations/${organizationId}`;
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const login = await db.auth.signInWithPassword({ email: ownerEmail, password: DEMO_PASSWORD });
  if (login.error) throw login.error;
  try {
    const priceBookItemId = await createPriceBookItem(db, { organizationId, name: 'Acceptance historical service', unit: 'service', unitAmountMinor: 1000 });
    await addPricedLine(db, { workItemId, priceBookItemId, quantity: 1 });
    const invoiceId = await issueInvoice(db, { workItemId });
    const paymentId = await recordPayment(db, { invoiceId, amountMinor: 500 });
    const callId = await recordCall(db, { organizationId, customerId, direction: 'outbound', fromNumber: '+14165550111', toNumber: '+14165550112' });
    await page.goto(`${base}/crm/contacts/${customerId}`);
    await page.getByRole('link', { name: 'Sales', exact: true }).click();
    await page.getByRole('button', { name: 'New opportunity', exact: true }).click();
    const opportunity = page.getByRole('dialog', { name: 'New opportunity', exact: true });
    const title = `Preserved opportunity ${randomUUID().slice(0, 8)}`;
    await opportunity.getByLabel('Title', { exact: true }).fill(title);
    await opportunity.getByRole('button', { name: 'Save opportunity', exact: true }).click();
    await expect(opportunity).toBeHidden();
    await expect(page).toHaveURL(/\/crm\/opportunities\/[a-f0-9-]+$/);
    await page.goto(`${base}/crm/contacts/${customerId}`);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const edit = page.getByRole('dialog');
    await edit.getByText('Person', { exact: true }).click();
    await edit.getByRole('button', { name: 'Relationship', exact: true }).click();
    await edit.getByLabel('Lifecycle', { exact: true }).selectOption('customer');
    await edit.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(edit).toBeHidden();
    await page.reload();
    await expect(page).toHaveURL(`${base}/crm/contacts/${customerId}`);
    await page.getByRole('link', { name: 'Related', exact: true }).click();
    await page.getByRole('link', { name: 'Work', exact: true }).click();
    await expect(page.getByRole('link', { name: 'Isolated fixture job', exact: true }).first()).toBeVisible();
    await page.getByRole('link', { name: 'Sales', exact: true }).click();
    await page.getByRole('link', { name: 'Invoices', exact: true }).click();
    await expect(page.getByRole('link', { name: /^Invoice #/ }).first()).toHaveAttribute('href', `${base}/work/${workItemId}`);
    expect((await db.from('invoices').select('id,customer_id').eq('id', invoiceId).single()).data).toMatchObject({ id: invoiceId, customer_id: customerId });
    await page.getByRole('link', { name: 'Activity', exact: true }).click();
    await page.getByRole('link', { name: 'Calls', exact: true }).click();
    await expect(page.locator(`a[href$="/calls/${callId}"]`).first()).toBeVisible();
    await page.getByRole('link', { name: 'Sales', exact: true }).click();
    await page.getByRole('link', { name: title, exact: true }).first().click();
    await expect(page).toHaveURL(/\/crm\/opportunities\/[a-f0-9-]+$/);
    await expect(page.locator(`a[href$="/crm/contacts/${customerId}"]`).first()).toBeVisible();
    expect((await db.from('payments').select('id,invoice_id,amount_minor').eq('id', paymentId).single()).data).toMatchObject({ id: paymentId, invoice_id: invoiceId, amount_minor: 500 });
  } finally { await db.auth.signOut({ scope: 'local' }); }
});

test('a simulated synchronized worksheet can lose a row while its imported contact remains accessible', async ({ page }, info) => {
  test.setTimeout(120_000);
  const { organizationId, ownerEmail } = loadDemoContext();
  const base = `/organizations/${organizationId}`;
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const login = await db.auth.signInWithPassword({ email: ownerEmail, password: DEMO_PASSWORD });
  if (login.error) throw login.error;
  const pg = new Client(process.env.SUPABASE_DB_URL);
  await pg.connect();
  try {
    const connectionId = await recordConnection(db, { organizationId, connectorKey: 'google_workspace' });
    await pg.query("update integration_connections set status='active' where id=$1", [connectionId]);
    async function machine(sql: string, values: unknown[]) {
      await pg.query('begin');
      try {
        await pg.query('set local role integration_operator');
        const answer = await pg.query(sql, values);
        await pg.query('commit');
        return answer.rows;
      } catch (error) { await pg.query('rollback'); throw error; }
    }
    const resourceId = (await machine("select public.record_managed_integration_resource($1,'google_sheet',$2,'Acceptance worksheet','{}') as id", [connectionId, randomUUID()]))[0].id;
    const configured = await db.rpc('configure_integration_resource_sync', { p_resource_id: resourceId, p_enabled: true, p_parameters: {} });
    if (configured.error) throw configured.error;
    const name = `Worksheet Person ${randomUUID().slice(0, 8)}`;
    async function snapshot(rows: unknown[]) {
      const job = (await machine('select public.claim_integration_resource_sync($1) as job', [resourceId]))[0].job;
      expect(job).toBeTruthy();
      await machine("select public.commit_integration_resource_sync($1,$2,$3,'{}',true,true,null)", [resourceId, job.lease_id, JSON.stringify(rows)]);
    }
    await snapshot([{ external_id: 'person-42', display_name: name, metadata: { headers: ['name'], values: [name] }, deleted: false }]);
    await page.goto(`${base}/library/imports/new?resourceId=${resourceId}`);
    await page.getByRole('combobox', { name: 'Contact type', exact: true }).selectOption('person');
    await page.getByRole('combobox', { name: 'How often', exact: true }).selectOption('sync');
    await page.getByRole('button', { name: 'Review changes', exact: true }).click();
    await page.getByRole('button', { name: 'Import 1 contact', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Import 1 contact/ }).click();
    await expect(page.getByRole('heading', { name: 'Results', exact: true })).toBeVisible();
    const contact = await db.from('contacts').select('id').eq('organization_id', organizationId).eq('name', name).single();
    expect(contact.error).toBeNull();
    await snapshot([]);
    await page.goto(`${base}/library/sources/${resourceId}`);
    await expect(page.getByRole('heading', { name: 'Acceptance worksheet', exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('source-row-removed.png'), fullPage: true });
    await page.goto(`${base}/crm/contacts/${contact.data!.id}`);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByText('Person', { exact: true }).first()).toBeVisible();
  } finally { await pg.end(); await db.auth.signOut({ scope: 'local' }); }
});

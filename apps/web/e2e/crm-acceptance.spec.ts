import './appearance-env';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE, COLLEAGUE_STORAGE_STATE } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

async function createContact(page: Page, type: 'person' | 'company', name: string, company?: string) {
  await page.getByRole('button', { name: 'Add contact', exact: true }).first().click();
  const drawer = page.getByRole('dialog', { name: 'Add contact', exact: true });
  await drawer.getByLabel('Contact type', { exact: true }).selectOption(type);
  await drawer.getByLabel(type === 'person' ? 'Person name' : 'Company name', { exact: true }).fill(name);
  if (company) await drawer.getByLabel('Company', { exact: true }).selectOption({ label: company });
  await drawer.getByRole('button', { name: 'Add contact', exact: true }).click();
  await expect(drawer).toBeHidden();
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
  const identityUrl = page.url();
  await expect(page.getByRole('heading', { name: people[1], exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: company, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: `Edit ${people[1]}`, exact: true });
  await edit.getByLabel('Lifecycle', { exact: true }).selectOption('customer');
  await edit.getByLabel('Lead temperature', { exact: true }).selectOption('hot');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(edit).toBeHidden();
  await page.reload();
  expect(page.url()).toBe(identityUrl);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(edit.getByLabel('Contact type', { exact: true })).toHaveValue('person');
  await expect(edit.getByLabel('Lifecycle', { exact: true })).toHaveValue('customer');
  await expect(edit.getByLabel('Lead temperature', { exact: true })).toHaveValue('hot');
  await page.keyboard.press('Escape');
  await page.goto(base);
  const companyLink = page.getByRole('link', { name: company, exact: true }).first();
  const companyId = (await companyLink.getAttribute('href'))!.split('/').pop()!;
  await companyLink.click();
  for (const name of people) await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await page.goto(base);
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
  const csv = `source_record_id,name,email\n${suffix},${name},import-${suffix}@example.test\n`;
  await page.goto(`${base}/crm/contacts`);
  await page.getByRole('link', { name: /Import/, exact: false }).first().click();
  await expect(page).toHaveURL(/\/library\/imports\/new/);
  await page.getByLabel('CSV file', { exact: true }).setInputFiles({ name: `acceptance-${suffix}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Map your columns', exact: true })).toBeVisible();
  const sourceUrl = page.url();
  await page.getByLabel('Contact type', { exact: true }).selectOption('person');
  await page.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('import-review.png'), fullPage: true });
  await page.getByRole('button', { name: 'Import 1 contact', exact: true }).click();
  const confirmation = page.getByRole('dialog');
  await confirmation.getByRole('button', { name: /Import 1 contact/ }).click();
  await expect(page.getByRole('heading', { name: 'Result', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'View contacts', exact: true }).click();
  await page.getByRole('link', { name, exact: true }).first().click();
  const identity = page.url();
  await page.goto(sourceUrl);
  await page.getByLabel('Contact type', { exact: true }).selectOption('person');
  await page.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(page.getByText('0 rows ready to import.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import 1 contact', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Duplicates', exact: true }).click();
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath('import-duplicate-review.png'), fullPage: true });
  await page.goto(`${base}/library/sources`);
  await page.getByRole('link', { name: /Import/, exact: false }).first().click();
  await expect(page).toHaveURL(/\/library\/imports\/new/);
  await page.goto(identity);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
});

test.describe('CRM limited membership', () => {
  test.use({ storageState: COLLEAGUE_STORAGE_STATE });
  test('does not offer contact creation or import', async ({ page }) => {
    await page.goto(`/organizations/${loadDemoContext().organizationId}/crm/contacts`);
    await expect(page.getByRole('button', { name: 'Add contact', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Import', exact: true })).toHaveCount(0);
  });
});

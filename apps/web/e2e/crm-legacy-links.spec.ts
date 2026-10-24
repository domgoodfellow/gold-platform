import { test, expect } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';

test.use({ storageState: OWNER_STORAGE_STATE });

/**
 * Old CRM addresses are temporary compatibility redirects (docs/data.md, "Approved CRM
 * consolidation"). Each one must land on its canonical page with the same organization, the same
 * record and every query value, so a bookmarked or emailed link keeps working until retirement.
 */
test('old CRM links land on the canonical page with the same record and query', async ({ page }) => {
  // Nine full page loads; on a development server each first visit also compiles the page.
  test.setTimeout(90_000);
  const { organizationId, customerId } = loadDemoContext();
  const base = `/organizations/${organizationId}`;
  const cases: [string, string][] = [
    ['/sales', '/crm'],
    ['/sales/configuration/fields', '/crm/configuration/fields'],
    [`/customers?q=a%26b&lifecycle=lead`, `/crm/contacts?q=a%26b&lifecycle=lead`],
    [`/customers/${customerId}`, `/crm/contacts/${customerId}`],
    ['/customers/pipeline', '/crm/contacts/stages'],
    ['/opportunities?kind=open', '/crm/opportunities?kind=open'],
    ['/opportunities/pipeline', '/crm/pipeline'],
    ['/follow-ups?status=open&status=completed', '/crm/tasks?status=open&status=completed'],
  ];
  for (const [legacy, canonical] of cases) {
    await page.goto(`${base}${legacy}`);
    await expect(page, legacy).toHaveURL(`${base}${canonical}`);
  }
  // The record page itself rendered, not a not-found inside CRM.
  await page.goto(`${base}/customers/${customerId}`);
  await expect(page.getByRole('heading', { name: 'Not found' })).toHaveCount(0);
});

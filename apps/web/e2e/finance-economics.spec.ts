import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { expect, test } from '@playwright/test';
import { loadDemoContext, OWNER_STORAGE_STATE, platformUrl, STAFF_STORAGE_STATE } from './helpers';

const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const source = `finance-visual-${randomUUID()}`;
let pg: Client;
let usageEventId: string;

test.beforeAll(async () => {
  pg = new Client({ connectionString: CONNECTION });
  await pg.connect();
  const { organizationId } = loadDemoContext();
  await pg.query(
    `insert into public.platform_provider_rates
       (provider_key, meter_id, cost_meter_key, currency, unit_amount_micros,
        approval_state, effective_from, source, region, direction)
     values ('twilio', 'voice_minutes', 'telephony.pstn.outbound.minute', 'CAD', 1400000,
       'approved', now() - interval '1 day', $1, 'CA', 'outbound')`,
    [source],
  );
  usageEventId = (await pg.query(
    `select app.record_usage($1, 'voice_minutes', 10, 'twilio', now(), null, null, null, $2, 'visual QA call') as id`,
    [organizationId, source],
  )).rows[0].id;
  await pg.query(`select app.identify_usage_source($1, 'communications.call', $2)`, [usageEventId, source]);
  await pg.query(`select app.record_usage_cost_component($1, 'pstn', 'twilio', 'telephony.pstn.outbound.minute', 10, 'minute', null, null, 'CA', 'outbound', null, 'CAD')`, [usageEventId]);
  await pg.query(`select app.record_usage_cost_component($1, 'conference', 'twilio', 'telephony.conference.participant_minute', 20, 'participant_minute', null, null, null, 'outbound', null, 'CAD')`, [usageEventId]);
});

test.afterAll(async () => {
  await pg.query(`delete from public.usage_cost_components where usage_event_id = $1`, [usageEventId]);
  await pg.query(`delete from public.usage_events where id = $1`, [usageEventId]);
  await pg.query(`delete from public.platform_provider_rates where source = $1`, [source]);
  await pg.end();
});

test.describe('staff finance economics', () => {
  test.use({ storageState: STAFF_STORAGE_STATE });

  test('filters usage and opens a mixed known/unknown component drawer', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(platformUrl('usage'));
    await expect(page.getByRole('heading', { name: 'Usage & economics', level: 1 })).toBeVisible();
    const { organizationId } = loadDemoContext();
    await page.getByLabel('Organization', { exact: true }).selectOption(organizationId);
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page).toHaveURL(new RegExp(`organization=${organizationId}`));
    await expect(page.getByText('Cost unknown').first()).toBeVisible();
    await page.getByRole('button', { name: 'Grachtwerk Verhuur' }).click();
    await expect(page.getByRole('heading', { name: 'voice minutes' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Cost components' })).toBeVisible();
    await expect(page.getByText('No current provider rate matches this component.')).toBeVisible();
    await page.screenshot({ path: '../../.artifacts/finance/usage-economics-desktop.png', fullPage: true });
    await page.goto(platformUrl('usage'));
    await page.getByLabel('From date').fill('2099-01-01');
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByText('No usage for this period.')).toBeVisible();
    await page.screenshot({ path: '../../.artifacts/finance/usage-economics-empty.png', fullPage: true });
    expect(errors).toEqual([]);
  });

  test('shows vendor rate history and remains usable at a narrow viewport', async ({ page }) => {
    await page.goto(platformUrl('vendor-rates'));
    await expect(page.getByRole('heading', { name: 'Vendor rates', level: 1 })).toBeVisible();
    const pstnRate = page.getByRole('button', { name: 'PSTN outbound minute' }).first();
    await expect(pstnRate).toBeVisible();
    await pstnRate.click();
    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
    await page.screenshot({ path: '../../.artifacts/finance/vendor-rates-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(platformUrl('usage'));
    await expect(page.getByRole('heading', { name: 'Usage & economics', level: 1 })).toBeVisible();
    await page.screenshot({ path: '../../.artifacts/finance/usage-economics-narrow.png', fullPage: true });
  });
});

test.describe('tenant cost boundary', () => {
  test.use({ storageState: OWNER_STORAGE_STATE });

  test('does not expose wholesale economics on Plan & usage', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/settings/plan`);
    await expect(page.getByRole('heading', { name: 'Plan & usage', level: 1 })).toBeVisible();
    await expect(page.getByText('Known COGS')).toHaveCount(0);
    await expect(page.getByText('Provider rate')).toHaveCount(0);
    await page.screenshot({ path: '../../.artifacts/finance/tenant-plan-usage.png', fullPage: true });
  });

  test('does not expose wholesale economics on Finance Home, and reaches it from the sidebar', async ({ page }) => {
    const { organizationId } = loadDemoContext();
    await page.goto(`/organizations/${organizationId}/home`);
    await page.getByRole('link', { name: 'Finance', exact: true }).click();
    await expect(page).toHaveURL(`/organizations/${organizationId}/finance`);
    await expect(page.getByRole('heading', { name: 'Finance', level: 1 })).toBeVisible();
    await expect(page.getByText('Known COGS')).toHaveCount(0);
    await expect(page.getByText('Provider rate')).toHaveCount(0);
    await expect(page.getByText('margin', { exact: false })).toHaveCount(0);
    await page.screenshot({ path: '../../.artifacts/finance/finance-home-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.screenshot({ path: '../../.artifacts/finance/finance-home-narrow.png', fullPage: true });
  });
});

import { test, expect } from '@playwright/test';
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { loadDemoContext, OWNER_STORAGE_STATE } from './helpers';
import { DEMO_PASSWORD } from '../scripts/demo/businesses';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { setModuleEnabled } from '../lib/domain/tenancy/modules';
import { recordCommercialTerm } from '../lib/domain/commercial/terms';
import { createWorkItemType } from '../lib/domain/work-items/types';
import { createWorkItemStatus } from '../lib/domain/work-items/statuses';
import { createWorkItemTransition } from '../lib/domain/work-items/transitions';
import {
  createWorkItem,
  listWorkItems,
} from '../lib/domain/work-items/work-items';
import { createCustomer } from '../lib/domain/customers/customers';
import {
  createAutomationRule,
  addAutomationAction,
  addAutomationCondition,
  listAutomationRules,
  listAutomationRuns,
} from '../lib/domain/automation/rules';
import {
  createMessageTemplate,
  listMessageDeliveries,
  updateMessageTemplate,
} from '../lib/domain/automation/templates';

config({ path: '../../.env.test' });
test.use({ storageState: OWNER_STORAGE_STATE });

test('authors, executes and monitors rules with responsive operating surfaces', async ({
  page,
}) => {
  test.setTimeout(240000);
  const url = process.env.SUPABASE_URL ?? '';
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname))
    throw new Error('Automation fixtures are local only');
  const db = createClient(url, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const staff = createClient(url, process.env.SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ctx = loadDemoContext();
  const signIn = await db.auth.signInWithPassword({
    email: ctx.ownerEmail,
    password: DEMO_PASSWORD,
  });
  if (signIn.error) throw signIn.error;
  const staffSignIn = await staff.auth.signInWithPassword({
    email: 'staff@gold.test',
    password: DEMO_PASSWORD,
  });
  if (staffSignIn.error) throw staffSignIn.error;
  const organizationId = await provisionOrganization(staff, {
    ownerEmail: ctx.ownerEmail,
    name: `Automations acceptance ${randomUUID().slice(0, 8)}`,
    timezone: 'America/Toronto',
    currency: 'CAD',
  });
  await setModuleEnabled(db, {
    organizationId,
    key: 'automations',
    enabled: true,
  });
  await recordCommercialTerm(staff, {
    organizationId,
    productKey: 'module:automations',
    periodStart: '2026-01-01',
    periodEnd: '9999-12-31',
    priceMinor: 0,
    note: 'Local automation acceptance fixture',
  });
  const typeId = await createWorkItemType(db, {
    organizationId,
    name: 'Maintenance',
    schedulable: true,
  });
  const initial = await createWorkItemStatus(db, {
    organizationId,
    typeId,
    name: 'Requested',
    position: 0,
  });
  const target = await createWorkItemStatus(db, {
    organizationId,
    typeId,
    name: 'Confirmed',
    position: 1,
  });
  const invalid = await createWorkItemStatus(db, {
    organizationId,
    typeId,
    name: 'Unreachable',
    position: 2,
  });
  await createWorkItemTransition(db, {
    organizationId,
    typeId,
    fromStatusId: initial,
    toStatusId: target,
  });
  const base = `/organizations/${organizationId}/automations`;
  mkdirSync('test-results/automations', { recursive: true });
  writeFileSync(
    'test-results/automations/context.json',
    JSON.stringify(
      { organizationId, url: `http://localhost:3000${base}` },
      null,
      2,
    ),
  );
  const capture = async (name: string) =>
    page.screenshot({
      path: `test-results/automations/${name}.png`,
      fullPage: true,
    });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base);
  await expect(
    page.getByRole('heading', { name: 'Needs attention', exact: true }),
  ).toBeVisible();
  await capture('01-empty-home-desktop');
  await page
    .getByRole('button', { name: 'New automation', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'What this rule is for' })
    .fill('Confirm controlled maintenance');
  await page.getByLabel('What sets it off').selectOption('event');
  await page.getByLabel('Which moment').selectOption('work_item.created');
  await page.getByRole('button', { name: 'Add rule', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Rule workflow' }),
  ).toBeVisible();
  await expect(
    page.getByText('Disabled', { exact: true }).first(),
  ).toBeVisible();
  const ruleId = page.url().split('/').at(-1)!.split('?')[0];
  await page
    .getByRole('button', { name: 'Add condition', exact: true })
    .first()
    .click();
  await page.getByLabel('Part of the job').selectOption('title');
  await page.getByLabel('Comparison', { exact: true }).selectOption('equals');
  await page
    .getByRole('textbox', { name: 'Value', exact: true })
    .fill('Controlled maintenance');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Add condition', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Add action', exact: true })
    .first()
    .click();
  await page.getByLabel('What to do').selectOption('change_status');
  await page.getByLabel('Status', { exact: true }).selectOption(target);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Add action', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /Action 1.*Change Work status/ }),
  ).toBeVisible();
  await capture('05-builder-completed');
  const canvas = await page
    .getByRole('region', { name: 'Workflow canvas' })
    .boundingBox();
  const inspector = await page.getByLabel('Node inspector').boundingBox();
  expect(inspector!.x).toBeGreaterThan(canvas!.x);
  expect(Math.abs(inspector!.y - canvas!.y)).toBeLessThan(2);
  await page
    .getByRole('button', { name: /Trigger.*Starts this automation/ })
    .click();
  await capture('06-builder-trigger');
  const rule = (await listAutomationRules(db, { organizationId })).find(
    (r) => r.id === ruleId,
  )!;
  await page.goto(`${base}/${ruleId}?node=${rule.conditions[0].id}`);
  await capture('07-builder-condition');
  await page
    .getByRole('button', { name: 'Edit condition', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Value', exact: true })
    .fill('Controlled maintenance');
  await page
    .getByRole('button', { name: 'Save condition', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto(`${base}/${ruleId}?node=${rule.actions[0].id}`);
  await capture('08-builder-action');
  await page.getByRole('button', { name: 'Edit action', exact: true }).click();
  await page.getByLabel('Status', { exact: true }).selectOption(target);
  await page.getByRole('button', { name: 'Save action', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Enable', exact: true }).click();
  await page
    .getByRole('button', { name: 'Enable automation', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Disable', exact: true }),
  ).toBeVisible();
  const workId = await createWorkItem(db, {
    organizationId,
    statusId: initial,
    title: 'Controlled maintenance',
  });
  expect(
    (await listAutomationRuns(db, { organizationId, ruleId }))[0].outcome,
  ).toBe('done');
  expect(
    (await listWorkItems(db, { organizationId })).find((w) => w.id === workId)
      ?.status.id,
  ).toBe(target);

  // Local-only populated composition, including genuine runtime failures and queued messages.
  const customerId = await createCustomer(db, {
    organizationId,
    name: 'Test Customer',
    email: 'automation@example.test',
  });
  const templateId = await createMessageTemplate(db, {
    organizationId,
    name: 'Maintenance confirmation',
    subject: 'Update for {{job}}',
    body: 'Hello {{customer}}, {{job}} is {{status}}. {{business}}',
  });
  for (const [name, kind] of [
    ['Upcoming maintenance reminder', 'schedule'],
    ['Weather schedule adjustment', 'external_reading'],
    ['Asset service interval', 'counter_threshold'],
  ] as const) {
    const id = await createAutomationRule(db, {
      organizationId,
      name,
      triggerKind: kind,
      triggerMinutesBefore: 120,
      triggerMetric: 'wind_speed',
      triggerComparison: 'above',
      triggerThreshold: 30,
      triggerUnit: kind === 'counter_threshold' ? 'hours' : 'km/h',
      triggerCounterStep: 500,
      enabled: false,
    });
    if (kind === 'counter_threshold')
      await addAutomationAction(db, {
        organizationId,
        ruleId: id,
        kind: 'create_work_item',
        typeId,
        statusId: initial,
      });
    else
      await addAutomationAction(db, {
        organizationId,
        ruleId: id,
        kind: 'shift_schedule',
        shiftMinutes: 1440,
      });
  }
  const notify = await createAutomationRule(db, {
    organizationId,
    name: 'Notify maintenance Customer',
    triggerKind: 'event',
    triggerEventAction: 'work_item.created',
  });
  await addAutomationCondition(db, {
    organizationId,
    ruleId: notify,
    subjectField: 'customer_id',
    operator: 'is_set',
  });
  await addAutomationAction(db, {
    organizationId,
    ruleId: notify,
    kind: 'notify',
    templateId,
    channel: 'email',
  });
  const failure = await createAutomationRule(db, {
    organizationId,
    name: 'Review unreachable transition',
    triggerKind: 'event',
    triggerEventAction: 'work_item.created',
  });
  await addAutomationAction(db, {
    organizationId,
    ruleId: failure,
    kind: 'change_status',
    statusId: invalid,
  });
  for (let i = 0; i < 3; i++)
    await createWorkItem(db, {
      organizationId,
      statusId: initial,
      title: `Controlled maintenance ${i}`,
      customerId,
    });
  const deliveries = await listMessageDeliveries(db, { organizationId });
  const pg = new Client(
    process.env.SUPABASE_DB_URL ??
      'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  );
  if (
    !['localhost', '127.0.0.1'].includes(
      new URL(
        process.env.SUPABASE_DB_URL ??
          'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      ).hostname,
    )
  )
    throw new Error('Local sender simulation only');
  await pg.connect();
  await pg.query('select public.record_message_delivery($1,false,$2)', [
    deliveries[0].id,
    'Controlled local sender rejection; no provider called',
  ]);
  await pg.query('select public.record_message_delivery($1,true,null)', [
    deliveries[1].id,
  ]);
  await pg.end();
  await updateMessageTemplate(db, {
    id: templateId,
    name: 'Maintenance confirmation',
    subject: 'Changed subject',
    body: 'Changed body',
  });
  expect((await listMessageDeliveries(db, { organizationId }))[0].body).toBe(
    deliveries[0].body,
  );
  await page.goto(base);
  for (const title of [
    'Needs attention',
    'Automation library',
    'Recent executions',
    'Execution performance',
    'Recent activity',
    'Automation health',
    'Recent failures',
    'Insights',
  ])
    await expect(
      page.getByRole('heading', { name: title, exact: true }),
    ).toBeVisible();
  await capture('02-populated-home-desktop');
  const mainPanel = await page
    .getByRole('heading', { name: 'Needs attention', exact: true })
    .boundingBox();
  const railPanel = await page
    .getByRole('heading', { name: 'Recent activity', exact: true })
    .boundingBox();
  expect(railPanel!.x).toBeGreaterThan(mainPanel!.x);
  expect(Math.abs(railPanel!.y - mainPanel!.y)).toBeLessThan(2);
  await page.getByRole('button', { name: /Failed deliveries/ }).click();
  await expect(
    page
      .getByText('Controlled local sender rejection; no provider called')
      .filter({ visible: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 768, height: 1024 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await capture('home-tablet');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await capture('03-populated-home-mobile');
  await page.goto(`${base}/${ruleId}`);
  await page
    .getByRole('button', { name: /Trigger.*Starts this automation/ })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Trigger configuration' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to canvas' }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await capture('builder-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${base}/rules?status=enabled`);
  await capture('04-rules-collection');
  await page.goto(`${base}/${failure}?node=diagnostics`);
  await capture('09-builder-diagnostics');
  await page.goto(`${base}/activity?outcome=failed`);
  await capture('10-run-history');
  const failed = (
    await listAutomationRuns(db, { organizationId, failedOnly: true })
  )[0];
  await page.goto(`${base}/activity?run=${failed.id}`);
  await expect(
    page.getByRole('heading', { name: 'Execution inspection' }),
  ).toBeVisible();
  await capture('11-execution-inspector');
  await page.goto(
    `${base}/activity?stream=deliveries&delivery=${deliveries[0].id}`,
  );
  await expect(
    page.getByRole('heading', { name: 'Delivery inspection' }),
  ).toBeVisible();
  await capture('delivery-inspector');
  await page.goto(`${base}/messages`);
  await capture('12-message-templates');
  await page
    .getByRole('button', { name: 'Edit Maintenance confirmation' })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: /Preview/ })).toBeVisible();
  await capture('13-template-editor');
  await page.goto(`${base}/${ruleId}`);
  const historicalRun = (
    await listAutomationRuns(db, { organizationId, ruleId })
  )[0];
  await page.getByRole('button', { name: 'Disable', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Enable', exact: true }),
  ).toBeVisible();
  await createWorkItem(db, {
    organizationId,
    statusId: initial,
    title: 'Controlled maintenance',
  });
  expect(await listAutomationRuns(db, { organizationId, ruleId })).toHaveLength(
    1,
  );
  await page.getByRole('button', { name: 'Enable', exact: true }).click();
  await page
    .getByRole('button', { name: 'Enable automation', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Disable', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Remove rule', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Needs attention', exact: true }),
  ).toBeVisible();
  await page.goto(`${base}/activity?run=${historicalRun.id}`);
  await expect(
    page.getByText(
      'This rule was deleted. Its execution history remains recorded.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Open current Rule Builder', exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

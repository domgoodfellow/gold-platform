import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { chromium, type FullConfig } from '@playwright/test';
import type { DemoContext } from './global-setup';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { configureBusiness } from '../lib/domain/configuration/configure';
import { recordCommercialTerm } from '../lib/domain/commercial/terms';
import { createPlan, grantPlanProduct } from '../lib/domain/catalogue/plans';
import { recordPlanAssignment } from '../lib/domain/catalogue/organization-plans';
import { addMember } from '../lib/domain/tenancy/members';
import { createResource } from '../lib/domain/resources/resources';
import { createLocation } from '../lib/domain/locations/locations';
import { createCustomer } from '../lib/domain/customers/customers';
import { createWorkItem } from '../lib/domain/work-items/work-items';
import { createAsset } from '../lib/domain/assets/assets';
import { BUSINESSES, DEMO_PASSWORD } from '../scripts/demo/businesses';

/**
 * Disposable fixtures for the navigation specs that used to need the shared demo businesses
 * (`adaptive-shell`, `breadcrumbs`, `studio-navigation`). It stands up **one new business** from the
 * first demo business's shape, through the same domain commands the demo uses, with its own
 * run-unique owner and reduced-role colleague, and writes its context and signed-in states into
 * `E2E_FIXTURE_DIR`. It never reads, changes or deletes the demo businesses; `isolated-teardown.ts`
 * removes exactly what this run recorded in `fixtures.json`.
 */
export const FIXTURE_DIR = process.env.E2E_FIXTURE_DIR!;

function local(url: string) {
  if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error(`Refusing disposable fixtures against ${url}: local only.`);
}

export default async function isolatedSetup(config: FullConfig): Promise<void> {
  loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test'), quiet: true });
  const url = process.env.SUPABASE_URL!;
  const connection = process.env.SUPABASE_DB_URL!;
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3000';
  for (const value of [url, connection, baseURL]) local(value);
  if (!FIXTURE_DIR) throw new Error('E2E_FIXTURE_DIR is not set.');
  mkdirSync(path.join(FIXTURE_DIR, '.auth'), { recursive: true });

  const run = randomUUID().slice(0, 8);
  const template = BUSINESSES[0];
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
  // The demo password, because the configuration-permissions spec signs the owner in with it; the account is local and run-unique.
  const owner = { email: `isolated-owner-${run}@example.test`, password: DEMO_PASSWORD };
  const colleague = { email: `isolated-colleague-${run}@example.test`, password: randomUUID() };
  const created = { organizationIds: [] as string[], userIds: [] as string[], planKeys: [] as string[] };
  const record = () => writeFileSync(path.join(FIXTURE_DIR, 'fixtures.json'), JSON.stringify(created, null, 2));

  for (const account of [owner, colleague]) {
    const made = await admin.auth.admin.createUser({ email: account.email, password: account.password, email_confirm: true });
    if (made.error) throw made.error;
    created.userIds.push(made.data.user.id);
    record();
  }

  // The owner provisions as temporary staff, the same door every disposable acceptance tenant uses;
  // the staff row is removed as soon as the business exists.
  const pg = new Client(connection);
  await pg.connect();
  try {
    await pg.query('insert into platform_staff(user_id,name) values($1,$2)', [created.userIds[0], `Isolated E2E fixture ${run}`]);
    const ownerDb = createClient(url, process.env.SUPABASE_ANON_KEY!, options);
    const login = await ownerDb.auth.signInWithPassword(owner);
    if (login.error) throw login.error;
    const organizationId = await provisionOrganization(ownerDb, {
      ownerEmail: owner.email, name: `${template.name} (isolated ${run})`, displayName: template.owner.displayName, timezone: template.timezone, currency: template.currency,
    });
    created.organizationIds.push(organizationId);
    record();

    // A run-unique plan granting every catalogue product, as a sale would, so the shape's modules
    // are inside this business's plan when it is applied and nothing it uses is hidden.
    const planKey = `isolated_e2e_${run}`;
    const planId = await createPlan(ownerDb, { key: planKey, kind: 'plan', label: `Isolated E2E ${run}`, description: 'Local browser fixture only', billable: false });
    created.planKeys.push(planKey);
    record();
    for (const { key } of (await pg.query<{ key: string }>('select key from platform_catalog_products')).rows) await grantPlanProduct(ownerDb, { planId, productKey: key });
    await recordPlanAssignment(ownerDb, { organizationId, planId, periodStart: '2020-01-01', periodEnd: '9999-12-31' });
    for (const key of template.shape.modules ?? []) {
      if (key === 'billing' || key === 'drafting') continue;
      await recordCommercialTerm(ownerDb, { organizationId, productKey: `module:${key}`, periodStart: new Date().toISOString().slice(0, 10), periodEnd: '9999-12-31', priceMinor: 0, note: `Isolated E2E fixture ${run}` });
    }
    const configured = await configureBusiness(ownerDb, organizationId, template.shape);
    await addMember(ownerDb, { organizationId, email: colleague.email, displayName: template.member.displayName, roleId: configured.roleIds[0] });
    const resourceIds: string[] = [];
    for (const resource of template.resources) resourceIds.push(await createResource(ownerDb, { organizationId, name: resource.name, resourceClass: resource.resourceClass, capabilityIds: [] }));
    const locationId = await createLocation(ownerDb, { organizationId, ...template.locations[0] });
    const customerId = await createCustomer(ownerDb, { organizationId, name: template.customers[0].name, email: template.customers[0].email, phone: template.customers[0].phone });
    const workItemId = await createWorkItem(ownerDb, { organizationId, statusId: configured.statusIds[0], title: 'Isolated fixture job', customerId, locationId, resourceIds: resourceIds.slice(0, 1) });
    // The record the breadcrumbs spec reads by name.
    const assetId = await createAsset(ownerDb, { organizationId, name: 'E2E Test Compressor', customerId, locationId });

    const context: DemoContext = { organizationId, ownerEmail: owner.email, customerId, locationId, assetId, workItemId, bookingSlug: '', goldOrganizationId: '' };
    writeFileSync(path.join(FIXTURE_DIR, '.demo-context.json'), JSON.stringify(context, null, 2));
  } finally {
    await pg.query('delete from platform_staff where user_id=$1', [created.userIds[0]]).catch(() => undefined);
    await pg.end();
  }

  // Signed-in browser states for the owner and the reduced-role colleague. No Platform staff state:
  // Platform needs GildOps' own operating organization, which a disposable business cannot stand in for.
  const browser = await chromium.launch();
  try {
    for (const [name, account] of [['owner', owner], ['colleague', colleague]] as const) {
      const page = await browser.newPage({ baseURL } as never);
      await page.goto(`${baseURL}/login`);
      await page.getByLabel('Email', { exact: true }).fill(account.email);
      await page.getByLabel('Password', { exact: true }).fill(account.password);
      await page.getByRole('button', { name: 'Log in', exact: true }).click();
      await page.waitForURL(/\/organizations/, { timeout: 20_000 });
      await page.context().storageState({ path: path.join(FIXTURE_DIR, '.auth', `${name}.json`) });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

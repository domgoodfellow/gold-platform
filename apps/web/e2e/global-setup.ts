import { BUCKET } from '../lib/domain/documents/documents';
import { supabaseFileStore } from '../lib/adapters/storage/supabase-file-store';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { chromium, type FullConfig } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { BUSINESSES, DEMO_PASSWORD } from '../scripts/demo/businesses';
import { createAsset, listAssets } from '../lib/domain/assets/assets';
import { recordAssetReading, listAssetReadings } from '../lib/domain/assets/readings';
import { listCustomers } from '../lib/domain/customers/customers';
import { createCustomerStage, listCustomerStages } from '../lib/domain/customers/stages';
import { listDocuments, uploadDocument } from '../lib/domain/documents/documents';
import { listLocations } from '../lib/domain/locations/locations';
import { getOrganization, listMyOrganizations, updateOrganization } from '../lib/domain/tenancy/organizations';
import { listWorkItems } from '../lib/domain/work-items/work-items';
import { listBookableTypes } from '../lib/domain/booking/booking';
import { setTypeBookable } from '../lib/domain/work-items/types';
import { listUsableModules, setModuleEnabled } from '../lib/domain/tenancy/modules';
import { recordCommercialTerm } from '../lib/domain/commercial/terms';
import { provisionOrganization } from '../lib/domain/platform/provision';
import { bootstrapOperatingOrganization, callerOperatingOrganization } from '../lib/domain/platform/operating-organization';
import { listCalls, recordCall } from '../lib/domain/reception/calls';
import { createCallOutcome, listCallOutcomes } from '../lib/domain/reception/outcomes';

/**
 * Sets up exactly what the smoke suite needs on top of `pnpm demo`, and nothing else.
 *
 * `pnpm demo` (scripts/demo/run.ts) already stands up real businesses through real domain
 * calls — reused here rather than a second, parallel fixture story. It does not create an
 * Asset row for either business (no `createAsset` call in that script), so this adds one, the
 * same way an operator would: signed in as the business owner, through the domain layer, under
 * real RLS. Idempotent — re-running this setup against data it already touched adds nothing a
 * second time, so it is safe to run before every E2E invocation rather than only once per
 * `demo:fresh`.
 *
 * Requires: `pnpm db:start` and `pnpm demo` (or `pnpm demo:fresh`) already run against the same
 * local stack this reads `.env.test` for. Never points at anything but localhost — the demo
 * script's own account passwords are not secret, only local.
 */

const AUTH_DIR = path.join(__dirname, '.auth');
const CONTEXT_FILE = path.join(__dirname, '.demo-context.json');

export type DemoContext = {
  organizationId: string;
  ownerEmail: string;
  customerId: string;
  locationId: string;
  assetId: string;
  workItemId: string;
  bookingSlug: string;
  /** GOLD's own organization — the context every Platform address is nested under. */
  goldOrganizationId: string;
};

function refuseAnythingButLocalhost(url: string): void {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Refusing to run E2E setup against ${host}. This is local-only tooling.`);
  }
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  loadEnv({ path: path.join(__dirname, '..', '..', '..', '.env.test') });

  const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
  const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error(
      'e2e/global-setup: .env.test is missing SUPABASE_URL/SUPABASE_ANON_KEY. Run `pnpm db:start` first.',
    );
  }
  refuseAnythingButLocalhost(SUPABASE_URL);

  const business = BUSINESSES[0];
  const ownerEmail = business.owner.email;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await db.auth.signInWithPassword({ email: ownerEmail, password: DEMO_PASSWORD });
  if (signIn.error) {
    throw new Error(
      `e2e/global-setup: could not sign in as ${ownerEmail}. Has \`pnpm demo\` been run against this stack? (${signIn.error.message})`,
    );
  }

  const organizations = await listMyOrganizations(db);
  const organization = organizations.find((org) => org.name === business.name) ?? organizations[0];
  if (!organization) {
    throw new Error('e2e/global-setup: signed-in demo owner belongs to no organization.');
  }
  const organizationId = organization.id;

  const [customers, locations, workItems, assets] = await Promise.all([
    listCustomers(db, { organizationId }),
    listLocations(db, { organizationId }),
    listWorkItems(db, { organizationId }),
    listAssets(db, { organizationId }),
  ]);
  const customerId = customers[0]?.id;
  const locationId = locations[0]?.id;
  const workItemId = workItems[0]?.id;
  if (!customerId || !locationId || !workItemId) {
    throw new Error('e2e/global-setup: demo data is missing a customer, location or work item.');
  }

  // CRM + Voice is the reference product-feature vertical. Give its browser specs one honest,
  // reusable setup: the commercial module is usable, the business has named its own pipeline
  // and outcome vocabulary, and one completed call is waiting for wrap-up. These records are
  // idempotent and go through the same domain APIs as the operator UI.
  const voiceModules = await listUsableModules(db, { organizationId });
  if (!voiceModules.has('reception')) {
    await setModuleEnabled(db, { organizationId, key: 'reception', enabled: true });
    const voiceStaffDb = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const voiceStaffSignIn = await voiceStaffDb.auth.signInWithPassword({
      email: 'staff@gold.test',
      password: DEMO_PASSWORD,
    });
    if (voiceStaffSignIn.error) {
      throw new Error(
        `e2e/global-setup: could not sign in as platform staff to record a commercial term for reception (${voiceStaffSignIn.error.message})`,
      );
    }
    await recordCommercialTerm(voiceStaffDb, {
      organizationId,
      productKey: 'module:reception',
      periodStart: new Date().toISOString().slice(0, 10),
      periodEnd: '9999-12-31',
      priceMinor: 0,
      note: 'E2E fixture: CRM and Voice interactions are switched on and paid for.',
    });
  }

  const stages = await listCustomerStages(db, { organizationId });
  if (stages.length === 0) {
    await createCustomerStage(db, { organizationId, name: 'New enquiry', position: 0 });
    await createCustomerStage(db, { organizationId, name: 'In progress', position: 1 });
  }
  const outcomes = await listCallOutcomes(db, { organizationId });
  if (outcomes.length === 0) {
    await createCallOutcome(db, { organizationId, name: 'Spoke', reached: true, position: 0 });
    await createCallOutcome(db, { organizationId, name: 'No answer', reached: false, position: 1 });
  }
  const calls = await listCalls(db, { organizationId });
  if (calls.length === 0) {
    await recordCall(db, {
      organizationId,
      customerId,
      direction: 'outbound',
      fromNumber: '+31205550100',
      toNumber: '+31205550142',
    });
  }

  // The demo shapes (`scripts/demo/businesses.ts`) don't enable `portal` — this stack's own
  // operator-path specs need it. Module activation and commercial entitlement are separate,
  // so switching the module on is not enough by itself; the module-owning term is what `run.ts`
  // also records for everything a demo shape switches on beyond its zero-price founding set,
  // done here the same way for the one module none of the shapes ask for.
  const usableModules = await listUsableModules(db, { organizationId });
  if (!usableModules.has('portal')) {
    await setModuleEnabled(db, { organizationId, key: 'portal', enabled: true });

    const staffDb = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const staffSignIn = await staffDb.auth.signInWithPassword({
      email: 'staff@gold.test',
      password: DEMO_PASSWORD,
    });
    if (staffSignIn.error) {
      throw new Error(
        `e2e/global-setup: could not sign in as platform staff to record a commercial term for portal (${staffSignIn.error.message})`,
      );
    }
    await recordCommercialTerm(staffDb, {
      organizationId,
      productKey: 'module:portal',
      periodStart: new Date().toISOString().slice(0, 10),
      periodEnd: '9999-12-31',
      priceMinor: 0,
      note: 'E2E fixture: switched on and paid for, so the Portal operator-path specs have something real to exercise.',
    });
  }

  // One asset, created only if the fixture from a previous run is not already there.
  let assetId = assets.find((asset) => asset.name === 'E2E Test Compressor')?.id;
  if (!assetId) {
    assetId = await createAsset(db, {
      organizationId,
      name: 'E2E Test Compressor',
      customerId,
      locationId,
    });
  }
  const readings = await listAssetReadings(db, { organizationId, assetId });
  if (readings.length === 0) {
    await recordAssetReading(db, { organizationId, assetId, value: 42, unit: 'hours' });
  }

  // One document each on the customer and the work item, so the Documents section on each
  // record has something real to list rather than only its empty state.
  const [customerDocs, workItemDocs] = await Promise.all([
    listDocuments(db, { organizationId, attachedTo: { entity: 'customer', id: customerId } }),
    listDocuments(db, { organizationId, attachedTo: { entity: 'work_item', id: workItemId } }),
  ]);
  if (customerDocs.length === 0) {
    await uploadDocument(db, { files: supabaseFileStore(db, BUCKET),
      organizationId,
      attachedTo: { entity: 'customer', id: customerId },
      file: new File(['e2e fixture'], 'e2e-customer-note.txt', { type: 'text/plain' }),
    });
  }
  if (workItemDocs.length === 0) {
    await uploadDocument(db, { files: supabaseFileStore(db, BUCKET),
      organizationId,
      attachedTo: { entity: 'work_item', id: workItemId },
      file: new File(['e2e fixture'], 'e2e-job-photo.txt', { type: 'text/plain' }),
    });
  }

  // A public slug and one bookable kind of work, so the Public Presence Preview link (Settings
  // → Public page) and the Booking page it points at are both real, reachable journeys rather
  // than the "not set up yet" explanatory sentence. `booking_organization`'s bookable-type
  // requirement is a deliberate privacy opt-in (20260829000005_booking_slug.sql) — this does
  // not bypass it, it satisfies it, the same way an operator configuring booking would.
  const organizationDetail = await getOrganization(db, organizationId);
  if (!organizationDetail) {
    throw new Error('e2e/global-setup: could not read the demo organization back.');
  }
  const bookingSlug = organizationDetail.slug ?? 'grachtwerk-e2e';
  if (!organizationDetail.slug) {
    await updateOrganization(db, {
      id: organizationId,
      name: organizationDetail.name,
      timezone: organizationDetail.timezone,
      currency: organizationDetail.currency ?? 'EUR',
      bufferMinutes: organizationDetail.bufferMinutes,
      slug: bookingSlug,
    });
  }

  const bookableTypes = await listBookableTypes(db, { organizationId });
  if (bookableTypes.length === 0) {
    const firstJob = workItems[0];
    await setTypeBookable(db, {
      id: firstJob.type.id,
      statusId: firstJob.status.id,
      durationMinutes: 30,
    });
  }

  // GildOps' operating organization, for the specs that sign in as platform staff. Platform
  // (`/organizations/{goldId}/platform/**`) renders inside it, so staff with no membership of it have nowhere to render. Idempotent:
  // provisioned once, by the same two acts an operator uses (a staff-provisioned business, then the
  // staff-only bootstrap door), and left alone when the fixture from a previous run is there.
  const goldStaffDb = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const goldStaffSignIn = await goldStaffDb.auth.signInWithPassword({ email: 'staff@gold.test', password: DEMO_PASSWORD });
  if (goldStaffSignIn.error) {
    throw new Error(`e2e/global-setup: could not sign in as platform staff (${goldStaffSignIn.error.message})`);
  }
  let goldOrganizationId = (await callerOperatingOrganization(goldStaffDb))?.id ?? null;
  if (!goldOrganizationId) {
    goldOrganizationId = await provisionOrganization(goldStaffDb, {
      ownerEmail: 'staff@gold.test',
      name: 'GOLD',
      displayName: 'GOLD staff',
      timezone: 'Europe/Amsterdam',
      currency: 'EUR',
    });
    await bootstrapOperatingOrganization(goldStaffDb, { organizationId: goldOrganizationId });
  }

  const context: DemoContext = {
    organizationId,
    ownerEmail,
    customerId,
    locationId,
    assetId,
    workItemId,
    bookingSlug,
    goldOrganizationId,
  };
  writeFileSync(CONTEXT_FILE, JSON.stringify(context, null, 2));

  // A real, signed-in browser session, saved once so every spec starts already logged in
  // rather than re-running the login form per test — faster, and it isolates "can this
  // specific journey be reached" from "does login itself work" (covered by its own spec).
  if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR);

  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:3000';
  const browser = await chromium.launch();

  const ownerPage = await browser.newPage({ baseURL } as never);
  await ownerPage.goto(`${baseURL}/login`);
  await ownerPage.getByLabel('Email').fill(ownerEmail);
  await ownerPage.getByLabel('Password').fill(DEMO_PASSWORD);
  await ownerPage.getByRole('button', { name: 'Log in' }).click();
  await ownerPage.waitForURL(/\/organizations/, { timeout: 15_000 });
  await ownerPage.context().storageState({ path: path.join(AUTH_DIR, 'owner.json') });
  await ownerPage.close();

  // The demo script's own staff account (scripts/demo/run.ts), not one of `BUSINESSES` — GOLD's
  // own platform console has no organization of its own to belong to.
  const staffPage = await browser.newPage({ baseURL } as never);
  await staffPage.goto(`${baseURL}/login`);
  await staffPage.getByLabel('Email').fill('staff@gold.test');
  await staffPage.getByLabel('Password').fill(DEMO_PASSWORD);
  await staffPage.getByRole('button', { name: 'Log in' }).click();
  await staffPage.waitForURL(/\/(platform|organizations)/, { timeout: 15_000 });
  await staffPage.context().storageState({ path: path.join(AUTH_DIR, 'staff.json') });
  await staffPage.close();

  // `business.member` — the colleague `run.ts` adds on a reduced, `role.manage`-less role
  // (`businesses.ts`'s own comment: "so I12 is something to look at rather than read about").
  // A signed-in session for them is what makes the operator-path specs able to prove a control
  // is genuinely absent for a caller who lacks the capability, not merely absent for nobody.
  const colleaguePage = await browser.newPage({ baseURL } as never);
  await colleaguePage.goto(`${baseURL}/login`);
  await colleaguePage.getByLabel('Email').fill(business.member.email);
  await colleaguePage.getByLabel('Password').fill(DEMO_PASSWORD);
  await colleaguePage.getByRole('button', { name: 'Log in' }).click();
  await colleaguePage.waitForURL(/\/organizations/, { timeout: 15_000 });
  await colleaguePage.context().storageState({ path: path.join(AUTH_DIR, 'colleague.json') });
  await colleaguePage.close();

  await browser.close();
}

import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { issueInvoice, recordPayment } from '@/lib/domain/billing/invoices';
import { createContact } from '@/lib/domain/contacts/contacts';
import { createLocation, linkCustomerLocation } from '@/lib/domain/locations/locations';
import { configureBusiness, type BusinessShape } from '@/lib/domain/configuration/configure';
import { workTypesOf } from '@/lib/domain/configuration/shape';
import { recordCommercialTerm } from '@/lib/domain/commercial/terms';
import { createPlan, grantPlanModule, grantPlanProduct } from '@/lib/domain/catalogue/plans';
import { recordPlanAssignment } from '@/lib/domain/catalogue/organization-plans';
import { provisionOrganization } from '@/lib/domain/platform/provision';
import { bootstrapOperatingOrganization, callerOperatingOrganization } from '@/lib/domain/platform/operating-organization';
import { createPortalInvite, listPortalInvites } from '@/lib/domain/portal/portal';
import { listUsableModules, setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { addPricedLine } from '@/lib/domain/pricing/prices';
import { createDashboard, pinReport } from '@/lib/domain/reporting/dashboards';
import { saveReportDefinition, setReportRoles } from '@/lib/domain/reporting/definitions';
import { createResourceCapability } from '@/lib/domain/resources/resource-capabilities';
import { createResource } from '@/lib/domain/resources/resources';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { addMember } from '@/lib/domain/tenancy/members';
import { listRoles } from '@/lib/domain/tenancy/roles';
import { launchOrganization } from '@/lib/domain/tenancy/lifecycle';
import { getOrganization, updateOrganization } from '@/lib/domain/tenancy/organizations';
import { recordCost, recordTime } from '@/lib/domain/work-items/consumption';
import { changeWorkItemStatus } from '@/lib/domain/work-items/transitions';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { PLATFORM_NAME } from '@/lib/brand';
import { BUSINESSES, DEMO_PASSWORD, demoShape, type DemoBusiness, type DemoJob } from './businesses';

/**
 * A populated pair of businesses, a platform admin and a portal customer, in one command.
 *
 * **This is the local seed**: `pnpm db:reset` runs it after rebuilding the database, and it is
 * safe to run again on its own. Every line below is still a real domain call under a real
 * session rather than inserted rows. The only SQL writes are the `platform_staff` row, because no
 * application path may write one, and lookups of what an earlier run already made.
 *
 * **There is no branch on which business this is holding**, and that is the property that makes
 * the script evidence rather than only a convenience. Everything that differs lives in
 * `businesses.ts`. If this file ever needs `if (business.name === …)`, that data model is wrong.
 *
 * It lives under `apps/web` so `pnpm typecheck` covers it, which means **it breaks the gate the
 * day a domain signature changes** — the thing wanted from a second caller, and the difference
 * between this and a snippet that quietly rots.
 */

config({
  path: new URL('../../../../.env.test', import.meta.url).pathname.replace(
    /^\/([A-Za-z]:)/,
    '$1',
  ),
});

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? '';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * The first thing it does, and not a warning.
 *
 * This creates accounts with a password written down in a file in the repository and then writes
 * into whatever schema it is pointed at. The accident it exists to prevent is somebody's
 * `.env.test` pointing at a linked project.
 */
function refuseAnythingButLocalhost(): void {
  let host = '';
  try {
    host = new URL(SUPABASE_URL).hostname;
  } catch {
    throw new Error(`SUPABASE_URL is not a URL: ${SUPABASE_URL || '(unset)'}`);
  }

  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(
      `Refusing to run against ${host}. This creates accounts with a published password and ` +
        `writes into the schema it is given. Point .env.test at a local stack.`,
    );
  }
}

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Makes the account unless it is already there. An existing demo account keeps whatever password
 * it has; the sign-in in `account` is what proves it is still the demo one.
 */
async function ensureUser(email: string): Promise<void> {
  const { error } = await admin().auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  if (error && error.code !== 'email_exists' && !/already been registered/i.test(error.message)) throw error;
}

/** An account with a password somebody can actually use, and a session on it. */
async function account(email: string): Promise<SupabaseClient> {
  await ensureUser(email);

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await db.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
  if (signIn.error) throw new Error(`Could not sign in as ${email} with the demo password: ${signIn.error.message}`);
  return db;
}

/** An instant `days` from now at a wall-clock hour, near enough for a demo's purposes. */
function at(days: number, hour: number): Date {
  const when = new Date(Date.now() + days * DAY);
  when.setHours(hour, 0, 0, 0);
  return when;
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString();
}

/**
 * Everything that has happened to one job, in the order it happened.
 *
 * The status walk is a walk: a shape's transitions run in a line, so reaching status *n* means
 * making *n* legal moves. Jumping straight there would need a transition the business never
 * wrote, and `app.check_status_transition` would refuse it — correctly, which is why this walks.
 */
async function buildJob(
  db: SupabaseClient,
  business: DemoBusiness,
  transitions: [number, number][],
  ids: {
    organizationId: string;
    statusIds: string[];
    priceBookItemIds: string[];
    resourceIds: string[];
    customerIds: string[];
    locationIds: string[];
  },
  job: DemoJob,
): Promise<void> {
  const customer = business.customers[job.customer];

  const workItemId = await createWorkItem(db, {
    organizationId: ids.organizationId,
    statusId: ids.statusIds[0],
    title: job.title,
    customerId: ids.customerIds[job.customer],
    locationId: ids.locationIds[customer.location],
    resourceIds: job.resource === null ? [] : [ids.resourceIds[job.resource]],
  });

  if (job.startsInDays !== null) {
    const starts = at(job.startsInDays, job.startHour);
    await scheduleWorkItem(db, {
      workItemId,
      startsAt: starts.toISOString(),
      endsAt: new Date(starts.getTime() + job.minutes * MINUTE).toISOString(),
    });
  }

  // Priced before the status walk, because a business quotes work it is about to do rather than
  // work it has finished — and because `issue_invoice` refuses a job with nothing priced.
  for (const [priceIndex, quantity] of job.lines) {
    await addPricedLine(db, {
      workItemId,
      priceBookItemId: ids.priceBookItemIds[priceIndex],
      quantity,
    });
  }

  // **The walk.** Statuses beyond the first are reached one legal move at a time. A shape whose
  // transitions do not connect 0 to `job.status` is a shape this script cannot build, and the
  // refusal comes from the database rather than from a check here.
  const route =
    job.status === 0
      ? []
      : transitions.some((pair) => pair[0] === 0 && pair[1] === job.status)
        ? [job.status]
        : Array.from({ length: job.status }, (_, step) => step + 1);

  for (const statusIndex of route) {
    await changeWorkItemStatus(db, { workItemId, toStatusId: ids.statusIds[statusIndex] });
  }

  if (job.time) {
    const started = new Date(Date.now() - job.time.daysAgo * DAY);
    await recordTime(db, {
      workItemId,
      resourceId: job.resource === null ? null : ids.resourceIds[job.resource],
      startedAt: started.toISOString(),
      endedAt: new Date(started.getTime() + job.time.hours * 60 * MINUTE).toISOString(),
      note: job.time.note,
    });
  }

  for (const cost of job.costs) {
    await recordCost(db, {
      workItemId,
      description: cost.description,
      amountMinor: cost.amountMinor,
      incurredAt: daysAgo(cost.daysAgo),
    });
  }

  if (job.invoice) {
    const invoiceId = await issueInvoice(db, {
      workItemId,
      issuedAt: daysAgo(job.invoice.daysAgo),
    });

    if (job.invoice.paid) {
      await recordPayment(db, {
        invoiceId,
        amountMinor: job.invoice.paid.amountMinor,
        receivedAt: daysAgo(job.invoice.paid.daysAgo),
      });
    }
  }
}

async function standUp(
  staff: SupabaseClient,
  business: DemoBusiness,
  shape: BusinessShape,
  planId: string,
): Promise<{ organizationId: string }> {
  const ownerDb = await account(business.owner.email);
  const memberDb = await account(business.member.email);
  // Signed in so the account exists with a session; the member works through the owner's calls
  // below, and the point of the account is that somebody can sign in as them afterwards.
  void memberDb;

  // GOLD creates the business; whoever is inside it does the configuring. Two acts, two
  // parties, and the second one is `configureBusiness` — which this script is the first caller of
  // from outside the test suite.
  const organizationId = await provisionOrganization(staff, {
    ownerEmail: business.owner.email,
    name: business.name,
    displayName: business.owner.displayName,
    timezone: business.timezone,
    currency: business.currency,
  });

  // A sold business has a plan before it is configured: `configureBusiness` refuses any module
  // outside the plan. The demo plan is assigned through the same command a sale uses.
  await recordPlanAssignment(staff, { organizationId, planId, periodStart: '2020-01-01', periodEnd: '9999-12-31' });

  // The template, in this business's words: stages and what they mean, fields, hours, roles,
  // modules and online booking all come from it, through the same call a reviewed draft takes.
  const configured = await configureBusiness(ownerDb, organizationId, shape);

  // **The wanted-versus-paid entitlement rule's own trigger, applied to this script.** Only `billing` and `drafting` carry a term
  // from founding (`app.grant_founding_terms`); anything else a shape names sits wanted-but-
  // unpaid until GOLD records one. A demo business is meant to be seen fully working, so the
  // staff session that just provisioned it also records a term for whatever else it switched
  // on — the same act a real sale would perform, through the same door.
  for (const key of shape.modules ?? []) {
    if (key === 'billing' || key === 'drafting') continue;
    await recordCommercialTerm(staff, {
      organizationId,
      productKey: `module:${key}`,
      periodStart: new Date().toISOString().slice(0, 10),
      periodEnd: '9999-12-31',
      priceMinor: 0,
      note: 'Demo: switched on and paid for, so nothing this business uses is hidden.',
    });
  }

  await addMember(ownerDb, {
    organizationId,
    email: business.member.email,
    displayName: business.member.displayName,
    roleId: configured.roleIds[0],
  });

  // The vocabulary first, one row per distinct word, then each resource states its class and what it can do.
  const capabilityIds = new Map<string, string>();
  for (const word of new Set(business.resources.flatMap((resource) => resource.capabilities ?? []))) {
    capabilityIds.set(word, await createResourceCapability(ownerDb, { organizationId, name: word }));
  }
  const resourceIds: string[] = [];
  for (const resource of business.resources) {
    resourceIds.push(
      await createResource(ownerDb, {
        organizationId,
        name: resource.name,
        resourceClass: resource.resourceClass,
        capabilityIds: (resource.capabilities ?? []).map((word) => capabilityIds.get(word)!),
      }),
    );
  }

  const locationIds: string[] = [];
  for (const location of business.locations) {
    locationIds.push(await createLocation(ownerDb, { organizationId, ...location }));
  }

  const customerIds: string[] = [];
  for (const customer of business.customers) {
    const customerId = await createContact(ownerDb, {
      organizationId,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
    });
    customerIds.push(customerId);
    await linkCustomerLocation(ownerDb, {
      organizationId,
      customerId,
      locationId: locationIds[customer.location],
    });
  }

  for (const job of business.jobs) {
    await buildJob(
      ownerDb,
      business,
      workTypesOf(shape)[0].transitions,
      {
        organizationId,
        statusIds: configured.statusIds,
        priceBookItemIds: configured.priceBookItemIds,
        resourceIds,
        customerIds,
        locationIds,
      },
      job,
    );
  }

  // **Saved reports and a dashboard**, because the reporting machinery *is* a definition and a pin, and a
  // demo that stopped at the ad-hoc screen would leave both invisible in the one command that
  // exists so somebody can look at them.
  const reportIds: string[] = [];
  for (const report of business.reports) {
    const reportId = await saveReportDefinition(ownerDb, {
      organizationId,
      name: report.name,
      measure: report.measure,
      grouping: report.grouping,
      period: report.period,
    });
    reportIds.push(reportId);

    if (report.shareWithMember) {
      await setReportRoles(ownerDb, {
        organizationId,
        reportId,
        roleIds: [configured.roleIds[0]],
      });
    }
  }

  const dashboardId = await createDashboard(ownerDb, {
    organizationId,
    name: business.dashboard.name,
  });
  for (const [position, index] of business.dashboard.reports.entries()) {
    await pinReport(ownerDb, {
      organizationId,
      dashboardId,
      reportId: reportIds[index],
      position,
    });
  }

  // Three months of jobs, invoices and reports is not a business "still being set up" — the
  // real path a person building one of these by hand would have launched it long before now,
  // and the demo-seed decision says this script takes the real path, not a shortcut around it.
  // Online booking is sold, so launch requires it to be usable: a public address, set the way the
  // owner sets it in Settings, and one bookable type, which the template already says.
  const organization = (await getOrganization(ownerDb, organizationId))!;
  await updateOrganization(ownerDb, {
    id: organizationId, name: organization.name, timezone: organization.timezone, currency: organization.currency,
    bufferMinutes: organization.bufferMinutes, slug: business.owner.email.split('@')[1].split('.')[0],
  });

  await launchOrganization(ownerDb, { organizationId });

  return { organizationId };
}

const STAFF_EMAIL = 'staff@gold.test';
const PLATFORM_CAPABILITIES = [
  'platform.organizations',
  'platform.catalogue',
  'platform.commercial',
  'platform.providers',
  'platform.health',
];
const APP_ORIGIN = 'http://localhost:3000';

/**
 * Platform staff with every platform capability, and a member of GildOps' operating organization
 * so Platform has somewhere to render. Both steps are safe to repeat.
 *
 * The staff row goes in over a direct connection because nothing in the application may write
 * one. The operating organization goes through the same two acts `e2e/global-setup.ts` uses: a
 * staff-provisioned business, then `bootstrap_gold_internal_workspace`. When one is already
 * designated and staff are already a member, nothing is written; designated without that
 * membership, the bootstrap is asked again for that same business, which repairs it.
 */
async function ensurePlatformAdmin(pg: Client): Promise<{ staff: SupabaseClient; goldOrganizationId: string }> {
  await ensureUser(STAFF_EMAIL);
  const { rows: users } = await pg.query<{ id: string }>('select id from auth.users where email = $1', [STAFF_EMAIL]);
  await pg.query(
    `insert into public.platform_staff (user_id, name, capabilities) values ($1, $2, $3)
       on conflict (user_id) do update set capabilities = excluded.capabilities`,
    [users[0].id, 'GildOps (demo)', PLATFORM_CAPABILITIES],
  );

  const staff = await account(STAFF_EMAIL);

  const { rows: settings } = await pg.query<{ id: string | null }>(
    'select operating_organization_id as id from public.platform_settings where singleton',
  );
  const designated = settings[0]?.id ?? null;
  const member = await callerOperatingOrganization(staff);
  if (designated && member?.id === designated) return { staff, goldOrganizationId: designated };

  const goldOrganizationId =
    designated ??
    (await provisionOrganization(staff, {
      ownerEmail: STAFF_EMAIL,
      name: PLATFORM_NAME,
      displayName: `${PLATFORM_NAME} staff`,
      timezone: 'Europe/Amsterdam',
      currency: 'EUR',
    }));
  await bootstrapOperatingOrganization(staff, { organizationId: goldOrganizationId });

  return { staff, goldOrganizationId };
}

/**
 * One deterministic, non-billable demo plan, created by platform staff through the catalogue
 * commands, or found again by its key. It grants everything except card payments: launch requires
 * a connected payment account for those, which a local demo cannot have.
 */
async function ensureDemoPlan(pg: Client, staff: SupabaseClient): Promise<string> {
  const { rows: existing } = await pg.query<{ id: string }>(
    "select id from public.platform_plans where key = 'demo_complete'",
  );
  if (existing[0]) return existing[0].id;

  const planId = await createPlan(staff, {
    key: 'demo_complete', kind: 'plan', label: 'Demo',
    description: 'Local demo only: every catalogue module except card payments.', billable: false,
  });
  const NOT_SOLD = new Set(['payments']);
  const modules = await pg.query<{ product: string; module: string; id: string }>(
    `select p.key as product, m.key as module, m.id from public.platform_catalog_modules m
       join public.platform_catalog_products p on p.id = m.product_id order by p.key, m.key`,
  );
  const partial = new Set(modules.rows.filter((row) => NOT_SOLD.has(row.module)).map((row) => row.product));
  for (const product of new Set(modules.rows.map((row) => row.product))) {
    if (!partial.has(product)) await grantPlanProduct(staff, { planId, productKey: product });
  }
  for (const row of modules.rows) {
    if (partial.has(row.product) && !NOT_SOLD.has(row.module)) await grantPlanModule(staff, { planId, moduleId: row.id });
  }
  return planId;
}

/**
 * A business this script already finished, found by its name and its owner's address.
 *
 * Launch is the last thing `standUp` does, so a live business is a whole one and is left alone.
 * One that exists but never launched was cut off part-way by an earlier run; finishing it would
 * mean guessing which steps ran, so the run stops and says how to start clean instead.
 */
async function existingBusiness(pg: Client, business: DemoBusiness): Promise<string | null> {
  const { rows } = await pg.query<{ id: string; operational_state: string }>(
    `select o.id, o.operational_state from public.organizations o
       join public.memberships m on m.organization_id = o.id
       join auth.users u on u.id = m.user_id
      where o.name = $1 and u.email = $2`,
    [business.name, business.owner.email],
  );
  if (!rows[0]) return null;
  if (rows[0].operational_state !== 'live') {
    throw new Error(
      `${business.name} exists but was never launched, so an earlier run stopped part-way. ` +
        'Run `pnpm db:reset` to rebuild the local database from scratch.',
    );
  }
  return rows[0].id;
}

/**
 * A portal link for one customer of the first business, so the customer's side can be opened.
 *
 * The portal module is switched on and paid for the same way `e2e/global-setup.ts` does it (no
 * demo shape asks for it). The last customer is used, so specs that work on the first one are not
 * handed an extra link. An unrevoked link from an earlier run is reused.
 */
async function ensurePortalCustomer(
  pg: Client,
  staff: SupabaseClient,
  business: DemoBusiness,
  organizationId: string,
): Promise<{ email: string; url: string }> {
  const ownerDb = await account(business.owner.email);
  if (!(await listUsableModules(ownerDb, { organizationId })).has('portal')) {
    await setModuleEnabled(ownerDb, { organizationId, key: 'portal', enabled: true });
    await recordCommercialTerm(staff, {
      organizationId,
      productKey: 'module:portal',
      periodStart: new Date().toISOString().slice(0, 10),
      periodEnd: '9999-12-31',
      priceMinor: 0,
      note: 'Demo: switched on and paid for, so the customer portal can be opened.',
    });
  }

  const customer = business.customers[business.customers.length - 1];
  const { rows } = await pg.query<{ id: string }>(
    'select id from public.customers where organization_id = $1 and name = $2',
    [organizationId, customer.name],
  );
  if (!rows[0]) throw new Error(`${business.name} has no customer named ${customer.name}.`);

  const live = (await listPortalInvites(ownerDb, { organizationId, customerId: rows[0].id }))
    .find((invite) => invite.revokedAt === null);
  const token = live?.token ?? (await createPortalInvite(ownerDb, { customerId: rows[0].id }));
  return { email: customer.email, url: `${APP_ORIGIN}/portal/${token}` };
}

/**
 * Which template each demo business started from, recorded the way applying a template draft
 * records it. Written once; a business that already says leaves it alone.
 */
async function ensureStartingTemplate(pg: Client, business: DemoBusiness, organizationId: string): Promise<void> {
  const { rows } = await pg.query<{ key: string | null }>(
    'select starting_template_key as key from public.organization_identity where organization_id = $1', [organizationId]);
  if (rows[0]?.key) return;
  const ownerDb = await account(business.owner.email);
  const { error } = await ownerDb.rpc('record_starting_template', { p_organization_id: organizationId, p_template_key: business.template });
  if (error) throw new Error(`${business.name} could not record its starting template: ${error.message}`);
}

/**
 * One owner who runs two businesses: the second business's owner also manages the first, on its
 * founding role, so "start from one of my businesses" has something to offer them. Added once.
 */
async function ensureSecondBusiness(
  pg: Client,
  first: { business: DemoBusiness; organizationId: string },
  second: { business: DemoBusiness },
): Promise<void> {
  const { rows } = await pg.query(
    `select 1 from public.memberships m join auth.users u on u.id = m.user_id
      where m.organization_id = $1 and lower(u.email) = lower($2)`,
    [first.organizationId, second.business.owner.email],
  );
  if (rows.length) return;
  const ownerDb = await account(first.business.owner.email);
  const [founding] = await listRoles(ownerDb, { organizationId: first.organizationId });
  await addMember(ownerDb, {
    organizationId: first.organizationId,
    email: second.business.owner.email,
    displayName: second.business.owner.displayName,
    roleId: founding.id,
  });
}

function printLoginTable(rows: { role: string; business: string; email: string; credential: string }[]): void {
  const headings = { role: 'Role', business: 'Business', email: 'Email', credential: 'Password or link' };
  const all = [headings, ...rows];
  const width = (key: keyof typeof headings) => Math.max(...all.map((row) => row[key].length));
  const line = (row: typeof headings) =>
    `${row.role.padEnd(width('role'))}  ${row.business.padEnd(width('business'))}  ${row.email.padEnd(width('email'))}  ${row.credential}`;
  process.stdout.write(`\nSign in at ${APP_ORIGIN}/login\n\n${line(headings)}\n`);
  for (const row of rows) process.stdout.write(`${line(row)}\n`);
  process.stdout.write('\n');
}

async function main(): Promise<void> {
  refuseAnythingButLocalhost();

  if (!ANON_KEY || !SERVICE_ROLE_KEY || !CONNECTION) {
    throw new Error('.env.test is missing keys. Run `pnpm db:start` and try again.');
  }

  const pg = new Client({ connectionString: CONNECTION });
  await pg.connect();

  try {
    // **Safe to run again.** Every step finds what an earlier run made before making anything, so
    // a second run adds nothing and ends with the same sign-in table.
    const { staff } = await ensurePlatformAdmin(pg);
    const planId = await ensureDemoPlan(pg, staff);

    const stood: { business: DemoBusiness; shape: BusinessShape; organizationId: string }[] = [];
    for (const business of BUSINESSES) {
      const shape = await demoShape(staff, business);
      const found = await existingBusiness(pg, business);
      if (found) {
        process.stdout.write(`${business.name} is already there.\n`);
        stood.push({ business, shape, organizationId: found });
        continue;
      }
      process.stdout.write(`Standing up ${business.name}…\n`);
      const { organizationId } = await standUp(staff, business, shape, planId);
      stood.push({ business, shape, organizationId });
    }

    for (const { business, organizationId } of stood) await ensureStartingTemplate(pg, business, organizationId);
    await ensureSecondBusiness(pg, stood[0], stood[1]);

    const portal = await ensurePortalCustomer(pg, staff, stood[0].business, stood[0].organizationId);

    printLoginTable([
      { role: 'Platform admin', business: PLATFORM_NAME, email: STAFF_EMAIL, credential: DEMO_PASSWORD },
      ...stood.flatMap(({ business, shape }) => [
        { role: 'Org owner', business: business.name, email: business.owner.email, credential: DEMO_PASSWORD },
        { role: `Org staff (${shape.roles[0].name})`, business: business.name, email: business.member.email, credential: DEMO_PASSWORD },
      ]),
      { role: 'Portal customer', business: stood[0].business.name, email: portal.email, credential: portal.url },
    ]);
  } finally {
    await pg.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

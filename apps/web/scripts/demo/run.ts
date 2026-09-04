import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { issueInvoice, recordPayment } from '@/lib/domain/billing/invoices';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createLocation, linkCustomerLocation } from '@/lib/domain/locations/locations';
import { configureBusiness } from '@/lib/domain/onboarding/configure';
import { provisionOrganization } from '@/lib/domain/platform/provision';
import { addPricedLine } from '@/lib/domain/pricing/prices';
import { createDashboard, pinReport } from '@/lib/domain/reporting/dashboards';
import { saveReportDefinition, setReportRoles } from '@/lib/domain/reporting/definitions';
import { createResource } from '@/lib/domain/resources/resources';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { addMember } from '@/lib/domain/tenancy/members';
import { recordCost, recordTime } from '@/lib/domain/work-items/consumption';
import { updateWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { changeWorkItemStatus } from '@/lib/domain/work-items/transitions';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { BUSINESSES, DEMO_PASSWORD, type DemoBusiness, type DemoJob } from './businesses';

/**
 * A populated pair of businesses, in one command. D37 holds the decisions.
 *
 * **Nothing here is seeded.** Every line below is a real domain call under a real session, so a
 * fresh database stays genuinely empty until somebody runs this on purpose — which is what
 * `walkthrough.md` means when it says an empty organization is the product working. The only SQL
 * is the `platform_staff` row, because no application path may write one (D28).
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
  path: new URL('../../../../infra/.env.test', import.meta.url).pathname.replace(
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
 * `infra/.env.test` pointing at a linked project.
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
        `writes into the schema it is given. Point infra/.env.test at a local stack.`,
    );
  }
}

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** An account with a password somebody can actually use, and a session on it. */
async function account(email: string): Promise<SupabaseClient> {
  const { error } = await admin().auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signIn = await db.auth.signInWithPassword({ email, password: DEMO_PASSWORD });
  if (signIn.error) throw signIn.error;
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
    resourceId: job.resource === null ? null : ids.resourceIds[job.resource],
  });

  if (job.startsInDays !== null) {
    const starts = at(job.startsInDays, job.startHour);
    await scheduleWorkItem(db, {
      workItemId,
      resourceId: job.resource === null ? null : ids.resourceIds[job.resource],
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
      : business.shape.transitions.some((pair) => pair[0] === 0 && pair[1] === job.status)
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
): Promise<{ organizationId: string }> {
  const ownerDb = await account(business.owner.email);
  const memberDb = await account(business.member.email);
  // Signed in so the account exists with a session; the member works through the owner's calls
  // below, and the point of the account is that somebody can sign in as them afterwards.
  void memberDb;

  // GOLD creates the business; whoever is inside it does the configuring (D29). Two acts, two
  // parties, and the second one is `configureBusiness` — which this script is the first caller of
  // from outside the test suite.
  const organizationId = await provisionOrganization(staff, {
    ownerEmail: business.owner.email,
    name: business.name,
    displayName: business.owner.displayName,
    timezone: business.timezone,
    currency: business.currency,
  });

  for (const key of business.modules) {
    await setModuleEnabled(ownerDb, { organizationId, key, enabled: true });
  }

  const configured = await configureBusiness(ownerDb, organizationId, business.shape);

  // The two questions the platform asks about a status, answered through the same call the Work
  // screen makes. A shape says what a business calls its work; these say what its words *mean*.
  for (const [index, name] of business.shape.statuses.entries()) {
    await updateWorkItemStatus(ownerDb, {
      id: configured.statusIds[index],
      name,
      position: index,
      releasesResource: business.releasesResource.includes(index),
      marksComplete: business.marksComplete.includes(index),
    });
  }

  await addMember(ownerDb, {
    organizationId,
    email: business.member.email,
    displayName: business.member.displayName,
    roleId: configured.roleIds[0],
  });

  const resourceIds: string[] = [];
  for (const name of business.resources) {
    resourceIds.push(await createResource(ownerDb, { organizationId, name }));
  }

  const locationIds: string[] = [];
  for (const location of business.locations) {
    locationIds.push(await createLocation(ownerDb, { organizationId, ...location }));
  }

  const customerIds: string[] = [];
  for (const customer of business.customers) {
    const customerId = await createCustomer(ownerDb, {
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

  // **Saved reports and a dashboard**, because M7's machinery *is* a definition and a pin, and a
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

  return { organizationId };
}

async function main(): Promise<void> {
  refuseAnythingButLocalhost();

  if (!ANON_KEY || !SERVICE_ROLE_KEY || !CONNECTION) {
    throw new Error('infra/.env.test is missing keys. Run `pnpm db:start` and try again.');
  }

  const pg = new Client({ connectionString: CONNECTION });
  await pg.connect();

  try {
    // **Refused rather than half-done.** A second run dies part-way on a unique customer address
    // or a duplicate report name, leaving a business somebody then has to unpick by hand.
    const { rows } = await pg.query<{ count: string }>(
      'select count(*)::text as count from public.organizations',
    );
    if (rows[0].count !== '0') {
      throw new Error(
        'This database already holds organizations. Run `pnpm demo:fresh` to reset it first.',
      );
    }

    // The staff row goes in over a direct connection because nothing in the application may write
    // one (D28), and it goes in *before* the sign-in below, because the role claim is minted at
    // sign-in and promoting somebody afterwards does not refresh their token.
    const staffEmail = 'staff@gold.test';
    const { data: created, error } = await admin().auth.admin.createUser({
      email: staffEmail,
      password: DEMO_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;

    await pg.query('insert into public.platform_staff (user_id, name) values ($1, $2)', [
      created.user.id,
      'GOLD (demo)',
    ]);

    const staff = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signIn = await staff.auth.signInWithPassword({
      email: staffEmail,
      password: DEMO_PASSWORD,
    });
    if (signIn.error) throw signIn.error;

    const stood: { business: DemoBusiness; organizationId: string }[] = [];
    for (const business of BUSINESSES) {
      process.stdout.write(`Standing up ${business.name}…\n`);
      const { organizationId } = await standUp(staff, business);
      stood.push({ business, organizationId });
    }

    process.stdout.write(`\nOne password for everybody: ${DEMO_PASSWORD}\n\n`);
    process.stdout.write(`GOLD staff  http://localhost:3000/platform\n`);
    process.stdout.write(`            ${staffEmail}\n\n`);

    for (const { business, organizationId } of stood) {
      process.stdout.write(`${business.name}\n`);
      process.stdout.write(`            http://localhost:3000/organizations/${organizationId}\n`);
      process.stdout.write(`  owner     ${business.owner.email}\n`);
      process.stdout.write(
        `  ${business.shape.roles[0].name.padEnd(9)} ${business.member.email}` +
          `  (no report.read — the Reports screen explains itself)\n\n`,
      );
    }
  } finally {
    await pg.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

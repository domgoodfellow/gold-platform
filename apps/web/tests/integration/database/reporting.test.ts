import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { getInvoiceForWorkItem, issueInvoice } from '@/lib/domain/billing/invoices';
import { createCustomer } from '@/lib/domain/customers/customers';
import {
  formatMinutes,
  listTimeCommitted,
  totalMinutes,
} from '@/lib/domain/reporting/commitment';
import { listWorkMarkedComplete } from '@/lib/domain/reporting/completion';
import { createPriceBookItem, updatePriceBookItem } from '@/lib/domain/pricing/price-book';
import { priceWorkItem } from '@/lib/domain/pricing/prices';
import {
  createDashboard,
  listDashboards,
  pinReport,
  readDashboard,
} from '@/lib/domain/reporting/dashboards';
import {
  deleteReportDefinition,
  getReportDefinition,
  listReportDefinitions,
  runReportDefinition,
  saveReportDefinition,
  setReportRoles,
} from '@/lib/domain/reporting/definitions';
import {
  listInvoicedAndIncurred,
  totalsByCurrency,
  type FinancialGroup,
} from '@/lib/domain/reporting/financials';
import { periodFor } from '@/lib/domain/reporting/shape';
import { createResource } from '@/lib/domain/resources/resources';
import { listSchedule } from '@/lib/domain/scheduling/availability';
import { zonedDayRange } from '@/lib/domain/scheduling/window';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { updateOrganization } from '@/lib/domain/tenancy/organizations';
import { addMember } from '@/lib/domain/tenancy/members';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { addPricedLine } from '@/lib/domain/pricing/prices';
import { recordCost } from '@/lib/domain/work-items/consumption';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { createWorkItemStatus, updateWorkItemStatus } from '@/lib/domain/work-items/statuses';
import {
  changeWorkItemStatus,
  createWorkItemTransition,
} from '@/lib/domain/work-items/transitions';
import { createWorkItemType, listWorkItemTypes } from '@/lib/domain/work-items/types';
import { foundBusiness } from '@/tests/support/founding';

/**
 * The aggregate layer, and the claim that keeps it from becoming a second one.
 *
 * **The test that carries this suite is the correspondence** — the aggregate's total and
 * `priceWorkItem` over the same lines, asserted equal. The agreeing-implementations rule permits one rule to be expressed
 * twice on exactly that condition, and the precedent is the single availability model rather than an analogy: the
 * availability predicate genuinely lives in a Postgres constraint *and* in `listSchedule`'s
 * filters, and what holds the single availability model up is `availability.test.ts` asserting the two agree in both
 * directions.
 *
 * So this suite is not really about arithmetic. It is about what happens the day somebody adds
 * a minimum charge, a tax or a rounding rule to `priceWorkItem`: the correspondence fails, which
 * is exactly the event the one-calculation rule was written to catch. **It must be repaired by teaching the aggregate
 * the new rule, never by relaxing the assertion.**
 *
 * Everything else here is a refusal. Grouping by service reports no cost. Two currencies produce
 * two rows and no conversion. A renamed catalogue item does not move last month's figures. Each
 * is a rule from the agreeing-implementations rule and each would be silently easy to lose.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/**
 * Manila, and the zone is the point rather than colour.
 *
 * +08:00 with no daylight saving, so an instant late on the last day of a month in UTC is
 * already the first of the next month where the business is. A period boundary computed from
 * the server's clock puts that invoice in the wrong month, which is `20260902000009`'s finding
 * arriving from the other direction.
 */
const ZONE = 'Asia/Manila';

type Tenant = {
  db: SupabaseClient;
  organizationId: string;
  statusId: string;
  calloutId: string;
};

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;
  expect(created.user.id).toBeTruthy();

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: ZONE,
    currency: 'PHP',
  });

  const typeId = await createWorkItemType(db, { schedulable: true, organizationId, name: 'Job' });
  const statusId = await createWorkItemStatus(db, {
    organizationId,
    typeId,
    name: 'Open',
    position: 0,
  });
  const calloutId = await createPriceBookItem(db, {
    organizationId,
    name: 'Callout',
    unit: 'visit',
    unitAmountMinor: 12_000,
  });

  return { db, organizationId, statusId, calloutId };
}

/** A job, priced, invoiced on a chosen day, and optionally with a cost against it. */
async function billedJob(
  tenant: Tenant,
  input: {
    title: string;
    customerId?: string;
    priceItemId?: string;
    quantity?: number;
    issuedAt: string;
    cost?: { amountMinor: number; incurredAt: string };
  },
): Promise<string> {
  const workItemId = await createWorkItem(tenant.db, {
    organizationId: tenant.organizationId,
    statusId: tenant.statusId,
    title: input.title,
    customerId: input.customerId ?? null,
  });

  await addPricedLine(tenant.db, {
    workItemId,
    priceBookItemId: input.priceItemId ?? tenant.calloutId,
    quantity: input.quantity ?? 1,
  });

  if (input.cost) {
    await recordCost(tenant.db, {
      workItemId,
      description: 'Parts',
      amountMinor: input.cost.amountMinor,
      incurredAt: input.cost.incurredAt,
    });
  }

  await issueInvoice(tenant.db, { workItemId, issuedAt: input.issuedAt });
  return workItemId;
}

const find = (groups: FinancialGroup[], label: string | null) =>
  groups.find((group) => group.label === label);

let acme: Tenant;
let rival: Tenant;
let acmeCustomerId: string;
let acmeJobs: string[];

describe('what a business billed, and what its work consumed', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }

    acme = await newTenant('rep-acme');
    rival = await newTenant('rep-rival');

    acmeCustomerId = await createCustomer(acme.db, {
      organizationId: acme.organizationId,
      name: 'Harbour Dive Co',
    });

    acmeJobs = [
      // Quantity 3, so the correspondence below is not satisfied by a sum that ignores it.
      await billedJob(acme, {
        title: 'Reef survey',
        customerId: acmeCustomerId,
        quantity: 3,
        issuedAt: '2026-08-10T04:00:00.000Z',
        cost: { amountMinor: 9_000, incurredAt: '2026-08-09T04:00:00.000Z' },
      }),
      await billedJob(acme, {
        title: 'Tank service',
        customerId: acmeCustomerId,
        quantity: 1,
        issuedAt: '2026-08-20T04:00:00.000Z',
      }),
      // No customer at all, which must be grouped rather than dropped.
      await billedJob(acme, {
        title: 'Walk-in',
        quantity: 2,
        issuedAt: '2026-08-22T04:00:00.000Z',
      }),
    ];
  });

  it('agrees with the one price calculation, line for line', async () => {
    // **The load-bearing test.** The aggregate totals in SQL; `priceWorkItem` totals in
    // TypeScript. The agreeing-implementations rule permits both only while they answer identically on the same rows, which
    // is the single availability model's mechanism applied to price. A failure here is not a broken test — it means a
    // pricing rule reached one expression and not the other, and the aggregate is what has to
    // learn it.
    const groups = await listInvoicedAndIncurred(acme.db, {
      organizationId: acme.organizationId,
      grouping: 'customer',
    });

    let throughTheCalculation = 0;
    for (const workItemId of acmeJobs) {
      const invoice = await getInvoiceForWorkItem(acme.db, {
        organizationId: acme.organizationId,
        workItemId,
      });
      throughTheCalculation += priceWorkItem(invoice!.lines)!.totalMinor;
    }

    const throughTheAggregate = groups.reduce((total, group) => total + group.invoicedMinor, 0);

    // 12000 × (3 + 1 + 2), by both routes.
    expect(throughTheCalculation).toBe(72_000);
    expect(throughTheAggregate).toBe(throughTheCalculation);
  });

  it('groups by customer, and subtracts what those jobs consumed', async () => {
    const groups = await listInvoicedAndIncurred(acme.db, {
      organizationId: acme.organizationId,
      grouping: 'customer',
    });

    const harbour = find(groups, 'Harbour Dive Co');
    expect(harbour).toBeDefined();
    expect(harbour!.groupId).toBe(acmeCustomerId);
    expect(harbour!.currency).toBe('PHP');
    expect(harbour!.invoicedMinor).toBe(48_000);
    expect(harbour!.incurredMinor).toBe(9_000);
    expect(harbour!.marginMinor).toBe(39_000);
  });

  it('narrows to one customer, and takes that customer’s costs with it', async () => {
    // **A filter narrows jobs, not amounts**, which is why both halves of the aggregate read the
    // grouping keys off the work item. A filter that kept a job's revenue and dropped its costs
    // would report a margin for work that was only partly counted — plausible, and wrong.
    const groups = await listInvoicedAndIncurred(acme.db, {
      organizationId: acme.organizationId,
      grouping: 'service',
      filters: { customerId: acmeCustomerId },
    });

    // The walk-in job had no customer, so its 24 000 is gone; what remains is this customer's
    // two jobs. The cost travelled with them even though the grouping is by service, where a
    // cost is not reported — it is still excluded from the rows, not merely from the column.
    expect(find(groups, 'Callout')?.invoicedMinor).toBe(48_000);
  });

  it('groups work attributed to nobody rather than leaving it out of the totals', async () => {
    // A dropped row would make the report quietly disagree with the invoices it was built
    // from, which is the worst failure a report can have: plausible and wrong.
    const groups = await listInvoicedAndIncurred(acme.db, {
      organizationId: acme.organizationId,
      grouping: 'customer',
    });

    const unattributed = find(groups, null);
    expect(unattributed).toBeDefined();
    expect(unattributed!.groupId).toBeNull();
    expect(unattributed!.invoicedMinor).toBe(24_000);
  });

  it('reports no cost and no margin when grouping by service, rather than zero', async () => {
    // A cost belongs to a job; a service is one line on one. Splitting a job's costs across its
    // lines needs an allocation rule this platform has no basis to invent, so the honest answer
    // is an absence. Zero would say the service cost nothing, which is a claim.
    const groups = await listInvoicedAndIncurred(acme.db, {
      organizationId: acme.organizationId,
      grouping: 'service',
    });

    const callout = find(groups, 'Callout');
    expect(callout).toBeDefined();
    expect(callout!.invoicedMinor).toBe(72_000);
    expect(callout!.incurredMinor).toBeNull();
    expect(callout!.marginMinor).toBeNull();
    // No entity to point at: the line holds a snapshotted word and no key to the catalogue.
    expect(callout!.groupId).toBeNull();
  });

  it('keeps a renamed catalogue item out of last month’s figures', async () => {
    // The join this would need is the one `work_item_priced_lines` and `invoice_lines` refuse
    // to hold a key for. Renaming a service splits the report, and that is correct: those were
    // two things sold under two names, and each line records what was agreed at the time.
    await updatePriceBookItem(acme.db, {
      id: acme.calloutId,
      name: 'Site visit',
      unit: 'visit',
      unitAmountMinor: 12_000,
    });

    await billedJob(acme, {
      title: 'After the rename',
      customerId: acmeCustomerId,
      issuedAt: '2026-08-25T04:00:00.000Z',
    });

    const groups = await listInvoicedAndIncurred(acme.db, {
      organizationId: acme.organizationId,
      grouping: 'service',
    });

    expect(find(groups, 'Callout')?.invoicedMinor).toBe(72_000);
    expect(find(groups, 'Site visit')?.invoicedMinor).toBe(12_000);
  });

  it('counts an invoice into the month the business is in, not the server’s', async () => {
    // 2026-08-31T17:00Z is 2026-09-01 01:00 in Manila. A boundary computed in UTC puts this in
    // August; the business it belongs to has already started September.
    const septemberInManila = await newTenant('rep-zone');
    await billedJob(septemberInManila, {
      title: 'Just after midnight',
      issuedAt: '2026-08-31T17:00:00.000Z',
    });

    const august = await listInvoicedAndIncurred(septemberInManila.db, {
      organizationId: septemberInManila.organizationId,
      grouping: 'customer',
      period: { from: '2026-08-01', to: '2026-09-01' },
    });
    const september = await listInvoicedAndIncurred(septemberInManila.db, {
      organizationId: septemberInManila.organizationId,
      grouping: 'customer',
      period: { from: '2026-09-01', to: '2026-10-01' },
    });

    expect(august).toEqual([]);
    expect(september[0]?.invoicedMinor).toBe(12_000);
  });

  it('totals each currency separately and converts nothing', async () => {
    // The reachable case rather than a theoretical one: a business that changes what it trades
    // in has a catalogue and a history in two currencies, and amounts are never converted.
    const shifted = await newTenant('rep-currency');
    const regular = await createCustomer(shifted.db, {
      organizationId: shifted.organizationId,
      name: 'Long-standing client',
    });

    await billedJob(shifted, {
      title: 'Before',
      customerId: regular,
      issuedAt: '2026-08-05T04:00:00.000Z',
    });

    await updateOrganization(shifted.db, {
      id: shifted.organizationId,
      name: 'rep-currency Ltd',
      timezone: ZONE,
      currency: 'EUR',
      bufferMinutes: 0,
      slug: null,
    });

    // A new catalogue entry rather than a re-priced one, because that is what actually happens:
    // `update_price_book_item` takes no currency, so an item carries the currency the business
    // traded in when it was created and keeps it. The old entry is the one the Pricing
    // screen already reports as priced in a currency this business no longer trades in.
    const inEuro = await createPriceBookItem(shifted.db, {
      organizationId: shifted.organizationId,
      name: 'Charter',
      unit: 'day',
      unitAmountMinor: 5_000,
    });
    await billedJob(shifted, {
      title: 'After',
      customerId: regular,
      priceItemId: inEuro,
      issuedAt: '2026-08-06T04:00:00.000Z',
    });

    const groups = await listInvoicedAndIncurred(shifted.db, {
      organizationId: shifted.organizationId,
      grouping: 'customer',
    });

    // One customer, two currencies, two rows — and no row in a currency nobody recorded. The
    // refusal `jobEconomics` expresses as a null margin, expressed here as a table.
    expect(groups.filter((group) => group.groupId === regular)).toHaveLength(2);
    expect(groups.find((group) => group.currency === 'PHP')?.invoicedMinor).toBe(12_000);
    expect(groups.find((group) => group.currency === 'EUR')?.invoicedMinor).toBe(5_000);

    const totals = totalsByCurrency(groups);
    expect(totals.map((total) => total.currency)).toEqual(['EUR', 'PHP']);
  });

  it('is narrowed by the caller’s own session, never by the id it was handed', async () => {
    // The failure a tool layer invites: if the organization id were what kept a caller inside
    // their own business, the protection would be a value the caller chose. It is not.
    //
    // **This used to assert an empty list and now asserts a refusal, because the guard moved
    // earlier.** `app.has_capability` is keyed to the caller's own memberships, so a caller
    // naming another business is stopped before a single row is read rather than after RLS has
    // filtered them all away. Stronger, and worth recording rather than quietly rewriting.
    await expect(
      listInvoicedAndIncurred(rival.db, {
        organizationId: acme.organizationId,
        grouping: 'customer',
      }),
    ).rejects.toThrow(/may not read/);

    // And a business that does not exist is refused identically. Somebody probing this cannot
    // tell a real tenant they may not read from a uuid nobody has ever used, which is the same
    // property `booking_organization` keeps when it answers null for two different reasons.
    await expect(
      listInvoicedAndIncurred(rival.db, {
        organizationId: randomUUID(),
        grouping: 'customer',
      }),
    ).rejects.toThrow(/may not read/);
  });

  it('shows a member only their own business’s figures, with another’s in the same database', async () => {
    // The other half of the same claim, now that the refusal above no longer exercises it: two
    // tenants have invoices in one database and `acme`'s totals are `acme`'s alone. The
    // correspondence test would already fail if this were untrue — it matches an exact figure —
    // but that reads as an arithmetic assertion and this reads as the tenancy one it also is.
    const theirCustomer = await createCustomer(rival.db, {
      organizationId: rival.organizationId,
      name: 'Somebody else entirely',
    });
    await billedJob(rival, {
      title: 'Not acme’s',
      customerId: theirCustomer,
      issuedAt: '2026-08-11T04:00:00.000Z',
    });

    const groups = await listInvoicedAndIncurred(acme.db, {
      organizationId: acme.organizationId,
      grouping: 'customer',
    });

    expect(groups.map((group) => group.label)).not.toContain('Somebody else entirely');
    // The unattributed bucket is the one a leak would inflate without adding a label, so it is
    // asserted at the figure test 3 established rather than merely being present.
    expect(find(groups, null)?.invoicedMinor).toBe(24_000);
  });

  it('refuses a member who does not hold report.read, in the database', async () => {
    // **A whole tenant of its own, because this demotes the only member it has.** The
    // capabilities left are plainly not nothing — this member can create work, price it and
    // invoice it, which means they can open every invoice this report adds up, one at a time.
    // What they cannot do is see them added up, and that is the distinction
    // `20260903000003` exists to make: a total is a disclosure that exists in no row.
    //
    // Asserted against the function rather than against the page, because hiding a page is a
    // courtesy and the refusal has to survive somebody calling the RPC directly.
    const limited = await newTenant('rep-limited');
    const roleId = await createRole(limited.db, {
      organizationId: limited.organizationId,
      name: 'Coordinator',
      capabilities: [
        'role.manage',
        'work_item.create',
        'work_item.price',
        'price.manage',
        'invoice.issue',
      ],
    });
    const { data: membership } = await limited.db
      .from('memberships')
      .select('id')
      .eq('organization_id', limited.organizationId)
      .single();
    await assignRole(limited.db, { membershipId: membership!.id, roleId });

    await expect(
      listInvoicedAndIncurred(limited.db, {
        organizationId: limited.organizationId,
        grouping: 'customer',
      }),
    ).rejects.toMatchObject({ code: 'reporting.financials_failed' });

    // The rows themselves are untouched, which is the half that makes the distinction real
    // rather than a slogan: this member still reads every invoice the report would have summed.
    const { data: invoices, error } = await limited.db
      .from('invoices')
      .select('id')
      .eq('organization_id', limited.organizationId);
    expect(error).toBeNull();
    expect(invoices).toEqual([]);
  });

  it('refuses a grouping it does not implement, rather than answering something else', async () => {
    // Returning no rows would read as "this business billed nothing" and a null key would read
    // as "all of it, unattributed". Both are answers and both are wrong.
    await expect(
      listInvoicedAndIncurred(acme.db, {
        organizationId: acme.organizationId,
        // Deliberately outside the union: a model or a URL can produce this and must not be
        // quietly obliged.
        grouping: 'profit' as never,
      }),
    ).rejects.toMatchObject({ code: 'reporting.financials_failed' });
  });
});

describe('the period a report covers', () => {
  it('is half-open, so a month and the next share a boundary and count nothing twice', () => {
    expect(periodFor('month', '2026-08-14')).toEqual({ from: '2026-08-01', to: '2026-09-01' });
    expect(periodFor('month', '2026-09-02')).toEqual({ from: '2026-09-01', to: '2026-10-01' });
  });

  it('rolls the year over in December rather than producing a thirteenth month', () => {
    expect(periodFor('month', '2026-12-31')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(periodFor('year', '2026-12-31')).toEqual({ from: '2026-01-01', to: '2027-01-01' });
  });

  it('asks for everything when the preset says everything', () => {
    expect(periodFor('all', '2026-08-14')).toEqual({});
  });
});

describe('a period total', () => {
  const group = (over: Partial<FinancialGroup> = {}): FinancialGroup => ({
    groupId: null,
    label: 'A',
    currency: 'PHP',
    invoicedMinor: 1_000,
    incurredMinor: 400,
    marginMinor: 600,
    ...over,
  });

  it('adds within a currency and never across one', () => {
    const totals = totalsByCurrency([
      group({ label: 'A' }),
      group({ label: 'B', invoicedMinor: 500, incurredMinor: 100, marginMinor: 400 }),
      group({ label: 'C', currency: 'EUR', invoicedMinor: 700, incurredMinor: 0, marginMinor: 700 }),
    ]);

    expect(totals).toEqual([
      { currency: 'EUR', invoicedMinor: 700, incurredMinor: 0, marginMinor: 700 },
      { currency: 'PHP', invoicedMinor: 1_500, incurredMinor: 500, marginMinor: 1_000 },
    ]);
  });

  it('carries an absent cost through to the total rather than calling it zero', () => {
    // Grouping by service: no group has a cost, so neither does the total. A zero here would
    // claim the period broke even against nothing spent.
    const totals = totalsByCurrency([
      group({ incurredMinor: null, marginMinor: null }),
      group({ label: 'B', invoicedMinor: 500, incurredMinor: null, marginMinor: null }),
    ]);

    expect(totals).toEqual([
      { currency: 'PHP', invoicedMinor: 1_500, incurredMinor: null, marginMinor: null },
    ]);
  });
});

/**
 * A saved report, and who it is for.
 *
 * **The claim that matters is that a saved report is arguments**. It holds no figures and
 * no query, so opening one takes the same road the ad-hoc screen takes — asserted below by
 * running both and comparing whole rows, because a second read path is the thing this design is
 * most likely to grow.
 *
 * The rest is the audience, and it is asserted as an *absent row* rather than as a hidden
 * control. A report a role may not see returns nothing from `report_definitions_select`, which
 * is what lets a dashboard render what each viewer can read with nothing in code deciding it.
 */
describe('a report a business saved', () => {
  let owner: Tenant;
  let outsiderDb: SupabaseClient;
  let readerDb: SupabaseClient;
  let readerRoleId: string;
  let reportId: string;

  async function joinAs(
    tenant: Tenant,
    label: string,
    capabilities: string[],
  ): Promise<{ db: SupabaseClient; roleId: string }> {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;
    const { error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError) throw createError;

    const roleId = await createRole(tenant.db, {
      organizationId: tenant.organizationId,
      name: label,
      capabilities,
    });
    await addMember(tenant.db, {
      organizationId: tenant.organizationId,
      email,
      displayName: label,
      roleId,
    });

    const db = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await db.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;

    return { db, roleId };
  }

  beforeAll(async () => {
    owner = await newTenant('def-owner');
    const customerId = await createCustomer(owner.db, {
      organizationId: owner.organizationId,
      name: 'Pier Works',
    });
    await billedJob(owner, {
      title: 'Hull inspection',
      customerId,
      quantity: 2,
      issuedAt: '2026-08-12T04:00:00.000Z',
      cost: { amountMinor: 3_000, incurredAt: '2026-08-11T04:00:00.000Z' },
    });

    // Two people who are not the founder. Both may read figures; neither may author a report.
    const reader = await joinAs(owner, 'reader', ['report.read']);
    readerDb = reader.db;
    readerRoleId = reader.roleId;

    const outsider = await joinAs(owner, 'outsider', ['report.read']);
    outsiderDb = outsider.db;

    reportId = await saveReportDefinition(owner.db, {
      organizationId: owner.organizationId,
      name: 'Billing by service',
      measure: 'invoiced_and_incurred',
      grouping: 'service',
      period: 'all',
    });
  });

  it('runs through the same aggregate the ad-hoc view runs through', async () => {
    // **The load-bearing test of this slice.** A saved report that grew its own query would be a
    // second answer to a question that already has one, and it would look like an optimisation
    // on the day somebody wrote it. Whole rows compared, not a total.
    const definition = await getReportDefinition(owner.db, {
      organizationId: owner.organizationId,
      id: reportId,
    });

    const throughTheDefinition = await runReportDefinition(owner.db, {
      organizationId: owner.organizationId,
      definition: definition!,
      today: '2026-08-30',
    });

    const throughTheScreen = await listInvoicedAndIncurred(owner.db, {
      organizationId: owner.organizationId,
      grouping: 'service',
      period: periodFor('all', '2026-08-30'),
    });

    expect(throughTheDefinition.measure).toBe('invoiced_and_incurred');
    expect(throughTheDefinition.groups).toEqual(throughTheScreen);
    expect(throughTheDefinition.groups[0]).toMatchObject({ invoicedMinor: 24_000 });
  });

  it('shows a report to nobody until it names a role', async () => {
    // Not a hidden button: the row is not returned. Both of these members hold `report.read`
    // and can see the business's figures on the ad-hoc screen — what they cannot see is
    // somebody else's saved report.
    expect(
      await listReportDefinitions(readerDb, { organizationId: owner.organizationId }),
    ).toEqual([]);
    expect(
      await getReportDefinition(readerDb, { organizationId: owner.organizationId, id: reportId }),
    ).toBeNull();
  });

  it('shows it to the role it names, and to nobody else', async () => {
    await setReportRoles(owner.db, {
      organizationId: owner.organizationId,
      reportId,
      roleIds: [readerRoleId],
    });

    const forReader = await listReportDefinitions(readerDb, {
      organizationId: owner.organizationId,
    });
    expect(forReader.map((row) => row.name)).toEqual(['Billing by service']);

    // The other member holds the same capability and a different role, which is the whole of
    // what separates them.
    expect(
      await listReportDefinitions(outsiderDb, { organizationId: owner.organizationId }),
    ).toEqual([]);
  });

  it('lets somebody who is shared a report run it, and get the author’s figures', async () => {
    const definition = await getReportDefinition(readerDb, {
      organizationId: owner.organizationId,
      id: reportId,
    });
    expect(definition).not.toBeNull();

    const result = await runReportDefinition(readerDb, {
      organizationId: owner.organizationId,
      definition: definition!,
      today: '2026-08-30',
    });
    expect(result.groups[0]).toMatchObject({ invoicedMinor: 24_000 });
  });

  it('refuses a member who may read figures but not author a report', async () => {
    await expect(
      saveReportDefinition(readerDb, {
        organizationId: owner.organizationId,
        name: 'Mine now',
        measure: 'invoiced_and_incurred',
        grouping: 'customer',
        period: 'all',
      }),
    ).rejects.toMatchObject({ code: 'reports.save_failed' });

    await expect(
      setReportRoles(readerDb, {
        organizationId: owner.organizationId,
        reportId,
        roleIds: [],
      }),
    ).rejects.toMatchObject({ code: 'reports.share_failed' });
  });

  it('cannot be filtered to another business’s customer', async () => {
    // The composite key refuses it, so the row cannot be written at all. A JSON filter column
    // would have accepted this and produced an empty report nobody could explain.
    const stranger = await newTenant('def-stranger');
    const theirCustomer = await createCustomer(stranger.db, {
      organizationId: stranger.organizationId,
      name: 'Not yours',
    });

    await expect(
      saveReportDefinition(owner.db, {
        organizationId: owner.organizationId,
        name: 'Somebody else’s customer',
        measure: 'invoiced_and_incurred',
        grouping: 'service',
        period: 'all',
        filters: { customerId: theirCustomer },
      }),
    ).rejects.toMatchObject({ code: 'reports.save_failed' });
  });

  it('refuses a second report with the same name', async () => {
    await expect(
      saveReportDefinition(owner.db, {
        organizationId: owner.organizationId,
        name: 'billing BY service',
        measure: 'invoiced_and_incurred',
        grouping: 'customer',
        period: 'all',
      }),
    ).rejects.toMatchObject({ code: 'reports.name_taken' });
  });
});

/**
 * A dashboard, and the audience it does not have.
 *
 * **The claim worth testing is the absence.** A dashboard holds no role list; who sees it follows
 * from which of its reports they can read, asked by `dashboards_select` with
 * `report_definitions_select` running inside the subquery. So the assertions below are about what
 * three different people get from one row: every tile, one tile, and no dashboard at all.
 *
 * That last one is the property a second role list would have broken. A dashboard of somebody
 * else's reports is **absent**, not empty — its name does not leak either.
 */
describe('a dashboard', () => {
  let owner: Tenant;
  let readerDb: SupabaseClient;
  let strangerDb: SupabaseClient;
  let dashboardId: string;
  let sharedReportId: string;
  let privateReportId: string;

  async function joinAs(
    tenant: Tenant,
    label: string,
    capabilities: string[],
  ): Promise<{ db: SupabaseClient; roleId: string }> {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;
    const { error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError) throw createError;

    const roleId = await createRole(tenant.db, {
      organizationId: tenant.organizationId,
      name: label,
      capabilities,
    });
    await addMember(tenant.db, {
      organizationId: tenant.organizationId,
      email,
      displayName: label,
      roleId,
    });

    const db = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await db.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;

    return { db, roleId };
  }

  beforeAll(async () => {
    owner = await newTenant('dash-owner');
    await billedJob(owner, { title: 'A job', issuedAt: '2026-08-14T04:00:00.000Z' });

    const reader = await joinAs(owner, 'dash-reader', ['report.read']);
    readerDb = reader.db;
    const stranger = await joinAs(owner, 'dash-stranger', ['report.read']);
    strangerDb = stranger.db;

    sharedReportId = await saveReportDefinition(owner.db, {
      organizationId: owner.organizationId,
      name: 'Everyone’s',
      measure: 'invoiced_and_incurred',
      grouping: 'service',
      period: 'all',
    });
    privateReportId = await saveReportDefinition(owner.db, {
      organizationId: owner.organizationId,
      name: 'Owner’s only',
      measure: 'invoiced_and_incurred',
      grouping: 'customer',
      period: 'all',
    });

    await setReportRoles(owner.db, {
      organizationId: owner.organizationId,
      reportId: sharedReportId,
      roleIds: [reader.roleId],
    });

    dashboardId = await createDashboard(owner.db, {
      organizationId: owner.organizationId,
      name: 'The board',
    });
    await pinReport(owner.db, {
      organizationId: owner.organizationId,
      dashboardId,
      reportId: sharedReportId,
      position: 0,
    });
    await pinReport(owner.db, {
      organizationId: owner.organizationId,
      dashboardId,
      reportId: privateReportId,
      position: 1,
    });
  });

  it('shows its author every tile, each through the one aggregate', async () => {
    const tiles = await readDashboard(owner.db, {
      organizationId: owner.organizationId,
      dashboardId,
      today: '2026-08-30',
    });

    expect(tiles.map((tile) => tile.report.name)).toEqual(['Everyone’s', 'Owner’s only']);
    // Not a stored figure anywhere: each tile is `runReportDefinition`, which is the aggregate.
    expect(tiles[0].result.groups[0]).toMatchObject({ invoicedMinor: 12_000 });
  });

  it('shows one person two tiles and another person one, from the same row', async () => {
    const forReader = await readDashboard(readerDb, {
      organizationId: owner.organizationId,
      dashboardId,
      today: '2026-08-30',
    });

    // The pin to the owner's private report is not returned, so the tile is absent rather than
    // rendered empty — and nothing in application code decided that.
    expect(forReader.map((tile) => tile.report.name)).toEqual(['Everyone’s']);
    expect(forReader[0].result.groups[0]).toMatchObject({ invoicedMinor: 12_000 });
  });

  it('does not exist for somebody none of its reports are for', async () => {
    // **The property a second role list would have broken.** This member holds `report.read` and
    // can see the business's figures on the ad-hoc screen; what they cannot see is that this
    // dashboard exists, because nothing on it is theirs.
    const visible = await listDashboards(strangerDb, { organizationId: owner.organizationId });
    expect(visible).toEqual([]);

    const tiles = await readDashboard(strangerDb, {
      organizationId: owner.organizationId,
      dashboardId,
      today: '2026-08-30',
    });
    expect(tiles).toEqual([]);
  });

  it('appears for the reader it has something for, by name', async () => {
    const visible = await listDashboards(readerDb, { organizationId: owner.organizationId });
    expect(visible.map((entry) => entry.name)).toEqual(['The board']);
  });

  it('refuses a member who may read figures but not author one', async () => {
    await expect(
      createDashboard(readerDb, { organizationId: owner.organizationId, name: 'Mine' }),
    ).rejects.toMatchObject({ code: 'dashboards.create_failed' });

    await expect(
      pinReport(readerDb, {
        organizationId: owner.organizationId,
        dashboardId,
        reportId: sharedReportId,
      }),
    ).rejects.toMatchObject({ code: 'dashboards.pin_failed' });
  });

  it('loses a tile when the report behind it goes, rather than keeping a gap', async () => {
    // `cascade` rather than `set null` on the pin: a tile pointing at a report that no longer
    // exists is not a tile with a hole in it, it is not a tile.
    await deleteReportDefinition(owner.db, { id: privateReportId });

    const tiles = await readDashboard(owner.db, {
      organizationId: owner.organizationId,
      dashboardId,
      today: '2026-08-30',
    });
    expect(tiles.map((tile) => tile.report.name)).toEqual(['Everyone’s']);
  });
});

/**
 * How much work a business marked finished.
 *
 * **The second measure, and the first that is not money** — which is what takes `requires:
 * 'billing'` off the reporting module. What is worth testing here is not the arithmetic but the
 * three refusals it is built on.
 *
 * *Which status means finished is the tenant's answer*, and a business that has said nothing
 * reports nothing rather than everything. *`releases_resource` is not that answer* — Cancelled
 * frees the van and is not completed work, which is exactly why it was never made to answer both
 * questions with one flag. And a job finished, reopened and finished again inside one period
 * **counts once**, because counting the moves would make a business that corrects a mistake look
 * busier than one that does not.
 */
describe('work a business marked finished', () => {
  let shop: Tenant;
  let doneId: string;
  let cancelledId: string;
  let openId: string;
  let customerId: string;

  beforeAll(async () => {
    shop = await newTenant('done-shop');

    const [type] = await listWorkItemTypes(shop.db, { organizationId: shop.organizationId });
    openId = shop.statusId;

    doneId = await createWorkItemStatus(shop.db, {
      organizationId: shop.organizationId,
      typeId: type.id,
      name: 'Finished',
      position: 1,
    });
    cancelledId = await createWorkItemStatus(shop.db, {
      organizationId: shop.organizationId,
      typeId: type.id,
      name: 'Cancelled',
      position: 2,
    });

    // Every move has to be legal before it can be made.
    for (const to of [doneId, cancelledId]) {
      await createWorkItemTransition(shop.db, {
        organizationId: shop.organizationId,
        typeId: type.id,
        fromStatusId: openId,
        toStatusId: to,
      });
      await createWorkItemTransition(shop.db, {
        organizationId: shop.organizationId,
        typeId: type.id,
        fromStatusId: to,
        toStatusId: openId,
      });
    }

    customerId = await createCustomer(shop.db, {
      organizationId: shop.organizationId,
      name: 'Regular client',
    });
  });

  async function job(title: string): Promise<string> {
    return createWorkItem(shop.db, {
      organizationId: shop.organizationId,
      statusId: openId,
      title,
      customerId,
    });
  }

  it('reports nothing until the business says which status means finished', async () => {
    // **Not zero because nothing happened — nothing because nothing was asked.** A business that
    // has not answered is not a business with no completed work, and the screen says so.
    const finished = await job('Done but unclaimed');
    await changeWorkItemStatus(shop.db, { workItemId: finished, toStatusId: doneId });

    expect(
      await listWorkMarkedComplete(shop.db, {
        organizationId: shop.organizationId,
        grouping: 'customer',
      }),
    ).toEqual([]);
  });

  it('counts work once the business answers, and reaches back over what already happened', async () => {
    // **Read against the event log rather than stamped at the moment work moved**, so answering
    // the question later counts history correctly instead of only counting what happens next.
    // A business that decides "Finished" was always the finish line sees last year immediately.
    await updateWorkItemStatus(shop.db, {
      id: doneId,
      name: 'Finished',
      position: 1,
      releasesResource: false,
      marksComplete: true,
    });

    const groups = await listWorkMarkedComplete(shop.db, {
      organizationId: shop.organizationId,
      grouping: 'customer',
    });

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Regular client');
    expect(groups[0].jobs).toBe(1);
  });

  it('does not treat freeing the resource as finishing the work', async () => {
    // The distinction deliberately never collapsed, asserted rather than described. Cancelled releases
    // the van; it is not work anybody did.
    await updateWorkItemStatus(shop.db, {
      id: cancelledId,
      name: 'Cancelled',
      position: 2,
      releasesResource: true,
      marksComplete: false,
    });

    const abandoned = await job('Called off');
    await changeWorkItemStatus(shop.db, { workItemId: abandoned, toStatusId: cancelledId });

    const groups = await listWorkMarkedComplete(shop.db, {
      organizationId: shop.organizationId,
      grouping: 'customer',
    });
    expect(groups[0].jobs).toBe(1);
  });

  it('counts a job once however many times it was finished', async () => {
    // Finished, reopened, finished again. One job was done, and counting the moves would make
    // correcting a mistake look like extra work.
    const reworked = await job('Twice over');
    await changeWorkItemStatus(shop.db, { workItemId: reworked, toStatusId: doneId });
    await changeWorkItemStatus(shop.db, { workItemId: reworked, toStatusId: openId });
    await changeWorkItemStatus(shop.db, { workItemId: reworked, toStatusId: doneId });

    const groups = await listWorkMarkedComplete(shop.db, {
      organizationId: shop.organizationId,
      grouping: 'customer',
    });
    expect(groups[0].jobs).toBe(2);
  });

  it('refuses a grouping it cannot answer, at the aggregate and when saving one', async () => {
    // A job is finished as a whole; splitting one completion across the priced lines on it would
    // mean inventing a rule about how — the same refusal the money report makes about cost per
    // service. Refused twice: at execution, and when somebody tries to *store* the pair, so a
    // report whose only outcome is a failure is never put on a screen as a thing to click.
    await expect(
      listWorkMarkedComplete(shop.db, {
        organizationId: shop.organizationId,
        grouping: 'service',
      }),
    ).rejects.toMatchObject({ code: 'reporting.completion_failed' });

    await expect(
      saveReportDefinition(shop.db, {
        organizationId: shop.organizationId,
        name: 'Finished by service',
        measure: 'work_marked_complete',
        grouping: 'service',
        period: 'all',
      }),
    ).rejects.toMatchObject({ code: 'reports.grouping_unanswerable' });
  });

  it('is gated by report.read like every other total', async () => {
    const limited = await newTenant('done-limited');
    const roleId = await createRole(limited.db, {
      organizationId: limited.organizationId,
      name: 'Coordinator',
      capabilities: ['role.manage', 'work_item.create', 'work_item.transition'],
    });
    const { data: membership } = await limited.db
      .from('memberships')
      .select('id')
      .eq('organization_id', limited.organizationId)
      .single();
    await assignRole(limited.db, { membershipId: membership!.id, roleId });

    await expect(
      listWorkMarkedComplete(limited.db, {
        organizationId: limited.organizationId,
        grouping: 'customer',
      }),
    ).rejects.toMatchObject({ code: 'reporting.completion_failed' });
  });

  it('is saveable, and a saved one runs through the same aggregate', async () => {
    const reportId = await saveReportDefinition(shop.db, {
      organizationId: shop.organizationId,
      name: 'Finished by customer',
      measure: 'work_marked_complete',
      grouping: 'customer',
      period: 'all',
    });

    const definition = await getReportDefinition(shop.db, {
      organizationId: shop.organizationId,
      id: reportId,
    });
    expect(definition?.measure).toBe('work_marked_complete');

    const result = await runReportDefinition(shop.db, {
      organizationId: shop.organizationId,
      definition: definition!,
      today: '2026-09-03',
    });

    expect(result.measure).toBe('work_marked_complete');
    if (result.measure !== 'work_marked_complete') throw new Error('wrong measure');
    expect(result.groups).toEqual(
      await listWorkMarkedComplete(shop.db, {
        organizationId: shop.organizationId,
        grouping: 'customer',
      }),
    );
  });
});

/**
 * How much resource time a business committed.
 *
 * **The correspondence is the test and everything else is secondary.** What counts as a
 * commitment is `work_items_resource_not_double_booked`'s partial predicate, and it now lives in
 * three places: the exclusion constraint, `listSchedule`'s filters, and `time_committed`. The agreeing-implementations rule
 * permits that only while they agree, which is the single availability model's own mechanism — `availability.test.ts` already
 * holds the first two together in both directions, and this holds the third to them.
 *
 * **A failure here is not a broken test.** It means a clause reached one expression and not the
 * others, which is the event the single availability model was written to catch. Repair it by teaching the aggregate what
 * the constraint learned, never by relaxing the assertion.
 *
 * What is deliberately absent is utilisation. A percentage needs opening hours minus commitments,
 * which is `freeWindows`, and a second answer to *what is free* is what the single availability model forbids outright — no
 * correspondence test would make that safe, because the second answer is the one somebody books
 * against.
 */
describe('time a business has committed', () => {
  const DAY = '2027-04-12';
  // **The business's day, not the server's**, and the first draft of this suite used a UTC one.
  // The aggregate zones its two dates from the organization's own row, so a correspondence test
  // reading a UTC day would compare two different windows and pass by luck — which it did, until
  // a booking late in the UTC day fell outside the Manila one and said so.
  const ZONE_WINDOW = zonedDayRange(DAY, ZONE);

  let yard: Tenant;
  let vanId: string;
  let releasedId: string;

  beforeAll(async () => {
    yard = await newTenant('time-yard');
    vanId = await createResource(yard.db, { resourceClass: 'other',
      organizationId: yard.organizationId,
      name: 'Van one',
    });

    const [type] = await listWorkItemTypes(yard.db, { organizationId: yard.organizationId });
    releasedId = await createWorkItemStatus(yard.db, {
      organizationId: yard.organizationId,
      typeId: type.id,
      name: 'Called off',
      position: 3,
    });
    await createWorkItemTransition(yard.db, {
      organizationId: yard.organizationId,
      typeId: type.id,
      fromStatusId: yard.statusId,
      toStatusId: releasedId,
    });
    await updateWorkItemStatus(yard.db, {
      id: releasedId,
      name: 'Called off',
      position: 3,
      releasesResource: true,
      marksComplete: false,
    });
  });

  async function booked(title: string, from: string, to: string): Promise<string> {
    const id = await createWorkItem(yard.db, {
      organizationId: yard.organizationId,
      statusId: yard.statusId,
      title,
    });
    await scheduleWorkItem(yard.db, {
      workItemId: id,
      resourceIds: [vanId],
      startsAt: from,
      endsAt: to,
    });
    return id;
  }

  it('agrees with the one availability calculation, on the same jobs', async () => {
    // **The load-bearing test of this slice.** Two hours and ninety minutes, on one van, on one
    // day. `listSchedule` reads the commitments through the domain layer; `time_committed` reads
    // them in SQL. Both are the same predicate and they have to answer identically.
    await booked('Morning', '2027-04-12T08:00:00.000Z', '2027-04-12T10:00:00.000Z');
    await booked('Afternoon', '2027-04-12T13:00:00.000Z', '2027-04-12T14:30:00.000Z');

    const schedule = await listSchedule(yard.db, {
      organizationId: yard.organizationId,
      within: ZONE_WINDOW,
    });

    const throughTheSchedule = schedule
      .flatMap((entry) => entry.booked)
      .reduce((total, entry) => {
        // Clipped to the window, which is what the aggregate does and what the schedule leaves
        // to its caller. Stated here rather than assumed, so the rule is visible in the test.
        const from = Math.max(
          new Date(entry.occupied.startsAt).getTime(),
          new Date(ZONE_WINDOW.startsAt).getTime(),
        );
        const to = Math.min(
          new Date(entry.occupied.endsAt).getTime(),
          new Date(ZONE_WINDOW.endsAt).getTime(),
        );
        return total + Math.max(0, to - from) / 60_000;
      }, 0);

    const throughTheAggregate = await listTimeCommitted(yard.db, {
      organizationId: yard.organizationId,
      grouping: 'resource',
      period: { from: DAY, to: '2027-04-13' },
    });

    expect(throughTheSchedule).toBe(210);
    expect(totalMinutes(throughTheAggregate)).toBe(throughTheSchedule);
    expect(throughTheAggregate[0].label).toBe('Van one');
  });

  it('stops counting work whose status the business says frees the resource', async () => {
    // The third clause of the predicate, and the one a tenant can change under it. The exclusion
    // constraint stops enforcing on this row and the schedule stops drawing it; the aggregate
    // has to stop counting it in the same breath, or a business that cancels a job reports time
    // it did not spend.
    const abandoned = await booked(
      'Called off later',
      '2027-04-12T11:00:00.000Z',
      '2027-04-12T12:00:00.000Z',
    );

    const before = await listTimeCommitted(yard.db, {
      organizationId: yard.organizationId,
      grouping: 'resource',
      period: { from: DAY, to: '2027-04-13' },
    });
    expect(totalMinutes(before)).toBe(270);

    await changeWorkItemStatus(yard.db, { workItemId: abandoned, toStatusId: releasedId });

    const after = await listTimeCommitted(yard.db, {
      organizationId: yard.organizationId,
      grouping: 'resource',
      period: { from: DAY, to: '2027-04-13' },
    });
    expect(totalMinutes(after)).toBe(210);

    // And the schedule agrees, which is the correspondence holding through a change rather than
    // only at rest.
    const schedule = await listSchedule(yard.db, {
      organizationId: yard.organizationId,
      within: ZONE_WINDOW,
    });
    expect(schedule.flatMap((entry) => entry.booked)).toHaveLength(2);
  });

  it('splits a job across the months it actually occupied', async () => {
    // Counting the whole window into both months would report more committed time than exists.
    const spanning = await newTenant('time-span');
    const van = await createResource(spanning.db, { resourceClass: 'other',
      organizationId: spanning.organizationId,
      name: 'Night shift',
    });
    const id = await createWorkItem(spanning.db, {
      organizationId: spanning.organizationId,
      statusId: spanning.statusId,
      title: 'Over the boundary',
    });
    // 22:00 to 02:00 Manila, which straddles midnight on the first of the month there.
    await scheduleWorkItem(spanning.db, {
      workItemId: id,
      resourceIds: [van],
      startsAt: '2027-04-30T14:00:00.000Z',
      endsAt: '2027-04-30T18:00:00.000Z',
    });

    const april = await listTimeCommitted(spanning.db, {
      organizationId: spanning.organizationId,
      grouping: 'resource',
      period: { from: '2027-04-01', to: '2027-05-01' },
    });
    const may = await listTimeCommitted(spanning.db, {
      organizationId: spanning.organizationId,
      grouping: 'resource',
      period: { from: '2027-05-01', to: '2027-06-01' },
    });

    // Four hours in total, and each month gets the part it held rather than all of it.
    expect(totalMinutes(april) + totalMinutes(may)).toBe(240);
    expect(totalMinutes(april)).toBeGreaterThan(0);
    expect(totalMinutes(may)).toBeGreaterThan(0);
  });

  it('is gated by report.read, and refuses a grouping it cannot answer', async () => {
    await expect(
      listTimeCommitted(yard.db, {
        organizationId: yard.organizationId,
        grouping: 'service',
      }),
    ).rejects.toMatchObject({ code: 'reporting.commitment_failed' });
  });

  it('reads minutes as a timesheet does, not as a decimal to be multiplied', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(210)).toBe('3h 30m');
  });
});

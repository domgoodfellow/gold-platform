import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { getInvoiceForWorkItem, issueInvoice } from '@/lib/domain/billing/invoices';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createPriceBookItem, updatePriceBookItem } from '@/lib/domain/pricing/price-book';
import { priceWorkItem } from '@/lib/domain/pricing/prices';
import {
  listInvoicedAndIncurred,
  periodFor,
  totalsByCurrency,
  type FinancialGroup,
} from '@/lib/domain/reporting/financials';
import { updateOrganization } from '@/lib/domain/tenancy/organizations';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { addPricedLine } from '@/lib/domain/pricing/prices';
import { recordCost } from '@/lib/domain/work-items/consumption';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { foundBusiness } from './helpers/founding';

/**
 * The aggregate layer, and the claim that keeps it from becoming a second one.
 *
 * **The test that carries this suite is the correspondence** — the aggregate's total and
 * `priceWorkItem` over the same lines, asserted equal. D35 permits one rule to be expressed
 * twice on exactly that condition, and the precedent is I5 rather than an analogy: the
 * availability predicate genuinely lives in a Postgres constraint *and* in `listSchedule`'s
 * filters, and what holds I5 up is `availability.test.ts` asserting the two agree in both
 * directions.
 *
 * So this suite is not really about arithmetic. It is about what happens the day somebody adds
 * a minimum charge, a tax or a rounding rule to `priceWorkItem`: the correspondence fails, which
 * is exactly the event I4 was written to catch. **It must be repaired by teaching the aggregate
 * the new rule, never by relaxing the assertion.**
 *
 * Everything else here is a refusal. Grouping by service reports no cost. Two currencies produce
 * two rows and no conversion. A renamed catalogue item does not move last month's figures. Each
 * is a rule from D35 and each would be silently easy to lose.
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

  const typeId = await createWorkItemType(db, { organizationId, name: 'Job' });
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

  it('agrees with the one price calculation, line for line (I4, D35)', async () => {
    // **The load-bearing test.** The aggregate totals in SQL; `priceWorkItem` totals in
    // TypeScript. D35 permits both only while they answer identically on the same rows, which
    // is I5's mechanism applied to price. A failure here is not a broken test — it means a
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

  it('reports no cost and no margin when grouping by service, rather than zero (D35)', async () => {
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

  it('keeps a renamed catalogue item out of last month’s figures (I8)', async () => {
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

  it('counts an invoice into the month the business is in, not the server’s (I9)', async () => {
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

  it('totals each currency separately and converts nothing (I10)', async () => {
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
    // traded in when it was created and keeps it (I8). The old entry is the one the Pricing
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

  it('is narrowed by the caller’s own session, never by the id it was handed (D34)', async () => {
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

  it('refuses a member who does not hold report.read, in the database (I16)', async () => {
    // **A whole tenant of its own, because this demotes the only member it has.** The
    // capabilities left are plainly not nothing — this member can create work, price it and
    // invoice it, which means they can open every invoice this report adds up, one at a time.
    // What they cannot do is see them added up, and that is the distinction
    // `20260903000003` exists to make: a total is a disclosure that exists in no row.
    //
    // Asserted against the function rather than against the page, because hiding a page is a
    // courtesy and the refusal has to survive somebody calling the RPC directly (I12).
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

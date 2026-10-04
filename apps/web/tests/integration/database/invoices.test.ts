import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  getInvoiceForWorkItem,
  invoiceStanding,
  issueInvoice,
  recordPayment,
  totalPaid,
  type Payment,
} from '@/lib/domain/billing/invoices';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createPriceBookItem, updatePriceBookItem } from '@/lib/domain/pricing/price-book';
import { addPricedLine, priceWorkItem, removePricedLine } from '@/lib/domain/pricing/prices';
import { ALL_CAPABILITIES, CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { listMembers } from '@/lib/domain/tenancy/members';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { listCustomerTimeline } from '@/lib/domain/timeline/timeline';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Invoicing, and money arriving.
 *
 * The claims worth holding here are all about things the schema deliberately does *not* have.
 * An invoice has no total column, so re-pricing the catalogue or amending the quote must move
 * nothing on an issued document — which is I8 applied one level up from where the priced line
 * already applies it. An invoice has no `paid` flag, so settlement has to be arithmetic that
 * cannot disagree with the payments it was derived from. And a second invoice for one job is
 * refused by a unique index rather than by a check before the insert, for the reason I6 gives
 * about checking before writing.
 *
 * The last one is the point of the suite: every guarantee below is either a constraint or a
 * function, and none of them is a column that somebody has to remember to update.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

type Tenant = {
  db: SupabaseClient;
  userId: string;
  organizationId: string;
  statusId: string;
  calloutId: string;
  membershipId: string;
};

let alice: Tenant;
let bob: Tenant;

async function newTenant(label: string, currency = 'CAD'): Promise<Tenant> {
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

  const db = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: 'America/Toronto',
    currency: currency,
  });

  const organization = organizationId as string;
  const typeId = await createWorkItemType(db, { schedulable: true, organizationId: organization, name: 'Job' });
  const statusId = await createWorkItemStatus(db, {
    organizationId: organization,
    typeId,
    name: 'Open',
    position: 0,
  });
  const calloutId = await createPriceBookItem(db, {
    organizationId: organization,
    name: 'Callout',
    unit: 'visit',
    unitAmountMinor: 12_000,
  });

  const [membership] = await listMembers(db, { organizationId: organization });

  return {
    db,
    userId: created.user.id,
    organizationId: organization,
    statusId,
    calloutId,
    membershipId: membership.id,
  };
}

/** A job with one callout on it. Quoted, so it can be invoiced. */
async function quotedJob(tenant: Tenant, title: string, quantity = 1): Promise<string> {
  const id = await createWorkItem(tenant.db, {
    organizationId: tenant.organizationId,
    statusId: tenant.statusId,
    title,
  });
  await addPricedLine(tenant.db, {
    workItemId: id,
    priceBookItemId: tenant.calloutId,
    quantity,
  });
  return id;
}

describe('invoicing a job', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('inv-alice');
    bob = await newTenant('inv-bob');
  });

  it('refuses to invoice a job with nothing priced on it', async () => {
    // Not an invoice for zero, which is a decision somebody made. An invoice for nothing is a
    // document nobody meant to send.
    const bare = await createWorkItem(alice.db, {
      organizationId: alice.organizationId,
      statusId: alice.statusId,
      title: 'Never quoted',
    });

    await expect(issueInvoice(alice.db, { workItemId: bare })).rejects.toThrow(
      /nothing priced/i,
    );
  });

  it('copies the quote onto the invoice and totals it through the one calculation (I4)', async () => {
    const job = await quotedJob(alice, 'Winter changeover', 2);
    await issueInvoice(alice.db, { workItemId: job });

    const invoice = await getInvoiceForWorkItem(alice.db, {
      organizationId: alice.organizationId,
      workItemId: job,
    });

    expect(invoice).not.toBeNull();
    expect(invoice!.lines).toHaveLength(1);
    expect(invoice!.currency).toBe('CAD');

    const standing = invoiceStanding(invoice!);
    // 12000 × 2, and the same answer `priceWorkItem` gives the quote — because it *is*
    // `priceWorkItem`, called over the invoice's own lines. There is no second total.
    expect(standing.total).toEqual({ totalMinor: 24_000, currency: 'CAD' });
    expect(standing.total).toEqual(priceWorkItem(invoice!.lines));
  });

  it('does not move when the catalogue is re-priced, nor when the quote is amended (I8)', async () => {
    const job = await quotedJob(alice, 'Priced before the rise');
    await issueInvoice(alice.db, { workItemId: job });

    const read = async () => {
      const invoice = await getInvoiceForWorkItem(alice.db, {
        organizationId: alice.organizationId,
        workItemId: job,
      });
      return invoiceStanding(invoice!).total!.totalMinor;
    };

    expect(await read()).toBe(12_000);

    // The business puts its prices up. Nothing already quoted moves — that is the priced
    // line's snapshot, already proved in `prices.test.ts`.
    await updatePriceBookItem(alice.db, {
      id: alice.calloutId,
      name: 'Callout',
      unit: 'visit',
      unitAmountMinor: 99_999,
    });
    expect(await read()).toBe(12_000);

    // And the quote itself is amended *after* the invoice was issued, which is the case this
    // table exists for. An invoice joined to `work_item_priced_lines` would now read zero.
    const quote = await getInvoiceForWorkItem(alice.db, {
      organizationId: alice.organizationId,
      workItemId: job,
    });
    expect(quote).not.toBeNull();
    const { data: liveLines } = await alice.db
      .from('work_item_priced_lines')
      .select('id')
      .eq('work_item_id', job);
    for (const line of liveLines ?? []) {
      await removePricedLine(alice.db, { id: line.id });
    }

    expect(await read()).toBe(12_000);

    // Put the catalogue back, so later cases in this file price at the figure they expect.
    await updatePriceBookItem(alice.db, {
      id: alice.calloutId,
      name: 'Callout',
      unit: 'visit',
      unitAmountMinor: 12_000,
    });
  });

  it('holds no reference back to the quote at all', async () => {
    // Asserted from the catalogue rather than from behaviour, in the shape `prices.test.ts`
    // uses: a copy that is merely not currently joined becomes a join the first time a key
    // makes one look safe, and the first `join work_item_priced_lines` written for a
    // perfectly good reason would make every issued invoice track today's quote.
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      const { rows } = await client.query(
        `select conname, confrelid::regclass::text as target
           from pg_constraint
          where conrelid = 'public.invoice_lines'::regclass
            and contype = 'f'`,
      );
      const targets = rows.map((row) => row.target);
      expect(targets).not.toContain('work_item_priced_lines');
      expect(targets).not.toContain('price_book_items');
    } finally {
      await client.end();
    }
  });

  it('numbers invoices per business, so two tenants both have a number 1 (I2)', async () => {
    const mine = await quotedJob(alice, 'Numbering, mine');
    const theirs = await quotedJob(bob, 'Numbering, theirs');

    await issueInvoice(alice.db, { workItemId: mine });
    await issueInvoice(bob.db, { workItemId: theirs });

    const a = await getInvoiceForWorkItem(alice.db, {
      organizationId: alice.organizationId,
      workItemId: mine,
    });
    const b = await getInvoiceForWorkItem(bob.db, {
      organizationId: bob.organizationId,
      workItemId: theirs,
    });

    // Bob's first invoice is 1 even though Alice has issued several. A global sequence would
    // leak how many invoices the platform has issued to everyone who receives one.
    expect(b!.number).toBe(1);
    expect(a!.number).toBeGreaterThanOrEqual(1);
  });

  it('refuses a second invoice for the same job, in the database', async () => {
    const job = await quotedJob(alice, 'Only once');
    await issueInvoice(alice.db, { workItemId: job });

    await expect(issueInvoice(alice.db, { workItemId: job })).rejects.toThrow(
      /already been invoiced/i,
    );
  });

  it('is invisible to another tenant, whose id for it is no help', async () => {
    const job = await quotedJob(alice, 'Alice only');
    await issueInvoice(alice.db, { workItemId: job });

    const seen = await getInvoiceForWorkItem(bob.db, {
      organizationId: alice.organizationId,
      workItemId: job,
    });
    expect(seen).toBeNull();
  });

  it('writes the issue to the timeline', async () => {
    const customerId = await createCustomer(alice.db, {
      organizationId: alice.organizationId,
      name: 'Timeline Motors',
      email: `tl-${randomUUID().slice(0, 8)}@example.test`,
    });

    const job = await createWorkItem(alice.db, {
      organizationId: alice.organizationId,
      statusId: alice.statusId,
      title: 'Invoiced job',
      customerId,
    });
    await addPricedLine(alice.db, {
      workItemId: job,
      priceBookItemId: alice.calloutId,
      quantity: 1,
    });
    const invoiceId = await issueInvoice(alice.db, { workItemId: job });
    await recordPayment(alice.db, { invoiceId, amountMinor: 12_000, note: 'Cash' });

    const timeline = await listCustomerTimeline(alice.db, {
      organizationId: alice.organizationId,
      customerId,
    });
    const actions = timeline.map((entry) => entry.action);
    expect(actions).toContain('invoice.issued');
    expect(actions).toContain('payment.recorded');
  });

  it('bears the date it is issued for, which need not be today', async () => {
    // Billing in arrears: the work finished in August and the invoice belongs to August, even
    // though somebody raised it in September.
    const job = await quotedJob(alice, 'August work, September paperwork');
    const inAugust = '2026-08-31T16:00:00.000Z';

    await issueInvoice(alice.db, { workItemId: job, issuedAt: inAugust });

    const invoice = await getInvoiceForWorkItem(alice.db, {
      organizationId: alice.organizationId,
      workItemId: job,
    });

    expect(new Date(invoice!.issuedAt).toISOString()).toBe(inAugust);
  });

  it('is dated now when nothing says otherwise', async () => {
    const before = Date.now();
    const job = await quotedJob(alice, 'Raised as the work finished');

    await issueInvoice(alice.db, { workItemId: job });

    const invoice = await getInvoiceForWorkItem(alice.db, {
      organizationId: alice.organizationId,
      workItemId: job,
    });
    const at = new Date(invoice!.issuedAt).getTime();

    expect(at).toBeGreaterThan(before - 60_000);
    expect(at).toBeLessThan(Date.now() + 60_000);
  });

  it('numbers by the order invoices were raised, never by the dates on them', async () => {
    // The consequence of the field above, asserted rather than left to be discovered. A
    // business that back-dates out of order gets a number that does not follow its date —
    // which is the business's to notice, because numbering by date would mean renumbering
    // documents that have already been sent.
    const later = await quotedJob(alice, 'Raised first, dated last');
    const earlier = await quotedJob(alice, 'Raised second, dated first');

    await issueInvoice(alice.db, { workItemId: later, issuedAt: '2026-08-30T09:00:00.000Z' });
    await issueInvoice(alice.db, { workItemId: earlier, issuedAt: '2026-08-01T09:00:00.000Z' });

    const read = async (workItemId: string) =>
      (await getInvoiceForWorkItem(alice.db, {
        organizationId: alice.organizationId,
        workItemId,
      }))!;

    const first = await read(later);
    const second = await read(earlier);

    // The one raised first holds the lower number despite bearing the later date.
    expect(second.number).toBeGreaterThan(first.number);
    expect(new Date(second.issuedAt).getTime()).toBeLessThan(new Date(first.issuedAt).getTime());
  });
});

describe('money arriving', () => {
  it('settles by arithmetic, because there is no paid column to disagree with it', async () => {
    const job = await quotedJob(alice, 'Paid in two goes');
    const invoiceId = await issueInvoice(alice.db, { workItemId: job });

    const standing = async () => {
      const invoice = await getInvoiceForWorkItem(alice.db, {
        organizationId: alice.organizationId,
        workItemId: job,
      });
      return invoiceStanding(invoice!);
    };

    expect((await standing()).settled).toBe(false);
    expect((await standing()).outstandingMinor).toBe(12_000);

    await recordPayment(alice.db, { invoiceId, amountMinor: 5_000, note: 'Deposit' });
    const partial = await standing();
    expect(partial.paidMinor).toBe(5_000);
    expect(partial.outstandingMinor).toBe(7_000);
    expect(partial.settled).toBe(false);

    await recordPayment(alice.db, { invoiceId, amountMinor: 7_000, note: 'The rest' });
    const done = await standing();
    expect(done.outstandingMinor).toBe(0);
    expect(done.settled).toBe(true);
  });

  it('takes the invoice’s currency and never the caller’s', async () => {
    // `record_payment` reads the currency off the invoice. There is no argument for it, so a
    // caller cannot assert that a job priced in CAD was paid in something else — which would
    // need a rate, and a rate has a date (`vision.md`: not accounting software).
    const job = await quotedJob(alice, 'Currency is not an argument');
    const invoiceId = await issueInvoice(alice.db, { workItemId: job });
    await recordPayment(alice.db, { invoiceId, amountMinor: 100 });

    const invoice = await getInvoiceForWorkItem(alice.db, {
      organizationId: alice.organizationId,
      workItemId: job,
    });
    expect(invoice!.payments.every((payment) => payment.currency === 'CAD')).toBe(true);
  });

  it('records a payment nobody can edit, corrected only by its reverse', async () => {
    const job = await quotedJob(alice, 'Fat fingers');
    const invoiceId = await issueInvoice(alice.db, { workItemId: job });
    const paymentId = await recordPayment(alice.db, { invoiceId, amountMinor: 120_000 });

    // There is no update policy and no delete policy on `payments`. A wrong figure is undone
    // by writing its reverse, which is why `amount_minor` is signed and only zero is refused.
    const { error } = await alice.db
      .from('payments')
      .update({ amount_minor: 12_000 })
      .eq('id', paymentId);
    const { data: unchanged } = await alice.db
      .from('payments')
      .select('amount_minor')
      .eq('id', paymentId)
      .single();
    expect(error !== null || unchanged?.amount_minor === 120_000).toBe(true);

    await recordPayment(alice.db, { invoiceId, amountMinor: -108_000, note: 'Correction' });

    const invoice = await getInvoiceForWorkItem(alice.db, {
      organizationId: alice.organizationId,
      workItemId: job,
    });
    expect(invoiceStanding(invoice!).paidMinor).toBe(12_000);
    expect(invoiceStanding(invoice!).settled).toBe(true);
  });

  it('refuses a payment of nothing, and refuses a caller who may not record one', async () => {
    const job = await quotedJob(alice, 'Guarded');
    const invoiceId = await issueInvoice(alice.db, { workItemId: job });

    await expect(recordPayment(alice.db, { invoiceId, amountMinor: 0 })).rejects.toThrow(
      /payment of nothing/i,
    );

    // A role holding everything except the two new capabilities. The guard is the RLS policy
    // inside `record_payment`, not the absence of a button (I12).
    const roleId = await createRole(alice.db, {
      organizationId: alice.organizationId,
      name: 'Technician',
      capabilities: CAPABILITIES.filter(
        (capability) => capability !== 'payment.record' && capability !== 'invoice.issue',
      ),
    });
    await assignRole(alice.db, { membershipId: alice.membershipId, roleId });

    try {
      await expect(
        recordPayment(alice.db, { invoiceId, amountMinor: 1_000 }),
      ).rejects.toThrow();
      const other = await quotedJob(alice, 'Cannot invoice this');
      await expect(issueInvoice(alice.db, { workItemId: other })).rejects.toThrow();
    } finally {
      const restored = await createRole(alice.db, {
        organizationId: alice.organizationId,
        name: `Owner ${randomUUID().slice(0, 6)}`,
        capabilities: [...ALL_CAPABILITIES],
      });
      await assignRole(alice.db, { membershipId: alice.membershipId, roleId: restored });
    }
  });
});

describe('what has arrived, totalled', () => {
  function payment(over: Partial<Payment> = {}): Payment {
    return {
      id: 'p1',
      amountMinor: 5_000,
      currency: 'CAD',
      receivedAt: '2026-11-02T13:00:00.000Z',
      provider: null,
      note: null,
      ...over,
    };
  }

  it('is one function, for the same reason there is one price calculation', () => {
    // Pure, and asserted directly: a part payment, a refund and a processor fee all land here
    // when they land anywhere, and an inline `reduce` on a screen is a place that is forgotten.
    expect(totalPaid([])).toBe(0);
    expect(totalPaid([payment(), payment({ id: 'p2', amountMinor: 2_500 })])).toBe(7_500);
    expect(totalPaid([payment(), payment({ id: 'p2', amountMinor: -5_000 })])).toBe(0);
  });

  it('says nothing rather than zero when there is nothing to total', () => {
    // Unreachable through `issue_invoice`, which refuses an unquoted job — but if that
    // guarantee were ever dropped, an honest absence beats a confident zero.
    const standing = invoiceStanding({ lines: [], payments: [] });
    expect(standing.total).toBeNull();
    expect(standing.outstandingMinor).toBeNull();
    expect(standing.settled).toBe(false);
  });
});

describe('money arriving from a processor', () => {
  /** Ask for money, as the operator would. Returns the request id the processor is handed. */
  async function requestPayment(tenant: Tenant, invoiceId: string, amountMinor: number) {
    const id = randomUUID();
    const { error } = await tenant.db.from('payment_requests').insert({
      id,
      organization_id: tenant.organizationId,
      invoice_id: invoiceId,
      provider: 'stripe',
      provider_reference: `cs_test_${id.slice(0, 12)}`,
      amount_minor: amountMinor,
      currency: 'CAD',
      created_by: tenant.userId,
    });
    if (error) throw error;
    return id;
  }

  /**
   * Call the webhook's one function *as the webhook role*, which is the point of the test.
   *
   * `set role payment_webhook` first, so what is exercised is the grant rather than a
   * superuser's ability to call anything. If that grant were missing this throws 42501.
   */
  async function asWebhook(sql: string, params: unknown[]): Promise<unknown> {
    const client = new Client({ connectionString: CONNECTION });
    await client.connect();
    try {
      await client.query('set role payment_webhook');
      const { rows } = await client.query(sql, params);
      return rows[0];
    } finally {
      await client.end();
    }
  }

  it('derives the organization, invoice and currency from the request, not from its caller', async () => {
    const job = await quotedJob(alice, 'Paid by card');
    const invoiceId = await issueInvoice(alice.db, { workItemId: job });
    const requestId = await requestPayment(alice, invoiceId, 12_000);

    await asWebhook('select public.record_provider_payment($1, $2, $3, $4) as id', [
      requestId,
      'stripe',
      'cs_test_settled_1',
      12_000,
    ]);

    const invoice = await getInvoiceForWorkItem(alice.db, {
      organizationId: alice.organizationId,
      workItemId: job,
    });

    // The function was told a provider, a reference and an amount, and nothing else. Every
    // value that decides *where* this landed came from the request row.
    expect(invoice!.payments).toHaveLength(1);
    expect(invoice!.payments[0].provider).toBe('stripe');
    expect(invoice!.payments[0].currency).toBe('CAD');
    expect(invoiceStanding(invoice!).settled).toBe(true);
  });

  it('writes one row when the processor delivers the same event twice', async () => {
    const job = await quotedJob(alice, 'Delivered twice');
    const invoiceId = await issueInvoice(alice.db, { workItemId: job });
    const requestId = await requestPayment(alice, invoiceId, 12_000);

    const first = (await asWebhook(
      'select public.record_provider_payment($1, $2, $3, $4) as id',
      [requestId, 'stripe', 'cs_test_twice', 12_000],
    )) as { id: string };
    const second = (await asWebhook(
      'select public.record_provider_payment($1, $2, $3, $4) as id',
      [requestId, 'stripe', 'cs_test_twice', 12_000],
    )) as { id: string };

    // Idempotent by constraint rather than by a check before the insert, which would race
    // identically (I6) — and here the race costs a refund rather than a double booking.
    expect(second.id).toBe(first.id);

    const invoice = await getInvoiceForWorkItem(alice.db, {
      organizationId: alice.organizationId,
      workItemId: job,
    });
    expect(invoice!.payments).toHaveLength(1);
  });

  it('refuses a payment nobody asked for', async () => {
    // A verified event naming a request this platform has no record of. The handler turns this
    // into a 200 with nothing written, because retrying will not make the row appear.
    await expect(
      asWebhook('select public.record_provider_payment($1, $2, $3, $4) as id', [
        randomUUID(),
        'stripe',
        'cs_test_unknown',
        50_000,
      ]),
    ).rejects.toThrow(/no payment was requested/i);
  });

  it('attributes the write to the integration actor, so I11 keeps one shape', async () => {
    const job = await quotedJob(alice, 'Attributed to a machine');
    const invoiceId = await issueInvoice(alice.db, { workItemId: job });
    const requestId = await requestPayment(alice, invoiceId, 12_000);

    await asWebhook('select public.record_provider_payment($1, $2, $3, $4) as id', [
      requestId,
      'stripe',
      'cs_test_actor',
      12_000,
    ]);

    const { data } = await alice.db
      .from('payments')
      .select('created_by')
      .eq('provider_reference', 'cs_test_actor')
      .single();

    // A real `auth.users` row rather than a null actor or a sentinel outside the table. That
    // choice is D26's, and it is what let I11 stay a single claim.
    expect(data!.created_by).toBe('00000000-0000-4000-8000-0000000000a1');
  });
});

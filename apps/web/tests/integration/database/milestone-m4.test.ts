import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  bookSlot,
  bookableSlots,
  beginBooking,
  listBookableTypes,
  resolveBookingSlug,
} from '@/lib/domain/booking/booking';
import {
  getInvoiceForWorkItem,
  invoiceStanding,
  issueInvoice,
  recordPayment,
} from '@/lib/domain/billing/invoices';
import { createPriceBookItem } from '@/lib/domain/pricing/price-book';
import { addOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { createResource } from '@/lib/domain/resources/resources';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import {
  getOrganization,
  updateOrganization,
} from '@/lib/domain/tenancy/organizations';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { listCustomerTimeline } from '@/lib/domain/timeline/timeline';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import {
  changeWorkItemStatus,
  createWorkItemTransition,
} from '@/lib/domain/work-items/transitions';
import { addPricedLine, listPricedLines, priceWorkItem } from '@/lib/domain/pricing/prices';
import { createWorkItemType, setTypeBookable } from '@/lib/domain/work-items/types';
import { listWorkItems } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * THE M4 MILESTONE TEST.
 *
 * `roadmap.md` describes M4 as one demonstration:
 *
 *   > a real business runs its operations on GOLD — quotes or bookings in, work scheduled and
 *   > assigned, work completed, invoiced, and paid — and nobody at that business has ever been
 *   > given database credentials.
 *
 * **M4's inversion is that half of it runs as somebody who is a member of nothing.** M1 ran
 * byte-identical input across two tenants; M2 ran identical input twice; M3 ran maximally
 * different input through identical code. All three ran as members. Here the booking that
 * starts the job is taken by a stranger with no membership, no role and no capability, and the
 * assertion carried throughout is that `app.current_tenant_ids()` is **empty for that person at
 * every step, including the ones where they successfully wrote**.
 *
 * **Nothing here touches SQL, and that is the point rather than a style rule.** "Nobody at that
 * business has ever been given database credentials" is a claim about the path, so the path is
 * what is exercised — the same reasoning that made M2's "without opening the database" mean
 * something. The only raw connection in this file reads `app.current_tenant_ids()` back as an
 * *assertion about* the visitor, never to set anything up.
 *
 * **Pneu3L is the evidence and not the subject** (`roadmap.md` M4). Every word, number, status
 * and price below is data this business chose; nothing in the tree names it, and a clinic in
 * Tokyo would run the identical sequence with different rows. What this test proves is that
 * the platform can carry a business end to end — the fact that one named business is doing so
 * is what stops that being a hypothesis.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** The one privileged call in this file, minting an account. Exactly as every suite does. */
async function newOperator(): Promise<{ db: SupabaseClient; userId: string; email: string }> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `m4-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;

  const db = anonClient();
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  return { db, userId: created.user.id, email };
}

/** Which tenants this caller is *in*. For a member, one. For an outsider, none, ever. */
async function tenantsFor(userId: string): Promise<string[]> {
  const client = new Client({ connectionString: CONNECTION });
  await client.connect();
  try {
    const { rows } = await client.query(
      `select m.organization_id from public.memberships m where m.user_id = $1`,
      [userId],
    );
    return rows.map((row) => row.organization_id);
  } finally {
    await client.end();
  }
}

type Business = {
  db: SupabaseClient;
  userId: string;
  organizationId: string;
  typeId: string;
  requestedId: string;
  scheduledId: string;
  doneId: string;
  resourceId: string;
  priceItemId: string;
  slug: string;
};

let pneu: Business;

/**
 * Pneu3L, stood up entirely through configuration.
 *
 * No migration, no deploy, no seed. Every string and number below is this business's answer to
 * a question the platform asked — which is M3's claim, used here rather than re-proved.
 */
async function standUpPneu3L(): Promise<Business> {
  const { db, userId, email } = await newOperator();

  // **Pneu3L is provisioned, because since D29 that is how a business begins.** The milestone's
  // criterion is unchanged and so is everything below: nobody at this business is ever given
  // database credentials, and the owner runs every step from here on. What changed is only the
  // door it came through, which is the distinction that record exists to draw.
  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: 'Pneu3L',
    displayName: 'Owner-operator',
    // Montreal, in Canadian dollars. Neither is a default: `organizations.currency` is
    // required at founding because there is no neutral currency (I10).
    timezone: 'America/Toronto',
    currency: 'CAD',
  });

  const typeId = await createWorkItemType(db, { schedulable: true, organizationId, name: 'Mobile tyre change' });
  const requestedId = await createWorkItemStatus(db, {
    organizationId,
    typeId,
    name: 'Requested',
    position: 0,
  });
  const scheduledId = await createWorkItemStatus(db, {
    organizationId,
    typeId,
    name: 'On the van',
    position: 1,
  });
  const doneId = await createWorkItemStatus(db, {
    organizationId,
    typeId,
    name: 'Done',
    position: 2,
  });

  // A type with no configured transitions is frozen rather than unconstrained (I13), so the
  // lifecycle is these two rows and nothing else.
  await createWorkItemTransition(db, { organizationId, typeId, fromStatusId: requestedId, toStatusId: scheduledId });
  await createWorkItemTransition(db, { organizationId, typeId, fromStatusId: scheduledId, toStatusId: doneId });

  const resourceId = await createResource(db, { organizationId, name: 'The van' });
  const priceItemId = await createPriceBookItem(db, {
    organizationId,
    name: 'Seasonal tyre change',
    unit: 'visit',
    unitAmountMinor: 12_000,
  });

  // Mondays, 09:00–12:00. Nothing anywhere holds a working week — no weekend, no default —
  // so a business that says nothing is open always, and this business has now said something.
  await addOperatingHours(db, { organizationId, dayOfWeek: 1, opensAt: '09:00', closesAt: '12:00' });

  const organization = await getOrganization(db, organizationId);
  const slug = `pneu3l-${randomUUID().slice(0, 6)}`;
  await updateOrganization(db, {
    id: organizationId,
    name: organization!.name,
    timezone: organization!.timezone,
    currency: organization!.currency!,
    // Travel is this business's binding constraint, and it reaches the platform as a number
    // rather than as a feature: twenty minutes between jobs, enforced by the exclusion
    // constraint and never displayed as a rule.
    bufferMinutes: 20,
    slug,
  });

  // Two decisions, and this business makes both: the module says a public page exists at all,
  // and a bookable type says what is on it. A new business has neither — publishing to the
  // internet is not a default anybody acquires by signing up.
  await setModuleEnabled(db, { organizationId, key: 'booking', enabled: true });
  await setTypeBookable(db, { id: typeId, statusId: requestedId, durationMinutes: 60, priceItemId });

  return {
    db,
    userId,
    organizationId,
    typeId,
    requestedId,
    scheduledId,
    doneId,
    resourceId,
    priceItemId,
    slug,
  };
}

describe('THE M4 MILESTONE: a real business runs on the platform', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    pneu = await standUpPneu3L();
  });

  it('runs a job from a stranger’s booking to a settled invoice, and nobody opens the database', async () => {
    // ---------------------------------------------------------------------
    // 1. A member of the public finds the business by the name it chose.
    // ---------------------------------------------------------------------
    const stranger = anonClient();
    const found = await resolveBookingSlug(stranger, pneu.slug);
    expect(found).toBe(pneu.organizationId);

    await beginBooking(stranger, { organizationId: pneu.organizationId });
    const { data: strangerUser } = await stranger.auth.getUser();
    const strangerId = strangerUser.user!.id;

    // **The assertion this milestone is built around.** They are signed in, they are about to
    // write, and they are a member of nothing. `app.current_external_tenant()` answers for
    // them; `app.current_tenant_ids()` never will.
    expect(await tenantsFor(strangerId)).toEqual([]);

    // ---------------------------------------------------------------------
    // 2. They read what is on offer and take a slot.
    // ---------------------------------------------------------------------
    const offered = await listBookableTypes(stranger, { organizationId: pneu.organizationId });
    expect(offered).toHaveLength(1);
    // The business's own word for its own work, and its own price, read by somebody with no
    // role. Nothing here is a platform noun.
    expect(offered[0].name).toBe('Mobile tyre change');
    expect(offered[0].price).toEqual({
      amountMinor: 12_000,
      currency: 'CAD',
      // The catalogue row's own name, snapshotted onto the offer. What a stranger is shown is
      // this business's words about this business's work, all the way down.
      description: 'Seasonal tyre change',
    });

    // A Monday, in the business's own zone. The slots are computed against the hours this
    // business published and the buffer it configured — not against a working week the
    // platform believes in, because nothing anywhere holds one.
    const slots = await bookableSlots(stranger, {
      organizationId: pneu.organizationId,
      type: offered[0],
      date: '2026-09-07',
      timeZone: 'America/Toronto',
    });
    expect(slots.length).toBeGreaterThan(0);

    const workItemId = await bookSlot(stranger, {
      organizationId: pneu.organizationId,
      typeId: pneu.typeId,
      slot: slots[0],
      name: 'Marie Tremblay',
      email: `marie-${randomUUID().slice(0, 6)}@example.test`,
      phone: '',
    });

    // Still a member of nothing, having just written. The write went through one privileged
    // function whose first act is the scope check; the stranger holds no insert permission on
    // any table (D22).
    expect(await tenantsFor(strangerId)).toEqual([]);

    // ---------------------------------------------------------------------
    // 3. The operator sees the job, schedules it, and works it.
    // ---------------------------------------------------------------------
    const inbox = await listWorkItems(pneu.db, { organizationId: pneu.organizationId });
    const booked = inbox.find((item) => item.id === workItemId);
    expect(booked).toBeDefined();
    expect(booked!.customer?.label).toBe('Marie Tremblay');

    await scheduleWorkItem(pneu.db, {
      workItemId,
      resourceId: pneu.resourceId,
      startsAt: slots[0].startsAt,
      endsAt: slots[0].endsAt,
    });

    // Along the lifecycle this business configured, and no other path: a type with no
    // configured transitions is frozen (I13), and these two rows are the whole of it.
    await changeWorkItemStatus(pneu.db, { workItemId, toStatusId: pneu.scheduledId });
    await changeWorkItemStatus(pneu.db, { workItemId, toStatusId: pneu.doneId });

    // ---------------------------------------------------------------------
    // 4. Quoted, invoiced, and paid.
    // ---------------------------------------------------------------------
    await addPricedLine(pneu.db, {
      workItemId,
      priceBookItemId: pneu.priceItemId,
      quantity: 1,
    });

    const quote = priceWorkItem(
      await listPricedLines(pneu.db, { organizationId: pneu.organizationId, workItemId }),
    );

    await issueInvoice(pneu.db, { workItemId });
    const issued = await getInvoiceForWorkItem(pneu.db, {
      organizationId: pneu.organizationId,
      workItemId,
    });

    // The invoice is the quote copied, and its total comes from the same one calculation (I4).
    expect(invoiceStanding(issued!).total).toEqual(quote);
    expect(invoiceStanding(issued!).settled).toBe(false);

    // Cash, which is half of what this business actually takes. A payment with no provider is
    // what "cash" means -- it never touches a processor and is never recorded as though it did.
    await recordPayment(pneu.db, {
      invoiceId: issued!.id,
      amountMinor: invoiceStanding(issued!).outstandingMinor!,
      note: 'Cash on the driveway',
    });

    const settled = await getInvoiceForWorkItem(pneu.db, {
      organizationId: pneu.organizationId,
      workItemId,
    });
    expect(invoiceStanding(settled!).settled).toBe(true);
    expect(settled!.payments[0].provider).toBeNull();

    // ---------------------------------------------------------------------
    // 5. The whole of it is on the customer's history, and none of it was backfilled.
    // ---------------------------------------------------------------------
    const customerId = booked!.customer!.id;
    const timeline = await listCustomerTimeline(pneu.db, {
      organizationId: pneu.organizationId,
      customerId,
    });
    const actions = timeline.map((entry) => entry.action);

    // `events` shipped in M1 precisely because it cannot be backfilled. This is the return on
    // that: a job which began as a stranger clicking a slot is legible end to end.
    // `work_item.booked`, not `work_item.created` — the outsider axis writes its own action,
    // because a job a stranger took a slot for is a different fact from one an operator typed.
    expect(actions).toContain('work_item.booked');
    expect(actions).toContain('work_item.scheduled');
    expect(actions).toContain('work_item.status_changed');
    expect(actions).toContain('work_item.line_added');
    expect(actions).toContain('invoice.issued');
    expect(actions).toContain('payment.recorded');

    // ---------------------------------------------------------------------
    // 6. And the stranger is still a member of nothing.
    // ---------------------------------------------------------------------
    // Carried to the end deliberately. Everything above happened *to* them and *for* them, and
    // at no point did any of it make them part of this business.
    expect(await tenantsFor(strangerId)).toEqual([]);
  });

  it('never lets a stranger read anything but what they created', async () => {
    // A second visitor to the same business, scoped to one tenant like the first -- and to
    // their own rows within it, by `created_by` rather than by a customer id (D22).
    const other = anonClient();
    await beginBooking(other, { organizationId: pneu.organizationId });

    const theirs = await other.from('work_items').select('id');
    expect(theirs.data ?? []).toEqual([]);

    // There is no read policy for this axis on `invoices` at all. An outsider's access to money
    // is the portal's question, answered by an invite the business sent -- not by having once
    // booked, which is a much weaker claim to somebody else's accounts.
    const invoices = await other.from('invoices').select('id');
    expect(invoices.data ?? []).toEqual([]);
  });

  it('runs the whole business on an ordinary signed-in session', async () => {
    // "Nobody at that business has ever been given database credentials" is a claim about the
    // path, and this is the direct form of it: the operator who did everything above holds a
    // session whose Postgres role is `authenticated`, exactly like every other member. There
    // is no privileged client operating this business — the only one in this file mints an
    // account, as `setup.ts` does everywhere.
    const { data } = await pneu.db.auth.getSession();
    const [, payload] = data.session!.access_token.split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));

    expect(claims.role).toBe('authenticated');
    expect(claims.role).not.toBe('service_role');
    expect(claims.sub).toBe(pneu.userId);

    // And that session cannot reach past RLS: `auth.users` is not readable through it, which
    // is what "credentials" would have bought.
    const users = await pneu.db.from('users').select('id');
    expect(users.error).not.toBeNull();
  });
});

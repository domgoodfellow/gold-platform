import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createPriceBookItem,
  listPriceBookItems,
  updatePriceBookItem,
} from '@/lib/domain/pricing/price-book';
import {
  addPricedLine,
  listPricedLines,
  priceWorkItem,
  removePricedLine,
} from '@/lib/domain/pricing/prices';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { updateOrganization } from '@/lib/domain/tenancy/organizations';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';

/**
 * I4: there is exactly one price calculation.
 *
 * The invariant is not "the arithmetic is correct" — it is that there is one place doing it.
 * A total is trivial, which is exactly why a second one gets written: `lines.reduce(…)` in a
 * component reads as formatting rather than as pricing. So the tests below assert the two
 * properties that make a single calculation *observable* rather than merely intended:
 *
 *   * A quoted job holds copies, so re-pricing the catalogue moves nothing already quoted
 *     (I8). If a total were derived by joining back to `price_book_items`, this fails.
 *   * A job is never quoted in two currencies, so the total is always a number in a named
 *     currency. That is a database constraint, not a check before the insert, for the reason
 *     I6 gives.
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
};

let alice: Tenant;
let bob: Tenant;

async function newTenant(label: string, currency = 'EUR'): Promise<Tenant> {
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

  const { data: organizationId, error } = await db.rpc('create_organization', {
    p_name: `${label} Ltd`,
    p_role: 'Owner',
    p_capabilities: ALL_CAPABILITIES,
    p_display_name: 'Founder',
    p_timezone: 'UTC',
    p_currency: currency,
  });
  if (error) throw error;

  const organization = organizationId as string;
  const typeId = await createWorkItemType(db, { organizationId: organization, name: 'Job' });
  const statusId = await createWorkItemStatus(db, {
    organizationId: organization,
    typeId,
    name: 'Open',
    position: 0,
  });

  return { db, userId: created.user.id, organizationId: organization, statusId };
}

async function newJob(tenant: Tenant, title: string): Promise<string> {
  return createWorkItem(tenant.db, {
    organizationId: tenant.organizationId,
    statusId: tenant.statusId,
    title,
  });
}

describe('pricing a work item', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('pr-alice');
    bob = await newTenant('pr-bob');
  });

  it('has no price at all until something is quoted', () => {
    // Null, not zero. A job with no lines has not been quoted; a job quoted at nothing is a
    // decision somebody made, and rendering them the same erases the difference.
    expect(priceWorkItem([])).toBeNull();
  });

  it('totals the lines on a job, in one place', async () => {
    const callout = await createPriceBookItem(alice.db, {
      organizationId: alice.organizationId,
      name: 'Callout',
      unit: 'visit',
      unitAmountMinor: 4250,
    });
    const labour = await createPriceBookItem(alice.db, {
      organizationId: alice.organizationId,
      name: 'Labour',
      unit: 'hour',
      unitAmountMinor: 6000,
    });

    const job = await newJob(alice, 'Quoted job');
    await addPricedLine(alice.db, {
      workItemId: job,
      priceBookItemId: callout,
      quantity: 1,
    });
    await addPricedLine(alice.db, { workItemId: job, priceBookItemId: labour, quantity: 3 });

    const lines = await listPricedLines(alice.db, {
      organizationId: alice.organizationId,
      workItemId: job,
    });
    const price = priceWorkItem(lines);

    // 4250 + 6000*3. Integer arithmetic end to end; nothing rounds because nothing divides.
    expect(price).toEqual({ totalMinor: 22250, currency: 'EUR' });
  });

  it('copies the catalogue onto the line rather than joining to it (I8)', async () => {
    const job = await newJob(alice, 'Quoted before the rise');
    const items = await listPriceBookItems(alice.db, { organizationId: alice.organizationId });
    const callout = items.find((item) => item.name === 'Callout')!;

    await addPricedLine(alice.db, {
      workItemId: job,
      priceBookItemId: callout.id,
      quantity: 2,
    });

    const before = priceWorkItem(
      await listPricedLines(alice.db, { organizationId: alice.organizationId, workItemId: job }),
    );
    expect(before!.totalMinor).toBe(8500);

    // The business puts its prices up. This is the whole reason the line is a copy.
    await updatePriceBookItem(alice.db, {
      id: callout.id,
      name: 'Callout',
      unit: 'visit',
      unitAmountMinor: 9999,
    });

    const after = priceWorkItem(
      await listPricedLines(alice.db, { organizationId: alice.organizationId, workItemId: job }),
    );

    // Unmoved. A join back to price_book_items — even one added later for a good reason —
    // makes this 19998 and rewrites every historical quote in the database.
    expect(after!.totalMinor).toBe(8500);

    // And the next job quoted gets the new price, which is the other half of the claim.
    const next = await newJob(alice, 'Quoted after the rise');
    await addPricedLine(alice.db, {
      workItemId: next,
      priceBookItemId: callout.id,
      quantity: 1,
    });
    const nextPrice = priceWorkItem(
      await listPricedLines(alice.db, { organizationId: alice.organizationId, workItemId: next }),
    );
    expect(nextPrice!.totalMinor).toBe(9999);
  });

  it('holds no reference back to the catalogue at all', async () => {
    // The structural form of the test above, and the one that survives somebody optimising
    // the read path later. A copy that is merely *not currently joined* becomes a join the
    // first time a foreign key makes it look safe — so the assertion is that no such key
    // exists, not that nothing currently follows one.
    const catalog = new Client({ connectionString: CONNECTION });
    await catalog.connect();
    try {
      const { rows } = await catalog.query<{ conname: string }>(
        `select con.conname
           from pg_constraint con
           join pg_class child  on child.oid  = con.conrelid
           join pg_class parent on parent.oid = con.confrelid
          where con.contype = 'f'
            and child.relname  = 'work_item_priced_lines'
            and parent.relname = 'price_book_items'`,
      );
      expect(rows).toHaveLength(0);
    } finally {
      await catalog.end();
    }
  });

  it('refuses a second currency on one job, in the database (I4)', async () => {
    // A business changes what it trades in. Its catalogue now holds both, because amounts are
    // never converted — see the price book migration.
    await updateOrganization(alice.db, {
      id: alice.organizationId,
      name: 'pr-alice Ltd',
      timezone: 'UTC',
      currency: 'USD',
    });
    const inDollars = await createPriceBookItem(alice.db, {
      organizationId: alice.organizationId,
      name: 'Callout, repriced',
      unit: 'visit',
      unitAmountMinor: 5000,
    });

    const job = await newJob(alice, 'Two currencies');
    const items = await listPriceBookItems(alice.db, { organizationId: alice.organizationId });
    const inEuro = items.find((item) => item.name === 'Labour')!;

    await addPricedLine(alice.db, { workItemId: job, priceBookItemId: inEuro.id, quantity: 1 });

    // work_item_priced_lines_one_currency, a gist exclusion using `currency with <>`. Not a
    // check before the insert, which would race identically (I6's reasoning).
    await expect(
      addPricedLine(alice.db, { workItemId: job, priceBookItemId: inDollars, quantity: 1 }),
    ).rejects.toMatchObject({ code: 'prices.mixed_currency' });

    // And as a raw insert, which never passes through the domain layer at all.
    const { error } = await alice.db.from('work_item_priced_lines').insert({
      organization_id: alice.organizationId,
      work_item_id: job,
      description: 'Smuggled',
      unit: 'visit',
      unit_amount_minor: 5000,
      currency: 'USD',
      quantity: 1,
      created_by: alice.userId,
    });
    expect(error?.code).toBe('23P01');
  });

  it('lets each job hold its own currency, so the constraint is not global', async () => {
    // The exclusion is scoped to one work item. Alice trades in USD now, and a *new* job
    // priced entirely in USD is perfectly ordinary.
    const job = await newJob(alice, 'All dollars');
    const items = await listPriceBookItems(alice.db, { organizationId: alice.organizationId });
    const inDollars = items.find((item) => item.name === 'Callout, repriced')!;

    await addPricedLine(alice.db, {
      workItemId: job,
      priceBookItemId: inDollars.id,
      quantity: 2,
    });

    const price = priceWorkItem(
      await listPricedLines(alice.db, { organizationId: alice.organizationId, workItemId: job }),
    );
    expect(price).toEqual({ totalMinor: 10000, currency: 'USD' });
  });

  it('cannot quote from another tenant’s catalogue (I18)', async () => {
    const theirs = await createPriceBookItem(bob.db, {
      organizationId: bob.organizationId,
      name: 'Their callout',
      unit: 'visit',
      unitAmountMinor: 100,
    });

    const job = await newJob(alice, 'Borrowed price');

    // Not a leak that RLS would catch on the row being written — the line's own
    // organization_id is genuinely Alice's. The RPC requires the catalogue item to belong to
    // the same organization as the job, and reads it under RLS besides.
    await expect(
      addPricedLine(alice.db, { workItemId: job, priceBookItemId: theirs, quantity: 1 }),
    ).rejects.toMatchObject({ code: 'prices.unknown_item' });
  });

  it('removes a line rather than amending it', async () => {
    const job = await newJob(alice, 'Struck out');
    const items = await listPriceBookItems(alice.db, { organizationId: alice.organizationId });
    const item = items.find((i) => i.name === 'Callout, repriced')!;

    const line = await addPricedLine(alice.db, {
      workItemId: job,
      priceBookItemId: item.id,
      quantity: 4,
    });

    // No update policy exists on the table, so this is refused for want of anything
    // permitting it — an amount on a line is a snapshot, and an editable snapshot is not one.
    const { error } = await alice.db
      .from('work_item_priced_lines')
      .update({ quantity: 1 })
      .eq('id', line);
    expect(error).not.toBeNull();

    await removePricedLine(alice.db, { id: line });

    const after = await listPricedLines(alice.db, {
      organizationId: alice.organizationId,
      workItemId: job,
    });
    expect(after).toHaveLength(0);
  });

  it('refuses a quantity that is not a whole number of at least one', async () => {
    const job = await newJob(alice, 'Bad quantity');
    const items = await listPriceBookItems(alice.db, { organizationId: alice.organizationId });
    const item = items.find((i) => i.name === 'Callout, repriced')!;

    for (const quantity of [0, -1, 1.5]) {
      await expect(
        addPricedLine(alice.db, {
          workItemId: job,
          priceBookItemId: item.id,
          quantity,
        }),
      ).rejects.toMatchObject({ code: 'prices.quantity_invalid' });
    }

    // And directly, because the domain layer is not the guarantee.
    const { error } = await alice.db.from('work_item_priced_lines').insert({
      organization_id: alice.organizationId,
      work_item_id: job,
      description: 'Zero',
      unit: 'visit',
      unit_amount_minor: 100,
      currency: 'USD',
      quantity: 0,
      created_by: alice.userId,
    });
    expect(error?.code).toBe('23514');
  });

  it('refuses pricing work to a member without the capability (I12)', async () => {
    const job = await newJob(bob, 'Not theirs to price');
    const item = (await listPriceBookItems(bob.db, { organizationId: bob.organizationId }))[0];

    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'No Quoting',
      capabilities: ['role.manage', 'work_item.create'],
    });
    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();
    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    await expect(
      addPricedLine(bob.db, { workItemId: job, priceBookItemId: item.id, quantity: 1 }),
    ).rejects.toMatchObject({ code: 'prices.forbidden' });
  });

  it('records each quoted line on the timeline (I11)', async () => {
    const { data, error } = await alice.db
      .from('events')
      .select('action, actor_id')
      .eq('organization_id', alice.organizationId)
      .in('action', ['work_item.line_added', 'work_item.line_removed']);

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((row) => row.actor_id === alice.userId)).toBe(true);
    expect(data!.map((row) => row.action)).toContain('work_item.line_removed');
  });
});

import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createResource } from '@/lib/domain/resources/resources';
import { scheduleWorkItem, unscheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { formatWindow, overlaps, parseWindow } from '@/lib/domain/scheduling/window';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem, listWorkItems } from '@/lib/domain/work-items/work-items';
import { asPlatformStaff, foundBusiness, newAccountEmail } from '@/tests/support/founding';

/**
 * I7 — two work items can never occupy the same resource and window.
 *
 * `roadmap.md` will not accept this in any other form: "`I7` is a database exclusion
 * constraint. An application-level overlap check is not this milestone." So every assertion
 * here goes through the database, and the negative cases are checked for `23P01`
 * specifically — the constraint firing — rather than for "some error", which a domain check
 * would also produce.
 *
 * The shape of the constraint is the answer to a failure constraints.md quotes by name:
 *
 *   > `tire-app-template` has an exclusion constraint that coalesces a null technician to
 *   > the zero UUID, so every unassigned booking in the database shares one exclusion key.
 *   > Add a second tenant and their unassigned 9am job blocks yours.
 *
 * Three tests below are that failure, inverted: unassigned work does not block unassigned
 * work, untimed work does not block anything, and the other tenant's identical booking on an
 * identically named resource succeeds. The last is I7 and I2 together and is the one that
 * would have failed in the repository the quotation comes from.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** Deliberately the same instants in both tenants. */
const TUESDAY_09 = '2026-09-01T09:00:00.000Z';
const TUESDAY_10 = '2026-09-01T10:00:00.000Z';
const TUESDAY_11 = '2026-09-01T11:00:00.000Z';
const TUESDAY_0930 = '2026-09-01T09:30:00.000Z';

type Tenant = {
  db: SupabaseClient;
  userId: string;
  organizationId: string;
  typeId: string;
  statusId: string;
  resourceId: string;
};

let alice: Tenant;
let bob: Tenant;

async function newTenant(label: string, timezone: string): Promise<Tenant> {
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
    timezone: timezone,
    currency: 'EUR',
  });

  const orgId = organizationId as string;
  const typeId = await createWorkItemType(db, { schedulable: true, organizationId: orgId, name: 'Callout' });

  return {
    db,
    userId: created.user.id,
    organizationId: orgId,
    typeId,
    statusId: await createWorkItemStatus(db, { organizationId: orgId, typeId, name: 'Open' }),
    // The same name in both tenants, so the cross-tenant test below is not passing because
    // the resources happen to be distinguishable.
    resourceId: await createResource(db, { organizationId: orgId, name: 'Sam Okafor' }),
  };
}

async function newWorkItem(tenant: Tenant, title: string): Promise<string> {
  return createWorkItem(tenant.db, {
    organizationId: tenant.organizationId,
    title,
    statusId: tenant.statusId,
  });
}

describe('scheduling', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    // Two businesses on two clocks, which is what makes I9 observable at all.
    alice = await newTenant('sc-alice', 'Europe/Amsterdam');
    bob = await newTenant('sc-bob', 'America/New_York');
  });

  it('commits a work item to a resource and a window', async () => {
    const workItemId = await newWorkItem(alice, 'Morning callout');
    await scheduleWorkItem(alice.db, {
      workItemId,
      resourceId: alice.resourceId,
      startsAt: TUESDAY_09,
      endsAt: TUESDAY_10,
    });

    const items = await listWorkItems(alice.db, { organizationId: alice.organizationId });
    const scheduled = items.find((i) => i.id === workItemId);
    expect(scheduled?.window).toEqual({ startsAt: TUESDAY_09, endsAt: TUESDAY_10 });
    expect(scheduled?.resource?.label).toBe('Sam Okafor');
  });

  it('refuses an overlapping booking on the same resource (I7)', async () => {
    const workItemId = await newWorkItem(alice, 'Overlaps the morning');

    await expect(
      scheduleWorkItem(alice.db, {
        workItemId,
        resourceId: alice.resourceId,
        startsAt: TUESDAY_0930,
        endsAt: TUESDAY_11,
      }),
    ).rejects.toMatchObject({ code: 'scheduling.double_booked' });
  });

  it('refuses the overlap as a raw update too, with 23P01', async () => {
    // The constraint, not the domain. A caller that never touches scheduleWorkItem gets the
    // same answer, which is the whole reason I7 must be a database constraint.
    const workItemId = await newWorkItem(alice, 'Overlaps, written directly');

    const { error } = await alice.db
      .from('work_items')
      .update({
        resource_id: alice.resourceId,
        scheduled_during: `["${TUESDAY_0930}","${TUESDAY_11}")`,
      })
      .eq('id', workItemId);

    expect(error?.code).toBe('23P01');
  });

  it('allows back-to-back work, because the window is half-open', async () => {
    // 09:00–10:00 and 10:00–11:00 do not overlap. Written as two inclusive timestamps and
    // compared in application code, this is the off-by-one nobody finds until a technician
    // is double-booked at a shift boundary.
    const workItemId = await newWorkItem(alice, 'Straight after');
    await scheduleWorkItem(alice.db, {
      workItemId,
      resourceId: alice.resourceId,
      startsAt: TUESDAY_10,
      endsAt: TUESDAY_11,
    });

    const items = await listWorkItems(alice.db, { organizationId: alice.organizationId });
    expect(items.find((i) => i.id === workItemId)?.window?.startsAt).toBe(TUESDAY_10);
  });

  it('lets the other tenant book the identical window on an identically named resource (I7, I2)', async () => {
    // The exact failure constraints.md quotes. If organization_id did not lead the exclusion
    // constraint, Alice's 9am would block Bob's.
    const workItemId = await newWorkItem(bob, 'Morning callout');
    await scheduleWorkItem(bob.db, {
      workItemId,
      resourceId: bob.resourceId,
      startsAt: TUESDAY_09,
      endsAt: TUESDAY_10,
    });

    const items = await listWorkItems(bob.db, { organizationId: bob.organizationId });
    expect(items.find((i) => i.id === workItemId)?.window?.startsAt).toBe(TUESDAY_09);
  });

  it('does not let unassigned work block unassigned work', async () => {
    // The other half of the quoted failure: with a coalesced null resource, every unassigned
    // job in the database would share one exclusion key. The constraint is partial instead,
    // so these rows never enter the index.
    const first = await newWorkItem(alice, 'Tuesday, nobody assigned');
    const second = await newWorkItem(alice, 'Tuesday, also nobody assigned');

    await scheduleWorkItem(alice.db, {
      workItemId: first,
      resourceId: null,
      startsAt: TUESDAY_09,
      endsAt: TUESDAY_10,
    });
    await scheduleWorkItem(alice.db, {
      workItemId: second,
      resourceId: null,
      startsAt: TUESDAY_09,
      endsAt: TUESDAY_10,
    });

    const items = await listWorkItems(alice.db, { organizationId: alice.organizationId });
    expect(items.find((i) => i.id === first)?.window?.startsAt).toBe(TUESDAY_09);
    expect(items.find((i) => i.id === second)?.window?.startsAt).toBe(TUESDAY_09);
  });

  it('keeps one tenant unassigned booking from blocking another tenant', async () => {
    // This is the sharpest form of the quoted failure, and the one the leading
    // organization_id genuinely buys. With a NON-null resource_id the tenant column is
    // redundant for correctness — a resource uuid belongs to exactly one organization, so
    // two tenants can never share an exclusion key. Coalesce a null resource to a fixed uuid
    // and that stops being true: every unassigned scheduled row in the database collapses
    // onto one key, and the constraint starts refusing across the tenant wall.
    //
    // The constraint here is partial instead, so these rows are not in the index at all —
    // and organization_id leads it, so even a future non-partial form could not do this.
    const mine = await newWorkItem(alice, 'Wednesday, nobody assigned');
    const theirs = await newWorkItem(bob, 'Wednesday, nobody assigned');

    for (const [tenant, workItemId] of [
      [alice, mine],
      [bob, theirs],
    ] as const) {
      await scheduleWorkItem(tenant.db, {
        workItemId,
        resourceId: null,
        startsAt: '2026-09-09T09:00:00.000Z',
        endsAt: '2026-09-09T10:00:00.000Z',
      });
    }

    const ours = await listWorkItems(alice.db, { organizationId: alice.organizationId });
    const bobs = await listWorkItems(bob.db, { organizationId: bob.organizationId });
    expect(ours.find((i) => i.id === mine)?.window?.startsAt).toBe('2026-09-09T09:00:00.000Z');
    expect(bobs.find((i) => i.id === theirs)?.window?.startsAt).toBe('2026-09-09T09:00:00.000Z');
  });

  it('does not let an assigned but untimed work item block anything', async () => {
    // A work item can name a resource with no window at all — created that way, in fact —
    // and holds nothing.
    const untimed = await createWorkItem(alice.db, {
      organizationId: alice.organizationId,
      title: 'Assigned, not yet timed',
      statusId: alice.statusId,
      resourceId: alice.resourceId,
    });

    const items = await listWorkItems(alice.db, { organizationId: alice.organizationId });
    expect(items.find((i) => i.id === untimed)?.window).toBeNull();
  });

  it('frees the window when a work item is unscheduled', async () => {
    const workItemId = await newWorkItem(alice, 'Booked then dropped');
    await scheduleWorkItem(alice.db, {
      workItemId,
      resourceId: alice.resourceId,
      startsAt: '2026-09-02T09:00:00.000Z',
      endsAt: '2026-09-02T10:00:00.000Z',
    });

    await unscheduleWorkItem(alice.db, { workItemId });

    // And the slot is genuinely free again, not merely blank on screen.
    const successor = await newWorkItem(alice, 'Takes the freed slot');
    await scheduleWorkItem(alice.db, {
      workItemId: successor,
      resourceId: alice.resourceId,
      startsAt: '2026-09-02T09:00:00.000Z',
      endsAt: '2026-09-02T10:00:00.000Z',
    });

    const items = await listWorkItems(alice.db, { organizationId: alice.organizationId });
    expect(items.find((i) => i.id === workItemId)?.window).toBeNull();
    expect(items.find((i) => i.id === successor)?.window?.startsAt).toBe(
      '2026-09-02T09:00:00.000Z',
    );
  });

  it('refuses a window that ends before it starts', async () => {
    const workItemId = await newWorkItem(alice, 'Backwards');

    await expect(
      scheduleWorkItem(alice.db, {
        workItemId,
        resourceId: alice.resourceId,
        startsAt: TUESDAY_10,
        endsAt: TUESDAY_09,
      }),
    ).rejects.toMatchObject({ code: 'scheduling.window_backwards' });
  });

  it('refuses an unbounded or inclusive window written directly', async () => {
    const workItemId = await newWorkItem(alice, 'Forever');

    // An unbounded range would hold a resource for all time. The check constraint, not the
    // domain, is what refuses it.
    const unbounded = await alice.db
      .from('work_items')
      .update({ scheduled_during: `["${TUESDAY_09}",)` })
      .eq('id', workItemId);
    expect(unbounded.error?.code).toBe('23514');

    // And an inclusive upper bound, which would make back-to-back work collide at the shared
    // instant.
    const inclusive = await alice.db
      .from('work_items')
      .update({ scheduled_during: `["${TUESDAY_09}","${TUESDAY_10}"]` })
      .eq('id', workItemId);
    expect(inclusive.error?.code).toBe('23514');
  });

  it('cannot schedule against another tenant\'s resource (I18)', async () => {
    const workItemId = await newWorkItem(alice, 'Borrowed technician');

    await expect(
      scheduleWorkItem(alice.db, {
        workItemId,
        resourceId: bob.resourceId,
        startsAt: '2026-09-03T09:00:00.000Z',
        endsAt: '2026-09-03T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'scheduling.resource_not_found' });
  });

  it('stores an absolute instant and renders it in each tenant\'s zone (I9)', async () => {
    // One instant, two businesses, two clocks. 09:00Z is 11:00 in Amsterdam and 05:00 in New
    // York, and neither reading is the server's.
    const window = { startsAt: TUESDAY_09, endsAt: TUESDAY_10 };

    expect(formatWindow(window, 'Europe/Amsterdam')).toContain('11:00');
    expect(formatWindow(window, 'America/New_York')).toContain('05:00');

    // And the zone each tenant chose at founding is what a page would use.
    const { data: aliceOrg } = await alice.db
      .from('organizations')
      .select('timezone')
      .eq('id', alice.organizationId)
      .single();
    const { data: bobOrg } = await bob.db
      .from('organizations')
      .select('timezone')
      .eq('id', bob.organizationId)
      .single();

    expect(aliceOrg!.timezone).toBe('Europe/Amsterdam');
    expect(bobOrg!.timezone).toBe('America/New_York');
  });

  it('refuses a timezone Postgres does not recognise', async () => {
    // Asked of the provisioning door — the only one with a grant since D29 (see
    // `consumption.test.ts` for the same move). The check being exercised is on
    // `organizations`, so it fires whichever door writes the row.
    const { error } = await (await asPlatformStaff()).rpc('provision_organization', {
      p_owner_email: await newAccountEmail('nowhere'),
      p_name: 'Nowhere Ltd',
      p_role: 'Owner',
      p_capabilities: ALL_CAPABILITIES,
      p_display_name: 'Founder',
      p_timezone: 'Mars/Olympus_Mons',
      p_currency: 'EUR',
    });

    expect(error?.code).toBe('23514');
  });

  it('holds no timestamp without a zone anywhere in the schema (I9)', async () => {
    // The general form of the invariant. A single `timestamp` column added later would be an
    // instant that means different things depending on who reads it, and no test of one
    // table would notice.
    const pg = new Client({
      connectionString:
        process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    });
    await pg.connect();
    try {
      const { rows } = await pg.query(
        `select c.relname as table_name, a.attname as column_name
           from pg_attribute a
           join pg_class c on c.oid = a.attrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind = 'r'
            and a.attnum > 0
            and not a.attisdropped
            and format_type(a.atttypid, a.atttypmod) in
                ('timestamp without time zone', 'tsrange')`,
      );
      expect(rows).toEqual([]);
    } finally {
      await pg.end();
    }
  });

  it('refuses scheduling to a member without the capability (I12, I16)', async () => {
    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'Mover Only',
      capabilities: ['role.manage', 'work_item.create', 'work_item.transition'],
    });

    const workItemId = await newWorkItem(bob, 'Not yours to schedule');

    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();

    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    // The policy admits this caller — they hold work_item.transition — so the per-column
    // trigger is the only thing standing between them and the schedule. This is the test
    // that would fail if that refinement were dropped and the policy left to carry both.
    await expect(
      scheduleWorkItem(bob.db, {
        workItemId,
        resourceId: bob.resourceId,
        startsAt: '2026-09-04T09:00:00.000Z',
        endsAt: '2026-09-04T10:00:00.000Z',
      }),
    ).rejects.toMatchObject({ code: 'scheduling.forbidden' });

    const items = await listWorkItems(bob.db, { organizationId: bob.organizationId });
    expect(items.find((i) => i.id === workItemId)?.window).toBeNull();
  });

  it('parses and compares windows without a database', () => {
    // The pure half, so the parser is pinned rather than only exercised through PostgREST.
    expect(parseWindow('["2026-09-01 09:00:00+00","2026-09-01 10:00:00+00")')).toEqual({
      startsAt: TUESDAY_09,
      endsAt: TUESDAY_10,
    });
    expect(parseWindow(null)).toBeNull();
    expect(parseWindow('not a range')).toBeNull();

    expect(
      overlaps(
        { startsAt: TUESDAY_09, endsAt: TUESDAY_10 },
        { startsAt: TUESDAY_0930, endsAt: TUESDAY_11 },
      ),
    ).toBe(true);
    // Back to back, so no.
    expect(
      overlaps(
        { startsAt: TUESDAY_09, endsAt: TUESDAY_10 },
        { startsAt: TUESDAY_10, endsAt: TUESDAY_11 },
      ),
    ).toBe(false);
  });
});

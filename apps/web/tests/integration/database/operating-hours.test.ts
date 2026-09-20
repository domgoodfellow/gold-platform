import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createResource } from '@/lib/domain/resources/resources';
import { listSchedule } from '@/lib/domain/scheduling/availability';
import {
  addOperatingHours,
  listOperatingHours,
  openWindows,
  removeOperatingHours,
} from '@/lib/domain/scheduling/operating-hours';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import {
  isoDayOfWeek,
  zonedDayRange,
  zonedTimeToInstant,
} from '@/lib/domain/scheduling/window';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Operating hours — the configuration that was missing from the availability calculation.
 *
 * The claim under test is not only that hours are subtracted. It is that **nothing anywhere
 * knows what a working week is**: no Monday-to-Friday, no weekend, no default set, and no
 * seeded rows. `constraints.md` forbids hardcoding business hours, and a nine-to-five living
 * in a default would be that rule broken quietly rather than loudly.
 *
 * So the first test is the important one: a business that has configured nothing is available
 * around the clock. Not because always-open is a good guess, but because it is the only
 * reading of "this business has not told us" that does not invent a claim on its behalf.
 * Contrast I13, where an unconfigured type is *frozen* — an empty transition set genuinely
 * asserts that no move is legal, and an empty hours set asserts nothing at all.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const ZONE = 'Europe/Amsterdam';
/** A Tuesday. Which is a fact about the calendar, not about anybody's business. */
const TUESDAY = '2026-09-15';

type Tenant = {
  db: SupabaseClient;
  userId: string;
  organizationId: string;
  statusId: string;
  resourceId: string;
};

let alice: Tenant;
let bob: Tenant;

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
    currency: 'EUR',
  });

  const orgId = organizationId as string;
  const typeId = await createWorkItemType(db, { organizationId: orgId, name: 'Callout' });

  return {
    db,
    userId: created.user.id,
    organizationId: orgId,
    statusId: await createWorkItemStatus(db, { organizationId: orgId, typeId, name: 'Open' }),
    resourceId: await createResource(db, { organizationId: orgId, name: 'Sam Okafor' }),
  };
}

function scheduleFor(tenant: Tenant) {
  return listSchedule(tenant.db, {
    organizationId: tenant.organizationId,
    within: zonedDayRange(TUESDAY, ZONE),
    on: { date: TUESDAY, timeZone: ZONE },
  });
}

describe('operating hours', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('oh-alice');
    bob = await newTenant('oh-bob');
  });

  it('seeds no hours at all for a new business', async () => {
    // The assertion that keeps the rest honest. If anything ever starts creating a default
    // week, this fails first and by name.
    for (const tenant of [alice, bob]) {
      expect(await listOperatingHours(tenant.db, { organizationId: tenant.organizationId }))
        .toEqual([]);
    }
  });

  it('treats a business that has said nothing as open around the clock', async () => {
    const [entry] = await scheduleFor(alice);
    const day = zonedDayRange(TUESDAY, ZONE);

    // The whole day, not a working day. "No claim" rather than "closed", and rather than a
    // guess about when this business works.
    expect(entry.free).toEqual([day]);
  });

  it('subtracts the hours a business has set', async () => {
    // Tuesday is ISO day 2. The number comes from the calendar; the hours come from Alice.
    await addOperatingHours(alice.db, {
      organizationId: alice.organizationId,
      dayOfWeek: 2,
      opensAt: '08:00',
      closesAt: '16:00',
    });

    const [entry] = await scheduleFor(alice);
    expect(entry.free).toEqual([
      {
        startsAt: zonedTimeToInstant(TUESDAY, '08:00:00', ZONE),
        endsAt: zonedTimeToInstant(TUESDAY, '16:00:00', ZONE),
      },
    ]);
  });

  it('leaves a business closed on a day it has not configured', async () => {
    // Alice has set Tuesday only. Wednesday now has no hours *and* the business has spoken,
    // so there is nothing open — which is different from having said nothing at all.
    const wednesday = '2026-09-16';
    const schedule = await listSchedule(alice.db, {
      organizationId: alice.organizationId,
      within: zonedDayRange(wednesday, ZONE),
      on: { date: wednesday, timeZone: ZONE },
    });

    expect(schedule[0].free).toEqual([]);
  });

  it('supports a split day as two periods', async () => {
    // Closed for lunch. Two rows, because that is what it is — rather than one row with a
    // break rule every reader would have to know about.
    await addOperatingHours(alice.db, {
      organizationId: alice.organizationId,
      dayOfWeek: 3,
      opensAt: '09:00',
      closesAt: '12:00',
    });
    await addOperatingHours(alice.db, {
      organizationId: alice.organizationId,
      dayOfWeek: 3,
      opensAt: '13:00',
      closesAt: '17:00',
    });

    const wednesday = '2026-09-16';
    const schedule = await listSchedule(alice.db, {
      organizationId: alice.organizationId,
      within: zonedDayRange(wednesday, ZONE),
      on: { date: wednesday, timeZone: ZONE },
    });

    expect(schedule[0].free).toEqual([
      {
        startsAt: zonedTimeToInstant(wednesday, '09:00:00', ZONE),
        endsAt: zonedTimeToInstant(wednesday, '12:00:00', ZONE),
      },
      {
        startsAt: zonedTimeToInstant(wednesday, '13:00:00', ZONE),
        endsAt: zonedTimeToInstant(wednesday, '17:00:00', ZONE),
      },
    ]);
  });

  it('subtracts committed work from the open period, not from the day', async () => {
    const workItemId = await createWorkItem(alice.db, {
      organizationId: alice.organizationId,
      title: 'Morning callout',
      statusId: alice.statusId,
    });
    await scheduleWorkItem(alice.db, {
      workItemId,
      resourceId: alice.resourceId,
      startsAt: zonedTimeToInstant(TUESDAY, '10:00:00', ZONE),
      endsAt: zonedTimeToInstant(TUESDAY, '11:00:00', ZONE),
    });

    const [entry] = await scheduleFor(alice);
    expect(entry.free).toEqual([
      {
        startsAt: zonedTimeToInstant(TUESDAY, '08:00:00', ZONE),
        endsAt: zonedTimeToInstant(TUESDAY, '10:00:00', ZONE),
      },
      {
        startsAt: zonedTimeToInstant(TUESDAY, '11:00:00', ZONE),
        endsAt: zonedTimeToInstant(TUESDAY, '16:00:00', ZONE),
      },
    ]);
  });

  it('gives two businesses different weeks without either seeing the other', async () => {
    // Bob works Tuesday evenings. Nothing about Alice's Tuesday reaches him.
    await addOperatingHours(bob.db, {
      organizationId: bob.organizationId,
      dayOfWeek: 2,
      opensAt: '17:00',
      closesAt: '21:00',
    });

    const [entry] = await scheduleFor(bob);
    expect(entry.free).toEqual([
      {
        startsAt: zonedTimeToInstant(TUESDAY, '17:00:00', ZONE),
        endsAt: zonedTimeToInstant(TUESDAY, '21:00:00', ZONE),
      },
    ]);

    expect(
      await listOperatingHours(bob.db, { organizationId: alice.organizationId }),
    ).toEqual([]);
  });

  it('lets two businesses open at the same time on the same day (I2)', async () => {
    // If the unique index had lost its leading organization_id, no two businesses could ever
    // share an opening time.
    const mine = await addOperatingHours(alice.db, {
      organizationId: alice.organizationId,
      dayOfWeek: 5,
      opensAt: '09:00',
      closesAt: '17:00',
    });
    const theirs = await addOperatingHours(bob.db, {
      organizationId: bob.organizationId,
      dayOfWeek: 5,
      opensAt: '09:00',
      closesAt: '17:00',
    });
    expect(mine).not.toBe(theirs);
  });

  it('refuses the same opening twice in one business', async () => {
    await expect(
      addOperatingHours(alice.db, {
        organizationId: alice.organizationId,
        dayOfWeek: 5,
        opensAt: '09:00',
        closesAt: '18:00',
      }),
    ).rejects.toMatchObject({ code: 'operating_hours.duplicate' });
  });

  it('refuses a closing time that is not after its opening', async () => {
    await expect(
      addOperatingHours(alice.db, {
        organizationId: alice.organizationId,
        dayOfWeek: 6,
        opensAt: '22:00',
        closesAt: '02:00',
      }),
    ).rejects.toMatchObject({ code: 'operating_hours.closes_before_opens' });

    // And in the database, which is where the guarantee is.
    const { error } = await alice.db.from('operating_hours').insert({
      organization_id: alice.organizationId,
      day_of_week: 6,
      opens_at: '22:00:00',
      closes_at: '02:00:00',
      created_by: alice.userId,
    });
    expect(error?.code).toBe('23514');
  });

  it('refuses a day outside the week', async () => {
    await expect(
      addOperatingHours(alice.db, {
        organizationId: alice.organizationId,
        dayOfWeek: 8,
        opensAt: '09:00',
        closesAt: '17:00',
      }),
    ).rejects.toMatchObject({ code: 'operating_hours.day_invalid' });
  });

  it('frees the day again when hours are removed', async () => {
    const hours = await listOperatingHours(alice.db, {
      organizationId: alice.organizationId,
    });
    for (const entry of hours) {
      await removeOperatingHours(alice.db, { id: entry.id });
    }

    const [entry] = await scheduleFor(alice);
    // Back to no claim, and therefore back to the whole day minus what is committed.
    expect(entry.free[0].startsAt).toBe(zonedDayRange(TUESDAY, ZONE).startsAt);
  });

  it('refuses hours to a member without the capability (I12, I16)', async () => {
    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'No Config',
      capabilities: ['role.manage'],
    });

    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();

    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    await expect(
      addOperatingHours(bob.db, {
        organizationId: bob.organizationId,
        dayOfWeek: 1,
        opensAt: '09:00',
        closesAt: '17:00',
      }),
    ).rejects.toMatchObject({ code: 'operating_hours.forbidden' });

    // A direct insert gets the same answer, which is what makes it a guarantee.
    const direct = await bob.db.from('operating_hours').insert({
      organization_id: bob.organizationId,
      day_of_week: 1,
      opens_at: '09:00:00',
      closes_at: '17:00:00',
      created_by: bob.userId,
    });
    expect(direct.error?.code).toBe('42501');

    // And the rows they already had are still there — a denied delete removes nothing.
    const existing = await listOperatingHours(bob.db, {
      organizationId: bob.organizationId,
    });
    expect(existing.length).toBeGreaterThan(0);
    await expect(
      removeOperatingHours(bob.db, { id: existing[0].id }),
    ).rejects.toMatchObject({ code: 'operating_hours.forbidden' });
  });

  it('reads a weekday from the calendar and nothing else', () => {
    // ISO numbering, and no word for any day anywhere in the platform.
    expect(isoDayOfWeek('2026-09-14')).toBe(1);
    expect(isoDayOfWeek('2026-09-15')).toBe(2);
    expect(isoDayOfWeek('2026-09-20')).toBe(7);
  });

  it('resolves a wall-clock reading against the tenant\'s zone, including across DST', () => {
    // 09:00 in Amsterdam is 07:00Z in September and 08:00Z in January. An hours rule stored
    // as an instant would have been wrong for half the year.
    expect(zonedTimeToInstant('2026-09-15', '09:00:00', ZONE)).toBe('2026-09-15T07:00:00.000Z');
    expect(zonedTimeToInstant('2026-01-15', '09:00:00', ZONE)).toBe('2026-01-15T08:00:00.000Z');
  });

  it('opens the whole range when a business has no hours at all', () => {
    const day = zonedDayRange(TUESDAY, ZONE);
    expect(openWindows(TUESDAY, ZONE, [], day)).toEqual([day]);
  });

  it('ignores hours belonging to other days', () => {
    const day = zonedDayRange(TUESDAY, ZONE);
    const hours = [
      { id: '1', dayOfWeek: 1, opensAt: '09:00:00', closesAt: '17:00:00' },
      { id: '2', dayOfWeek: 2, opensAt: '10:00:00', closesAt: '12:00:00' },
    ];

    expect(openWindows(TUESDAY, ZONE, hours, day)).toEqual([
      {
        startsAt: zonedTimeToInstant(TUESDAY, '10:00:00', ZONE),
        endsAt: zonedTimeToInstant(TUESDAY, '12:00:00', ZONE),
      },
    ]);
  });

  it('holds a bare `time` column only where a recurring local reading belongs', async () => {
    // The companion to scheduling.test.ts's "no timestamp without a zone" assertion. `time`
    // is right for "we open at nine" and wrong for everything else in this schema, so a
    // second table growing one is a question worth being asked.
    const pg = new Client({
      connectionString:
        process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
    });
    await pg.connect();
    try {
      const { rows } = await pg.query(
        `select distinct c.relname as table_name
           from pg_attribute a
           join pg_class c on c.oid = a.attrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relkind = 'r'
            and a.attnum > 0
            and not a.attisdropped
            and format_type(a.atttypid, a.atttypmod) = 'time without time zone'`,
      );
      expect(rows.map((row) => row.table_name)).toEqual(['operating_hours']);
    } finally {
      await pg.end();
    }
  });
});

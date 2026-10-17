import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createResource } from '@/lib/domain/resources/resources';
import { freeWindows, listSchedule } from '@/lib/domain/scheduling/availability';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { clipWindow, todayInZone, zonedDayRange, zonedTimeToInstant } from '@/lib/domain/scheduling/window';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * The single availability model and the advisory-availability rule.
 *
 * The single availability model — "there is exactly one availability calculation" — is not provable by counting
 * functions. What makes it hold is that the one calculation and the constraint that commits
 * work **agree**, so nothing has a reason to grow a second opinion. Two tests assert that
 * agreement in both directions: a window `freeWindows` reports as free can be committed, and
 * one it does not report cannot.
 *
 * The advisory-availability rule — "availability shown to a client is advisory; it is re-asserted server-side before work
 * is committed" — is asserted as the race it describes. Availability is read, a second caller
 * takes the slot, and the first caller commits against an answer that was true when it was
 * given. Nothing in the domain layer could have prevented that, which is the point: the
 * re-assertion is the exclusion constraint, in the transaction that would have written the
 * row.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const DAY = '2026-09-15';
const ZONE = 'Europe/Amsterdam';

type Tenant = {
  db: SupabaseClient;
  organizationId: string;
  statusId: string;
  resourceId: string;
};

let alice: Tenant;

async function newTenant(label: string): Promise<Tenant> {
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
  const typeId = await createWorkItemType(db, { schedulable: true, organizationId: orgId, name: 'Callout' });

  return {
    db,
    organizationId: orgId,
    statusId: await createWorkItemStatus(db, { organizationId: orgId, typeId, name: 'Open' }),
    resourceId: await createResource(db, { resourceClass: 'other', organizationId: orgId, name: 'Sam Okafor' }),
  };
}

async function book(tenant: Tenant, title: string, startsAt: string, endsAt: string) {
  const workItemId = await createWorkItem(tenant.db, {
    organizationId: tenant.organizationId,
    title,
    statusId: tenant.statusId,
  });
  await scheduleWorkItem(tenant.db, {
    workItemId,
    resourceIds: [tenant.resourceId],
    startsAt,
    endsAt,
  });
  return workItemId;
}

describe('availability', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('av-alice');
  });

  it('subtracts committed work from a range', () => {
    const day = { startsAt: '2026-09-15T00:00:00.000Z', endsAt: '2026-09-16T00:00:00.000Z' };

    expect(
      freeWindows(day, [
        { startsAt: '2026-09-15T09:00:00.000Z', endsAt: '2026-09-15T10:00:00.000Z' },
      ]),
    ).toEqual([
      { startsAt: '2026-09-15T00:00:00.000Z', endsAt: '2026-09-15T09:00:00.000Z' },
      { startsAt: '2026-09-15T10:00:00.000Z', endsAt: '2026-09-16T00:00:00.000Z' },
    ]);
  });

  it('leaves no gap between back-to-back work', () => {
    const morning = { startsAt: '2026-09-15T09:00:00.000Z', endsAt: '2026-09-15T11:00:00.000Z' };

    expect(
      freeWindows(morning, [
        { startsAt: '2026-09-15T09:00:00.000Z', endsAt: '2026-09-15T10:00:00.000Z' },
        { startsAt: '2026-09-15T10:00:00.000Z', endsAt: '2026-09-15T11:00:00.000Z' },
      ]),
    ).toEqual([]);
  });

  it('merges overlapping commitments rather than producing a negative gap', () => {
    const day = { startsAt: '2026-09-15T08:00:00.000Z', endsAt: '2026-09-15T18:00:00.000Z' };

    expect(
      freeWindows(day, [
        { startsAt: '2026-09-15T09:00:00.000Z', endsAt: '2026-09-15T12:00:00.000Z' },
        { startsAt: '2026-09-15T10:00:00.000Z', endsAt: '2026-09-15T11:00:00.000Z' },
      ]),
    ).toEqual([
      { startsAt: '2026-09-15T08:00:00.000Z', endsAt: '2026-09-15T09:00:00.000Z' },
      { startsAt: '2026-09-15T12:00:00.000Z', endsAt: '2026-09-15T18:00:00.000Z' },
    ]);
  });

  it('ignores commitments outside the range, and clips those that straddle it', () => {
    const afternoon = {
      startsAt: '2026-09-15T12:00:00.000Z',
      endsAt: '2026-09-15T17:00:00.000Z',
    };

    expect(
      freeWindows(afternoon, [
        { startsAt: '2026-09-15T06:00:00.000Z', endsAt: '2026-09-15T08:00:00.000Z' },
        { startsAt: '2026-09-15T11:00:00.000Z', endsAt: '2026-09-15T13:00:00.000Z' },
        { startsAt: '2026-09-15T20:00:00.000Z', endsAt: '2026-09-15T21:00:00.000Z' },
      ]),
    ).toEqual([{ startsAt: '2026-09-15T13:00:00.000Z', endsAt: '2026-09-15T17:00:00.000Z' }]);
  });

  it('drops gaps shorter than the work needs', () => {
    const day = { startsAt: '2026-09-15T08:00:00.000Z', endsAt: '2026-09-15T12:00:00.000Z' };

    // A thirty-minute hole is not availability for a two-hour job.
    expect(
      freeWindows(
        day,
        [
          { startsAt: '2026-09-15T08:30:00.000Z', endsAt: '2026-09-15T09:00:00.000Z' },
          { startsAt: '2026-09-15T09:30:00.000Z', endsAt: '2026-09-15T10:00:00.000Z' },
        ],
        { minimumMinutes: 60 },
      ),
    ).toEqual([{ startsAt: '2026-09-15T10:00:00.000Z', endsAt: '2026-09-15T12:00:00.000Z' }]);
  });

  it('clips a booking that spans midnight to the day it is drawn on, for display only', () => {
    const monday = zonedDayRange('2026-09-14', ZONE);
    const tuesday = zonedDayRange('2026-09-15', ZONE);
    // A booking starting late Monday and running past local midnight into Tuesday.
    const spanning = {
      startsAt: zonedTimeToInstant('2026-09-14', '23:00', ZONE),
      endsAt: zonedTimeToInstant('2026-09-15', '01:00', ZONE),
    };

    expect(clipWindow(spanning, monday)).toEqual({ startsAt: spanning.startsAt, endsAt: monday.endsAt });
    expect(clipWindow(spanning, tuesday)).toEqual({ startsAt: tuesday.startsAt, endsAt: spanning.endsAt });
  });

  it('clips a buffer that spans midnight the same way as an appointment', () => {
    const monday = zonedDayRange('2026-09-14', ZONE);
    // The appointment plus a tenant buffer running well past local midnight.
    const occupied = {
      startsAt: zonedTimeToInstant('2026-09-14', '23:30', ZONE),
      endsAt: zonedTimeToInstant('2026-09-15', '01:30', ZONE),
    };

    expect(clipWindow(occupied, monday)).toEqual({ startsAt: occupied.startsAt, endsAt: monday.endsAt });
  });

  it('returns null for a window that does not touch the bound at all', () => {
    const monday = zonedDayRange('2026-09-14', ZONE);
    const wednesday = { startsAt: '2026-09-16T09:00:00.000Z', endsAt: '2026-09-16T10:00:00.000Z' };
    expect(clipWindow(wednesday, monday)).toBeNull();
  });

  it('leaves a window entirely inside the bound unchanged', () => {
    const monday = zonedDayRange('2026-09-14', ZONE);
    const inside = { startsAt: '2026-09-14T09:00:00.000Z', endsAt: '2026-09-14T10:00:00.000Z' };
    expect(clipWindow(inside, monday)).toEqual(inside);
  });

  it('reports a resource\'s day from the rows themselves, with no calendar table', async () => {
    await book(alice, 'Morning', '2026-09-15T07:00:00.000Z', '2026-09-15T09:00:00.000Z');

    const within = zonedDayRange(DAY, ZONE);
    const schedule = await listSchedule(alice.db, {
      organizationId: alice.organizationId,
      within,
    });

    expect(schedule).toHaveLength(1);
    expect(schedule[0].resource.name).toBe('Sam Okafor');
    expect(schedule[0].booked.map((b) => b.title)).toEqual(['Morning']);
    expect(schedule[0].free).toEqual([
      { startsAt: within.startsAt, endsAt: '2026-09-15T07:00:00.000Z' },
      { startsAt: '2026-09-15T09:00:00.000Z', endsAt: within.endsAt },
    ]);
  });

  it('agrees with the constraint: a window it calls free can be committed', async () => {
    const within = zonedDayRange(DAY, ZONE);
    const [schedule] = await listSchedule(alice.db, {
      organizationId: alice.organizationId,
      within,
    });

    const gap = schedule.free.find((window) => window.startsAt === '2026-09-15T09:00:00.000Z')!;
    await expect(
      book(alice, 'Takes the advertised gap', gap.startsAt, '2026-09-15T10:00:00.000Z'),
    ).resolves.toBeTypeOf('string');
  });

  it('agrees with the constraint: a window it does not call free cannot be', async () => {
    const within = zonedDayRange(DAY, ZONE);
    const [schedule] = await listSchedule(alice.db, {
      organizationId: alice.organizationId,
      within,
    });

    // Straddles the 07:00–09:00 booking, so no reported free window contains it.
    const contested = {
      startsAt: '2026-09-15T08:00:00.000Z',
      endsAt: '2026-09-15T08:30:00.000Z',
    };
    const claimedFree = schedule.free.some(
      (window) => window.startsAt <= contested.startsAt && window.endsAt >= contested.endsAt,
    );
    expect(claimedFree).toBe(false);

    const workItemId = await createWorkItem(alice.db, {
      organizationId: alice.organizationId,
      title: 'Contested',
      statusId: alice.statusId,
    });
    await expect(
      scheduleWorkItem(alice.db, {
        workItemId,
        resourceIds: [alice.resourceId],
        startsAt: contested.startsAt,
        endsAt: contested.endsAt,
      }),
    ).rejects.toMatchObject({ code: 'scheduling.double_booked' });
  });

  it('is advisory: a free answer can be taken before it is acted on', async () => {
    const within = zonedDayRange(DAY, ZONE);

    // 1. A dispatcher reads availability and sees 14:00 free.
    const [before] = await listSchedule(alice.db, {
      organizationId: alice.organizationId,
      within,
    });
    const slot = { startsAt: '2026-09-15T14:00:00.000Z', endsAt: '2026-09-15T15:00:00.000Z' };
    expect(
      before.free.some(
        (window) => window.startsAt <= slot.startsAt && window.endsAt >= slot.endsAt,
      ),
    ).toBe(true);

    // 2. Somebody else takes it. Nothing told the first dispatcher.
    await book(alice, 'Taken by a colleague', slot.startsAt, slot.endsAt);

    // 3. The first dispatcher commits against an answer that was true when given. The
    //    exclusion constraint is the re-assertion, and it is the only thing that could have
    //    caught this — a check before the insert would have raced identically.
    const workItemId = await createWorkItem(alice.db, {
      organizationId: alice.organizationId,
      title: 'Acting on stale availability',
      statusId: alice.statusId,
    });
    await expect(
      scheduleWorkItem(alice.db, {
        workItemId,
        resourceIds: [alice.resourceId],
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
      }),
    ).rejects.toMatchObject({ code: 'scheduling.double_booked' });
  });

  it('bounds a day by the tenant\'s clock, not the server\'s', () => {
    // Amsterdam is UTC+2 in September, so the tenant's day starts at 22:00 the day before.
    expect(zonedDayRange('2026-09-15', 'Europe/Amsterdam')).toEqual({
      startsAt: '2026-09-14T22:00:00.000Z',
      endsAt: '2026-09-15T22:00:00.000Z',
    });

    // And in a zone the other side of UTC.
    expect(zonedDayRange('2026-09-15', 'America/New_York')).toEqual({
      startsAt: '2026-09-15T04:00:00.000Z',
      endsAt: '2026-09-16T04:00:00.000Z',
    });
  });

  it('bounds a day correctly across a daylight saving transition', () => {
    // Amsterdam goes UTC+1 → UTC+2 on 29 March 2026, so that day is 23 hours long. A naive
    // "midnight plus 24 hours" would lose or duplicate an hour of the schedule, on exactly
    // the day nobody tests.
    const spring = zonedDayRange('2026-03-29', 'Europe/Amsterdam');
    expect(spring).toEqual({
      startsAt: '2026-03-28T23:00:00.000Z',
      endsAt: '2026-03-29T22:00:00.000Z',
    });
    expect(
      new Date(spring.endsAt).getTime() - new Date(spring.startsAt).getTime(),
    ).toBe(23 * 60 * 60 * 1000);

    // And 25 October is 25 hours.
    const autumn = zonedDayRange('2026-10-25', 'Europe/Amsterdam');
    expect(
      new Date(autumn.endsAt).getTime() - new Date(autumn.startsAt).getTime(),
    ).toBe(25 * 60 * 60 * 1000);
  });

  it('reads today from the tenant\'s clock', () => {
    // 23:30 UTC on the 15th is already the 16th in Amsterdam. A server-derived date would put
    // the dispatcher on the wrong day for half an hour every night.
    const lateEvening = new Date('2026-09-15T23:30:00.000Z');
    expect(todayInZone('Europe/Amsterdam', lateEvening)).toBe('2026-09-16');
    expect(todayInZone('America/New_York', lateEvening)).toBe('2026-09-15');
  });
});

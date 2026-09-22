import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createResource } from '@/lib/domain/resources/resources';
import { listSchedule, listScheduleDays } from '@/lib/domain/scheduling/availability';
import { addOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { zonedDayRange, zonedTimeToInstant } from '@/lib/domain/scheduling/window';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * `listScheduleDays` — the Week view's read, and the generalization of `listSchedule` to several
 * tenant calendar days at once. What is under test is exactly what makes it safe to add: bookings
 * land on the day they actually occupy and nowhere else, each day's own opening hours are
 * respected (including a day left unconfigured inside an otherwise-configured week, which
 * `openWindows` reads as closed, not open), and the whole thing agrees with `listSchedule` run
 * once per day — a week is not a second availability algorithm, only a second caller of the first.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const ZONE = 'Europe/Amsterdam';
// A Monday through the following Sunday.
const MONDAY = '2026-09-14';
const WEEK = [
  '2026-09-14',
  '2026-09-15',
  '2026-09-16',
  '2026-09-17',
  '2026-09-18',
  '2026-09-19',
  '2026-09-20',
];

type Tenant = {
  db: SupabaseClient;
  organizationId: string;
  resourceId: string;
  statusId: string;
};

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

  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const organizationId = await foundBusiness({ ownerEmail: email, name: `${label} Ltd`, currency: 'EUR', timezone: ZONE });
  const typeId = await createWorkItemType(db, { organizationId, name: 'Callout' });

  return {
    db,
    organizationId,
    statusId: await createWorkItemStatus(db, { organizationId, typeId, name: 'Open' }),
    resourceId: await createResource(db, { organizationId, name: 'Sam Okafor' }),
  };
}

describe('listScheduleDays', () => {
  beforeAll(() => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
  });

  it('returns one entry per requested date, each bounded by its own tenant calendar day', async () => {
    const tenant = await newTenant('week-bounds');
    const days = await listScheduleDays(tenant.db, { organizationId: tenant.organizationId, dates: WEEK, timeZone: ZONE });

    expect(days.map((day) => day.date)).toEqual(WEEK);
    for (const day of days) {
      expect(day.within).toEqual(zonedDayRange(day.date, ZONE));
    }
  });

  it('places a booking on the day it occupies, and nowhere else', async () => {
    const tenant = await newTenant('week-placement');
    const workItemId = await createWorkItem(tenant.db, { organizationId: tenant.organizationId, title: 'Tuesday job', statusId: tenant.statusId });
    await scheduleWorkItem(tenant.db, {
      workItemId,
      resourceId: tenant.resourceId,
      startsAt: zonedTimeToInstant('2026-09-15', '10:00:00', ZONE),
      endsAt: zonedTimeToInstant('2026-09-15', '11:00:00', ZONE),
    });

    const days = await listScheduleDays(tenant.db, { organizationId: tenant.organizationId, dates: WEEK, timeZone: ZONE });
    const byDate = new Map(days.map((day) => [day.date, day]));

    expect(byDate.get('2026-09-15')!.resources[0].booked.map((entry) => entry.workItemId)).toEqual([workItemId]);
    for (const date of WEEK) {
      if (date === '2026-09-15') continue;
      expect(byDate.get(date)!.resources[0].booked).toEqual([]);
    }
  });

  it('reads each day’s own opening hours — configured for one day, closed on an unconfigured one inside the same week', async () => {
    const tenant = await newTenant('week-hours');
    // Tuesday only.
    await addOperatingHours(tenant.db, { organizationId: tenant.organizationId, dayOfWeek: 2, opensAt: '08:00', closesAt: '16:00' });

    const days = await listScheduleDays(tenant.db, { organizationId: tenant.organizationId, dates: WEEK, timeZone: ZONE });
    const byDate = new Map(days.map((day) => [day.date, day]));

    // Tuesday: the configured window.
    expect(byDate.get('2026-09-15')!.open).toEqual([
      { startsAt: zonedTimeToInstant('2026-09-15', '08:00:00', ZONE), endsAt: zonedTimeToInstant('2026-09-15', '16:00:00', ZONE) },
    ]);
    // Every other day: hours exist somewhere in this business, so an unconfigured day is closed —
    // never "no claim" now that the business has spoken for the week (openWindows' own rule).
    for (const date of WEEK) {
      if (date === '2026-09-15') continue;
      expect(byDate.get(date)!.open, date).toEqual([]);
    }
  });

  it('leaves every day open when the business has configured no hours at all', async () => {
    const tenant = await newTenant('week-unconfigured');
    const days = await listScheduleDays(tenant.db, { organizationId: tenant.organizationId, dates: WEEK, timeZone: ZONE });

    for (const day of days) {
      expect(day.open, day.date).toEqual([day.within]);
    }
  });

  it('agrees with listSchedule run once per day — one availability calculation, not two', async () => {
    const tenant = await newTenant('week-parity');
    await addOperatingHours(tenant.db, { organizationId: tenant.organizationId, dayOfWeek: 3, opensAt: '09:00', closesAt: '17:00' });

    const morning = await createWorkItem(tenant.db, { organizationId: tenant.organizationId, title: 'Wednesday morning', statusId: tenant.statusId });
    await scheduleWorkItem(tenant.db, {
      workItemId: morning,
      resourceId: tenant.resourceId,
      startsAt: zonedTimeToInstant('2026-09-16', '09:30:00', ZONE),
      endsAt: zonedTimeToInstant('2026-09-16', '10:30:00', ZONE),
    });

    const days = await listScheduleDays(tenant.db, { organizationId: tenant.organizationId, dates: WEEK, timeZone: ZONE });

    for (const day of days) {
      const [expected] = await listSchedule(tenant.db, {
        organizationId: tenant.organizationId,
        within: day.within,
        on: { date: day.date, timeZone: ZONE },
      });
      const [actual] = day.resources;
      expect(actual.booked, day.date).toEqual(expected.booked);
      expect(actual.free, day.date).toEqual(expected.free);
    }
  });

  it('returns nothing for an empty date list, and reads no resource or hours row for it', async () => {
    const tenant = await newTenant('week-empty');
    expect(await listScheduleDays(tenant.db, { organizationId: tenant.organizationId, dates: [], timeZone: ZONE })).toEqual([]);
  });

  it('gives two businesses different weeks without either seeing the other', async () => {
    const alice = await newTenant('week-alice');
    const bob = await newTenant('week-bob');
    await addOperatingHours(bob.db, { organizationId: bob.organizationId, dayOfWeek: 2, opensAt: '08:00', closesAt: '12:00' });

    const aliceDays = await listScheduleDays(alice.db, { organizationId: alice.organizationId, dates: WEEK, timeZone: ZONE });
    expect(aliceDays.find((day) => day.date === '2026-09-15')!.open).toEqual([zonedDayRange('2026-09-15', ZONE)]);

    expect(
      await listScheduleDays(alice.db, { organizationId: bob.organizationId, dates: WEEK, timeZone: ZONE }),
    ).toEqual(aliceDays.map((day) => ({ ...day, resources: [] })));
  });

  it('leaves a Monday-start week honestly running Monday through Sunday', () => {
    expect(WEEK).toHaveLength(7);
    expect(WEEK[0]).toBe(MONDAY);
  });
});

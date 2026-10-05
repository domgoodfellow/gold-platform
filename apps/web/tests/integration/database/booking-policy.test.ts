import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { beginBooking, bookSlot, bookableSlots, listBookableTypes, type Slot } from '@/lib/domain/booking/booking';
import {
  cancelBooking,
  getBookingChangeOptions,
  rescheduleBooking,
  rescheduleSlots,
} from '@/lib/domain/booking/changes';
import { evaluateBookingPolicy, getEffectiveBookingPolicy } from '@/lib/domain/booking/policy';
import { createResourceCapability } from '@/lib/domain/resources/resource-capabilities';
import { createResource } from '@/lib/domain/resources/resources';
import { setResourceWorkingHours } from '@/lib/domain/scheduling/resource-availability';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { getOrganization, updateOrganization } from '@/lib/domain/tenancy/organizations';
import { createResourceRequirement } from '@/lib/domain/work-items/requirements';
import { createWorkItemStatus, updateWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemTransition } from '@/lib/domain/work-items/transitions';
import { createWorkItemType, getTypeBooking, setTypeBookable, setTypeBookingPolicy } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import type { BookingPolicy } from '@/lib/domain/booking/policy';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Booking policy (I86), proved against the real database: what a customer is offered (notice,
 * horizon, same-day, cadence) and may do afterwards (reschedule, cancel), with the commit — not the
 * page — as the guarantee. Policy is not feasibility, so these tests move one without the other.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// Monday 2027-04-05, a date ahead of any real clock this suite will meet.
const T = (hh: string) => `2027-04-05T${hh}:00.000Z`;
const DATE = '2027-04-05';
const clock = (iso: string) => iso.slice(11, 16);

type Person = { db: SupabaseClient; userId: string; email: string };
type Shop = Person & {
  organizationId: string;
  typeId: string;
  bookedId: string;
  cancelledId: string;
  resources: Record<string, string>;
};

let pg: Client;

async function signUp(label: string): Promise<Person> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  return { db, userId: data.user.id, email };
}

const everyDay = (opensAt: string, closesAt: string) =>
  [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, opensAt, closesAt }));

/**
 * `needs: 'one'` is a type that needs nothing in particular (it still books one resource); `'pair'` needs
 * a person and a vehicle and has two vans, so a reschedule can move to the other one.
 */
async function newShop(label: string, options: { needs: 'one' | 'pair'; timezone?: string }): Promise<Shop> {
  const person = await signUp(label);
  const organizationId = (await foundBusiness({
    ownerEmail: person.email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: options.timezone ?? 'UTC',
    currency: 'EUR',
  })) as string;

  const typeId = await createWorkItemType(person.db, { organizationId, name: 'Fitting', schedulable: true });
  const bookedId = await createWorkItemStatus(person.db, { organizationId, typeId, name: 'Booked' });
  const cancelledId = await createWorkItemStatus(person.db, { organizationId, typeId, name: 'Cancelled' });
  await updateWorkItemStatus(person.db, { id: cancelledId, name: 'Cancelled', position: 1, releasesResource: true, marksComplete: false });

  const make = async (name: string, resourceClass: 'person' | 'vehicle', capabilityIds: string[], hours: [string, string]) => {
    const id = await createResource(person.db, { organizationId, name, resourceClass, capabilityIds });
    await setResourceWorkingHours(person.db, { resourceId: id, periods: everyDay(...hours) });
    return id;
  };

  const resources: Record<string, string> = {};
  if (options.needs === 'one') {
    // No working schedule of her own: she inherits the business's hours, and a business that has set
    // none is always open, so a fixture can move a booking to any real instant.
    resources.alex = await createResource(person.db, { organizationId, name: 'Alex', resourceClass: 'person', capabilityIds: [] });
  } else {
    const tire = await createResourceCapability(person.db, { organizationId, name: 'Tire service' });
    const mobile = await createResourceCapability(person.db, { organizationId, name: 'Mobile service' });
    await createResourceRequirement(person.db, { typeId, resourceClass: 'person', quantity: 1, capabilityIds: [tire] });
    await createResourceRequirement(person.db, { typeId, resourceClass: 'vehicle', quantity: 1, capabilityIds: [mobile] });
    resources.alex = await make('Alex', 'person', [tire], ['09:00', '17:00']);
    resources.van1 = await make('Van 1', 'vehicle', [mobile], ['08:00', '16:00']);
    resources.van2 = await make('Van 2', 'vehicle', [mobile], ['12:00', '18:00']);
  }

  const org = await getOrganization(person.db, organizationId);
  await updateOrganization(person.db, {
    id: organizationId,
    name: org!.name,
    timezone: options.timezone ?? 'UTC',
    currency: 'EUR',
    bufferMinutes: 0,
    slug: `bp-${randomUUID().slice(0, 8)}`,
  });
  await setModuleEnabled(person.db, { organizationId, key: 'booking', enabled: true });
  await setTypeBookable(person.db, { id: typeId, statusId: bookedId, durationMinutes: 60 });
  await createWorkItemTransition(person.db, { organizationId, typeId, fromStatusId: bookedId, toStatusId: cancelledId });

  return { ...person, organizationId, typeId, bookedId, cancelledId, resources };
}

const policyOf = async (shop: Shop): Promise<BookingPolicy> =>
  (await getEffectiveBookingPolicy(shop.db, { organizationId: shop.organizationId, typeId: shop.typeId }))!;

async function setPolicy(shop: Shop, patch: Partial<BookingPolicy>) {
  await setTypeBookingPolicy(shop.db, { typeId: shop.typeId, policy: { ...(await policyOf(shop)), ...patch } });
}

const visitor = async (shop: Shop) => {
  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  await beginBooking(db, { organizationId: shop.organizationId });
  return db;
};

const typeOf = async (shop: Shop, db: SupabaseClient) => (await listBookableTypes(db, { organizationId: shop.organizationId }))[0];

const slotsOn = async (shop: Shop, db: SupabaseClient, date = DATE, now?: Date) =>
  bookableSlots(db, { organizationId: shop.organizationId, type: await typeOf(shop, db), date, timeZone: 'UTC', now });

const reserve = (shop: Shop, db: SupabaseClient, slot: Slot, who: string, now?: Date) =>
  bookSlot(db, { organizationId: shop.organizationId, typeId: shop.typeId, slot, name: who, email: `${who}@example.test`, phone: '', now });

const assigned = async (workItemId: string) =>
  (await pg.query('select resource_id from public.work_item_resource_assignments where work_item_id = $1', [workItemId])).rows
    .map((row) => row.resource_id as string)
    .sort();

const windowOf = async (workItemId: string) =>
  (await pg.query('select lower(scheduled_during) as s, upper(scheduled_during) as e, status_id from public.work_items where id = $1', [workItemId])).rows[0] as {
    s: Date;
    e: Date;
    status_id: string;
  };

/**
 * Moves a booking's window with plain SQL, the way a fixture needs to. The capability guard on
 * `work_items` looks for a signed-in caller, so the same transaction-local marker the customer
 * functions use is set for this one row.
 */
async function moveWindow(workItemId: string, from: string, to: string) {
  await pg.query('begin');
  try {
    await pg.query("select set_config('app.customer_change_work_item_id', $1, true)", [workItemId]);
    await pg.query(`update public.work_items set scheduled_during = tstzrange(${from}, ${to}, '[)') where id = $1`, [workItemId]);
    await pg.query('commit');
  } catch (error) {
    await pg.query('rollback');
    throw error;
  }
}

/** The allocation a direct caller would hand `create_booking` for a one-resource type. */
const direct = (shop: Shop, db: SupabaseClient, startsAt: string, who = 'direct') =>
  db.rpc('create_booking', {
    p_organization_id: shop.organizationId,
    p_type_id: shop.typeId,
    p_allocations: [{ requirement_id: null as unknown as string, resource_id: shop.resources.alex }],
    p_starts_at: startsAt,
    p_name: who,
    p_email: `${who}@example.test`,
    p_phone: '',
  });

describe('booking policy', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    pg = new Client({ connectionString: CONNECTION });
    await pg.connect();
  });
  afterAll(async () => {
    await pg.end();
  });

  describe('defaults keep today’s behaviour', () => {
    it('publishes with the duration as the cadence, no notice, same-day open and a year’s horizon', async () => {
      const shop = await newShop('bp-default', { needs: 'one' });
      expect(await policyOf(shop)).toEqual({
        minimumNoticeMinutes: 0,
        maximumHorizonDays: 365,
        cadenceMinutes: 60,
        allowSameDay: true,
        customerRescheduleCutoffMinutes: null,
        customerCancellationCutoffMinutes: null,
        cancellationStatusId: null,
      });
      expect((await getTypeBooking(shop.db, { organizationId: shop.organizationId, typeId: shop.typeId }))!.policy.cadenceMinutes).toBe(60);
    });

    it('does not lose the policy when a type is withdrawn and published again', async () => {
      const shop = await newShop('bp-keep', { needs: 'one' });
      await setPolicy(shop, { cadenceMinutes: 15, minimumNoticeMinutes: 90 });
      await setTypeBookable(shop.db, { id: shop.typeId, statusId: null, durationMinutes: null });
      await setTypeBookable(shop.db, { id: shop.typeId, statusId: shop.bookedId, durationMinutes: 45 });
      const policy = await policyOf(shop);
      expect(policy.cadenceMinutes).toBe(15);
      expect(policy.minimumNoticeMinutes).toBe(90);
    });

    it('refuses nonsense at the table, however it is written', async () => {
      const shop = await newShop('bp-ranges', { needs: 'one' });
      for (const bad of [
        'booking_cadence_minutes = 4',
        'booking_minimum_notice_minutes = -1',
        'booking_horizon_days = 0',
        'booking_horizon_days = 731',
        'booking_reschedule_cutoff_minutes = -5',
      ]) {
        await expect(pg.query(`update public.work_item_types set ${bad} where id = $1`, [shop.typeId])).rejects.toMatchObject({ code: '23514' });
      }
      await expect(setPolicy(shop, { cadenceMinutes: 0 })).rejects.toMatchObject({ code: 'types.booking_cadence_invalid' });
      await expect(setPolicy(shop, { maximumHorizonDays: -5 })).rejects.toMatchObject({ code: 'types.booking_horizon_invalid' });
      await expect(setPolicy(shop, { minimumNoticeMinutes: Number.NaN })).rejects.toMatchObject({ code: 'types.booking_notice_invalid' });
    });

    it('lets a cancellation go only to a status that gives its resources back', async () => {
      const shop = await newShop('bp-cancel-status', { needs: 'one' });
      await expect(setPolicy(shop, { cancellationStatusId: shop.bookedId })).rejects.toMatchObject({
        code: 'types.booking_cancellation_status_invalid',
      });
      await setPolicy(shop, { cancellationStatusId: shop.cancelledId });
      expect((await policyOf(shop)).cancellationStatusId).toBe(shop.cancelledId);
    });
  });

  describe('what a visitor is offered', () => {
    it('offers quarter-hour starts for a one-hour job, each ending an hour later', async () => {
      const shop = await newShop('bp-cadence', { needs: 'one' });
      await setPolicy(shop, { cadenceMinutes: 15 });
      const slots = await slotsOn(shop, await visitor(shop));
      expect(slots.slice(0, 5).map((slot) => clock(slot.startsAt))).toEqual(['00:00', '00:15', '00:30', '00:45', '01:00']);
      expect(clock(slots[0].endsAt)).toBe('01:00');
      // Always open: the last hour that fits in the day begins 23:00.
      expect(clock(slots.at(-1)!.startsAt)).toBe('23:00');
    });

    it('begins at 10:45 at 10:07 with 30 minutes’ notice and a 15-minute cadence', async () => {
      const shop = await newShop('bp-notice-cadence', { needs: 'one' });
      await setPolicy(shop, { cadenceMinutes: 15, minimumNoticeMinutes: 30 });
      const slots = await slotsOn(shop, await visitor(shop), DATE, new Date(T('10:07')));
      expect(clock(slots[0].startsAt)).toBe('10:45');
    });

    it('keeps duration and cadence apart: 90 minutes every 30 ends 90 minutes after 10:30', async () => {
      const shop = await newShop('bp-90-30', { needs: 'one' });
      await pg.query('update public.work_item_types set booking_duration_minutes = 90 where id = $1', [shop.typeId]);
      await setPolicy(shop, { cadenceMinutes: 30 });
      const slots = await slotsOn(shop, await visitor(shop));
      const tenThirty = slots.find((slot) => clock(slot.startsAt) === '10:30')!;
      expect(clock(tenThirty.endsAt)).toBe('12:00');
    });

    it('offers nothing past the horizon, nothing before the notice, and tomorrow but not today without same-day', async () => {
      const shop = await newShop('bp-window', { needs: 'one' });
      const guest = await visitor(shop);
      const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

      await setPolicy(shop, { maximumHorizonDays: 7 });
      expect((await slotsOn(shop, guest, day(7))).length).toBeGreaterThan(0);
      expect(await slotsOn(shop, guest, day(8))).toEqual([]);

      await setPolicy(shop, { maximumHorizonDays: 365, minimumNoticeMinutes: 2 * 1440 });
      expect(await slotsOn(shop, guest, day(0))).toEqual([]);
      expect(await slotsOn(shop, guest, day(1))).toEqual([]);
      expect((await slotsOn(shop, guest, day(3))).length).toBeGreaterThan(0);

      await setPolicy(shop, { minimumNoticeMinutes: 0, allowSameDay: false });
      expect(await slotsOn(shop, guest, day(0))).toEqual([]);
      expect((await slotsOn(shop, guest, day(1))).length).toBeGreaterThan(0);
    });

    it('reads policy once and does no resource work for a day policy forbids', async () => {
      const shop = await newShop('bp-queries', { needs: 'one' });
      const guest = await visitor(shop);
      const type = await typeOf(shop, guest);
      await setPolicy(shop, { maximumHorizonDays: 7 });

      const counting = (db: SupabaseClient) => {
        let calls = 0;
        const wrapped = new Proxy(db, {
          get(target, property, receiver) {
            const value = Reflect.get(target, property, receiver);
            if ((property === 'from' || property === 'rpc') && typeof value === 'function') {
              return (...args: unknown[]) => {
                calls += 1;
                return (value as (...a: unknown[]) => unknown).apply(target, args);
              };
            }
            return value;
          },
        });
        return { db: wrapped as SupabaseClient, calls: () => calls };
      };

      const far = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      const forbidden = counting(guest);
      expect(await bookableSlots(forbidden.db, { organizationId: shop.organizationId, type, date: far, timeZone: 'UTC' })).toEqual([]);
      expect(forbidden.calls()).toBe(1); // the policy, and nothing else

      const near = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      const allowed = counting(guest);
      await bookableSlots(allowed.db, { organizationId: shop.organizationId, type, date: near, timeZone: 'UTC' });
      const first = allowed.calls();
      // Policy once, then a fixed handful of reads — not one per candidate.
      expect(first).toBeLessThanOrEqual(6);
      const again = counting(guest);
      await bookableSlots(again.db, { organizationId: shop.organizationId, type, date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), timeZone: 'UTC' });
      expect(again.calls()).toBe(first);
    });
  });

  describe('the commit reasserts policy, however it is reached', () => {
    it('refuses a slot that was legal when listed: the notice race', async () => {
      const shop = await newShop('bp-race', { needs: 'one' });
      const guest = await visitor(shop);
      // Listed under a clock a day behind the real one, so the page offered what is now too soon.
      const hour = 3_600_000;
      const nextHour = new Date(Math.ceil((Date.now() + hour) / hour) * hour).toISOString();
      await setPolicy(shop, { minimumNoticeMinutes: 1440 });
      const stale = new Date(new Date(nextHour).getTime() - 25 * hour);
      await expect(
        reserve(shop, guest, { startsAt: nextHour, endsAt: new Date(new Date(nextHour).getTime() + hour).toISOString() }, 'late', stale),
      ).rejects.toMatchObject({ code: 'booking.policy_refused' });
      expect(Number((await pg.query('select count(*) from public.work_items where organization_id = $1', [shop.organizationId])).rows[0].count)).toBe(0);
    });

    it('refuses a direct call that skips the page: notice, horizon and cadence each', async () => {
      const shop = await newShop('bp-direct', { needs: 'one' });
      const hour = 3_600_000;
      const nextHour = Math.ceil((Date.now() + hour) / hour) * hour;
      await setPolicy(shop, { minimumNoticeMinutes: 1440, maximumHorizonDays: 7, cadenceMinutes: 15 });

      const refused = async (startsAt: string) => {
        const guest = await visitor(shop);
        const { error } = await direct(shop, guest, startsAt);
        return error ? { code: error.code, message: error.message } : null;
      };

      expect(await refused(new Date(nextHour).toISOString())).toEqual({ code: 'GD017', message: 'minimum_notice_not_met' });
      expect(await refused(new Date(nextHour + 20 * 86_400_000).toISOString())).toEqual({ code: 'GD017', message: 'outside_booking_horizon' });
      expect(await refused(new Date(nextHour + 3 * 86_400_000 + 7 * 60_000).toISOString())).toEqual({ code: 'GD017', message: 'invalid_booking_cadence' });
      // And one that satisfies all three is taken, so the refusals above were policy and nothing else.
      expect(await refused(new Date(nextHour + 3 * 86_400_000).toISOString())).toBeNull();
    });

    it('does not bind staff: an owner schedules 10:07, today, inside the notice window', async () => {
      const shop = await newShop('bp-staff', { needs: 'one' });
      await setPolicy(shop, { minimumNoticeMinutes: 1440, allowSameDay: false, cadenceMinutes: 15, maximumHorizonDays: 1 });
      const item = await createWorkItem(shop.db, { organizationId: shop.organizationId, title: 'Walk-in', statusId: shop.bookedId, resourceIds: [shop.resources.alex] });
      await scheduleWorkItem(shop.db, { workItemId: item, startsAt: T('10:07'), endsAt: T('11:07') });
      expect(clock((await windowOf(item)).s.toISOString())).toBe('10:07');
    });
  });

  describe('the database and the domain say the same thing', () => {
    // [zone, now, start, policy columns] — every row is asked of `app.booking_policy_refusal` with a
    // fixed clock and of `evaluateBookingPolicy`, and both must agree on whether and why.
    const cases: Array<[string, string, string, string, Partial<Record<'notice' | 'horizon' | 'cadence' | 'sameDay', number | boolean>>]> = [
      ['notice below', 'America/Toronto', '2027-04-05T14:00:00Z', '2027-04-05T15:45:00Z', { notice: 120, cadence: 15 }],
      ['notice exactly', 'America/Toronto', '2027-04-05T14:00:00Z', '2027-04-05T16:00:00Z', { notice: 120, cadence: 15 }],
      ['notice zero, now', 'America/Toronto', '2027-04-05T14:00:00Z', '2027-04-05T14:00:00Z', { notice: 0, cadence: 15 }],
      ['past start', 'America/Toronto', '2027-04-05T14:00:00Z', '2027-04-05T13:45:00Z', { notice: 0, cadence: 15 }],
      ['cadence ok', 'America/Toronto', '2027-04-01T12:00:00Z', '2027-04-05T14:45:00Z', { notice: 0, cadence: 15 }],
      ['cadence 10:07', 'America/Toronto', '2027-04-01T12:00:00Z', '2027-04-05T14:07:00Z', { notice: 0, cadence: 15 }],
      ['half-hour zone, on the hour', 'Asia/Kolkata', '2027-04-01T12:00:00Z', '2027-04-05T04:30:00Z', { notice: 0, cadence: 60 }],
      ['half-hour zone, off the hour', 'Asia/Kolkata', '2027-04-01T12:00:00Z', '2027-04-05T04:00:00Z', { notice: 0, cadence: 60 }],
      ['same-day, Toronto', 'America/Toronto', '2027-04-06T02:00:00Z', '2027-04-06T13:00:00Z', { notice: 0, cadence: 15, sameDay: false }],
      ['same-day, Amsterdam', 'Europe/Amsterdam', '2027-04-06T02:00:00Z', '2027-04-06T13:00:00Z', { notice: 0, cadence: 15, sameDay: false }],
      ['horizon last day', 'America/Toronto', '2027-04-05T14:00:00Z', '2027-05-06T03:45:00Z', { notice: 0, cadence: 15, horizon: 30 }],
      ['horizon past', 'America/Toronto', '2027-04-05T14:00:00Z', '2027-05-06T04:00:00Z', { notice: 0, cadence: 15, horizon: 30 }],
      ['horizon, spring forward last', 'America/Toronto', '2027-03-01T15:00:00Z', '2027-04-01T03:45:00Z', { notice: 0, cadence: 15, horizon: 30 }],
      ['horizon, spring forward past', 'America/Toronto', '2027-03-01T15:00:00Z', '2027-04-01T04:00:00Z', { notice: 0, cadence: 15, horizon: 30 }],
      ['horizon, fall back last', 'America/Toronto', '2027-10-20T14:00:00Z', '2027-11-20T04:45:00Z', { notice: 0, cadence: 15, horizon: 30 }],
      ['horizon, fall back past', 'America/Toronto', '2027-10-20T14:00:00Z', '2027-11-20T05:00:00Z', { notice: 0, cadence: 15, horizon: 30 }],
      ['horizon, Amsterdam last', 'Europe/Amsterdam', '2027-04-05T14:00:00Z', '2027-05-05T21:45:00Z', { notice: 0, cadence: 15, horizon: 30 }],
      ['horizon, Amsterdam past', 'Europe/Amsterdam', '2027-04-05T14:00:00Z', '2027-05-05T22:00:00Z', { notice: 0, cadence: 15, horizon: 30 }],
      ['notice across spring forward, too soon', 'America/Toronto', '2027-03-14T05:30:00Z', '2027-03-14T07:15:00Z', { notice: 120, cadence: 15 }],
      ['notice across spring forward, exactly', 'America/Toronto', '2027-03-14T05:30:00Z', '2027-03-14T07:30:00Z', { notice: 120, cadence: 15 }],
    ];

    it.each(cases)('%s', async (_name, zone, now, start, p) => {
      const shop = await newShop('bp-agree', { needs: 'one' });
      await pg.query('update public.organizations set timezone = $1 where id = $2', [zone, shop.organizationId]);
      await pg.query(
        `update public.work_item_types
            set booking_cadence_minutes = $1, booking_minimum_notice_minutes = $2,
                booking_horizon_days = $3, booking_allow_same_day = $4
          where id = $5`,
        [p.cadence ?? 60, p.notice ?? 0, p.horizon ?? 365, p.sameDay ?? true, shop.typeId],
      );

      const sql = (
        await pg.query('select app.booking_policy_refusal($1, $2, $3::timestamptz, $4::timestamptz) as reason', [shop.organizationId, shop.typeId, start, now])
      ).rows[0].reason as string | null;
      const domain = evaluateBookingPolicy({
        now: new Date(now),
        startsAt: start,
        policy: { ...(await policyOf(shop)) },
        timeZone: zone,
      });

      expect(sql).toBe(domain.reasons[0] ?? null);
      expect(domain.allowed).toBe(sql === null);
    });
  });

  describe('a customer changing their own booking', () => {
    async function booked(label: string, needs: 'one' | 'pair' = 'pair') {
      const shop = await newShop(label, { needs });
      await setPolicy(shop, { cancellationStatusId: shop.cancelledId });
      const guest = await visitor(shop);
      const slots = await slotsOn(shop, guest);
      const ten = slots.find((slot) => clock(slot.startsAt) === '10:00')!;
      const workItemId = await reserve(shop, guest, ten, 'ariane');
      return { shop, guest, workItemId };
    }

    it('moves the same work item, swapping to the other van when the first is taken, in one step', async () => {
      const { shop, guest, workItemId } = await booked('bp-move');
      expect(await assigned(workItemId)).toEqual([shop.resources.alex, shop.resources.van1].sort());

      // Staff hold Van 1 at 13:00, so the new time needs Van 2.
      const staff = await createWorkItem(shop.db, { organizationId: shop.organizationId, title: 'Staff job', statusId: shop.bookedId, resourceIds: [shop.resources.van1] });
      await scheduleWorkItem(shop.db, { workItemId: staff, startsAt: T('13:00'), endsAt: T('14:00') });

      const options = await getBookingChangeOptions(guest, { workItemId });
      expect(options).toMatchObject({ canReschedule: true, canCancel: true });

      await rescheduleBooking(guest, { organizationId: shop.organizationId, workItemId, startsAt: T('13:00') });

      const after = await windowOf(workItemId);
      expect(after.s.toISOString()).toBe(T('13:00'));
      expect(after.e.toISOString()).toBe(T('14:00'));
      expect(await assigned(workItemId)).toEqual([shop.resources.alex, shop.resources.van2].sort());
      const events = await pg.query("select action from public.events where entity_id = $1 and action = 'work_item.rescheduled_by_customer'", [workItemId]);
      expect(events.rowCount).toBe(1);
    });

    it('offers its own time again when choosing a new one (it does not conflict with itself)', async () => {
      const { shop, guest, workItemId } = await booked('bp-self');
      const type = await typeOf(shop, guest);
      const slots = await rescheduleSlots(guest, { organizationId: shop.organizationId, workItemId, type, date: DATE, timeZone: 'UTC' });
      expect(slots.map((slot) => clock(slot.startsAt))).toContain('10:00');
      await rescheduleBooking(guest, { organizationId: shop.organizationId, workItemId, startsAt: T('10:00') });
      expect(clock((await windowOf(workItemId)).s.toISOString())).toBe('10:00');
    });

    it('leaves the original time and people untouched when the new target fails', async () => {
      const { shop, guest, workItemId } = await booked('bp-rollback');
      const staff = await createWorkItem(shop.db, { organizationId: shop.organizationId, title: 'Staff job', statusId: shop.bookedId, resourceIds: [shop.resources.van1] });
      await scheduleWorkItem(shop.db, { workItemId: staff, startsAt: T('13:00'), endsAt: T('14:00') });
      const before = await windowOf(workItemId);
      const people = await assigned(workItemId);

      // Straight at the database, naming the van that is busy: the exclusion constraint refuses it.
      const { error } = await guest.rpc('customer_reschedule_booking', {
        p_work_item_id: workItemId,
        p_allocations: [
          { requirement_id: (await pg.query('select id from public.work_item_type_resource_requirements where type_id = $1 and resource_class = $2', [shop.typeId, 'person'])).rows[0].id, resource_id: shop.resources.alex },
          { requirement_id: (await pg.query('select id from public.work_item_type_resource_requirements where type_id = $1 and resource_class = $2', [shop.typeId, 'vehicle'])).rows[0].id, resource_id: shop.resources.van1 },
        ],
        p_starts_at: T('13:00'),
      });
      expect(error?.code).toBe('23P01');

      const after = await windowOf(workItemId);
      expect(after.s).toEqual(before.s);
      expect(after.e).toEqual(before.e);
      expect(await assigned(workItemId)).toEqual(people);
    });

    it('refuses a new time that breaks the business’s booking policy', async () => {
      const { shop, guest, workItemId } = await booked('bp-move-policy');
      await setPolicy(shop, { cadenceMinutes: 30 });
      await expect(rescheduleBooking(guest, { organizationId: shop.organizationId, workItemId, startsAt: T('13:10') })).rejects.toMatchObject({
        code: 'booking.policy_refused',
      });
      expect(clock((await windowOf(workItemId)).s.toISOString())).toBe('10:00');
    });

    it('cancels through the business’s own status, keeps the work item, and gives the resources back', async () => {
      const { shop, guest, workItemId } = await booked('bp-cancel');
      await cancelBooking(guest, { workItemId });

      const row = await windowOf(workItemId);
      expect(row.status_id).toBe(shop.cancelledId);
      expect(await assigned(workItemId)).toHaveLength(2); // history keeps who was on it
      const kept = await pg.query("select count(*)::int as n from public.events where entity_id = $1 and action in ('work_item.status_changed','work_item.cancelled_by_customer')", [workItemId]);
      expect(kept.rows[0].n).toBe(2);

      // The same people, the same time: another visitor books it. The resources really are free.
      const other = await visitor(shop);
      const slots = await slotsOn(shop, other);
      expect(slots.map((slot) => clock(slot.startsAt))).toContain('10:00');
      const second = await reserve(shop, other, slots.find((slot) => clock(slot.startsAt) === '10:00')!, 'second');
      expect(await assigned(second)).toEqual([shop.resources.alex, shop.resources.van1].sort());

      // And it cannot be cancelled twice.
      await expect(cancelBooking(guest, { workItemId })).rejects.toMatchObject({ code: 'booking.change_refused' });
    });

    it('offers no cancellation until the business has named where one goes and a move to it', async () => {
      const shop = await newShop('bp-no-cancel', { needs: 'one' });
      const guest = await visitor(shop);
      const workItemId = await reserve(shop, guest, (await slotsOn(shop, guest)).find((slot) => clock(slot.startsAt) === '10:00')!, 'ariane');
      expect(await getBookingChangeOptions(guest, { workItemId })).toMatchObject({ canCancel: false, cancelRefusal: 'self_service_not_offered', canReschedule: true });
      await expect(cancelBooking(guest, { workItemId })).rejects.toMatchObject({ code: 'booking.change_refused' });

      // Named, but no transition from where it is: the board's own rule still holds.
      await setPolicy(shop, { cancellationStatusId: shop.cancelledId });
      await pg.query('delete from public.work_item_transitions where type_id = $1', [shop.typeId]);
      expect(await getBookingChangeOptions(guest, { workItemId })).toMatchObject({ canCancel: false, cancelRefusal: 'self_service_not_offered' });
    });

    it('keeps one customer out of another’s booking, and out of another business’s', async () => {
      const { shop, workItemId } = await booked('bp-authz');
      const stranger = await visitor(shop);
      expect(await getBookingChangeOptions(stranger, { workItemId })).toBeNull();
      await expect(cancelBooking(stranger, { workItemId })).rejects.toMatchObject({ code: 'booking.forbidden' });
      const { error } = await stranger.rpc('customer_reschedule_booking', { p_work_item_id: workItemId, p_allocations: [], p_starts_at: T('14:00') });
      expect(error?.code).toBe('42501');

      const elsewhere = await newShop('bp-authz-other', { needs: 'one' });
      const outsider = await visitor(elsewhere);
      expect(await getBookingChangeOptions(outsider, { workItemId })).toBeNull();
      await expect(cancelBooking(outsider, { workItemId })).rejects.toMatchObject({ code: 'booking.forbidden' });
      // Signed out entirely is no better.
      const anonymous = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      await expect(cancelBooking(anonymous, { workItemId })).rejects.toBeTruthy();
    });

    it('judges the cutoff against the appointment: refused inside it, allowed at it, never once started', async () => {
      const { shop, guest, workItemId } = await booked('bp-cutoff', 'one');
      await setPolicy(shop, { customerRescheduleCutoffMinutes: 720, customerCancellationCutoffMinutes: 360, cancellationStatusId: shop.cancelledId });

      const refusal = async (action: string, now: string) =>
        (await pg.query('select app.booking_change_refusal($1, $2, $3, $4::timestamptz) as reason', [shop.organizationId, workItemId, action, now])).rows[0].reason as string | null;

      // The appointment is 2027-04-05 10:00Z.
      expect(await refusal('reschedule', '2027-04-04T21:00:00Z')).toBeNull(); // 13h
      expect(await refusal('reschedule', '2027-04-04T22:00:00Z')).toBeNull(); // exactly 12h
      expect(await refusal('reschedule', '2027-04-04T22:01:00Z')).toBe('reschedule_cutoff_passed'); // 11h59
      expect(await refusal('cancel', '2027-04-05T04:00:00Z')).toBeNull(); // exactly 6h
      expect(await refusal('cancel', '2027-04-05T04:01:00Z')).toBe('cancellation_cutoff_passed');
      expect(await refusal('cancel', '2027-04-05T10:00:00Z')).toBe('booking_already_started');
      expect(await refusal('reschedule', '2027-04-05T10:30:00Z')).toBe('booking_already_started');

      // A zero cutoff still stops at the start.
      await setPolicy(shop, { customerRescheduleCutoffMinutes: 0, customerCancellationCutoffMinutes: 0, cancellationStatusId: shop.cancelledId });
      expect(await refusal('reschedule', '2027-04-05T09:59:00Z')).toBeNull();
      expect(await refusal('reschedule', '2027-04-05T10:00:00Z')).toBe('booking_already_started');

      // And through the real doors with the real clock: an appointment two hours away, a twelve-hour cutoff.
      await setPolicy(shop, { customerRescheduleCutoffMinutes: 720, customerCancellationCutoffMinutes: 360, cancellationStatusId: shop.cancelledId });
      await moveWindow(workItemId, "now() + interval '2 hours'", "now() + interval '3 hours'");
      const options = await getBookingChangeOptions(guest, { workItemId });
      expect(options).toMatchObject({
        canReschedule: false,
        rescheduleRefusal: 'reschedule_cutoff_passed',
        canCancel: false,
        cancelRefusal: 'cancellation_cutoff_passed',
      });
      await expect(cancelBooking(guest, { workItemId })).rejects.toMatchObject({ code: 'booking.change_refused' });
      const { error } = await guest.rpc('customer_reschedule_booking', { p_work_item_id: workItemId, p_allocations: [], p_starts_at: T('14:00') });
      expect(error?.code).toBe('GD017');
      expect(error?.message).toBe('reschedule_cutoff_passed');

      // Staff are not customers: the owner moves it, inside the cutoff, to an off-cadence time.
      await scheduleWorkItem(shop.db, { workItemId, startsAt: T('15:07'), endsAt: T('16:07') });
      expect(clock((await windowOf(workItemId)).s.toISOString())).toBe('15:07');
    });

    it('never offers a change to a booking that has already started', async () => {
      const { shop, guest, workItemId } = await booked('bp-started', 'one');
      await moveWindow(workItemId, "now() - interval '1 hour'", "now() + interval '1 hour'");
      expect(await getBookingChangeOptions(guest, { workItemId })).toMatchObject({
        canReschedule: false,
        rescheduleRefusal: 'booking_already_started',
        canCancel: false,
        cancelRefusal: 'booking_already_started',
      });
      expect(shop.organizationId).toBeTruthy();
    });
  });
});

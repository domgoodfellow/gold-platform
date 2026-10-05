import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { beginBooking, bookSlot, bookableSlots, listBookableTypes } from '@/lib/domain/booking/booking';
import { createResource } from '@/lib/domain/resources/resources';
import { listScheduleDays } from '@/lib/domain/scheduling/availability';
import { addOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import {
  createResourceAvailabilityException,
  deleteResourceAvailabilityException,
  getResourceWorkingHours,
  listAvailabilityConflicts,
  listResourceAvailabilityExceptions,
  listResourceOpenWindows,
  setResourceWorkingHours,
  inheritOrganizationHours,
} from '@/lib/domain/scheduling/resource-availability';
import { scheduleWorkItem, setWorkItemResources } from '@/lib/domain/scheduling/schedule';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { getOrganization, updateOrganization } from '@/lib/domain/tenancy/organizations';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType, setTypeBookable } from '@/lib/domain/work-items/types';
import { createWorkItem, getWorkItem } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * A resource says when it works and when it does not.
 *
 *   open = organization hours ∩ resource hours − exceptions        (one SQL calculation)
 *   free = open − commitments                                      (`freeWindows`)
 *
 * Proved where it is enforced: the authoritative scheduling and booking functions, called around
 * the domain layer too, in a shop whose zone is not the server's.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// Monday 2027-04-05, in UTC unless a shop says otherwise.
const T = (hh: string) => `2027-04-05T${hh}:00.000Z`;
const WINDOW = (from: string, to: string) => ({ startsAt: T(from), endsAt: T(to) });
const DAY = WINDOW('00:00', '23:59');
const asText = (windows: { startsAt: string; endsAt: string }[]) =>
  windows.map((w) => `${w.startsAt.slice(11, 16)}-${w.endsAt.slice(11, 16)}`);

type Person = { db: SupabaseClient; userId: string; email: string };
type Shop = Person & { organizationId: string; bookedId: string; typeId: string; alex: string; van: string; machine: string };

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

async function newShop(label: string, timezone = 'UTC'): Promise<Shop> {
  const person = await signUp(label);
  const organizationId = (await foundBusiness({
    ownerEmail: person.email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone,
    currency: 'EUR',
  })) as string;
  const typeId = await createWorkItemType(person.db, { organizationId, name: 'Tire change', schedulable: true });
  const bookedId = await createWorkItemStatus(person.db, { organizationId, typeId, name: 'Booked' });
  return {
    ...person,
    organizationId,
    typeId,
    bookedId,
    alex: await createResource(person.db, { organizationId, name: 'Alex', resourceClass: 'person' }),
    van: await createResource(person.db, { organizationId, name: 'Service Van 1', resourceClass: 'vehicle' }),
    machine: await createResource(person.db, { organizationId, name: 'Tire Machine', resourceClass: 'equipment' }),
  };
}

const job = (t: Shop, title: string, resourceIds: string[]) =>
  createWorkItem(t.db, { organizationId: t.organizationId, title, statusId: t.bookedId, resourceIds });

const open = async (t: Shop, resourceId: string, within = DAY) =>
  asText((await listResourceOpenWindows(t.db, { organizationId: t.organizationId, within, resourceIds: [resourceId] })).get(resourceId)!);

const everyDay = (opensAt: string, closesAt: string) =>
  [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, opensAt, closesAt }));

describe('resource working hours and exceptions', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    pg = new Client({ connectionString: CONNECTION });
    await pg.connect();
  });
  afterAll(async () => {
    await pg.end();
  });

  describe('open windows', () => {
    it('inherits the business’s hours when the resource has said nothing, and says so', async () => {
      const t = await newShop('rh-inherit');
      await addOperatingHours(t.db, { organizationId: t.organizationId, dayOfWeek: 1, opensAt: '08:00', closesAt: '17:00' });
      expect(await getResourceWorkingHours(t.db, { organizationId: t.organizationId, resourceId: t.alex })).toEqual({ mode: 'inherit' });
      expect(await open(t, t.alex)).toEqual(['08:00-17:00']);
    });

    it('treats a business with no hours as always open, as everywhere else', async () => {
      const t = await newShop('rh-always');
      expect(await open(t, t.alex, WINDOW('06:00', '12:00'))).toEqual(['06:00-12:00']);
    });

    it('narrows the business’s hours to the resource’s own', async () => {
      const t = await newShop('rh-narrow');
      await addOperatingHours(t.db, { organizationId: t.organizationId, dayOfWeek: 1, opensAt: '08:00', closesAt: '17:00' });
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '15:00' }] });
      expect(await open(t, t.alex)).toEqual(['09:00-15:00']);
      // Another resource is untouched.
      expect(await open(t, t.van)).toEqual(['08:00-17:00']);
    });

    it('never widens the business’s hours', async () => {
      const t = await newShop('rh-clip');
      await addOperatingHours(t.db, { organizationId: t.organizationId, dayOfWeek: 1, opensAt: '09:00', closesAt: '17:00' });
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [{ dayOfWeek: 1, opensAt: '07:00', closesAt: '20:00' }] });
      expect(await open(t, t.alex)).toEqual(['09:00-17:00']);
    });

    it('supports a split shift, and a day with no period is a day off', async () => {
      const t = await newShop('rh-split');
      await setResourceWorkingHours(t.db, {
        resourceId: t.alex,
        periods: [
          { dayOfWeek: 1, opensAt: '08:00', closesAt: '12:00' },
          { dayOfWeek: 1, opensAt: '13:00', closesAt: '17:00' },
        ],
      });
      expect(await open(t, t.alex)).toEqual(['08:00-12:00', '13:00-17:00']);
      expect(await open(t, t.alex, { startsAt: '2027-04-06T00:00:00.000Z', endsAt: '2027-04-06T23:59:00.000Z' })).toEqual([]);
    });

    it('a custom schedule with no days is a resource that never works, which is not inheriting', async () => {
      const t = await newShop('rh-never');
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [] });
      expect(await getResourceWorkingHours(t.db, { organizationId: t.organizationId, resourceId: t.alex })).toEqual({ mode: 'custom', periods: [] });
      expect(await open(t, t.alex)).toEqual([]);
    });

    it('goes back to inheriting, taking its own hours with it', async () => {
      const t = await newShop('rh-back');
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '10:00' }] });
      await inheritOrganizationHours(t.db, { resourceId: t.alex });
      expect(await getResourceWorkingHours(t.db, { organizationId: t.organizationId, resourceId: t.alex })).toEqual({ mode: 'inherit' });
      const left = await pg.query('select count(*)::int as n from public.resource_working_hours where resource_id = $1', [t.alex]);
      expect(left.rows[0].n).toBe(0);
    });

    it('subtracts an exception from the middle of the open time', async () => {
      const t = await newShop('rh-exception');
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '17:00' }] });
      await createResourceAvailabilityException(t.db, { resourceId: t.alex, startsAt: T('12:00'), endsAt: T('14:00'), reason: 'Dentist' });
      expect(await open(t, t.alex)).toEqual(['09:00-12:00', '14:00-17:00']);
    });

    it('applies the same exception semantics to a vehicle', async () => {
      const t = await newShop('rh-van');
      await createResourceAvailabilityException(t.db, { resourceId: t.van, startsAt: T('08:00'), endsAt: T('12:00'), reason: 'Maintenance' });
      expect(await open(t, t.van, WINDOW('06:00', '18:00'))).toEqual(['06:00-08:00', '12:00-18:00']);
    });

    it('feeds the one free-time calculation: open − exception − commitment', async () => {
      const t = await newShop('rh-free');
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '17:00' }] });
      await createResourceAvailabilityException(t.db, { resourceId: t.alex, startsAt: T('12:00'), endsAt: T('13:00') });
      const id = await job(t, 'Committed', [t.alex]);
      await scheduleWorkItem(t.db, { workItemId: id, ...WINDOW('14:00', '15:00') });

      const [day] = await listScheduleDays(t.db, { organizationId: t.organizationId, dates: ['2027-04-05'], timeZone: 'UTC' });
      const lane = day.resources.find((r) => r.resource.id === t.alex)!;
      expect(asText(lane.open)).toEqual(['09:00-12:00', '13:00-17:00']);
      expect(asText(lane.free)).toEqual(['09:00-12:00', '13:00-14:00', '15:00-17:00']);
      expect(lane.exceptions).toHaveLength(1);
    });
  });

  describe('scheduling', () => {
    it('leaves a resource that has said nothing exactly as it was: outside business hours is still allowed', async () => {
      const t = await newShop('rh-compat');
      await addOperatingHours(t.db, { organizationId: t.organizationId, dayOfWeek: 1, opensAt: '08:00', closesAt: '17:00' });
      const id = await job(t, 'Late', [t.alex]);
      await expect(scheduleWorkItem(t.db, { workItemId: id, ...WINDOW('20:00', '21:00') })).resolves.toBeUndefined();
    });

    it('refuses a window outside an assigned resource’s hours, by name, through the domain and the function', async () => {
      const t = await newShop('rh-refuse');
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [{ dayOfWeek: 1, opensAt: '12:00', closesAt: '17:00' }] });
      const id = await job(t, 'Early', [t.alex]);

      await expect(scheduleWorkItem(t.db, { workItemId: id, ...WINDOW('10:00', '11:00') })).rejects.toMatchObject({
        code: 'scheduling.resource_not_working',
        message: 'Alex is not working at that time',
      });

      // Around the domain layer: the authoritative function says the same.
      const direct = await t.db.rpc('schedule_work_item', {
        p_work_item_id: id,
        p_resource_ids: null as never,
        p_starts_at: T('10:00'),
        p_ends_at: T('11:00'),
      });
      expect(direct.error?.code).toBe('GD013');

      await expect(scheduleWorkItem(t.db, { workItemId: id, ...WINDOW('13:00', '14:00') })).resolves.toBeUndefined();
    });

    it('refuses a window over a resource’s time off and says when', async () => {
      const t = await newShop('rh-off');
      await createResourceAvailabilityException(t.db, { resourceId: t.van, startsAt: T('13:00'), endsAt: T('15:00'), reason: 'Servicing' });
      const id = await job(t, 'Van job', [t.van]);
      await expect(scheduleWorkItem(t.db, { workItemId: id, ...WINDOW('14:00', '14:30') })).rejects.toMatchObject({
        code: 'scheduling.resource_not_working',
        message: 'Service Van 1 is unavailable from 2027-04-05 13:00 to 2027-04-05 15:00',
      });
    });

    it('validates every assigned resource: the window must fit the intersection', async () => {
      const t = await newShop('rh-multi');
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '17:00' }] });
      await setResourceWorkingHours(t.db, { resourceId: t.van, periods: [{ dayOfWeek: 1, opensAt: '10:00', closesAt: '16:00' }] });
      const id = await job(t, 'Both', [t.alex, t.van]);

      await expect(scheduleWorkItem(t.db, { workItemId: id, ...WINDOW('09:30', '10:30') })).rejects.toMatchObject({
        message: 'Service Van 1 is not working at that time',
      });
      await expect(scheduleWorkItem(t.db, { workItemId: id, ...WINDOW('10:00', '11:00') })).resolves.toBeUndefined();
    });

    it('validates a resource added to scheduled work, leaves the others alone, and allows removal', async () => {
      const t = await newShop('rh-reassign');
      await setResourceWorkingHours(t.db, { resourceId: t.machine, periods: [{ dayOfWeek: 1, opensAt: '12:00', closesAt: '17:00' }] });
      const id = await job(t, 'Booked', [t.alex]);
      await scheduleWorkItem(t.db, { workItemId: id, ...WINDOW('10:00', '11:00') });

      await expect(setWorkItemResources(t.db, { workItemId: id, resourceIds: [t.alex, t.machine] })).rejects.toMatchObject({
        code: 'scheduling.resource_not_working',
      });
      const after = await getWorkItem(t.db, { organizationId: t.organizationId, workItemId: id });
      expect(after!.resources.map((r) => r.id)).toEqual([t.alex]);

      await expect(setWorkItemResources(t.db, { workItemId: id, resourceIds: [] })).resolves.toBeUndefined();
    });

    it('keeps scheduled-but-unassigned work valid: nobody’s hours are asked', async () => {
      const t = await newShop('rh-unassigned');
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [] });
      const id = await job(t, 'Nobody', []);
      await expect(scheduleWorkItem(t.db, { workItemId: id, ...WINDOW('03:00', '04:00') })).resolves.toBeUndefined();
    });
  });

  describe('work already booked', () => {
    it('is neither moved nor refused when hours change, and is flagged', async () => {
      const t = await newShop('rh-existing');
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '17:00' }] });
      const id = await job(t, 'Ten to eleven', [t.alex]);
      await scheduleWorkItem(t.db, { workItemId: id, ...WINDOW('10:00', '11:00') });
      expect(await listAvailabilityConflicts(t.db, { organizationId: t.organizationId, within: DAY })).toEqual([]);

      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [{ dayOfWeek: 1, opensAt: '12:00', closesAt: '17:00' }] });

      const item = await getWorkItem(t.db, { organizationId: t.organizationId, workItemId: id });
      expect(item!.window).toEqual(WINDOW('10:00', '11:00'));
      expect(await listAvailabilityConflicts(t.db, { organizationId: t.organizationId, within: DAY })).toEqual([
        { workItemId: id, resourceId: t.alex, problem: 'outside_hours' },
      ]);

      // And the schedule says so on the booking itself.
      const [day] = await listScheduleDays(t.db, { organizationId: t.organizationId, dates: ['2027-04-05'], timeZone: 'UTC' });
      expect(day.resources.find((r) => r.resource.id === t.alex)!.booked[0].availabilityProblem).toBe('outside_hours');
    });

    it('is neither moved nor refused when time off is added over it, and is flagged', async () => {
      const t = await newShop('rh-existing-off');
      const id = await job(t, 'Booked', [t.alex]);
      await scheduleWorkItem(t.db, { workItemId: id, ...WINDOW('10:00', '11:00') });

      const exceptionId = await createResourceAvailabilityException(t.db, { resourceId: t.alex, startsAt: T('09:00'), endsAt: T('12:00'), reason: 'Sick' });
      expect((await getWorkItem(t.db, { organizationId: t.organizationId, workItemId: id }))!.window).toEqual(WINDOW('10:00', '11:00'));
      expect(await listAvailabilityConflicts(t.db, { organizationId: t.organizationId, within: DAY })).toEqual([
        { workItemId: id, resourceId: t.alex, problem: 'unavailable' },
      ]);

      // Removing the time off clears the flag: it was derived, never stored.
      await deleteResourceAvailabilityException(t.db, { id: exceptionId });
      expect(await listAvailabilityConflicts(t.db, { organizationId: t.organizationId, within: DAY })).toEqual([]);
    });
  });

  describe('public booking', () => {
    async function bookable(t: Shop) {
      await updateOrganization(t.db, {
        id: t.organizationId,
        name: (await getOrganization(t.db, t.organizationId))!.name,
        timezone: 'UTC',
        currency: 'EUR',
        bufferMinutes: 0,
        slug: `rh-${randomUUID().slice(0, 8)}`,
      });
      await pg.query('delete from public.resources where organization_id = $1 and id <> $2', [t.organizationId, t.alex]);
      await setModuleEnabled(t.db, { organizationId: t.organizationId, key: 'booking', enabled: true });
      await setTypeBookable(t.db, { id: t.typeId, statusId: t.bookedId, durationMinutes: 60 });
    }
    const visitor = async (t: Shop) => {
      const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      await beginBooking(db, { organizationId: t.organizationId });
      return db;
    };
    const slotsFor = async (t: Shop, db: SupabaseClient) => {
      const [type] = await listBookableTypes(db, { organizationId: t.organizationId });
      return { type, slots: await bookableSlots(db, { organizationId: t.organizationId, type, date: '2027-04-05', timeZone: 'UTC' }) };
    };

    it('offers no slot outside the resource’s hours, though nothing is booked there', async () => {
      const t = await newShop('rh-slots');
      await bookable(t);
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '12:00' }] });
      const { slots } = await slotsFor(t, await visitor(t));
      expect(slots.map((s) => s.startsAt.slice(11, 16))).toEqual(['09:00', '10:00', '11:00']);
    });

    it('offers no slot over the resource’s time off', async () => {
      const t = await newShop('rh-slots-off');
      await bookable(t);
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '17:00' }] });
      await createResourceAvailabilityException(t.db, { resourceId: t.alex, startsAt: T('13:00'), endsAt: T('15:00') });
      const { slots } = await slotsFor(t, await visitor(t));
      const starts = slots.map((s) => s.startsAt.slice(11, 16));
      expect(starts).not.toContain('13:00');
      expect(starts).not.toContain('14:00');
      expect(starts).toContain('12:00');
      expect(starts).toContain('15:00');
    });

    it('refuses a stale slot when the hours changed after it was offered', async () => {
      const t = await newShop('rh-stale');
      await bookable(t);
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '17:00' }] });
      const guest = await visitor(t);
      const { type, slots } = await slotsFor(t, guest);
      const wanted = slots.find((s) => s.startsAt.startsWith('2027-04-05T10:00'))!;

      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [{ dayOfWeek: 1, opensAt: '13:00', closesAt: '17:00' }] });

      await expect(
        bookSlot(guest, { organizationId: t.organizationId, typeId: type.id, slot: wanted, name: 'Late', email: 'late@example.test', phone: '' }),
      ).rejects.toMatchObject({ code: 'booking.not_working' });
      const made = await pg.query('select count(*)::int as n from public.work_items where organization_id = $1', [t.organizationId]);
      expect(made.rows[0].n).toBe(0);
    });

    it('refuses a stale slot when time off was added after it was offered', async () => {
      const t = await newShop('rh-stale-off');
      await bookable(t);
      const guest = await visitor(t);
      const { type, slots } = await slotsFor(t, guest);
      const wanted = slots.find((s) => s.startsAt.startsWith('2027-04-05T10:00'))!;

      await createResourceAvailabilityException(t.db, { resourceId: t.alex, startsAt: T('09:00'), endsAt: T('12:00') });

      await expect(
        bookSlot(guest, { organizationId: t.organizationId, typeId: type.id, slot: wanted, name: 'Late', email: 'late@example.test', phone: '' }),
      ).rejects.toMatchObject({ code: 'booking.not_working' });
    });
  });

  describe('time zones', () => {
    it('reads recurring hours in the organization’s zone, whatever the server’s', async () => {
      const toronto = await newShop('rh-toronto', 'America/Toronto');
      await setResourceWorkingHours(toronto.db, { resourceId: toronto.alex, periods: [{ dayOfWeek: 1, opensAt: '10:00', closesAt: '12:00' }] });
      // 2027-04-05 is EDT (UTC-4): 10:00 local is 14:00Z.
      expect(await open(toronto, toronto.alex, { startsAt: '2027-04-05T00:00:00.000Z', endsAt: '2027-04-06T00:00:00.000Z' })).toEqual(['14:00-16:00']);

      const amsterdam = await newShop('rh-amsterdam', 'Europe/Amsterdam');
      await setResourceWorkingHours(amsterdam.db, { resourceId: amsterdam.alex, periods: [{ dayOfWeek: 1, opensAt: '10:00', closesAt: '12:00' }] });
      // CEST (UTC+2): 10:00 local is 08:00Z.
      expect(await open(amsterdam, amsterdam.alex, { startsAt: '2027-04-05T00:00:00.000Z', endsAt: '2027-04-06T00:00:00.000Z' })).toEqual(['08:00-10:00']);
    });

    it('keeps 09:00 at 09:00 across spring-forward and fall-back', async () => {
      const t = await newShop('rh-dst', 'America/Toronto');
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: everyDay('09:00', '10:00') });
      const at = async (from: string, to: string) =>
        (await listResourceOpenWindows(t.db, { organizationId: t.organizationId, within: { startsAt: from, endsAt: to }, resourceIds: [t.alex] }))
          .get(t.alex)!
          .map((w) => w.startsAt);

      // Sat 2027-03-13 is EST, Sun 2027-03-14 is EDT: nine o'clock moves an hour earlier in UTC, never in the room.
      expect(await at('2027-03-13T00:00:00.000Z', '2027-03-13T23:00:00.000Z')).toEqual(['2027-03-13T14:00:00.000Z']);
      expect(await at('2027-03-14T05:00:00.000Z', '2027-03-15T04:00:00.000Z')).toEqual(['2027-03-14T13:00:00.000Z']);
      // Fall back: Sat 2027-11-06 is EDT, Sun 2027-11-07 is EST.
      expect(await at('2027-11-06T04:00:00.000Z', '2027-11-07T03:00:00.000Z')).toEqual(['2027-11-06T13:00:00.000Z']);
      expect(await at('2027-11-07T05:00:00.000Z', '2027-11-08T05:00:00.000Z')).toEqual(['2027-11-07T14:00:00.000Z']);
    });

    it('produces one window, never a duplicate or malformed one, in the repeated hour', async () => {
      const t = await newShop('rh-repeat', 'America/Toronto');
      // 01:00–02:00 happens twice on 2027-11-07. A recurring rule names it once.
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [{ dayOfWeek: 7, opensAt: '01:00', closesAt: '02:00' }] });
      const windows = (
        await listResourceOpenWindows(t.db, {
          organizationId: t.organizationId,
          within: { startsAt: '2027-11-07T04:00:00.000Z', endsAt: '2027-11-08T05:00:00.000Z' },
          resourceIds: [t.alex],
        })
      ).get(t.alex)!;
      expect(windows).toHaveLength(1);
      expect(new Date(windows[0].endsAt).getTime()).toBeGreaterThan(new Date(windows[0].startsAt).getTime());
    });

    it('keeps a late-evening window on the organization’s calendar day', async () => {
      const t = await newShop('rh-midnight', 'America/Toronto');
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [{ dayOfWeek: 1, opensAt: '22:00', closesAt: '23:59' }] });
      // Mon 22:00 EDT is Tue 02:00Z — a different UTC date from the local one.
      expect(await open(t, t.alex, { startsAt: '2027-04-06T00:00:00.000Z', endsAt: '2027-04-06T12:00:00.000Z' })).toEqual(['02:00-03:59']);
    });
  });

  describe('authority and validation', () => {
    it('refuses overlapping periods, even around the domain', async () => {
      const t = await newShop('rh-overlap');
      await expect(
        setResourceWorkingHours(t.db, {
          resourceId: t.alex,
          periods: [
            { dayOfWeek: 1, opensAt: '08:00', closesAt: '12:00' },
            { dayOfWeek: 1, opensAt: '11:00', closesAt: '14:00' },
          ],
        }),
      ).rejects.toMatchObject({ code: 'resource_hours.overlap' });

      const direct = await t.db.rpc('set_resource_working_hours', {
        p_resource_id: t.alex,
        p_hours: [
          { day_of_week: 1, opens_at: '08:00', closes_at: '12:00' },
          { day_of_week: 1, opens_at: '11:00', closes_at: '14:00' },
        ],
      });
      expect(direct.error?.code).toBe('23P01');
      expect(await getResourceWorkingHours(t.db, { organizationId: t.organizationId, resourceId: t.alex })).toEqual({ mode: 'inherit' });
    });

    it('refuses an exception that ends before it starts', async () => {
      const t = await newShop('rh-reversed');
      await expect(
        createResourceAvailabilityException(t.db, { resourceId: t.alex, startsAt: T('12:00'), endsAt: T('11:00') }),
      ).rejects.toMatchObject({ code: 'resource_exceptions.ends_before_starts' });
      const direct = await t.db.rpc('create_resource_availability_exception', {
        p_resource_id: t.alex,
        p_starts_at: T('12:00'),
        p_ends_at: T('12:00'),
        p_reason: '',
      });
      expect(direct.error?.code).toBe('23514');
    });

    it('lets nobody write another business’s resource, or any table directly', async () => {
      const mine = await newShop('rh-mine');
      const theirs = await newShop('rh-theirs');

      await expect(setResourceWorkingHours(mine.db, { resourceId: theirs.alex, periods: [] })).rejects.toMatchObject({ code: 'resource_hours.forbidden' });
      await expect(
        createResourceAvailabilityException(mine.db, { resourceId: theirs.alex, startsAt: T('09:00'), endsAt: T('10:00') }),
      ).rejects.toMatchObject({ code: 'resource_exceptions.forbidden' });

      const direct = await mine.db.from('resource_availability_exceptions').insert({
        organization_id: mine.organizationId,
        resource_id: mine.alex,
        starts_at: T('09:00'),
        ends_at: T('10:00'),
        created_by: mine.userId,
      });
      expect(direct.error?.message).toMatch(/permission denied/i);

      // Reads stay inside the business.
      await createResourceAvailabilityException(theirs.db, { resourceId: theirs.alex, startsAt: T('09:00'), endsAt: T('10:00') });
      expect(await listResourceAvailabilityExceptions(mine.db, { organizationId: theirs.organizationId })).toEqual([]);
      const read = await mine.db.rpc('resource_open_windows', { p_organization_id: theirs.organizationId, p_from: T('00:00'), p_to: T('12:00') });
      expect(read.error).toBeNull();
      expect(read.data).toEqual([]);
    });

    it('records who changed what, in the ordinary event stream', async () => {
      const t = await newShop('rh-events');
      await setResourceWorkingHours(t.db, { resourceId: t.alex, periods: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '10:00' }] });
      const id = await createResourceAvailabilityException(t.db, { resourceId: t.alex, startsAt: T('09:00'), endsAt: T('10:00'), reason: 'Leave' });
      await deleteResourceAvailabilityException(t.db, { id });
      const events = await pg.query(
        `select action from public.events where organization_id = $1 and entity_id = $2 and action like 'resource.%' order by occurred_at, action`,
        [t.organizationId, t.alex],
      );
      expect(events.rows.map((r) => r.action)).toEqual(
        expect.arrayContaining([
          'resource.working_hours_changed',
          'resource.availability_exception_created',
          'resource.availability_exception_removed',
        ]),
      );
    });
  });
});

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { beginBooking, bookSlot, bookableSlots, listBookableTypes, type Slot } from '@/lib/domain/booking/booking';
import { createResourceCapability } from '@/lib/domain/resources/resource-capabilities';
import { createResource } from '@/lib/domain/resources/resources';
import {
  checkAssignedResources,
  checkWorkTypeFeasibility,
  feasibleSlots,
  loadFeasibilityData,
  loadPublicFeasibilityData,
} from '@/lib/domain/scheduling/feasibility';
import { addOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import {
  createResourceAvailabilityException,
  setResourceWorkingHours,
} from '@/lib/domain/scheduling/resource-availability';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { getOrganization, updateOrganization } from '@/lib/domain/tenancy/organizations';
import { createResourceRequirement } from '@/lib/domain/work-items/requirements';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType, setTypeBookable } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Multi-resource feasibility: a complete, distinct set of resources — each eligible, open and
 * uncommitted — exists for an interval, or it does not and the reasons say why. Proved against the
 * real database: the staff reader, the visitor's reader, and the booking transaction that has to
 * agree with both.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// Monday 2027-04-05.
const T = (hh: string) => `2027-04-05T${hh}:00.000Z`;
const DAY = { startsAt: T('00:00'), endsAt: '2027-04-06T00:00:00.000Z' };
const clock = (iso: string) => iso.slice(11, 16);

type Person = { db: SupabaseClient; userId: string; email: string };

type Garage = Person & {
  organizationId: string;
  bookedId: string;
  tire: string;
  mobile: string;
  oil: string;
  mobileType: string;
  alex: string;
  jo: string;
  van1: string;
  van2: string;
  names: Record<string, string>;
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
 * The example the work order ends on: Alex 09–17, Jo 12–20 (both tire technicians), Van 1 08–16 and
 * Van 2 12–18 (both mobile vans), and a kind of work that needs one of each.
 */
async function newGarage(label: string): Promise<Garage> {
  const person = await signUp(label);
  const organizationId = (await foundBusiness({
    ownerEmail: person.email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  })) as string;

  const tire = await createResourceCapability(person.db, { organizationId, name: 'Tire service' });
  const mobile = await createResourceCapability(person.db, { organizationId, name: 'Mobile service' });
  const oil = await createResourceCapability(person.db, { organizationId, name: 'Oil change' });

  const mobileType = await createWorkItemType(person.db, { organizationId, name: 'Mobile tire change', schedulable: true });
  const bookedId = await createWorkItemStatus(person.db, { organizationId, typeId: mobileType, name: 'Booked' });
  await createResourceRequirement(person.db, { typeId: mobileType, resourceClass: 'person', quantity: 1, capabilityIds: [tire] });
  await createResourceRequirement(person.db, { typeId: mobileType, resourceClass: 'vehicle', quantity: 1, capabilityIds: [mobile] });

  const make = (name: string, resourceClass: 'person' | 'vehicle', capabilityIds: string[], hours: [string, string]) =>
    createResource(person.db, { organizationId, name, resourceClass, capabilityIds }).then(async (id) => {
      await setResourceWorkingHours(person.db, { resourceId: id, periods: everyDay(...hours) });
      return id;
    });

  const alex = await make('Alex', 'person', [tire], ['09:00', '17:00']);
  const jo = await make('Jo', 'person', [tire], ['12:00', '20:00']);
  const van1 = await make('Service Van 1', 'vehicle', [mobile], ['08:00', '16:00']);
  const van2 = await make('Service Van 2', 'vehicle', [mobile], ['12:00', '18:00']);

  return {
    ...person,
    organizationId,
    bookedId,
    tire,
    mobile,
    oil,
    mobileType,
    alex,
    jo,
    van1,
    van2,
    names: { [alex]: 'Alex', [jo]: 'Jo', [van1]: 'Van 1', [van2]: 'Van 2' },
  };
}

const check = (g: Garage, start: string, end: string, extra: { excludeWorkItemId?: string; prefer?: string[] } = {}) =>
  checkWorkTypeFeasibility(g.db, {
    organizationId: g.organizationId,
    workTypeId: g.mobileType,
    timeZone: 'UTC',
    start: T(start),
    end: T(end),
    ...extra,
  });

/** Removes resources the way a test needs to: their schedules and capabilities first, then the rows. */
async function removeResources(g: Garage, ids: string[]) {
  await pg.query('delete from public.resource_working_schedules where resource_id = any($1)', [ids]);
  await pg.query('delete from public.resource_capability_assignments where resource_id = any($1)', [ids]);
  await pg.query('delete from public.resources where organization_id = $1 and id = any($2)', [g.organizationId, ids]);
}

async function booked(g: Garage, resourceIds: string[], from: string, to: string, title = 'Existing job') {
  const id = await createWorkItem(g.db, { organizationId: g.organizationId, title, statusId: g.bookedId, resourceIds });
  await scheduleWorkItem(g.db, { workItemId: id, startsAt: T(from), endsAt: T(to) });
  return id;
}

describe('multi-resource feasibility', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    pg = new Client({ connectionString: CONNECTION });
    await pg.connect();
  });
  afterAll(async () => {
    await pg.end();
  });

  describe('one interval, for staff', () => {
    it('finds Alex and Van 1 at 10–11, and says who is eligible, open and free', async () => {
      const g = await newGarage('fe-basic');
      const result = await check(g, '10:00', '11:00');
      expect(result.feasible).toBe(true);
      expect(result.combination!.map((entry) => entry.resourceId)).toEqual([g.alex, g.van1]);

      const [person, vehicle] = result.requirements;
      expect(person.eligibleResourceIds).toEqual([g.alex, g.jo]);
      // Jo does not start until noon, Van 2 neither: eligible, but not open.
      expect(person.openResourceIds).toEqual([g.alex]);
      expect(vehicle.openResourceIds).toEqual([g.van1]);
      expect(vehicle.freeResourceIds).toEqual([g.van1]);
      expect(result.reasons).toEqual([]);
    });

    it('switches to the other van when the first is busy, with no change to the requirements', async () => {
      const g = await newGarage('fe-alt');
      await booked(g, [g.van1], '13:00', '14:00');
      const result = await check(g, '13:00', '14:00');
      expect(result.feasible).toBe(true);
      expect(result.combination!.map((entry) => entry.resourceId)).toEqual([g.alex, g.van2]);
    });

    it('explains an interval nobody can be both open for: 17:30–18:30', async () => {
      const g = await newGarage('fe-late');
      const result = await check(g, '17:30', '18:30');
      expect(result.feasible).toBe(false);
      // Jo can do the person role; both vans have closed or close before the end. A calendar reason, not a configuration one.
      expect(result.reasons.some((reason) => reason.code === 'no_eligible_resource')).toBe(false);
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          { code: 'resource_not_working', requirementId: expect.any(String), resourceId: g.van1 },
          { code: 'resource_not_working', requirementId: expect.any(String), resourceId: g.van2 },
        ]),
      );
    });

    it('says a vehicle is booked, not that none exists, when every van is open but committed', async () => {
      const g = await newGarage('fe-booked');
      await booked(g, [g.van1], '13:00', '14:00', 'One');
      await booked(g, [g.van2], '13:00', '14:00', 'Two');
      const result = await check(g, '13:00', '14:00');
      expect(result.feasible).toBe(false);
      const codes = result.reasons.map((reason) => reason.code);
      expect(codes).toContain('resource_already_committed');
      expect(codes).toContain('insufficient_free_resources');
      expect(codes).not.toContain('no_eligible_resource');
      expect(codes).not.toContain('resource_not_working');
    });

    it('says a resource is unavailable — not booked — when it has time off', async () => {
      const g = await newGarage('fe-off');
      await createResourceAvailabilityException(g.db, { resourceId: g.van1, startsAt: T('09:00'), endsAt: T('12:00'), reason: 'Maintenance' });
      const result = await check(g, '10:00', '11:00');
      expect(result.feasible).toBe(false);
      // Van 1 has time off; Van 2 has not started yet. Two different facts, named apart.
      expect(result.reasons).toEqual([
        { code: 'resource_unavailable', requirementId: expect.any(String), resourceId: g.van1 },
        { code: 'resource_not_working', requirementId: expect.any(String), resourceId: g.van2 },
      ]);
    });

    it('says there is no eligible resource when the business has none that could do it', async () => {
      const g = await newGarage('fe-none');
      await pg.query('delete from public.resource_capability_assignments where resource_id = any($1)', [[g.van1, g.van2]]);
      const result = await check(g, '10:00', '11:00');
      expect(result.reasons).toEqual([{ code: 'no_eligible_resource', requirementId: expect.any(String) }]);
    });

    it('reports the business being closed ahead of any resource', async () => {
      const g = await newGarage('fe-closed');
      for (const day of [1, 2, 3, 4, 5]) {
        await addOperatingHours(g.db, { organizationId: g.organizationId, dayOfWeek: day, opensAt: '08:00', closesAt: '17:00' });
      }
      const result = await check(g, '18:00', '19:00');
      expect(result.feasible).toBe(false);
      expect(result.reasons).toEqual([{ code: 'outside_organization_hours' }]);
    });

    it('is feasible with no requirements and an empty combination', async () => {
      const g = await newGarage('fe-zero');
      const free = await createWorkItemType(g.db, { organizationId: g.organizationId, name: 'Walk-in', schedulable: true });
      const result = await checkWorkTypeFeasibility(g.db, {
        organizationId: g.organizationId,
        workTypeId: free,
        timeZone: 'UTC',
        start: T('10:00'),
        end: T('11:00'),
      });
      expect(result.feasible).toBe(true);
      expect(result.combination).toEqual([]);
    });
  });

  describe('competition and quantity', () => {
    it('does not count one person twice: two requirements wanting the same technician', async () => {
      const g = await newGarage('fe-compete');
      const type = await createWorkItemType(g.db, { organizationId: g.organizationId, name: 'Two oil jobs', schedulable: true });
      const specialist = await createResource(g.db, { organizationId: g.organizationId, name: 'Sam', resourceClass: 'person', capabilityIds: [g.oil] });
      await createResourceRequirement(g.db, { typeId: type, resourceClass: 'person', quantity: 1, capabilityIds: [g.oil] });
      await createResourceRequirement(g.db, { typeId: type, resourceClass: 'person', quantity: 1, capabilityIds: [g.oil] });

      const result = await checkWorkTypeFeasibility(g.db, { organizationId: g.organizationId, workTypeId: type, timeZone: 'UTC', start: T('10:00'), end: T('11:00') });
      expect(result.feasible).toBe(false);
      expect(result.requirements.every((entry) => entry.freeResourceIds.length === 1 && entry.freeResourceIds[0] === specialist)).toBe(true);
      expect(result.reasons).toEqual([{ code: 'requirements_compete_for_same_resources', requirementIds: [expect.any(String)] }]);
    });

    it('finds the arrangement a greedy match misses', async () => {
      const g = await newGarage('fe-greedy');
      const type = await createWorkItemType(g.db, { organizationId: g.organizationId, name: 'Tire and oil', schedulable: true });
      // Alex does tires and oil; Jo (from the garage) does tires only. Tires listed first.
      await pg.query('insert into public.resource_capability_assignments (organization_id, resource_id, capability_id, created_by) values ($1, $2, $3, $4)', [g.organizationId, g.alex, g.oil, g.userId]);
      await createResourceRequirement(g.db, { typeId: type, resourceClass: 'person', quantity: 1, capabilityIds: [g.tire] });
      await createResourceRequirement(g.db, { typeId: type, resourceClass: 'person', quantity: 1, capabilityIds: [g.oil] });

      const result = await checkWorkTypeFeasibility(g.db, { organizationId: g.organizationId, workTypeId: type, timeZone: 'UTC', start: T('13:00'), end: T('14:00') });
      expect(result.feasible).toBe(true);
      expect(result.combination!.map((entry) => entry.resourceId)).toEqual([g.jo, g.alex]);
    });

    it('needs two distinct people for a quantity of two', async () => {
      const g = await newGarage('fe-quantity');
      const type = await createWorkItemType(g.db, { organizationId: g.organizationId, name: 'Installation', schedulable: true });
      await createResourceRequirement(g.db, { typeId: type, resourceClass: 'person', quantity: 2, capabilityIds: [g.tire] });
      const run = () => checkWorkTypeFeasibility(g.db, { organizationId: g.organizationId, workTypeId: type, timeZone: 'UTC', start: T('13:00'), end: T('14:00') });

      expect((await run()).combination!.map((entry) => entry.resourceId).sort()).toEqual([g.alex, g.jo].sort());

      await booked(g, [g.jo], '13:00', '14:00');
      const short = await run();
      expect(short.feasible).toBe(false);
      expect(short.requirements[0].missingQuantity).toBe(1);
    });
  });

  describe('rescheduling and exact selections', () => {
    it('does not let a job block itself, and still lets other work block it', async () => {
      const g = await newGarage('fe-exclude');
      const job = await booked(g, [g.alex, g.van1], '12:00', '13:00', 'Mine');

      // Moving to 12:30–13:30: Alex and Van 1 are held by this very job, and Jo/Van 2 can cover otherwise.
      const withoutExclusion = await check(g, '12:30', '13:30');
      expect(withoutExclusion.combination!.map((entry) => entry.resourceId)).toEqual([g.jo, g.van2]);

      const excluded = await check(g, '12:30', '13:30', { excludeWorkItemId: job, prefer: [g.alex, g.van1] });
      expect(excluded.combination!.map((entry) => entry.resourceId)).toEqual([g.alex, g.van1]);

      // Other work still counts.
      await booked(g, [g.alex], '13:00', '14:00', 'Somebody else');
      const blocked = await check(g, '12:30', '13:30', { excludeWorkItemId: job, prefer: [g.alex, g.van1] });
      expect(blocked.combination!.map((entry) => entry.resourceId)).toEqual([g.jo, g.van1]);
    });

    it('fails an exact selection when an extra resource beyond the requirements is unavailable', async () => {
      const g = await newGarage('fe-exact');
      const machine = await createResource(g.db, { organizationId: g.organizationId, name: 'Tire machine', resourceClass: 'equipment' });
      await createResourceAvailabilityException(g.db, { resourceId: machine, startsAt: T('09:00'), endsAt: T('12:00'), reason: 'Calibration' });

      const exact = (ids: string[]) =>
        checkAssignedResources(g.db, { organizationId: g.organizationId, workTypeId: g.mobileType, timeZone: 'UTC', start: T('10:00'), end: T('11:00'), resourceIds: ids });

      const good = await exact([g.alex, g.van1]);
      expect(good.ok).toBe(true);

      const withMachine = await exact([g.alex, g.van1, machine]);
      expect(withMachine.requirementsMet).toBe(true);
      expect(withMachine.allAvailable).toBe(false);
      expect(withMachine.resources.find((entry) => entry.resourceId === machine)!.problem).toBe('unavailable');

      const partial = await exact([g.alex]);
      expect(partial.allAvailable).toBe(true);
      expect(partial.requirementsMet).toBe(false);

      const wrongPerson = await exact([g.jo, g.van1]);
      expect(wrongPerson.allAvailable).toBe(false);
      expect(wrongPerson.resources.find((entry) => entry.resourceId === g.jo)!.problem).toBe('not_working');
    });

    it('returns the same suggestion every time', async () => {
      const g = await newGarage('fe-stable');
      const first = await check(g, '13:00', '14:00');
      for (let i = 0; i < 3; i += 1) expect((await check(g, '13:00', '14:00')).combination).toEqual(first.combination);
    });
  });

  describe('slots over a range', () => {
    it('offers only intervals where the whole set exists, and agrees with the single check', async () => {
      const g = await newGarage('fe-slots');
      const data = await loadFeasibilityData(g.db, { organizationId: g.organizationId, typeId: g.mobileType, range: DAY, timeZone: 'UTC' });
      const slots = feasibleSlots(data, { range: DAY, durationMinutes: 60, stepMinutes: 60 });
      // Alex 09–17 with Van 1 08–16 gives 09–16; at 16:00 Jo (to 20:00) and Van 2 (to 18:00) cover 16:00 and 17:00.
      expect(slots.map((slot) => clock(slot.startsAt))).toEqual(
        expect.arrayContaining(['09:00', '10:00', '15:00', '16:00', '17:00']),
      );
      expect(slots.map((slot) => clock(slot.startsAt))).not.toContain('08:00');
      expect(slots.map((slot) => clock(slot.startsAt))).not.toContain('18:00');

      for (const slot of slots) {
        const single = await checkWorkTypeFeasibility(g.db, { organizationId: g.organizationId, workTypeId: g.mobileType, timeZone: 'UTC', start: slot.startsAt, end: slot.endsAt });
        expect(single.feasible, slot.startsAt).toBe(true);
      }
    });

    it('drops a slot when only one resource of the set becomes unavailable', async () => {
      const g = await newGarage('fe-oneout');
      await createResourceAvailabilityException(g.db, { resourceId: g.van1, startsAt: T('10:00'), endsAt: T('11:00') });
      const data = await loadFeasibilityData(g.db, { organizationId: g.organizationId, typeId: g.mobileType, range: DAY, timeZone: 'UTC' });
      const starts = feasibleSlots(data, { range: DAY, durationMinutes: 60, stepMinutes: 60 }).map((slot) => clock(slot.startsAt));
      // Alex is perfectly free at ten and eleven; the van is not at ten.
      expect(starts).not.toContain('10:00');
      expect(starts).toContain('11:00');
    });

    it('loads with a constant number of reads however many resources there are', async () => {
      const g = await newGarage('fe-reads');
      for (let i = 0; i < 25; i += 1) {
        await createResource(g.db, { organizationId: g.organizationId, name: `Extra ${i}`, resourceClass: 'person', capabilityIds: [g.tire] });
      }
      let calls = 0;
      const counted = new Proxy(g.db, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if ((prop === 'from' || prop === 'rpc') && typeof value === 'function') {
            return (...args: unknown[]) => {
              calls += 1;
              return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
          }
          return value;
        },
      });
      await loadFeasibilityData(counted as SupabaseClient, { organizationId: g.organizationId, typeId: g.mobileType, range: DAY, timeZone: 'UTC' });
      const withMany = calls;
      calls = 0;
      const g2 = await newGarage('fe-reads-small');
      const countedSmall = new Proxy(g2.db, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if ((prop === 'from' || prop === 'rpc') && typeof value === 'function') {
            return (...args: unknown[]) => {
              calls += 1;
              return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
          }
          return value;
        },
      });
      await loadFeasibilityData(countedSmall as SupabaseClient, { organizationId: g2.organizationId, typeId: g2.mobileType, range: DAY, timeZone: 'UTC' });
      expect(withMany).toBe(calls);
    });
  });

  describe('public booking', () => {
    async function publish(g: Garage) {
      const org = await getOrganization(g.db, g.organizationId);
      await updateOrganization(g.db, {
        id: g.organizationId,
        name: org!.name,
        timezone: 'UTC',
        currency: 'EUR',
        bufferMinutes: 0,
        slug: `fe-${randomUUID().slice(0, 8)}`,
      });
      await setModuleEnabled(g.db, { organizationId: g.organizationId, key: 'booking', enabled: true });
      await setTypeBookable(g.db, { id: g.mobileType, statusId: g.bookedId, durationMinutes: 60 });
    }
    const visitor = async (g: Garage) => {
      const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
      await beginBooking(db, { organizationId: g.organizationId });
      return db;
    };
    const offer = async (g: Garage, db: SupabaseClient) => {
      const [type] = await listBookableTypes(db, { organizationId: g.organizationId });
      return { type, slots: await bookableSlots(db, { organizationId: g.organizationId, type, date: '2027-04-05', timeZone: 'UTC' }) };
    };
    const reserve = (g: Garage, db: SupabaseClient, typeId: string, slot: Slot, who: string) =>
      bookSlot(db, { organizationId: g.organizationId, typeId, slot, name: who, email: `${who}@example.test`, phone: '' });
    const taken = async (workItemId: string) =>
      (await pg.query('select resource_id from public.work_item_resource_assignments where work_item_id = $1', [workItemId])).rows.map((row) => row.resource_id as string);

    it('publishes a type that needs a person and a vehicle, offers times only, and books both', async () => {
      const g = await newGarage('fe-pub');
      await publish(g);
      const guest = await visitor(g);
      const { type, slots } = await offer(g, guest);

      expect(slots.length).toBeGreaterThan(0);
      // A visitor is told times. Nothing about who or what.
      for (const slot of slots) expect(Object.keys(slot).sort()).toEqual(['endsAt', 'startsAt']);
      expect(JSON.stringify(slots)).not.toContain(g.alex);
      expect(clock(slots[0].startsAt)).toBe('09:00');

      const item = await reserve(g, guest, type.id, slots[0], 'ariane');
      expect((await taken(item)).sort()).toEqual([g.alex, g.van1].sort());
      const count = await pg.query('select count(*)::int as n from public.work_items where id = $1', [item]);
      expect(count.rows[0].n).toBe(1);
    });

    it('offers a slot only while a person AND a vehicle are both free', async () => {
      const g = await newGarage('fe-pub-both');
      await publish(g);
      // Both vans off for the whole day they would otherwise work; both people are free.
      await createResourceAvailabilityException(g.db, { resourceId: g.van1, startsAt: T('08:00'), endsAt: T('16:00') });
      await createResourceAvailabilityException(g.db, { resourceId: g.van2, startsAt: T('12:00'), endsAt: T('18:00') });
      const { slots } = await offer(g, await visitor(g));
      // A person alone is not enough: no vehicle, no slot — however free the people are.
      expect(slots).toEqual([]);
    });

    it('books a quantity of two with two assignments, and only when two are free', async () => {
      const g = await newGarage('fe-pub-two');
      const crew = await createWorkItemType(g.db, { organizationId: g.organizationId, name: 'Installation', schedulable: true });
      const status = await createWorkItemStatus(g.db, { organizationId: g.organizationId, typeId: crew, name: 'Booked' });
      await createResourceRequirement(g.db, { typeId: crew, resourceClass: 'person', quantity: 2, capabilityIds: [g.tire] });
      const org = await getOrganization(g.db, g.organizationId);
      await updateOrganization(g.db, { id: g.organizationId, name: org!.name, timezone: 'UTC', currency: 'EUR', bufferMinutes: 0, slug: `fe-${randomUUID().slice(0, 8)}` });
      await setModuleEnabled(g.db, { organizationId: g.organizationId, key: 'booking', enabled: true });
      await setTypeBookable(g.db, { id: crew, statusId: status, durationMinutes: 60 });

      const guest = await visitor(g);
      const types = await listBookableTypes(guest, { organizationId: g.organizationId });
      const type = types.find((entry) => entry.id === crew)!;
      const slots = await bookableSlots(guest, { organizationId: g.organizationId, type, date: '2027-04-05', timeZone: 'UTC' });
      // Alex starts at nine but Jo at noon: two people exist together only from twelve.
      expect(clock(slots[0].startsAt)).toBe('12:00');

      const item = await reserve(g, guest, crew, slots[0], 'pair');
      expect((await taken(item)).sort()).toEqual([g.alex, g.jo].sort());
    });

    it('refuses a stale slot whole when a resource was taken after it was offered', async () => {
      const g = await newGarage('fe-pub-stale');
      await publish(g);
      // Leave exactly one combination.
      await removeResources(g, [g.jo, g.van2]);

      const guest = await visitor(g);
      const { type, slots } = await offer(g, guest);
      const wanted = slots.find((slot) => clock(slot.startsAt) === '10:00')!;
      await booked(g, [g.van1], '10:00', '11:00', 'Taken after the offer');

      await expect(reserve(g, guest, type.id, wanted, 'late')).rejects.toMatchObject({ code: 'booking.slot_taken' });
      const stray = await pg.query('select count(*)::int as n from public.work_items where organization_id = $1 and created_by = $2', [g.organizationId, (await guest.auth.getUser()).data.user!.id]);
      expect(stray.rows[0].n).toBe(0);
    });

    it('lets exactly one of two simultaneous bookings take the only combination', async () => {
      const g = await newGarage('fe-race-one');
      await publish(g);
      await removeResources(g, [g.jo, g.van2]);
      const [a, b] = [await visitor(g), await visitor(g)];
      const { type, slots } = await offer(g, a);
      const wanted = slots.find((slot) => clock(slot.startsAt) === '10:00')!;

      const results = await Promise.allSettled([reserve(g, a, type.id, wanted, 'first'), reserve(g, b, type.id, wanted, 'second')]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

      const rows = await pg.query(
        `select resource_id, count(*)::int as n from public.work_item_resource_assignments
          where organization_id = $1 and occupies is not null group by resource_id`,
        [g.organizationId],
      );
      expect(rows.rows.every((row) => row.n === 1)).toBe(true);
      expect(rows.rows).toHaveLength(2);
    });

    it('lets two simultaneous bookings both succeed on different complete combinations, never the same resource', async () => {
      const g = await newGarage('fe-race-two');
      await publish(g);
      // At 13:00 both people and both vans are open.
      const [a, b] = [await visitor(g), await visitor(g)];
      const { type, slots } = await offer(g, a);
      const wanted = slots.find((slot) => clock(slot.startsAt) === '13:00')!;

      const results = await Promise.allSettled([reserve(g, a, type.id, wanted, 'first'), reserve(g, b, type.id, wanted, 'second')]);
      expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);

      const rows = await pg.query(
        `select resource_id, count(*)::int as n from public.work_item_resource_assignments
          where organization_id = $1 and occupies is not null group by resource_id`,
        [g.organizationId],
      );
      expect(rows.rows).toHaveLength(4);
      expect(rows.rows.every((row) => row.n === 1)).toBe(true);
    });

    it('agrees with the staff reader: every public slot is feasible for staff, and the visitor facts match', async () => {
      const g = await newGarage('fe-agree');
      await publish(g);
      await booked(g, [g.van1], '10:00', '11:00');
      await createResourceAvailabilityException(g.db, { resourceId: g.alex, startsAt: T('14:00'), endsAt: T('15:00') });

      const guest = await visitor(g);
      const publicData = await loadPublicFeasibilityData(guest, { organizationId: g.organizationId, typeId: g.mobileType, range: DAY });
      const publicSlots = feasibleSlots(publicData, { range: DAY, durationMinutes: 60, stepMinutes: 60 });
      expect(publicSlots.length).toBeGreaterThan(0);
      for (const slot of publicSlots) {
        const staff = await checkWorkTypeFeasibility(g.db, { organizationId: g.organizationId, workTypeId: g.mobileType, timeZone: 'UTC', start: slot.startsAt, end: slot.endsAt });
        expect(staff.feasible, slot.startsAt).toBe(true);
        expect(staff.combination).toEqual(slot.combination);
      }
    });
  });
});

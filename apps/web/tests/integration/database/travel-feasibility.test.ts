import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RouteRequest, RouteResult, RoutingProvider } from '@/lib/adapters/routing';
import { createLocation, setLocationCoordinates } from '@/lib/domain/locations/locations';
import { createResourceCapability } from '@/lib/domain/resources/resource-capabilities';
import { createResource, getResource, setResourceRouting } from '@/lib/domain/resources/resources';
import { checkAssignedResources, checkWorkTypeFeasibility } from '@/lib/domain/scheduling/feasibility';
import { setResourceWorkingHours } from '@/lib/domain/scheduling/resource-availability';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { createResourceRequirement } from '@/lib/domain/work-items/requirements';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Travel feasibility against the real database: the route context a resource has is its real
 * assignments' neighbours, a Location is the canonical row with the coordinates it already holds,
 * the buffer is the organization's own, and what one business holds never reaches another's checks.
 * The router is a table the test controls; nothing here reaches a network.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// Monday 2027-04-05.
const T = (hh: string) => `2027-04-05T${hh}:00.000Z`;

type Person = { db: SupabaseClient; userId: string; email: string };

type Yard = Person & {
  organizationId: string;
  bookedId: string;
  jobType: string;
  alex: string;
  jo: string;
  /** Location ids by the letter a test uses for them. */
  place: Record<'A' | 'B' | 'C' | 'SHOP', string>;
};

/** Each place is a point on a line, so the fake can answer "how far" by what it is asked. */
const COORDINATES = { A: 10, B: 20, C: 30, SHOP: 40 } as const;

class Router implements RoutingProvider {
  readonly name = 'fake';
  readonly asked: string[] = [];
  constructor(private readonly minutes: Record<string, number | 'down'>, private readonly fallback: number = 5) {}
  async route(request: RouteRequest): Promise<RouteResult> {
    const name = (point: { latitude: number }) => Object.entries(COORDINATES).find(([, value]) => value === point.latitude)![0];
    const pair = `${name(request.origin)}>${name(request.destination)}`;
    this.asked.push(pair);
    const answer = this.minutes[pair] ?? this.fallback;
    if (answer === 'down') throw Object.assign(new Error('down'), { name: 'RoutingError', failure: 'provider_unavailable' });
    return { distanceMeters: answer * 1000, durationSeconds: answer * 60, provider: 'fake', calculatedAt: '2027-04-01T00:00:00.000Z' };
  }
}

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

const everyDay = (opensAt: string, closesAt: string) => [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({ dayOfWeek, opensAt, closesAt }));

/** A business with two technicians (08–18) who each go to the work, a job that needs one, and four places. */
async function newYard(label: string): Promise<Yard> {
  const person = await signUp(label);
  const organizationId = (await foundBusiness({
    ownerEmail: person.email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  })) as string;

  const skill = await createResourceCapability(person.db, { organizationId, name: 'Repairs' });
  const jobType = await createWorkItemType(person.db, { organizationId, name: 'Callout', schedulable: true });
  const bookedId = await createWorkItemStatus(person.db, { organizationId, typeId: jobType, name: 'Booked' });
  await createResourceRequirement(person.db, { typeId: jobType, resourceClass: 'person', quantity: 1, capabilityIds: [skill] });

  const technician = async (name: string, mode: 'mobile' | 'fixed' | null = 'mobile', base: string | null = null) => {
    const id = await createResource(person.db, { organizationId, name, resourceClass: 'person', capabilityIds: [skill] });
    await setResourceWorkingHours(person.db, { resourceId: id, periods: everyDay('08:00', '18:00') });
    if (mode || base) await setResourceRouting(person.db, { resourceId: id, travelMode: mode, baseLocationId: base });
    return id;
  };

  const place = {} as Yard['place'];
  for (const key of ['A', 'B', 'C', 'SHOP'] as const) {
    const id = await createLocation(person.db, { organizationId, label: key, address: `${key} Street 1` });
    await setLocationCoordinates(person.db, { id, latitude: COORDINATES[key], longitude: COORDINATES[key] });
    place[key] = id;
  }

  const alex = await technician('Alex');
  const jo = await technician('Jo');
  return { ...person, organizationId, bookedId, jobType, alex, jo, place };
}

const check = (y: Yard, start: string, end: string, extra: Partial<Parameters<typeof checkWorkTypeFeasibility>[1]> = {}) =>
  checkWorkTypeFeasibility(y.db, {
    organizationId: y.organizationId,
    workTypeId: y.jobType,
    timeZone: 'UTC',
    start: T(start),
    end: T(end),
    locationId: y.place.B,
    ...extra,
  });

async function job(y: Yard, resourceId: string, at: keyof Yard['place'], from: string, to: string) {
  const id = await createWorkItem(y.db, { organizationId: y.organizationId, title: `Job at ${at}`, statusId: y.bookedId, locationId: y.place[at], resourceIds: [resourceId] });
  await scheduleWorkItem(y.db, { workItemId: id, startsAt: T(from), endsAt: T(to) });
  return id;
}

describe('travel feasibility', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    pg = new Client({ connectionString: CONNECTION });
    await pg.connect();
  });
  afterAll(async () => {
    await pg.end();
  });

  describe('a resource’s routing facts', () => {
    it('keeps what the business said, and nothing it did not', async () => {
      const y = await newYard('tr-facts');
      const bare = await createResource(y.db, { organizationId: y.organizationId, name: 'Bare', resourceClass: 'vehicle', capabilityIds: [] });
      expect(await getResource(y.db, { organizationId: y.organizationId, resourceId: bare })).toMatchObject({ travelMode: null, baseLocationId: null });

      await setResourceRouting(y.db, { resourceId: bare, travelMode: 'fixed', baseLocationId: y.place.SHOP });
      expect(await getResource(y.db, { organizationId: y.organizationId, resourceId: bare })).toMatchObject({ travelMode: 'fixed', baseLocationId: y.place.SHOP });
    });

    it('makes another business’s Location impossible as a base', async () => {
      const mine = await newYard('tr-iso-a');
      const theirs = await newYard('tr-iso-b');
      await expect(
        setResourceRouting(mine.db, { resourceId: mine.alex, travelMode: 'mobile', baseLocationId: theirs.place.SHOP }),
      ).rejects.toMatchObject({ code: 'resources.base_location_invalid' });

      // And not through any other door either: the composite key is the thing refusing, not the function.
      const direct = await pg.query(
        `update public.resources set base_location_id = $1 where id = $2`,
        [theirs.place.SHOP, mine.alex],
      ).then(() => null, (error: { code?: string }) => error.code);
      expect(direct).toBe('23503');
    });

    it('refuses a mode that is neither', async () => {
      const y = await newYard('tr-mode');
      const code = await pg.query(`update public.resources set travel_mode = 'flying' where id = $1`, [y.alex]).then(() => null, (error: { code?: string }) => error.code);
      expect(code).toBe('23514');
    });

    it('lets a base go without losing the resource', async () => {
      const y = await newYard('tr-base-gone');
      await setResourceRouting(y.db, { resourceId: y.alex, travelMode: 'mobile', baseLocationId: y.place.SHOP });
      // No signed-in role may delete a Location; the database does, as the owner would on cleanup.
      await pg.query('delete from public.locations where id = $1', [y.place.SHOP]);
      expect(await getResource(y.db, { organizationId: y.organizationId, resourceId: y.alex })).toMatchObject({ travelMode: 'mobile', baseLocationId: null });
    });
  });

  describe('the route context, from real assignments', () => {
    it('travels from the nearest earlier job, not the first, and judges it against the gap', async () => {
      const y = await newYard('tr-prev');
      await setResourceRouting(y.db, { resourceId: y.jo, travelMode: null, baseLocationId: null });
      await job(y, y.alex, 'C', '08:00', '09:00');
      await job(y, y.alex, 'A', '09:30', '10:00');
      const router = new Router({ 'A>B': 38, 'C>B': 1 });

      const result = await check(y, '10:15', '11:15', { routing: router });

      // 10:00 → 10:15 is fifteen minutes; A to B is thirty-eight. Jo does not travel and is the answer.
      expect(result.combination).toEqual([{ requirementId: expect.any(String), resourceId: y.jo }]);
      expect(result.requirements[0].freeResourceIds).toEqual([y.alex, y.jo]);
      expect(result.requirements[0].travelFeasibleResourceIds).toEqual([y.jo]);
      expect(router.asked).toEqual(['A>B']);
    });

    it('says why, in numbers, when nobody can arrive', async () => {
      const y = await newYard('tr-numbers');
      await setResourceRouting(y.db, { resourceId: y.jo, travelMode: 'mobile', baseLocationId: y.place.SHOP });
      await job(y, y.alex, 'A', '09:00', '10:00');
      await job(y, y.jo, 'C', '09:00', '10:00');
      const result = await check(y, '10:15', '11:15', { routing: new Router({ 'A>B': 38, 'C>B': 25 }) });

      expect(result.feasible).toBe(false);
      expect(result.reasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'travel_from_previous_too_long', resourceId: y.alex, availableSeconds: 15 * 60, requiredSeconds: 38 * 60 }),
          expect.objectContaining({ code: 'travel_from_previous_too_long', resourceId: y.jo, availableSeconds: 15 * 60, requiredSeconds: 25 * 60 }),
        ]),
      );
    });

    it('lets a later time work for the same resource', async () => {
      const y = await newYard('tr-later');
      await setResourceRouting(y.db, { resourceId: y.jo, travelMode: null, baseLocationId: null });
      await job(y, y.alex, 'A', '09:00', '10:00');
      const router = new Router({ 'A>B': 38 });
      expect((await check(y, '10:15', '11:15', { routing: router })).combination![0].resourceId).toBe(y.jo);
      const later = await check(y, '11:00', '12:00', { routing: router, prefer: [y.alex] });
      expect(later.combination![0].resourceId).toBe(y.alex);
    });

    it('does not let the job being moved be its own neighbour', async () => {
      const y = await newYard('tr-self');
      await setResourceRouting(y.db, { resourceId: y.jo, travelMode: null, baseLocationId: null });
      const own = await job(y, y.alex, 'B', '10:00', '11:00');
      const router = new Router({ 'B>B': 999 });

      // Moving it to 10:30: without exclusion it would collide with itself and be "previous" to itself.
      const moved = await check(y, '10:30', '11:30', { excludeWorkItemId: own, routing: router, prefer: [y.alex] });
      expect(moved.combination![0].resourceId).toBe(y.alex);
      expect(moved.travel.find((t) => t.resourceId === y.alex)?.legs ?? []).toEqual([]);
      expect(router.asked).toEqual([]);
    });

    it('checks the way out to the next job as well', async () => {
      const y = await newYard('tr-next');
      await setResourceRouting(y.db, { resourceId: y.jo, travelMode: null, baseLocationId: null });
      await setResourceRouting(y.db, { resourceId: y.alex, travelMode: 'mobile', baseLocationId: y.place.SHOP });
      await job(y, y.alex, 'C', '12:30', '13:30');
      const router = new Router({ 'SHOP>B': 5, 'B>C': 40 });

      const result = await check(y, '11:00', '12:00', { routing: router, prefer: [y.alex] });
      expect(result.combination![0].resourceId).toBe(y.jo);
      expect(result.requirements[0].freeResourceIds).toContain(y.alex);
      expect(result.requirements[0].travelFeasibleResourceIds).not.toContain(y.alex);
    });

    it('starts from the base when nothing earlier is in the period', async () => {
      const y = await newYard('tr-base');
      await setResourceRouting(y.db, { resourceId: y.jo, travelMode: null, baseLocationId: null });
      await setResourceRouting(y.db, { resourceId: y.alex, travelMode: 'mobile', baseLocationId: y.place.SHOP });
      const router = new Router({ 'SHOP>B': 18 });
      const result = await check(y, '09:00', '10:00', { routing: router, prefer: [y.alex] });
      expect(result.combination![0].resourceId).toBe(y.alex);
      expect(result.travel[0].legs[0]).toMatchObject({ kind: 'base', requiredSeconds: 18 * 60, availableSeconds: 60 * 60, provider: 'fake' });
    });

    it('does not count the business’s buffer a second time', async () => {
      const y = await newYard('tr-buffer');
      await setResourceRouting(y.db, { resourceId: y.jo, travelMode: null, baseLocationId: null });
      await pg.query('update public.organizations set buffer_minutes = 15 where id = $1', [y.organizationId]);
      // Occupies 09:00–10:15 and 12:30–13:30. Candidate 10:45–11:45 occupies until 12:00.
      await job(y, y.alex, 'A', '09:00', '10:00');
      await job(y, y.alex, 'C', '12:30', '13:30');
      const router = new Router({ 'A>B': 30, 'B>C': 30 });

      const result = await check(y, '10:45', '11:45', { routing: router, prefer: [y.alex] });
      expect(result.combination![0].resourceId).toBe(y.alex);
      expect(result.travel.find((t) => t.resourceId === y.alex)!.legs.map((leg) => [leg.kind, leg.availableSeconds])).toEqual([
        ['previous', 30 * 60],
        ['next', 30 * 60],
      ]);
    });
  });

  describe('when it cannot be known', () => {
    it('warns, and still answers, when no router is configured', async () => {
      const y = await newYard('tr-none');
      await setResourceRouting(y.db, { resourceId: y.jo, travelMode: null, baseLocationId: null });
      await job(y, y.alex, 'A', '09:00', '10:00');
      const result = await check(y, '10:15', '11:15', { routing: null, prefer: [y.alex] });
      expect(result.feasible).toBe(true);
      expect(result.warnings).toEqual([{ code: 'routing_unavailable', resourceId: y.alex }]);
    });

    it('treats a candidate with no Location as unknown where somewhere has to be reached, and not otherwise', async () => {
      const y = await newYard('tr-nolocation');
      await setResourceRouting(y.db, { resourceId: y.jo, travelMode: null, baseLocationId: null });
      const bare = await check(y, '10:15', '11:15', { locationId: null, routing: new Router({}), prefer: [y.alex] });
      // Alex has no earlier job and no base, and the work has no place: there is no journey to verify.
      expect(bare.warnings).toEqual([]);

      await job(y, y.alex, 'A', '08:00', '10:00');
      const after = await check(y, '10:15', '11:15', { locationId: null, routing: new Router({}), prefer: [y.alex] });
      expect(after.warnings).toEqual([{ code: 'travel_destination_unknown', resourceId: y.alex }]);
    });

    it('does not let another business’s Location stand in as the candidate’s place', async () => {
      const mine = await newYard('tr-leak-a');
      const theirs = await newYard('tr-leak-b');
      await setResourceRouting(mine.db, { resourceId: mine.jo, travelMode: null, baseLocationId: null });
      await job(mine, mine.alex, 'A', '08:00', '10:00');
      const router = new Router({});
      // The foreign id is simply not a place of this business; it reads as a candidate with no Location.
      const result = await check(mine, '10:15', '11:15', { locationId: theirs.place.B, routing: router, prefer: [mine.alex] });
      expect(result.warnings).toEqual([{ code: 'travel_destination_unknown', resourceId: mine.alex }]);
      expect(router.asked).toEqual([]);
    });
  });

  describe('exact assignments', () => {
    it('flags a ticked resource that cannot arrive', async () => {
      const y = await newYard('tr-exact');
      await job(y, y.alex, 'A', '09:00', '10:00');
      const checked = await checkAssignedResources(y.db, {
        organizationId: y.organizationId,
        workTypeId: y.jobType,
        timeZone: 'UTC',
        start: T('10:15'),
        end: T('11:15'),
        resourceIds: [y.alex],
        locationId: y.place.B,
        routing: new Router({ 'A>B': 38 }),
      });
      expect(checked.requirementsMet).toBe(true);
      expect(checked.allTravelFeasible).toBe(false);
      expect(checked.ok).toBe(false);
    });
  });

  describe('what is never stored', () => {
    it('has no travel or route column on the work or its assignments: travel is derived', async () => {
      const columns = await pg.query(
        `select table_name, column_name from information_schema.columns
          where table_schema = 'public'
            and table_name in ('work_items', 'work_item_resource_assignments')
            and (column_name ilike '%travel%' or column_name ilike '%route%' or column_name ilike '%drive%')`,
      );
      expect(columns.rows).toEqual([]);
    });
  });

  describe('existing schedules', () => {
    it('lets staff schedule a job travel says is tight, and moves nothing that is already there', async () => {
      const y = await newYard('tr-existing');
      const first = await job(y, y.alex, 'A', '09:00', '10:00');
      // Travel is advisory: scheduling is still the database's decision, and it takes the booking.
      const second = await job(y, y.alex, 'B', '10:01', '11:00');
      const rows = await pg.query('select id, scheduled_during from public.work_items where id = any($1) order by lower(scheduled_during)', [[first, second]]);
      expect(rows.rows.map((row) => row.id)).toEqual([first, second]);
    });
  });
});

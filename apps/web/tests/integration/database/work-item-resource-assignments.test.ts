import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  beginBooking,
  bookSlot,
  bookableSlots,
  listBookableTypes,
} from '@/lib/domain/booking/booking';
import { listTimeCommitted } from '@/lib/domain/reporting/commitment';
import { createResource } from '@/lib/domain/resources/resources';
import { listScheduleDays } from '@/lib/domain/scheduling/availability';
import {
  scheduleWorkItem,
  setWorkItemResources,
  unscheduleWorkItem,
} from '@/lib/domain/scheduling/schedule';
import { addOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { getOrganization, updateOrganization } from '@/lib/domain/tenancy/organizations';
import { addMember } from '@/lib/domain/tenancy/members';
import { createRole } from '@/lib/domain/tenancy/roles';
import {
  changeWorkItemStatus,
  createWorkItemTransition,
} from '@/lib/domain/work-items/transitions';
import { createWorkItemStatus, updateWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType, setTypeBookable } from '@/lib/domain/work-items/types';
import { createWorkItem, getWorkItem, listWorkItems } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * A work item has many resources, and the guarantee that no resource is double-booked survived the
 * move.
 *
 * What is proved here is proved where it is enforced — the assignment table's exclusion constraint,
 * its tenant-leading references, the triggers that carry the work item's window onto each
 * assignment — and mostly by writing around the domain layer too. A work item owns *when*; an
 * assignment owns *who takes part*; every assigned resource is committed for the one occupied
 * window, and a conflict anywhere refuses the whole change.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const T = (hh: string) => `2027-04-05T${hh}:00.000Z`;
const WINDOW = (from: string, to: string) => ({ startsAt: T(from), endsAt: T(to) });

type Person = { db: SupabaseClient; userId: string; email: string };
type Shop = Person & {
  organizationId: string;
  typeId: string;
  bookedId: string;
  cancelledId: string;
  alex: string;
  van: string;
  machine: string;
  bay: string;
};

let pg: Client;
let shop: Shop;
let rival: Shop;

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

async function newShop(label: string): Promise<Shop> {
  const person = await signUp(label);
  const organizationId = (await foundBusiness({
    ownerEmail: person.email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  })) as string;

  const typeId = await createWorkItemType(person.db, { organizationId, name: 'Oil change', schedulable: true });
  const bookedId = await createWorkItemStatus(person.db, { organizationId, typeId, name: 'Booked' });
  const cancelledId = await createWorkItemStatus(person.db, { organizationId, typeId, name: 'Cancelled' });
  await createWorkItemTransition(person.db, { organizationId, typeId, fromStatusId: bookedId, toStatusId: cancelledId });
  await createWorkItemTransition(person.db, { organizationId, typeId, fromStatusId: cancelledId, toStatusId: bookedId });
  await updateWorkItemStatus(person.db, {
    id: cancelledId,
    name: 'Cancelled',
    position: 1,
    releasesResource: true,
    marksComplete: false,
  });

  const make = (name: string, resourceClass: 'person' | 'vehicle' | 'equipment' | 'facility') =>
    createResource(person.db, { organizationId, name, resourceClass });

  return {
    ...person,
    organizationId,
    typeId,
    bookedId,
    cancelledId,
    alex: await make('Alex', 'person'),
    van: await make('Service Van 1', 'vehicle'),
    machine: await make('Tire Machine', 'equipment'),
    bay: await make('Bay 1', 'facility'),
  };
}

/** A job in the Booked status with the given people on it, scheduled when a window is given. */
async function job(t: Shop, title: string, resourceIds: string[], window?: ReturnType<typeof WINDOW>): Promise<string> {
  const id = await createWorkItem(t.db, { organizationId: t.organizationId, title, statusId: t.bookedId, resourceIds });
  if (window) await scheduleWorkItem(t.db, { workItemId: id, ...window });
  return id;
}

async function assignedTo(t: Shop, workItemId: string): Promise<string[]> {
  const item = await getWorkItem(t.db, { organizationId: t.organizationId, workItemId });
  return item!.resources.map((resource) => resource.id).sort();
}

async function windowOf(t: Shop, workItemId: string) {
  return (await getWorkItem(t.db, { organizationId: t.organizationId, workItemId }))!.window;
}

describe('a work item has many resources', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    pg = new Client({ connectionString: CONNECTION });
    await pg.connect();
    shop = await newShop('wra-shop');
    rival = await newShop('wra-rival');
  });

  afterAll(async () => {
    await pg.end();
  });

  describe('the migration', () => {
    it('turns every old resource_id into exactly one assignment and a null into none, from controlled fixtures', async () => {
      // The migration's own backfill statement, read from the file and pointed at tables shaped as
      // they were before it ran — so what is proved is the statement that shipped, on data this
      // test controls rather than whatever the local database happens to hold.
      const file = readFileSync(
        join(__dirname, '..', '..', '..', '..', '..', 'supabase', 'migrations', '20261022000035_a_work_item_has_many_resources_expand.sql'),
        'utf8',
      );
      const statement = /insert into public\.work_item_resource_assignments[\s\S]+?where w\.resource_id is not null;/i.exec(file)?.[0];
      expect(statement).toBeDefined();

      await pg.query('begin');
      try {
        await pg.query(
          `create temp table work_items_before (id uuid primary key, organization_id uuid not null, resource_id uuid,
             occupies tstzrange, status_releases_resource boolean not null, created_at timestamptz not null, created_by uuid not null)`,
        );
        await pg.query(
          `create temp table assignments_after (organization_id uuid, work_item_id uuid, resource_id uuid, occupies tstzrange,
             created_at timestamptz, created_by uuid)`,
        );
        const [assigned, unassigned, released] = [randomUUID(), randomUUID(), randomUUID()];
        const org = shop.organizationId;
        await pg.query(
          `insert into work_items_before values
             ($1, $4, $5, '[2027-04-05 10:00+00,2027-04-05 11:00+00)', false, now(), $6),
             ($2, $4, null, '[2027-04-05 10:00+00,2027-04-05 11:00+00)', false, now(), $6),
             ($3, $4, $5, '[2027-04-05 12:00+00,2027-04-05 13:00+00)', true, now(), $6)`,
          [assigned, unassigned, released, org, shop.alex, shop.userId],
        );

        await pg.query(
          statement!.replace('public.work_item_resource_assignments', 'assignments_after').replace('public.work_items', 'work_items_before'),
        );
        const { rows } = await pg.query('select * from assignments_after order by work_item_id');
        const byItem = new Map(rows.map((row) => [row.work_item_id, row]));

        expect(rows).toHaveLength(2);
        expect(byItem.get(assigned)).toMatchObject({ organization_id: org, resource_id: shop.alex });
        expect(byItem.get(assigned).occupies).not.toBeNull();
        // A job with no resource gets nothing — no row is invented.
        expect(byItem.has(unassigned)).toBe(false);
        // The old constraint's predicate came across: a releasing status held nothing.
        expect(byItem.get(released)).toMatchObject({ resource_id: shop.alex, occupies: null });
      } finally {
        await pg.query('rollback');
      }
    });

    it('left no competing authority: the column and the old constraint are gone', async () => {
      const column = await pg.query(
        `select 1 from information_schema.columns where table_name = 'work_items' and column_name = 'resource_id'`,
      );
      expect(column.rowCount).toBe(0);
      const old = await pg.query(`select 1 from pg_constraint where conname = 'work_items_resource_not_double_booked'`);
      expect(old.rowCount).toBe(0);
    });
  });

  describe('the relationship', () => {
    it('holds zero, one or many resources on one work item, and a resource on many work items', async () => {
      const none = await job(shop, 'No one', []);
      const one = await job(shop, 'One', [shop.alex]);
      const many = await job(shop, 'Many', [shop.alex, shop.van, shop.machine]);

      expect(await assignedTo(shop, none)).toEqual([]);
      expect(await assignedTo(shop, one)).toEqual([shop.alex]);
      expect(await assignedTo(shop, many)).toEqual([shop.alex, shop.van, shop.machine].sort());
    });

    it('refuses the same resource twice on one work item, and another tenant’s resource', async () => {
      const id = await job(shop, 'Duplicates', [shop.alex]);
      const row = { organization_id: shop.organizationId, work_item_id: id, resource_id: shop.alex, created_by: shop.userId };

      const twice = await shop.db.from('work_item_resource_assignments').insert(row);
      expect(twice.error?.code).toBe('23505');

      const borrowed = await shop.db
        .from('work_item_resource_assignments')
        .insert({ ...row, resource_id: rival.alex });
      expect(borrowed.error?.code).toBe('23503');
      await expect(
        pg.query(
          'insert into public.work_item_resource_assignments (organization_id, work_item_id, resource_id, created_by) values ($1, $2, $3, $4)',
          [shop.organizationId, id, rival.alex, shop.userId],
        ),
      ).rejects.toMatchObject({ code: '23503' });
    });

    it('cannot be given an occupancy by a caller: that is derived state', async () => {
      const id = await job(shop, 'Forged', []);
      const { error } = await shop.db.from('work_item_resource_assignments').insert({
        organization_id: shop.organizationId,
        work_item_id: id,
        resource_id: shop.bay,
        created_by: shop.userId,
        occupies: '[2027-04-05 01:00+00,2027-04-05 02:00+00)',
      } as never);
      expect(error).not.toBeNull();
    });

    it('is the creator’s to set on a job they raise and scheduling’s to change after', async () => {
      const clerk = await signUp('wra-clerk');
      const role = await createRole(shop.db, { organizationId: shop.organizationId, name: 'Clerk', capabilities: ['work_item.create'] });
      await addMember(shop.db, { organizationId: shop.organizationId, email: clerk.email, displayName: 'Clerk', roleId: role });

      // Raising a job with people on it is the creator's act, as it always was…
      const raised = await createWorkItem(clerk.db, {
        organizationId: shop.organizationId,
        title: 'Raised by a clerk',
        statusId: shop.bookedId,
        resourceIds: [shop.alex],
      });
      expect(await assignedTo(shop, raised)).toEqual([shop.alex]);

      // …changing it afterwards is not, by the domain or around it.
      await expect(setWorkItemResources(clerk.db, { workItemId: raised, resourceIds: [shop.van] })).rejects.toMatchObject({
        code: 'scheduling.forbidden',
      });
      const direct = await clerk.db.from('work_item_resource_assignments').insert({
        organization_id: shop.organizationId,
        work_item_id: raised,
        resource_id: shop.van,
        created_by: clerk.userId,
      });
      expect(direct.error).not.toBeNull();
      expect(await assignedTo(shop, raised)).toEqual([shop.alex]);
    });
  });

  describe('double-booking, for every assigned resource', () => {
    it('refuses overlap on either resource of a multi-resource job, allows a free third, and independent resources coexist', async () => {
      await job(shop, 'A: Alex + Van', [shop.alex, shop.van], WINDOW('10:00', '11:00'));

      const onAlex = await job(shop, 'B on Alex', [shop.alex]);
      await expect(scheduleWorkItem(shop.db, { workItemId: onAlex, ...WINDOW('10:30', '11:30') })).rejects.toMatchObject({
        code: 'scheduling.double_booked',
      });

      const onVan = await job(shop, 'B on Van', [shop.van]);
      await expect(scheduleWorkItem(shop.db, { workItemId: onVan, ...WINDOW('10:30', '11:30') })).rejects.toMatchObject({
        code: 'scheduling.double_booked',
      });

      const onMachine = await job(shop, 'B on Machine', [shop.machine]);
      await expect(scheduleWorkItem(shop.db, { workItemId: onMachine, ...WINDOW('10:30', '11:30') })).resolves.toBeUndefined();

      // Independent resources, same hour.
      const bayJob = await job(shop, 'C: Bay', [shop.bay], WINDOW('10:00', '11:00'));
      expect(await windowOf(shop, bayJob)).toEqual(WINDOW('10:00', '11:00'));

      // Back to back is not an overlap (half-open).
      const after = await job(shop, 'D: right after', [shop.alex, shop.van], WINDOW('11:00', '12:00'));
      expect(await assignedTo(shop, after)).toEqual([shop.alex, shop.van].sort());
    });

    it('is the database’s refusal, not the domain’s: the same overlap written straight onto the table is 23P01', async () => {
      const day = '2027-04-07';
      const first = await job(shop, 'Held', [shop.alex]);
      await shop.db.rpc('schedule_work_item', {
        p_work_item_id: first,
        p_resource_ids: null as unknown as string[],
        p_starts_at: `${day}T10:00:00Z`,
        p_ends_at: `${day}T11:00:00Z`,
      });
      const second = await job(shop, 'Raw', []);
      await shop.db.from('work_items').update({ scheduled_during: `[${day}T10:30:00Z,${day}T11:30:00Z)` }).eq('id', second);

      const { error } = await shop.db.from('work_item_resource_assignments').insert({
        organization_id: shop.organizationId,
        work_item_id: second,
        resource_id: shop.alex,
        created_by: shop.userId,
      });
      expect(error?.code).toBe('23P01');
    });

    it('refuses an assignment set as a whole: one busy resource and nothing is assigned', async () => {
      await job(shop, 'Van is busy', [shop.van], WINDOW('14:00', '15:00'));
      const target = await job(shop, 'Wants three', [], WINDOW('14:00', '15:00'));

      await expect(
        setWorkItemResources(shop.db, { workItemId: target, resourceIds: [shop.alex, shop.van, shop.machine] }),
      ).rejects.toMatchObject({ code: 'scheduling.double_booked' });
      // Alex and the free machine were not quietly given to it.
      expect(await assignedTo(shop, target)).toEqual([]);
    });

    it('keeps who it had when a change is refused, and refuses a reassignment onto a busy resource', async () => {
      await job(shop, 'Machine is busy', [shop.machine], WINDOW('16:00', '17:00'));
      const target = await job(shop, 'Alex only', [shop.alex], WINDOW('16:00', '17:00'));

      await expect(
        setWorkItemResources(shop.db, { workItemId: target, resourceIds: [shop.alex, shop.machine] }),
      ).rejects.toMatchObject({ code: 'scheduling.double_booked' });
      expect(await assignedTo(shop, target)).toEqual([shop.alex]);

      // Adding a free one, without touching the time, works.
      await setWorkItemResources(shop.db, { workItemId: target, resourceIds: [shop.alex, shop.bay] });
      expect(await assignedTo(shop, target)).toEqual([shop.alex, shop.bay].sort());
      expect(await windowOf(shop, target)).toEqual(WINDOW('16:00', '17:00'));

      // And swapping one out for another is one transaction.
      await setWorkItemResources(shop.db, { workItemId: target, resourceIds: [shop.van] });
      expect(await assignedTo(shop, target)).toEqual([shop.van]);
    });

    it('tests a reschedule against every assigned resource, and a failed move changes nothing', async () => {
      const day = (hh: string) => `2027-04-08T${hh}:00.000Z`;
      const mover = await createWorkItem(shop.db, { organizationId: shop.organizationId, title: 'Mover', statusId: shop.bookedId, resourceIds: [shop.alex, shop.van] });
      await scheduleWorkItem(shop.db, { workItemId: mover, startsAt: day('10:00'), endsAt: day('11:00') });
      const blocker = await createWorkItem(shop.db, { organizationId: shop.organizationId, title: 'Van at two', statusId: shop.bookedId, resourceIds: [shop.van] });
      await scheduleWorkItem(shop.db, { workItemId: blocker, startsAt: day('14:00'), endsAt: day('15:00') });

      await expect(
        scheduleWorkItem(shop.db, { workItemId: mover, startsAt: day('14:00'), endsAt: day('15:00') }),
      ).rejects.toMatchObject({ code: 'scheduling.double_booked' });
      expect(await windowOf(shop, mover)).toEqual({ startsAt: day('10:00'), endsAt: day('11:00') });
      expect(await assignedTo(shop, mover)).toEqual([shop.alex, shop.van].sort());

      // Moved to a time everyone is free, who is on it is untouched — omitting the list leaves it alone.
      await scheduleWorkItem(shop.db, { workItemId: mover, startsAt: day('12:00'), endsAt: day('13:00') });
      expect(await assignedTo(shop, mover)).toEqual([shop.alex, shop.van].sort());
    });

    it('unscheduling releases every resource’s time and keeps the assignments', async () => {
      const holder = await job(shop, 'Holder', [shop.alex, shop.van], WINDOW('18:00', '19:00'));
      const wanting = await job(shop, 'Wants the same', [shop.alex, shop.van]);
      await expect(scheduleWorkItem(shop.db, { workItemId: wanting, ...WINDOW('18:00', '19:00') })).rejects.toMatchObject({
        code: 'scheduling.double_booked',
      });

      await unscheduleWorkItem(shop.db, { workItemId: holder });
      expect(await assignedTo(shop, holder)).toEqual([shop.alex, shop.van].sort());
      expect(await windowOf(shop, holder)).toBeNull();
      await expect(scheduleWorkItem(shop.db, { workItemId: wanting, ...WINDOW('18:00', '19:00') })).resolves.toBeUndefined();
    });

    it('a status the business says releases its resources releases all of them, and restoring one re-asserts every conflict', async () => {
      const held = await job(shop, 'Cancellable', [shop.alex, shop.van], WINDOW('08:00', '09:00'));
      await changeWorkItemStatus(shop.db, { workItemId: held, toStatusId: shop.cancelledId });

      // Both resources are free for somebody else — the assignments themselves remain.
      expect(await assignedTo(shop, held)).toEqual([shop.alex, shop.van].sort());
      const alexJob = await job(shop, 'Takes Alex', [shop.alex], WINDOW('08:00', '09:00'));
      const vanJob = await job(shop, 'Takes Van', [shop.van], WINDOW('08:00', '09:00'));

      // Reinstating it would double-book both: refused, and it stays cancelled.
      await expect(changeWorkItemStatus(shop.db, { workItemId: held, toStatusId: shop.bookedId })).rejects.toBeDefined();
      expect((await getWorkItem(shop.db, { organizationId: shop.organizationId, workItemId: held }))!.status.id).toBe(shop.cancelledId);

      // One conflict is enough, and nothing is half-restored: free Alex, keep the Van taken.
      await unscheduleWorkItem(shop.db, { workItemId: alexJob });
      await expect(changeWorkItemStatus(shop.db, { workItemId: held, toStatusId: shop.bookedId })).rejects.toBeDefined();

      // With both free it comes back.
      await unscheduleWorkItem(shop.db, { workItemId: vanJob });
      await expect(changeWorkItemStatus(shop.db, { workItemId: held, toStatusId: shop.bookedId })).resolves.toBeUndefined();
    });

    it('applies the tenant’s buffer to every assigned resource, in both directions', async () => {
      const t = await newShop('wra-buffer');
      const setBuffer = async (minutes: number) => {
        const organization = await getOrganization(t.db, t.organizationId);
        await updateOrganization(t.db, {
          id: t.organizationId,
          name: organization!.name,
          timezone: organization!.timezone,
          currency: organization!.currency!,
          bufferMinutes: minutes,
          slug: null,
        });
      };

      await setBuffer(30);
      await job(t, 'A', [t.alex, t.van], WINDOW('10:00', '11:00'));

      // Both resources stay occupied until 11:30; the machine is not on the job and is free.
      const onVan = await job(t, 'B on Van', [t.van]);
      await expect(scheduleWorkItem(t.db, { workItemId: onVan, ...WINDOW('11:15', '12:00') })).rejects.toMatchObject({ code: 'scheduling.double_booked' });
      const onAlex = await job(t, 'B on Alex', [t.alex]);
      await expect(scheduleWorkItem(t.db, { workItemId: onAlex, ...WINDOW('11:15', '12:00') })).rejects.toMatchObject({ code: 'scheduling.double_booked' });
      await expect(scheduleWorkItem(t.db, { workItemId: onAlex, ...WINDOW('11:30', '12:30') })).resolves.toBeUndefined();
      const onMachine = await job(t, 'B on Machine', [t.machine]);
      await expect(scheduleWorkItem(t.db, { workItemId: onMachine, ...WINDOW('11:15', '12:00') })).resolves.toBeUndefined();

      // The other direction: a buffer that would now overlap committed work is refused, and nothing moves.
      await expect(setBuffer(90)).rejects.toMatchObject({ code: 'organizations.buffer_conflict' });
      expect((await getOrganization(t.db, t.organizationId))!.bufferMinutes).toBe(30);

      // Shrinking it reaches work already scheduled, on every assignment: Van is now free at 11:00.
      await setBuffer(0);
      const lateVan = await job(t, 'C on Van', [t.van]);
      await expect(scheduleWorkItem(t.db, { workItemId: lateVan, ...WINDOW('11:00', '11:15') })).resolves.toBeUndefined();
    });

    it('lets work be scheduled with nobody on it, and it takes no resource’s time', async () => {
      const inspection = await job(shop, 'Inspection', [], WINDOW('20:00', '21:00'));
      expect(await assignedTo(shop, inspection)).toEqual([]);

      // Alex is free at the same time — an unassigned job holds nothing.
      await expect(job(shop, 'Alex at eight', [shop.alex], WINDOW('20:00', '21:00'))).resolves.toEqual(expect.any(String));
    });
  });

  describe('the domain', () => {
    it('reads who is on a job in one query, and filters by a resource without duplicating or trimming', async () => {
      const t = await newShop('wra-read');
      const both = await job(t, 'Both', [t.alex, t.van]);
      await job(t, 'Only machine', [t.machine]);

      const forAlex = await listWorkItems(t.db, { organizationId: t.organizationId, resourceId: t.alex });
      expect(forAlex.map((item) => item.id)).toEqual([both]);
      // Everyone on it is still shown, not only the one filtered by.
      expect(forAlex[0].resources.map((resource) => resource.label)).toEqual(['Alex', 'Service Van 1']);

      const forVan = await listWorkItems(t.db, { organizationId: t.organizationId, resourceId: t.van });
      expect(forVan.map((item) => item.id)).toEqual([both]);
    });

    it('clears with an empty list and keeps with an omitted one', async () => {
      const id = await job(shop, 'Clear me', [shop.alex, shop.bay], WINDOW('06:00', '07:00'));
      await scheduleWorkItem(shop.db, { workItemId: id, ...WINDOW('06:30', '07:30') });
      expect(await assignedTo(shop, id)).toEqual([shop.alex, shop.bay].sort());

      await scheduleWorkItem(shop.db, { workItemId: id, resourceIds: [], ...WINDOW('06:30', '07:30') });
      expect(await assignedTo(shop, id)).toEqual([]);
    });

    it('translates a missing resource and a forbidden caller into sentences', async () => {
      const id = await job(shop, 'Sentences', []);
      await expect(setWorkItemResources(shop.db, { workItemId: id, resourceIds: [randomUUID()] })).rejects.toMatchObject({
        code: 'scheduling.resource_not_found',
      });
      await expect(setWorkItemResources(rival.db, { workItemId: id, resourceIds: [rival.alex] })).rejects.toMatchObject({
        code: 'scheduling.forbidden',
      });
    });
  });

  describe('the schedule projection', () => {
    it('shows one work item in each lane it takes part in and scheduled work nobody is on as unassigned', async () => {
      const t = await newShop('wra-proj');
      const multi = await job(t, 'Multi', [t.alex, t.van], WINDOW('10:00', '11:00'));
      const solo = await job(t, 'Solo', [t.machine], WINDOW('10:00', '11:00'));
      const orphan = await job(t, 'Nobody', [], WINDOW('13:00', '14:00'));
      // Unscheduled and cancelled work is not on the board.
      await job(t, 'Not scheduled', [t.bay]);
      const gone = await job(t, 'Cancelled', [], WINDOW('15:00', '16:00'));
      await changeWorkItemStatus(t.db, { workItemId: gone, toStatusId: t.cancelledId });

      const [day] = await listScheduleDays(t.db, { organizationId: t.organizationId, dates: ['2027-04-05'], timeZone: 'UTC' });
      const lane = (id: string) => day.resources.find((entry) => entry.resource.id === id)!;

      expect(lane(t.alex).booked.map((entry) => entry.workItemId)).toEqual([multi]);
      expect(lane(t.van).booked.map((entry) => entry.workItemId)).toEqual([multi]);
      expect(lane(t.machine).booked.map((entry) => entry.workItemId)).toEqual([solo]);
      expect(lane(t.bay).booked).toEqual([]);
      // The same id and window in both lanes — one job, never a copy — and it knows who else is on it.
      expect(lane(t.alex).booked[0].window).toEqual(lane(t.van).booked[0].window);
      expect(lane(t.alex).booked[0].resourceIds).toEqual([t.alex, t.van].sort());

      expect(day.unassigned.map((work) => work.workItemId)).toEqual([orphan]);
    });

    it('commits resource time per assigned resource, and counts a job once for anything else it is grouped by', async () => {
      const t = await newShop('wra-report');
      await job(t, 'Hour with three', [t.alex, t.van, t.machine], WINDOW('10:00', '11:00'));
      await job(t, 'Hour with nobody', [], WINDOW('12:00', '13:00'));

      const byResource = await listTimeCommitted(t.db, { organizationId: t.organizationId, grouping: 'resource' });
      expect(Object.fromEntries(byResource.map((group) => [group.label, group.minutes]))).toEqual({
        Alex: 60,
        'Service Van 1': 60,
        'Tire Machine': 60,
      });
      // Resource-minutes: three resources on an hour is three, and a job nobody is on commits none.
      const total = (await listTimeCommitted(t.db, { organizationId: t.organizationId, grouping: 'location' })).reduce((sum, g) => sum + g.minutes, 0);
      expect(total).toBe(180);
    });
  });

  describe('public booking', () => {
    it('writes one assignment, stays advisory, and refuses the slot the other visitor took', async () => {
      const t = await newShop('wra-book');
      const slug = `wra-${randomUUID().slice(0, 8)}`;
      const org = await getOrganization(t.db, t.organizationId);
      await updateOrganization(t.db, {
        id: t.organizationId,
        name: org!.name,
        timezone: org!.timezone,
        currency: org!.currency!,
        bufferMinutes: org!.bufferMinutes,
        slug,
      });
      // One resource only: public booking picks the one that is free.
      await pg.query('delete from public.resources where organization_id = $1 and id <> $2', [t.organizationId, t.van]);
      await addOperatingHours(t.db, { organizationId: t.organizationId, dayOfWeek: 1, opensAt: '09:00', closesAt: '11:00' });
      await setModuleEnabled(t.db, { organizationId: t.organizationId, key: 'booking', enabled: true });
      await setTypeBookable(t.db, { id: t.typeId, statusId: t.bookedId, durationMinutes: 60 });

      const visitor = async () => {
        const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
        await beginBooking(db, { organizationId: t.organizationId });
        return db;
      };

      const first = await visitor();
      const [type] = await listBookableTypes(first, { organizationId: t.organizationId });
      const slots = await bookableSlots(first, { organizationId: t.organizationId, type, date: '2027-04-05', timeZone: 'UTC' });
      expect(slots.length).toBeGreaterThan(0);
      const wanted = slots[0];

      const second = await visitor();
      const workItemId = await bookSlot(first, {
        organizationId: t.organizationId,
        typeId: type.id,
        slot: wanted,
        name: 'Ariane',
        email: 'ariane@example.test',
        phone: '',
      });

      // An ordinary work item with exactly one assignment, to the one resource this shop has. The visitor was never told which.
      const rows = await pg.query('select resource_id, occupies is not null as holds from public.work_item_resource_assignments where work_item_id = $1', [workItemId]);
      expect(rows.rows).toEqual([{ resource_id: t.van, holds: true }]);

      // The stale answer, committed after somebody else took it: refused by the constraint, with nothing checked first.
      await expect(
        bookSlot(second, { organizationId: t.organizationId, typeId: type.id, slot: wanted, name: 'Late', email: 'late@example.test', phone: '' }),
      ).rejects.toMatchObject({ code: 'booking.slot_taken' });
      const after = await pg.query('select count(*)::int as n from public.work_item_resource_assignments where organization_id = $1 and resource_id = $2', [
        t.organizationId,
        t.van,
      ]);
      expect(after.rows[0].n).toBe(1);
    });

    it('commits every resource of a multi-resource job in the public view, so none is offered', async () => {
      const t = await newShop('wra-commit');
      await job(t, 'Two on it', [t.alex, t.van], WINDOW('10:00', '11:00'));

      const rows = await pg.query(
        'select resource_id from public.work_item_resource_assignments where organization_id = $1 and occupies is not null order by resource_id',
        [t.organizationId],
      );
      expect(rows.rows.map((row) => row.resource_id)).toEqual([t.alex, t.van].sort());

      // The public view reads exactly those rows.
      // (The view filters by the caller's own tenants, so it is read as a member rather than as the database owner.)
      const { data } = await t.db.from('resource_commitments').select('resource_id').eq('organization_id', t.organizationId);
      expect((data ?? []).map((row) => row.resource_id).sort()).toEqual([t.alex, t.van].sort());
    });
  });

  describe('concurrency, with two real transactions', () => {
    async function connect(): Promise<Client> {
      const client = new Client({ connectionString: CONNECTION });
      await client.connect();
      return client;
    }
    const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    /** Inside the open transaction: act as a signed-in member, so policies and capability checks are the real ones. */
    const asMember = async (client: Client, userId: string) => {
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: 'authenticated' })]);
      await client.query('set local role authenticated');
    };

    it('two jobs taking the same resource at the same moment: one commits, the other is refused when the first lets go', async () => {
      const a = await job(shop, 'Race A', [shop.alex]);
      const b = await job(shop, 'Race B', [shop.alex]);
      const one = await connect();
      const two = await connect();
      const window = `[2027-04-09 10:00+00,2027-04-09 11:00+00)`;
      try {
        await one.query('begin');
        await two.query('begin');
        await asMember(one, shop.userId);
        await asMember(two, shop.userId);
        await one.query('update public.work_items set scheduled_during = $2 where id = $1', [a, window]);
        // Blocks on the first transaction's uncommitted claim — nothing checked first, and nothing to race.
        const second = two.query('update public.work_items set scheduled_during = $2 where id = $1', [b, window]);
        const settled = second.then(() => 'ok' as const, (error: { code?: string }) => error.code ?? 'error');
        await pause(300);
        await one.query('commit');
        expect(await settled).toBe('23P01');
      } finally {
        await two.query('rollback').catch(() => undefined);
        await one.end();
        await two.end();
      }
      expect(await windowOf(shop, a)).not.toBeNull();
      expect(await windowOf(shop, b)).toBeNull();
    });

    it('an assignment added while its job is being scheduled still holds the new window', async () => {
      // Without the lock on the work item, the assignment could read the job's old, empty window,
      // commit, and leave a scheduled job holding nothing — a resource that could then be double-booked.
      const c = await job(shop, 'Race C', []);
      const one = await connect();
      const two = await connect();
      try {
        await one.query('begin');
        await asMember(one, shop.userId);
        await one.query(`update public.work_items set scheduled_during = '[2027-04-09 12:00+00,2027-04-09 13:00+00)' where id = $1`, [c]);

        await two.query('begin');
        await asMember(two, shop.userId);
        const insert = two.query(
          'insert into public.work_item_resource_assignments (organization_id, work_item_id, resource_id, created_by) values ($1, $2, $3, $4)',
          [shop.organizationId, c, shop.bay, shop.userId],
        );
        const done = insert.then(() => 'inserted');
        await pause(300);
        await one.query('commit');
        expect(await done).toBe('inserted');
        await two.query('commit');
      } finally {
        await one.end();
        await two.end();
      }

      const { rows } = await pg.query(
        'select occupies is not null as holds from public.work_item_resource_assignments where work_item_id = $1',
        [c],
      );
      expect(rows).toEqual([{ holds: true }]);
    });
  });
});

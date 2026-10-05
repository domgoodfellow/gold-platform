import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  beginBooking,
  bookSlot,
  bookableSlots,
  listBookableTypes,
  type BookableType,
} from '@/lib/domain/booking/booking';
import { createResource, listResources } from '@/lib/domain/resources/resources';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { addOperatingHours } from '@/lib/domain/scheduling/operating-hours';
import { getOrganization, updateOrganization } from '@/lib/domain/tenancy/organizations';
import { setModuleEnabled } from '@/lib/domain/tenancy/modules';
import { createWorkItemStatus, updateWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType, setTypeBookable } from '@/lib/domain/work-items/types';
import { foundBusiness } from '@/tests/support/founding';

/**
 * I5 on the public axis.
 *
 * What counts as a commitment is `work_items_resource_not_double_booked`'s partial predicate,
 * and it is written out more than once: as the constraint, as `listSchedule`'s filters, and as
 * the `resource_commitments` view a booking page reads in place of `work_items`. The first two
 * are held together by `availability.test.ts` and `buffer.test.ts`. **The view is the copy a
 * stranger's slots come from, and nothing proved it follows the other two** — `booking.test.ts`
 * covers who may read it, never what it says. A clause the constraint learned (a status that
 * releases the resource, the buffer) and the view did not would offer a customer a slot the
 * business had already freed, or one it still holds, and nothing would fail.
 *
 * Each case below checks both directions, because a calculation that only ever agrees about
 * what is busy would still be a second opinion about what is free.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const DATE = '2027-03-15';
const ZONE = 'America/Toronto';

const local = new Intl.DateTimeFormat('en-GB', { timeStyle: 'short', timeZone: ZONE });

let owner: SupabaseClient;
let organizationId: string;
let statusId: string;
let bookable: BookableType;

function anonClient(): SupabaseClient {
  return createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function visitor(): Promise<SupabaseClient> {
  const db = anonClient();
  await beginBooking(db, { organizationId });
  return db;
}

async function offered(db: SupabaseClient): Promise<string[]> {
  const slots = await bookableSlots(db, { organizationId, type: bookable, date: DATE, timeZone: ZONE });
  return slots.map((slot) => local.format(new Date(slot.startsAt)));
}

async function setBuffer(minutes: number) {
  const organization = await getOrganization(owner, organizationId);
  await updateOrganization(owner, {
    id: organizationId,
    name: organization!.name,
    timezone: organization!.timezone,
    currency: organization!.currency!,
    bufferMinutes: minutes,
    slug: `agree-${randomUUID().slice(0, 8)}`,
  });
}

describe('public booking offers what the exclusion constraint would accept (I5)', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `agree-${randomUUID().slice(0, 8)}@example.test`;
    const password = `pw-${randomUUID()}`;
    const { error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError) throw createError;

    owner = anonClient();
    const { error: signInError } = await owner.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;

    organizationId = (await foundBusiness({
      ownerEmail: email,
      name: 'Agreement Ltd',
      displayName: 'Owner',
      timezone: ZONE,
      currency: 'CAD',
    })) as string;

    const typeId = await createWorkItemType(owner, { schedulable: true, organizationId, name: 'Tyre change' });
    statusId = await createWorkItemStatus(owner, { organizationId, typeId, name: 'Requested' });
    await createResource(owner, { resourceClass: 'other', organizationId, name: 'Van 1' });

    // 09:00–12:00 on the Monday the suite books, so the offered slots are countable.
    await addOperatingHours(owner, { organizationId, dayOfWeek: 1, opensAt: '09:00', closesAt: '12:00' });

    await setModuleEnabled(owner, { organizationId, key: 'booking', enabled: true });
    await setTypeBookable(owner, { id: typeId, statusId, durationMinutes: 60 });
    await setBuffer(0);

    [bookable] = await listBookableTypes(await visitor(), { organizationId });
  });

  it('keeps the tenant’s buffer out of what it offers, and the constraint refuses the same slot', async () => {
    const taker = await visitor();
    const slots = await bookableSlots(taker, { organizationId, type: bookable, date: DATE, timeZone: ZONE });
    expect(slots.map((slot) => local.format(new Date(slot.startsAt)))).toEqual(['09:00', '10:00', '11:00']);

    await bookSlot(taker, {
      organizationId,
      typeId: bookable.id,
      slot: slots[0],
      name: 'First Booker',
      email: 'first@example.test',
      phone: '',
    });

    const watcher = await visitor();
    expect(await offered(watcher)).toEqual(['10:00', '11:00']);

    // A thirty-minute buffer: the van is busy until 10:30, not 10:00. The view must follow the
    // constraint's `occupies`, not the appointment.
    await setBuffer(30);

    // 10:30 is the first free instant; 11:30 would run past closing. Not 10:00 and not 11:00.
    expect(await offered(watcher)).toEqual(['10:30']);

    // The other direction: the slot that was offered a moment ago is now refused by the
    // constraint, so what the page stopped offering is genuinely not committable.
    await expect(
      bookSlot(watcher, {
        organizationId,
        typeId: bookable.id,
        slot: slots[1],
        name: 'Too Soon',
        email: 'toosoon@example.test',
        phone: '',
      }),
    ).rejects.toMatchObject({ code: 'booking.slot_taken' });
  });

  it('offers a slot again when the business says the booked job’s status releases the resource', async () => {
    const watcher = await visitor();
    expect(await offered(watcher)).toEqual(['10:30']);

    // The tenant answers the question only the tenant can: work in this status no longer holds
    // the van. The cache on `work_items` follows, the constraint stops counting the job, and the
    // public view must stop counting it in the same moment.
    await updateWorkItemStatus(owner, {
      id: statusId,
      name: 'Requested',
      position: 0,
      releasesResource: true,
      marksComplete: false,
    });

    const slots = await bookableSlots(watcher, { organizationId, type: bookable, date: DATE, timeZone: ZONE });
    expect(slots.map((slot) => local.format(new Date(slot.startsAt)))).toEqual(['09:00', '10:00', '11:00']);

    // And the half that matters: what the page now calls free is committable, not merely shown.
    await expect(
      bookSlot(watcher, {
        organizationId,
        typeId: bookable.id,
        slot: slots[0],
        name: 'Second Booker',
        email: 'second@example.test',
        phone: '',
      }),
    ).resolves.toEqual(expect.any(String));
  });

  it('treats every resource of a multi-resource job as committed, and each one independently', async () => {
    // A different Monday, so nothing above is in the way. Two vans; one job that needs both.
    const monday = '2027-03-22';
    const [van1] = (await listResources(owner, { organizationId })).filter((resource) => resource.name === 'Van 1');
    const van2 = await createResource(owner, { organizationId, name: 'Van 2', resourceClass: 'vehicle' });
    const at = (hh: string) => `${monday}T${hh}:00-04:00`;
    const slotsOn = async () => {
      const watcher = await visitor();
      const slots = await bookableSlots(watcher, { organizationId, type: bookable, date: monday, timeZone: ZONE });
      return slots.map((slot) => local.format(new Date(slot.startsAt)));
    };

    expect(await slotsOn()).toEqual(['09:00', '10:00', '11:00']);

    // Both vans on one job at ten: with the 30-minute buffer neither is free again before 11:30, so
    // the page offers only the hour before. One work item, one window, two resources committed.
    // A status that holds its resources: the one used above was switched to releasing by the previous case.
    const holding = await createWorkItemStatus(owner, { organizationId, typeId: bookable.id, name: 'Holding' });
    const both = await createWorkItem(owner, { organizationId, title: 'Needs both vans', statusId: holding, resourceIds: [van1.id, van2] });
    await scheduleWorkItem(owner, { workItemId: both, startsAt: at('10:00'), endsAt: at('11:00') });
    expect(await slotsOn()).toEqual(['09:00']);

    // Take one van off the job and the other's time is offered again: each resource is judged on its own.
    await scheduleWorkItem(owner, { workItemId: both, resourceIds: [van1.id], startsAt: at('10:00'), endsAt: at('11:00') });
    expect(await slotsOn()).toEqual(['09:00', '10:00', '11:00']);
  });
});

import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { configureBusiness, type BusinessShape } from '@/lib/domain/configuration/configure';
import { createResource } from '@/lib/domain/resources/resources';
import { scheduleWorkItem, unscheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { computeSetupOverview } from '@/lib/domain/tenancy/lifecycle';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import {
  createWorkItemType,
  hasSchedulableWork,
  listWorkItemTypes,
  setTypeBookable,
  setWorkItemTypeSchedulable,
} from '@/lib/domain/work-items/types';
import { createWorkItem, listWorkItems } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Whether work of a kind is scheduled is the business's declaration, and *bookable implies it*.
 *
 * Four claims, each proved where it is enforced rather than where it is offered: the table
 * refuses a bookable type that does not schedule (even written directly), the work-item trigger
 * refuses a window on work whose type does not schedule (even by the raw RPC), the type trigger
 * refuses to stop scheduling while the diary holds work of that kind, and none of the three
 * collapses internal scheduling back into public booking.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const CONNECTION =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const NINE = '2027-02-01T09:00:00.000Z';
const TEN = '2027-02-01T10:00:00.000Z';

type Tenant = { db: SupabaseClient; organizationId: string };

let pg: Client;
let shop: Tenant;
let office: Tenant;

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;
  const { error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (createError) throw createError;

  const db = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;

  const organizationId = await foundBusiness({
    ownerEmail: email,
    name: `${label} Ltd`,
    displayName: 'Founder',
    timezone: 'UTC',
    currency: 'EUR',
  });
  return { db, organizationId: organizationId as string };
}

/** A type with one status and one job in it — everything a scheduling or booking test needs. */
async function typeWithJob(tenant: Tenant, name: string, schedulable: boolean) {
  const typeId = await createWorkItemType(tenant.db, { organizationId: tenant.organizationId, name, schedulable });
  const statusId = await createWorkItemStatus(tenant.db, { organizationId: tenant.organizationId, typeId, name: 'Open' });
  const workItemId = await createWorkItem(tenant.db, {
    organizationId: tenant.organizationId,
    title: `${name} job`,
    statusId,
  });
  return { typeId, statusId, workItemId };
}

describe('a work type says whether it is scheduled', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    pg = new Client({ connectionString: CONNECTION });
    await pg.connect();
    shop = await newTenant('wts-shop');
    office = await newTenant('wts-office');
  });

  afterAll(async () => {
    await pg.end();
  });

  it('has no default, so a new type must state the answer and the platform never answers for it', async () => {
    const { rows } = await pg.query(
      `select column_default, is_nullable
         from information_schema.columns
        where table_schema = 'public' and table_name = 'work_item_types' and column_name = 'schedulable'`,
    );
    expect(rows).toEqual([{ column_default: null, is_nullable: 'NO' }]);

    // Not even the owner of the table can create a type that does not say.
    const { error } = await shop.db
      .from('work_item_types')
      .insert({ organization_id: shop.organizationId, name: 'Unsaid', created_by: randomUUID() } as never);
    expect(error).not.toBeNull();
  });

  it('records the declaration it was given, either way', async () => {
    const visit = await createWorkItemType(shop.db, { organizationId: shop.organizationId, name: 'Service visit', schedulable: true });
    const lead = await createWorkItemType(shop.db, { organizationId: shop.organizationId, name: 'Sales opportunity', schedulable: false });

    const types = await listWorkItemTypes(shop.db, { organizationId: shop.organizationId });
    expect(types.find((type) => type.id === visit)?.schedulable).toBe(true);
    expect(types.find((type) => type.id === lead)?.schedulable).toBe(false);
  });

  it('refuses a type that is bookable and not scheduled, by the domain and by the table itself', async () => {
    const { typeId, statusId } = await typeWithJob(shop, 'Not scheduled, not bookable', false);

    await expect(
      setTypeBookable(shop.db, { id: typeId, statusId, durationMinutes: 60 }),
    ).rejects.toMatchObject({ code: 'types.booking_requires_schedulable' });

    // Around the domain layer entirely: a raw PostgREST update, and a superuser UPDATE.
    const direct = await shop.db
      .from('work_item_types')
      .update({ booking_status_id: statusId, booking_duration_minutes: 60 })
      .eq('id', typeId);
    expect(direct.error?.code).toBe('23514');
    expect(direct.error?.message).toContain('work_item_types_bookable_is_schedulable');

    await expect(
      pg.query(
        'update public.work_item_types set booking_status_id = $2, booking_duration_minutes = 60 where id = $1',
        [typeId, statusId],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses to schedule work whose type is not scheduled, through the domain and the raw RPC', async () => {
    const { workItemId } = await typeWithJob(shop, 'Enquiry', false);

    await expect(
      scheduleWorkItem(shop.db, { workItemId, startsAt: NINE, endsAt: TEN }),
    ).rejects.toMatchObject({ code: 'scheduling.type_not_schedulable' });

    const raw = await shop.db.rpc('schedule_work_item', {
      p_work_item_id: workItemId,
      p_resource_id: null as unknown as string,
      p_starts_at: NINE,
      p_ends_at: TEN,
    });
    expect(raw.error?.code).toBe('GD005');

    // And not by writing the column either.
    const written = await shop.db
      .from('work_items')
      .update({ scheduled_during: `[${NINE},${TEN})` })
      .eq('id', workItemId);
    expect(written.error).not.toBeNull();

    const items = await listWorkItems(shop.db, { organizationId: shop.organizationId });
    expect(items.find((item) => item.id === workItemId)?.window).toBeNull();
  });

  it('lets internal staff schedule work that is scheduled but not bookable', async () => {
    const { typeId, workItemId } = await typeWithJob(shop, 'Private service visit', true);
    const resourceId = await createResource(shop.db, { organizationId: shop.organizationId, name: 'Van A' });

    await expect(
      scheduleWorkItem(shop.db, { workItemId, resourceId, startsAt: NINE, endsAt: TEN }),
    ).resolves.toBeUndefined();

    // Nothing was published to get there: schedulable did not drag bookable in with it.
    const { data } = await shop.db
      .from('work_item_types')
      .select('booking_status_id, booking_duration_minutes')
      .eq('id', typeId)
      .single();
    expect(data).toEqual({ booking_status_id: null, booking_duration_minutes: null });
  });

  it('will not stop scheduling while work of the type is in the diary, and says what to do', async () => {
    const { typeId, workItemId } = await typeWithJob(shop, 'Installation', true);
    await scheduleWorkItem(shop.db, { workItemId, startsAt: NINE, endsAt: TEN });

    await expect(
      setWorkItemTypeSchedulable(shop.db, { id: typeId, schedulable: false }),
    ).rejects.toMatchObject({
      code: 'work_item_types.has_scheduled_work',
      message: expect.stringContaining('Unschedule'),
    });

    // The refusal is the database's, so a raw update says the same thing.
    const raw = await shop.db.from('work_item_types').update({ schedulable: false }).eq('id', typeId);
    expect(raw.error?.code).toBe('GD006');

    // Nothing was unscheduled on the business's behalf.
    const [still] = (await listWorkItems(shop.db, { organizationId: shop.organizationId })).filter((item) => item.id === workItemId);
    expect(still.window).not.toBeNull();

    // Once it is out of the diary the same change goes through, and scheduling it again is refused.
    await unscheduleWorkItem(shop.db, { workItemId });
    await setWorkItemTypeSchedulable(shop.db, { id: typeId, schedulable: false });
    await expect(
      scheduleWorkItem(shop.db, { workItemId, startsAt: NINE, endsAt: TEN }),
    ).rejects.toMatchObject({ code: 'scheduling.type_not_schedulable' });
  });

  it('will not stop scheduling a type that is open for public booking', async () => {
    const { typeId, statusId } = await typeWithJob(shop, 'Oil change', true);
    await setTypeBookable(shop.db, { id: typeId, statusId, durationMinutes: 45 });

    await expect(
      setWorkItemTypeSchedulable(shop.db, { id: typeId, schedulable: false }),
    ).rejects.toMatchObject({ code: 'work_item_types.is_bookable' });

    // Withdraw first, then it may be switched off — in that order.
    await setTypeBookable(shop.db, { id: typeId, statusId: null, durationMinutes: null });
    await expect(setWorkItemTypeSchedulable(shop.db, { id: typeId, schedulable: false })).resolves.toBeUndefined();
  });

  it('answers whether a business schedules from its declaration, never from what it has recorded', async () => {
    expect(await hasSchedulableWork(office.db, { organizationId: office.organizationId })).toBe(false);

    // Plenty of work, a resource, and nothing declared scheduled: still no schedule.
    await typeWithJob(office, 'Sales opportunity', false);
    await createResource(office.db, { organizationId: office.organizationId, name: 'Somebody' });
    expect(await hasSchedulableWork(office.db, { organizationId: office.organizationId })).toBe(false);

    // Declared, with no job booked yet: a schedule.
    await createWorkItemType(office.db, { organizationId: office.organizationId, name: 'Site visit', schedulable: true });
    expect(await hasSchedulableWork(office.db, { organizationId: office.organizationId })).toBe(true);

    // And one business's declaration is never another's.
    const other = await newTenant('wts-other');
    expect(await hasSchedulableWork(other.db, { organizationId: other.organizationId })).toBe(false);
  });

  it('asks a scheduling business for resources and hours, and a business that does not schedule for neither', async () => {
    const asked = async (tenant: Tenant) =>
      (await computeSetupOverview(tenant.db, { organizationId: tenant.organizationId })).areas.map((area) => area.key);

    const plain = await newTenant('wts-plain');
    await createWorkItemType(plain.db, { organizationId: plain.organizationId, name: 'Enquiry', schedulable: false });
    const plainKeys = await asked(plain);
    expect(plainKeys).toContain('work');
    for (const key of ['resources', 'hours', 'locations']) expect(plainKeys).not.toContain(key);

    const scheduling = await newTenant('wts-scheduling');
    await createWorkItemType(scheduling.db, { organizationId: scheduling.organizationId, name: 'Visit', schedulable: true });
    const keys = await asked(scheduling);
    expect(keys).toEqual(expect.arrayContaining(['work', 'resources', 'hours', 'locations']));
  });

  it('refuses a drafted setup that does not say whether the work is scheduled', async () => {
    const tenant = await newTenant('wts-draft');
    const shape = {
      typeName: 'Consultation',
      statuses: ['Open'],
      transitions: [],
      fields: {},
      prices: [],
      hours: [],
      roles: [],
    } as unknown as BusinessShape;

    await expect(configureBusiness(tenant.db, tenant.organizationId, shape)).rejects.toMatchObject({
      code: 'configuration.schedulable_missing',
    });
    await expect(
      configureBusiness(tenant.db, tenant.organizationId, {
        ...shape,
        schedulable: false,
        hours: [{ dayOfWeek: 1, opensAt: '09:00', closesAt: '17:00' }],
      }),
    ).rejects.toMatchObject({ code: 'configuration.hours_without_schedule' });

    // Neither refusal wrote anything.
    expect(await listWorkItemTypes(tenant.db, { organizationId: tenant.organizationId })).toEqual([]);
  });
});

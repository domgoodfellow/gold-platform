import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createResource } from '@/lib/domain/resources/resources';
import { listSchedule } from '@/lib/domain/scheduling/availability';
import { scheduleWorkItem, unscheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { ALL_CAPABILITIES } from '@/lib/domain/tenancy/capabilities';
import { getOrganization, updateOrganization } from '@/lib/domain/tenancy/organizations';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';

/**
 * Time a resource stays busy after a job, and the fact that it is configuration.
 *
 * `constraints.md` lists **buffers** in the never-hardcode set, beside statuses, prices,
 * business hours and currency. This suite is what makes that literal rather than aspirational:
 * the platform holds no gap between jobs, invents none, and a business that has said nothing
 * gets zero — byte-identical behaviour to before the column existed.
 *
 * **Why a business wants one is deliberately not modelled.** A mobile service drives to the
 * next address, a clinic cleans the room, a hire yard inspects the machine. Those are one fact
 * about a schedule, and naming the column for any one of them would put a single business's
 * reason in every business's schema.
 *
 * The load-bearing claim is that the buffer is **enforced, not displayed**. Padding only the
 * availability calculation would leave `freeWindows` refusing a slot the database accepts,
 * which breaks I5 in the direction nobody notices — the constraint would stop being the
 * re-assertion I6 depends on. So the constraint compares the occupied window, and these tests
 * check both directions of that agreement.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const NINE = '2026-12-01T09:00:00.000Z';
const TEN = '2026-12-01T10:00:00.000Z';
const HALF_TEN = '2026-12-01T10:30:00.000Z';
const ELEVEN = '2026-12-01T11:00:00.000Z';
const DAY = { startsAt: '2026-12-01T00:00:00.000Z', endsAt: '2026-12-02T00:00:00.000Z' };

type Tenant = {
  db: SupabaseClient;
  organizationId: string;
  statusId: string;
  resourceId: string;
};

let yard: Tenant;

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

  const { data: organizationId, error } = await db.rpc('create_organization', {
    p_name: `${label} Ltd`,
    p_role: 'Owner',
    p_capabilities: ALL_CAPABILITIES,
    p_display_name: 'Founder',
    p_timezone: 'America/Toronto',
    p_currency: 'CAD',
  });
  if (error) throw error;

  const orgId = organizationId as string;
  const typeId = await createWorkItemType(db, { organizationId: orgId, name: 'Callout' });
  const statusId = await createWorkItemStatus(db, {
    organizationId: orgId,
    typeId,
    name: 'Booked',
  });
  const resourceId = await createResource(db, { organizationId: orgId, name: 'Van 1' });

  return { db, organizationId: orgId, statusId, resourceId };
}

async function job(tenant: Tenant, title: string): Promise<string> {
  return createWorkItem(tenant.db, {
    organizationId: tenant.organizationId,
    title,
    statusId: tenant.statusId,
  });
}

async function setBuffer(tenant: Tenant, minutes: number) {
  const organization = await getOrganization(tenant.db, tenant.organizationId);
  await updateOrganization(tenant.db, {
    id: tenant.organizationId,
    name: organization!.name,
    timezone: organization!.timezone,
    currency: organization!.currency,
    bufferMinutes: minutes,
    slug: null,
  });
}

describe('a buffer between jobs, which the tenant owns', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    yard = await newTenant('bf-yard');
  });

  it('seeds no buffer at all for a new business', async () => {
    // The assertion that keeps the rest honest, and the same one `operating-hours.test.ts`
    // makes about a working week. Zero is what "this business has said nothing" means.
    const organization = await getOrganization(yard.db, yard.organizationId);
    expect(organization!.bufferMinutes).toBe(0);
  });

  it('allows back-to-back work while the business has said nothing', async () => {
    const first = await job(yard, 'Nine to ten');
    await scheduleWorkItem(yard.db, {
      workItemId: first,
      resourceId: yard.resourceId,
      startsAt: NINE,
      endsAt: TEN,
    });

    const second = await job(yard, 'Ten to eleven');
    await expect(
      scheduleWorkItem(yard.db, {
        workItemId: second,
        resourceId: yard.resourceId,
        startsAt: TEN,
        endsAt: ELEVEN,
      }),
    ).resolves.toBeUndefined();

    await unscheduleWorkItem(yard.db, { workItemId: second });
  });

  it('refuses the same pair once the business says it needs thirty minutes', async () => {
    await setBuffer(yard, 30);

    const second = await job(yard, 'Too soon after');
    await expect(
      scheduleWorkItem(yard.db, {
        workItemId: second,
        resourceId: yard.resourceId,
        startsAt: TEN,
        endsAt: ELEVEN,
      }),
    ).rejects.toMatchObject({ code: 'scheduling.double_booked' });
  });

  it('accepts the job that starts after the buffer has run', async () => {
    const later = await job(yard, 'After the gap');
    await expect(
      scheduleWorkItem(yard.db, {
        workItemId: later,
        resourceId: yard.resourceId,
        startsAt: HALF_TEN,
        endsAt: ELEVEN,
      }),
    ).resolves.toBeUndefined();

    await unscheduleWorkItem(yard.db, { workItemId: later });
  });

  it('subtracts the buffer from availability, and still agrees with the constraint (I5)', async () => {
    const [van] = await listSchedule(yard.db, {
      organizationId: yard.organizationId,
      within: DAY,
    });

    // The appointment is what the customer was told; the occupied window is what the van
    // cannot be booked across. Both are on the entry because they answer different questions.
    const booked = van.booked.find((entry) => entry.title === 'Nine to ten')!;
    expect(booked.window).toEqual({ startsAt: NINE, endsAt: TEN });
    expect(booked.occupied).toEqual({ startsAt: NINE, endsAt: HALF_TEN });

    // Free time begins after the buffer, not after the appointment...
    const gap = van.free.find((window) => window.startsAt === HALF_TEN);
    expect(gap).toBeDefined();

    // ...and a window it calls free is committable, which is the half of the agreement that
    // would break if the buffer padded only this calculation.
    const taker = await job(yard, 'Took the free window');
    await expect(
      scheduleWorkItem(yard.db, {
        workItemId: taker,
        resourceId: yard.resourceId,
        startsAt: HALF_TEN,
        endsAt: ELEVEN,
      }),
    ).resolves.toBeUndefined();
    await unscheduleWorkItem(yard.db, { workItemId: taker });
  });

  it('reaches work already scheduled when the buffer changes', async () => {
    // Deliberate, and the same reasoning as a status that releases its resource: a business
    // that discovers it needs longer between jobs means that about tomorrow's bookings, not
    // only about the next one it takes.
    await setBuffer(yard, 0);

    const [van] = await listSchedule(yard.db, {
      organizationId: yard.organizationId,
      within: DAY,
    });
    const booked = van.booked.find((entry) => entry.title === 'Nine to ten')!;
    expect(booked.occupied).toEqual({ startsAt: NINE, endsAt: TEN });
  });

  it('refuses a buffer that would overlap work already committed', async () => {
    // Two jobs an hour apart, then an attempt to declare a ninety-minute gap between jobs.
    // The database refuses rather than holding a schedule the van cannot work.
    const second = await job(yard, 'Ten to eleven, kept');
    await scheduleWorkItem(yard.db, {
      workItemId: second,
      resourceId: yard.resourceId,
      startsAt: TEN,
      endsAt: ELEVEN,
    });

    await expect(setBuffer(yard, 90)).rejects.toMatchObject({
      code: 'organizations.buffer_conflict',
    });

    // And nothing moved.
    const organization = await getOrganization(yard.db, yard.organizationId);
    expect(organization!.bufferMinutes).toBe(0);
  });

  it('refuses a buffer that is not a whole number of minutes in range', async () => {
    await expect(setBuffer(yard, -1)).rejects.toMatchObject({
      code: 'organizations.buffer_invalid',
    });
    await expect(setBuffer(yard, 1441)).rejects.toMatchObject({
      code: 'organizations.buffer_invalid',
    });

    // And as a raw update, because the check constraint is the guarantee and the domain
    // message is the courtesy.
    const { error } = await yard.db
      .from('organizations')
      .update({ buffer_minutes: -5 })
      .eq('id', yard.organizationId);
    expect(error).not.toBeNull();
  });

  it('is one tenant’s answer and never another’s', async () => {
    const clinic = await newTenant('bf-clinic');
    await setBuffer(clinic, 15);

    // The yard is unchanged, and nothing about the platform now believes fifteen minutes.
    const theirs = await getOrganization(clinic.db, clinic.organizationId);
    const ours = await getOrganization(yard.db, yard.organizationId);
    expect(theirs!.bufferMinutes).toBe(15);
    expect(ours!.bufferMinutes).toBe(0);
  });
});

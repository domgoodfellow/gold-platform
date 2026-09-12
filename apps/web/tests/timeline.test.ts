import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCustomer } from '@/lib/domain/customers/customers';
import { createLocation, linkCustomerLocation } from '@/lib/domain/locations/locations';
import { createResource } from '@/lib/domain/resources/resources';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import { listCustomerTimeline, listWorkItemTimeline } from '@/lib/domain/timeline/timeline';
import { createWorkItemStatus, updateWorkItemStatus } from '@/lib/domain/work-items/statuses';
import { createWorkItemTransition, changeWorkItemStatus } from '@/lib/domain/work-items/transitions';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from './helpers/founding';

/**
 * The first reader `events` has ever had.
 *
 * The table shipped in M1 because it cannot be backfilled, and thirty-odd writers have been
 * filling it since with nothing looking. These assertions are about what reading found.
 *
 * Two of them are the point of the file:
 *
 *   * **A renamed status renames its history.** The timeline resolves ids against the same
 *     rows every other screen reads, so a business that renames a board column sees the new
 *     word everywhere including last month. That follows from D6 rather than from a choice
 *     made here: the job moved into a *row*, and renaming a row moves no work. Snapshotting
 *     the word onto the event would make this the one screen still showing a name the
 *     business has stopped using.
 *   * **An event can be written against the other side of the relationship it records.**
 *     `location.linked` names the *location* and carries the customer in its payload, which
 *     was reasonable when written and invisible to a reader filtering on `entity_id`. That is
 *     a general hazard of an append-only table with a polymorphic subject, and it is worth an
 *     assertion because nothing else in the suite could have caught it.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = {
  db: SupabaseClient;
  organizationId: string;
  customerId: string;
  otherCustomerId: string;
  bookedId: string;
  doneId: string;
  workItemId: string;
};

let acme: Tenant;

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
    displayName: 'Dominique',
    timezone: 'America/Toronto',
    currency: 'CAD',
  });

  const orgId = organizationId as string;
  const typeId = await createWorkItemType(db, { organizationId: orgId, name: 'Callout' });
  const bookedId = await createWorkItemStatus(db, {
    organizationId: orgId,
    typeId,
    name: 'Booked',
  });
  const doneId = await createWorkItemStatus(db, { organizationId: orgId, typeId, name: 'Done' });
  await createWorkItemTransition(db, {
    organizationId: orgId,
    typeId,
    fromStatusId: bookedId,
    toStatusId: doneId,
  });

  const customerId = await createCustomer(db, { organizationId: orgId, name: 'Ariane Blais' });
  const otherCustomerId = await createCustomer(db, {
    organizationId: orgId,
    name: 'Someone Else',
  });

  const workItemId = await createWorkItem(db, {
    organizationId: orgId,
    title: 'Winter tyres',
    statusId: bookedId,
    customerId,
  });

  const resourceId = await createResource(db, { organizationId: orgId, name: 'Van 1' });
  await scheduleWorkItem(db, {
    workItemId,
    resourceId,
    startsAt: '2026-11-02T13:00:00.000Z',
    endsAt: '2026-11-02T14:00:00.000Z',
  });
  await changeWorkItemStatus(db, { workItemId, toStatusId: doneId });

  return { db, organizationId: orgId, customerId, otherCustomerId, bookedId, doneId, workItemId };
}

async function timeline(tenant: Tenant, customerId = tenant.customerId) {
  return listCustomerTimeline(tenant.db, { organizationId: tenant.organizationId, customerId });
}

describe('a customer’s history', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    acme = await newTenant('tl-acme');
  });

  it('reads a history nobody wrote for it', async () => {
    // Every one of these rows was written by a slice that had no reader in mind. That is the
    // whole argument for shipping `events` in M1: none of this could be reconstructed now.
    const entries = await timeline(acme);
    const actions = entries.map((entry) => entry.action);

    expect(actions).toContain('customer.created');
    expect(actions).toContain('work_item.created');
    expect(actions).toContain('work_item.scheduled');
    expect(actions).toContain('work_item.status_changed');
  });

  it('includes what happened to the customer’s work, not only to the customer row', async () => {
    // A business remembers a customer through jobs. A timeline of `customer.created` alone
    // would be a screen with one line on it forever.
    const entries = await timeline(acme);
    const created = entries.find((entry) => entry.action === 'work_item.created');
    expect(created!.description).toBe('Work created: Winter tyres');

    const scheduled = entries.find((entry) => entry.action === 'work_item.scheduled');
    expect(scheduled!.description).toContain('Van 1');
    expect(scheduled!.description).toContain('Winter tyres');
  });

  it('is newest first', async () => {
    const entries = await timeline(acme);
    const stamps = entries.map((entry) => entry.occurredAt);
    expect([...stamps].sort((a, b) => b.localeCompare(a))).toEqual(stamps);
  });

  it('attributes every entry to what this tenant calls that person (I11, D19)', async () => {
    const entries = await timeline(acme);
    expect(entries.every((entry) => entry.actorName === 'Dominique')).toBe(true);
  });

  it('shows another customer nothing of this one’s', async () => {
    const entries = await timeline(acme, acme.otherCustomerId);
    expect(entries.map((entry) => entry.action)).toEqual(['customer.created']);
  });

  it('renames history when a status is renamed (D6)', async () => {
    const before = await timeline(acme);
    expect(before.find((entry) => entry.action === 'work_item.status_changed')!.description).toBe(
      'Moved to Done on Winter tyres',
    );

    await updateWorkItemStatus(acme.db, {
      id: acme.doneId,
      name: 'Complété',
      position: 1,
      releasesResource: false,
      marksComplete: false,
    });

    // The event is unchanged and append-only; what changed is the row it points at. A
    // business that renames a board column does not keep a screen using the old word — the
    // job moved into that row, and that row is now called something else.
    const after = await timeline(acme);
    expect(after.find((entry) => entry.action === 'work_item.status_changed')!.description).toBe(
      'Moved to Complété on Winter tyres',
    );
  });

  it('finds an event written against the other side of the relationship', async () => {
    // `location.linked` names the location and puts the customer in the payload. A reader
    // filtering on `entity_id` — which is the obvious way to ask "what happened to this
    // customer" — sees nothing at all.
    const locationId = await createLocation(acme.db, {
      organizationId: acme.organizationId,
      label: 'Ariane’s driveway',
      address: '4021 Rue Sainte-Catherine, Montréal',
    });
    await linkCustomerLocation(acme.db, {
      organizationId: acme.organizationId,
      customerId: acme.customerId,
      locationId,
    });

    const entries = await timeline(acme);
    expect(entries.map((entry) => entry.action)).toContain('location.linked');

    // And it belongs to the customer it names, not to every customer at that address.
    const other = await timeline(acme, acme.otherCustomerId);
    expect(other.map((entry) => entry.action)).not.toContain('location.linked');
  });

  it('says so rather than rendering a blank when a status is gone', async () => {
    // Deleting a status a job is sitting in is refused by the foreign key, so this is the
    // reachable version: an event naming an id that resolves to nothing. It matters because
    // the resolve-don't-snapshot choice above is only safe if the miss is handled.
    const orphan = randomUUID();
    const { error } = await acme.db.from('events').insert({
      organization_id: acme.organizationId,
      actor_id: (await acme.db.auth.getUser()).data.user!.id,
      entity_type: 'work_item',
      entity_id: acme.workItemId,
      action: 'work_item.status_changed',
      payload: { from_status_id: acme.bookedId, to_status_id: orphan },
    });
    expect(error).toBeNull();

    const entries = await timeline(acme);
    const missing = entries.find((entry) =>
      entry.description.includes('no longer exists'),
    );
    expect(missing).toBeDefined();
  });

  it('shows one tenant nothing of another’s history', async () => {
    const other = await newTenant('tl-other');

    // Asking for their customer id under our own JWT returns nothing: RLS is the boundary,
    // and the `organization_id` filter above is an optimisation rather than the guard.
    const entries = await listCustomerTimeline(acme.db, {
      organizationId: acme.organizationId,
      customerId: other.customerId,
    });
    expect(entries).toEqual([]);
  });
});

describe('a job’s own history', () => {
  it('reads exactly what happened to this job — no view needed, unlike a customer’s', async () => {
    const entries = await listWorkItemTimeline(acme.db, {
      organizationId: acme.organizationId,
      workItemId: acme.workItemId,
    });
    const actions = entries.map((entry) => entry.action);

    expect(actions).toContain('work_item.created');
    expect(actions).toContain('work_item.scheduled');
    expect(actions).toContain('work_item.status_changed');
    // Written against the customer row, not this job — a job's own history is narrower than
    // the customer's, which is the whole point of having two scopes rather than one.
    expect(actions).not.toContain('customer.created');
  });

  it('drops the redundant "on <title>" a customer’s timeline needs but a job’s own page does not', async () => {
    const entries = await listWorkItemTimeline(acme.db, {
      organizationId: acme.organizationId,
      workItemId: acme.workItemId,
    });
    const scheduled = entries.find((entry) => entry.action === 'work_item.scheduled');
    expect(scheduled!.description).toBe('Scheduled to Van 1');
  });

  it('is newest first', async () => {
    const entries = await listWorkItemTimeline(acme.db, {
      organizationId: acme.organizationId,
      workItemId: acme.workItemId,
    });
    const stamps = entries.map((entry) => entry.occurredAt);
    expect([...stamps].sort((a, b) => b.localeCompare(a))).toEqual(stamps);
  });

  it('shows one tenant nothing of another’s job', async () => {
    const other = await newTenant('tl-other-job');

    const entries = await listWorkItemTimeline(acme.db, {
      organizationId: acme.organizationId,
      workItemId: other.workItemId,
    });
    expect(entries).toEqual([]);
  });
});

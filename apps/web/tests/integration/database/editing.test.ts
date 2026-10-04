import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { createResource } from '@/lib/domain/resources/resources';
import { scheduleWorkItem } from '@/lib/domain/scheduling/schedule';
import {
  getOrganization,
  updateOrganization,
} from '@/lib/domain/tenancy/organizations';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { listCosts, recordCost } from '@/lib/domain/work-items/consumption';
import {
  createWorkItemStatus,
  listWorkItemStatuses,
  updateWorkItemStatus,
} from '@/lib/domain/work-items/statuses';
import {
  createWorkItemType,
  listWorkItemTypes,
  renameWorkItemType,
} from '@/lib/domain/work-items/types';
import { createWorkItem, listWorkItems } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * The edit paths that shipped write-once, and the two claims that make them safe.
 *
 * D19 set the precedent for deferring an edit path until something needs one. What needed
 * these is a business that picked the wrong timezone at signup, or typed its board column
 * wrong, and had no recourse short of a migration.
 *
 * Two of them look dangerous and are not, for reasons that were designed in rather than
 * discovered:
 *
 *   * **Changing the currency does not reinterpret history.** Every amount carries the
 *     currency it was recorded in, snapshotted at insert (I8). This file records a cost in
 *     one currency, changes the organization's, and asserts the old row is unmoved.
 *   * **Changing the timezone does not move a booking.** A scheduled window is an absolute
 *     instant (I9); only its rendering changes.
 *
 * And one that looks dangerous and is not, for a different reason: renaming a status moves no
 * work, because a job references its status by id. That is what D6 buys by making the
 * tenant's word data rather than an enum, and it is worth an assertion because the whole
 * argument for D6 rests on it.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const BOOKED = '2026-09-15T09:00:00.000Z';

type Tenant = {
  db: SupabaseClient;
  userId: string;
  organizationId: string;
  typeId: string;
  statusId: string;
  resourceId: string;
  workItemId: string;
};

let alice: Tenant;
let bob: Tenant;

async function newTenant(label: string): Promise<Tenant> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const password = `pw-${randomUUID()}`;

  const { data: created, error: createError } = await admin.auth.admin.createUser({
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
    displayName: 'Founder',
    timezone: 'Europe/Amsterdam',
    currency: 'EUR',
  });

  const orgId = organizationId as string;
  const typeId = await createWorkItemType(db, { schedulable: true, organizationId: orgId, name: 'Callout' });
  const statusId = await createWorkItemStatus(db, {
    organizationId: orgId,
    typeId,
    name: 'Booked',
  });
  const resourceId = await createResource(db, { resourceClass: 'other', organizationId: orgId, name: 'Sam Okafor' });
  const workItemId = await createWorkItem(db, {
    organizationId: orgId,
    title: 'Replace the pump',
    statusId,
  });

  await scheduleWorkItem(db, {
    workItemId,
    resourceId,
    startsAt: BOOKED,
    endsAt: '2026-09-15T10:00:00.000Z',
  });

  return {
    db,
    userId: created.user.id,
    organizationId: orgId,
    typeId,
    statusId,
    resourceId,
    workItemId,
  };
}

describe('editing configuration that shipped write-once', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('ed-alice');
    bob = await newTenant('ed-bob');
  });

  it('renames a type without moving anything', async () => {
    await renameWorkItemType(alice.db, { id: alice.typeId, name: 'Service visit' });

    const [type] = await listWorkItemTypes(alice.db, {
      organizationId: alice.organizationId,
    });
    expect(type.name).toBe('Service visit');
    expect(type.id).toBe(alice.typeId);

    // Every job of that kind is still of that kind.
    const [item] = await listWorkItems(alice.db, {
      organizationId: alice.organizationId,
      typeId: alice.typeId,
    });
    expect(item.type.label).toBe('Service visit');
    expect(item.id).toBe(alice.workItemId);
  });

  it('renames a status without moving the work sitting in it (D6)', async () => {
    await updateWorkItemStatus(alice.db, {
      id: alice.statusId,
      name: 'Scheduled',
      position: 0,
      releasesResource: false,
      marksComplete: false,
    });

    const [item] = await listWorkItems(alice.db, {
      organizationId: alice.organizationId,
      typeId: alice.typeId,
    });
    // Same row, new word. This is the whole claim behind statuses being data rather than an
    // enum: a business renaming a board column is not a migration.
    expect(item.status.id).toBe(alice.statusId);
    expect(item.status.label).toBe('Scheduled');
  });

  it('reorders the board', async () => {
    const second = await createWorkItemStatus(alice.db, {
      organizationId: alice.organizationId,
      typeId: alice.typeId,
      name: 'Complete',
    });

    await updateWorkItemStatus(alice.db, {
      id: second,
      name: 'Complete',
      position: 0,
      releasesResource: false,
      marksComplete: false,
    });
    await updateWorkItemStatus(alice.db, {
      id: alice.statusId,
      name: 'Scheduled',
      position: 1,
      releasesResource: false,
      marksComplete: false,
    });

    const statuses = await listWorkItemStatuses(alice.db, {
      organizationId: alice.organizationId,
      typeId: alice.typeId,
    });
    expect(statuses.map((status) => status.name)).toEqual(['Complete', 'Scheduled']);
  });

  it('refuses a rename onto a name already in use', async () => {
    await expect(
      updateWorkItemStatus(alice.db, {
        id: alice.statusId,
        name: 'complete',
        position: 1,
        releasesResource: false,
      marksComplete: false,
      }),
    ).rejects.toMatchObject({ code: 'statuses.name_taken' });
  });

  it('cannot move a status to another type, even directly', async () => {
    // Not offered, and not possible: `type_id` is outside the column grant, so there is no
    // path that fails halfway through with a foreign key error nobody can read.
    const otherType = await createWorkItemType(alice.db, { schedulable: true,
      organizationId: alice.organizationId,
      name: 'Installation',
    });

    const { error } = await alice.db
      .from('work_item_statuses')
      .update({ type_id: otherType })
      .eq('id', alice.statusId);

    expect(error).not.toBeNull();
  });

  it('changes the business\'s own settings', async () => {
    await updateOrganization(alice.db, {
      id: alice.organizationId,
      name: 'Renamed Operations Ltd',
      timezone: 'America/New_York',
      currency: 'USD',
      bufferMinutes: 0,
      slug: null,
    });

    const organization = await getOrganization(alice.db, alice.organizationId);
    expect(organization!.name).toBe('Renamed Operations Ltd');
    expect(organization!.timezone).toBe('America/New_York');
    expect(organization!.currency).toBe('USD');
  });

  it('does not move a booking when the timezone changes (I9)', async () => {
    // The instant is absolute. Alice now reads it as a New York time rather than an
    // Amsterdam one, and it is the same moment.
    const [item] = await listWorkItems(alice.db, {
      organizationId: alice.organizationId,
      typeId: alice.typeId,
    });
    expect(item.window?.startsAt).toBe(BOOKED);
  });

  it('does not reinterpret a recorded cost when the currency changes (I8)', async () => {
    // Recorded while Bob traded in EUR.
    await recordCost(bob.db, {
      workItemId: bob.workItemId,
      description: 'Replacement valve',
      amountMinor: 4250,
    });

    await updateOrganization(bob.db, {
      id: bob.organizationId,
      name: 'Bob Ltd',
      timezone: 'Europe/Amsterdam',
      currency: 'GBP',
      bufferMinutes: 0,
      slug: null,
    });

    const [existing] = await listCosts(bob.db, {
      organizationId: bob.organizationId,
      workItemId: bob.workItemId,
    });
    // Still EUR. The snapshot is why this edit path is safe to offer at all.
    expect(existing.currency).toBe('EUR');
    expect(existing.amountMinor).toBe(4250);

    // And the next one is recorded in the new currency.
    await recordCost(bob.db, {
      workItemId: bob.workItemId,
      description: 'Second valve',
      amountMinor: 3000,
    });
    const costs = await listCosts(bob.db, {
      organizationId: bob.organizationId,
      workItemId: bob.workItemId,
    });
    expect(costs.map((cost) => cost.currency)).toEqual(['EUR', 'GBP']);
  });

  it('refuses a timezone the database does not recognise', async () => {
    await expect(
      updateOrganization(alice.db, {
        id: alice.organizationId,
        name: 'Renamed Operations Ltd',
        timezone: 'Mars/Olympus_Mons',
        currency: 'USD',
        bufferMinutes: 0,
        slug: null,
      }),
    ).rejects.toMatchObject({ code: 'organizations.timezone_invalid' });
  });

  it('refuses a currency that is not three letters', async () => {
    await expect(
      updateOrganization(alice.db, {
        id: alice.organizationId,
        name: 'Renamed Operations Ltd',
        timezone: 'America/New_York',
        currency: 'dollars',
        bufferMinutes: 0,
        slug: null,
      }),
    ).rejects.toMatchObject({ code: 'organizations.currency_invalid' });
  });

  it('cannot change another tenant\'s settings, even holding its id', async () => {
    await expect(
      updateOrganization(alice.db, {
        id: bob.organizationId,
        name: 'Taken over',
        timezone: 'UTC',
        currency: 'USD',
        bufferMinutes: 0,
        slug: null,
      }),
    ).rejects.toMatchObject({ code: 'organizations.forbidden' });

    const theirs = await getOrganization(bob.db, bob.organizationId);
    expect(theirs!.name).toBe('Bob Ltd');
  });

  it('requires organization.manage, which field.manage does not imply (I12, I16)', async () => {
    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'Configurer',
      capabilities: ['role.manage', 'field.manage'],
    });

    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();

    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    // Naming a board column is configuring how this business records work; changing the
    // currency it trades in is changing the business. Plausibly different people, so
    // deliberately different capabilities.
    await expect(
      updateOrganization(bob.db, {
        id: bob.organizationId,
        name: 'Should not change',
        timezone: 'UTC',
        currency: 'USD',
        bufferMinutes: 0,
        slug: null,
      }),
    ).rejects.toMatchObject({ code: 'organizations.forbidden' });

    // field.manage still renames a type, so the role is not simply powerless.
    await expect(
      renameWorkItemType(bob.db, { id: bob.typeId, name: 'Still allowed' }),
    ).resolves.toBeUndefined();

    // And a direct update changes nothing. A row refused by an UPDATE policy is invisible to
    // the statement rather than an error, so the assertion that matters is the value.
    await bob.db.from('organizations').update({ currency: 'USD' }).eq('id', bob.organizationId);

    const unchanged = await getOrganization(bob.db, bob.organizationId);
    expect(unchanged!.currency).toBe('GBP');
  });

  it('records every edit on the timeline (I11)', async () => {
    const { data, error } = await alice.db
      .from('events')
      .select('action, actor_id')
      .eq('organization_id', alice.organizationId)
      .in('action', [
        'organization.updated',
        'work_item_type.renamed',
        'work_item_status.updated',
      ]);

    expect(error).toBeNull();
    const actions = new Set(data!.map((event) => event.action));
    expect(actions).toContain('organization.updated');
    expect(actions).toContain('work_item_type.renamed');
    expect(actions).toContain('work_item_status.updated');
    expect(data!.every((event) => event.actor_id === alice.userId)).toBe(true);
  });
});

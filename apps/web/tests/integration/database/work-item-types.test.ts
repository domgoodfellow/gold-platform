import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { createWorkItemStatus, listWorkItemStatuses } from '@/lib/domain/work-items/statuses';
import { createWorkItemType, listWorkItemTypes } from '@/lib/domain/work-items/types';
import { createWorkItem, listWorkItems } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * Work item types, and the constraint that keeps a board coherent.
 *
 * A type owns scope and nothing else: which statuses exist, and — in the next slice — which
 * moves between them are legal. Two claims are worth a test each, and the second is the one
 * that is easy to get wrong.
 *
 *   * A status name is unique within a TYPE, not within the organization. A business that
 *     installs and also repairs wants "Scheduled" on both boards, and the old index would
 *     have refused the second one.
 *   * A work item cannot sit in another type's status. That is not a tenancy question —
 *     both rows belong to the same organization and RLS is satisfied — so nothing in I18's
 *     machinery catches it. The three-column reference
 *     `(organization_id, type_id, status_id)` does, and this file proves it by inserting
 *     the mismatch directly rather than through the domain layer.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = {
  db: SupabaseClient;
  userId: string;
  organizationId: string;
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
    timezone: 'UTC',
    currency: 'EUR',
  });

  return { db, userId: created.user.id, organizationId: organizationId as string };
}

describe('work item types', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('wt-alice');
    bob = await newTenant('wt-bob');
  });

  it('lets two tenants define the same type (I2)', async () => {
    // If work_item_types_org_name_unique had lost its leading organization_id, the second of
    // these would fail — and no two businesses could ever both do installations.
    const mine = await createWorkItemType(alice.db, { schedulable: true,
      organizationId: alice.organizationId,
      name: 'Installation',
    });
    const theirs = await createWorkItemType(bob.db, { schedulable: true,
      organizationId: bob.organizationId,
      name: 'Installation',
    });

    expect(mine).not.toBe(theirs);
  });

  it('refuses two types with the same name in one tenant', async () => {
    await expect(
      createWorkItemType(alice.db, { schedulable: true,
        organizationId: alice.organizationId,
        name: 'installation',
      }),
    ).rejects.toMatchObject({ code: 'work_item_types.name_taken' });
  });

  it('lets two types in one tenant share a status name', async () => {
    const [installation] = await listWorkItemTypes(alice.db, {
      organizationId: alice.organizationId,
    });
    const repair = await createWorkItemType(alice.db, { schedulable: true,
      organizationId: alice.organizationId,
      name: 'Repair',
    });

    // The whole reason statuses moved under types. Before this slice the second call failed.
    const onInstallation = await createWorkItemStatus(alice.db, {
      organizationId: alice.organizationId,
      typeId: installation.id,
      name: 'Scheduled',
    });
    const onRepair = await createWorkItemStatus(alice.db, {
      organizationId: alice.organizationId,
      typeId: repair,
      name: 'Scheduled',
    });

    expect(onInstallation).not.toBe(onRepair);

    // And each board sees only its own column, rather than both.
    const installationBoard = await listWorkItemStatuses(alice.db, {
      organizationId: alice.organizationId,
      typeId: installation.id,
    });
    expect(installationBoard.map((s) => s.id)).toEqual([onInstallation]);
  });

  it('cannot put a work item in another type\'s status', async () => {
    const types = await listWorkItemTypes(alice.db, { organizationId: alice.organizationId });
    const installation = types.find((t) => t.name === 'Installation')!;
    const repair = types.find((t) => t.name === 'Repair')!;

    const repairScheduled = (
      await listWorkItemStatuses(alice.db, {
        organizationId: alice.organizationId,
        typeId: repair.id,
      })
    )[0];

    // Written directly, because the domain layer derives the type from the status and so
    // cannot express the mismatch. Both rows are Alice's, so RLS passes and I18's composite
    // references pass — only the three-column constraint objects.
    const { error } = await alice.db.from('work_items').insert({
      organization_id: alice.organizationId,
      title: 'An installation sitting in a repair column',
      type_id: installation.id,
      status_id: repairScheduled.id,
      created_by: alice.userId,
    });

    expect(error?.code).toBe('23503');
  });

  it('derives a work item\'s type from its status', async () => {
    const types = await listWorkItemTypes(alice.db, { organizationId: alice.organizationId });
    const repair = types.find((t) => t.name === 'Repair')!;
    const [repairScheduled] = await listWorkItemStatuses(alice.db, {
      organizationId: alice.organizationId,
      typeId: repair.id,
    });

    await createWorkItem(alice.db, {
      organizationId: alice.organizationId,
      title: 'Derived',
      statusId: repairScheduled.id,
    });

    const [item] = await listWorkItems(alice.db, {
      organizationId: alice.organizationId,
      typeId: repair.id,
    });
    expect(item.title).toBe('Derived');
    expect(item.type.label).toBe('Repair');
  });

  it('filters work to one type, and lists every type when asked for none', async () => {
    const types = await listWorkItemTypes(alice.db, { organizationId: alice.organizationId });
    const installation = types.find((t) => t.name === 'Installation')!;

    const [installationScheduled] = await listWorkItemStatuses(alice.db, {
      organizationId: alice.organizationId,
      typeId: installation.id,
    });
    await createWorkItem(alice.db, {
      organizationId: alice.organizationId,
      title: 'On the other board',
      statusId: installationScheduled.id,
    });

    const onlyInstallation = await listWorkItems(alice.db, {
      organizationId: alice.organizationId,
      typeId: installation.id,
    });
    expect(onlyInstallation.map((i) => i.title)).toEqual(['On the other board']);

    const everything = await listWorkItems(alice.db, {
      organizationId: alice.organizationId,
    });
    expect(everything.map((i) => i.title).sort()).toEqual(['Derived', 'On the other board']);
  });

  it('shows each tenant only its own types', async () => {
    const theirs = await listWorkItemTypes(bob.db, { organizationId: bob.organizationId });
    expect(theirs.map((t) => t.name)).toEqual(['Installation']);

    // Holding Alice's real organization id grants nothing.
    const acrossTheWall = await listWorkItemTypes(bob.db, {
      organizationId: alice.organizationId,
    });
    expect(acrossTheWall).toEqual([]);
  });

  it('cannot hang a status off another tenant\'s type (I18)', async () => {
    const [aliceType] = await listWorkItemTypes(alice.db, {
      organizationId: alice.organizationId,
    });

    await expect(
      createWorkItemStatus(bob.db, {
        organizationId: bob.organizationId,
        typeId: aliceType.id,
        name: 'Borrowed',
      }),
    ).rejects.toMatchObject({ code: 'statuses.type_not_found' });
  });

  it('enforces the capability in the database, not just the domain (I16)', async () => {
    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'No Config',
      capabilities: ['role.manage'],
    });

    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();

    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    await expect(
      createWorkItemType(bob.db, { schedulable: true,
        organizationId: bob.organizationId,
        name: 'Should not exist',
      }),
    ).rejects.toMatchObject({ code: 'work_item_types.forbidden' });

    // The same refusal for a direct PostgREST insert, which no domain check would have seen.
    const { error } = await bob.db.from('work_item_types').insert({
      organization_id: bob.organizationId,
      name: 'Not this way either',
      created_by: bob.userId,
    });
    expect(error?.code).toBe('42501');
  });

  it('records a type on the timeline (I11)', async () => {
    const { data, error } = await alice.db
      .from('events')
      .select('action, actor_id')
      .eq('organization_id', alice.organizationId)
      .eq('action', 'work_item_type.created');

    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    expect(data!.every((e) => e.actor_id === alice.userId)).toBe(true);
  });
});

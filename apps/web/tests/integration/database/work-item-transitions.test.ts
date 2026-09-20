import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { assignRole, createRole } from '@/lib/domain/tenancy/roles';
import { createWorkItemStatus } from '@/lib/domain/work-items/statuses';
import {
  allowedNextStatusIds,
  changeWorkItemStatus,
  createWorkItemTransition,
  listWorkItemTransitions,
} from '@/lib/domain/work-items/transitions';
import { createWorkItemType } from '@/lib/domain/work-items/types';
import { createWorkItem, listWorkItems } from '@/lib/domain/work-items/work-items';
import { foundBusiness } from '@/tests/support/founding';

/**
 * I13 — a work item's status transition is valid according to that tenant's configured
 * transitions.
 *
 * The claim under test is not "the domain layer refuses an illegal move". It is that the
 * move is refused *at all*, by whatever path is taken, which is I12's standard: a direct
 * PostgREST update must be refused exactly as a form is. Every negative case here is
 * therefore run twice where it can be — once through the domain and once as a raw update —
 * because a check that lives only in TypeScript is absent from the path an attacker uses.
 *
 * The other half is the choice recorded in the migration: a type with no configured
 * transitions is FROZEN, not unconstrained. That is the reading of I13 that keeps it from
 * holding vacuously for every tenant who never opened the transitions screen, and the first
 * test asserts it directly.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

type Tenant = {
  db: SupabaseClient;
  userId: string;
  organizationId: string;
  typeId: string;
  open: string;
  doing: string;
  done: string;
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

  const orgId = organizationId as string;
  const typeId = await createWorkItemType(db, { organizationId: orgId, name: 'Callout' });

  const status = (name: string) =>
    createWorkItemStatus(db, { organizationId: orgId, typeId, name });

  return {
    db,
    userId: created.user.id,
    organizationId: orgId,
    typeId,
    open: await status('Open'),
    doing: await status('In progress'),
    done: await status('Done'),
  };
}

/** A fresh work item in `Open`, so each test starts from a known place on the board. */
async function newWorkItem(tenant: Tenant): Promise<string> {
  return createWorkItem(tenant.db, {
    organizationId: tenant.organizationId,
    title: `Job ${randomUUID().slice(0, 6)}`,
    statusId: tenant.open,
  });
}

/** Move a work item without the domain layer, the way a raw PostgREST call would. */
async function moveDirectly(tenant: Tenant, workItemId: string, toStatusId: string) {
  return tenant.db.from('work_items').update({ status_id: toStatusId }).eq('id', workItemId);
}

describe('work item transitions', () => {
  beforeAll(async () => {
    if (!ANON_KEY || !SERVICE_ROLE_KEY) {
      throw new Error('SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY must be set.');
    }
    alice = await newTenant('tr-alice');
    bob = await newTenant('tr-bob');
  });

  it('freezes a type with no configured transitions', async () => {
    // Before anything is wired, nothing moves. The alternative reading — unconfigured means
    // unconstrained — would let I13 hold vacuously for every tenant who never configured a
    // transition, which is every tenant on their first day.
    const workItemId = await newWorkItem(alice);

    await expect(
      changeWorkItemStatus(alice.db, { workItemId, toStatusId: alice.done }),
    ).rejects.toMatchObject({ code: 'work_items.transition_not_allowed' });

    // And the same answer without the domain layer in the way.
    const { error } = await moveDirectly(alice, workItemId, alice.done);
    expect(error?.code).toBe('23514');
  });

  it('allows a move once it is configured', async () => {
    await createWorkItemTransition(alice.db, {
      organizationId: alice.organizationId,
      typeId: alice.typeId,
      fromStatusId: alice.open,
      toStatusId: alice.doing,
    });

    const workItemId = await newWorkItem(alice);
    await changeWorkItemStatus(alice.db, { workItemId, toStatusId: alice.doing });

    const items = await listWorkItems(alice.db, {
      organizationId: alice.organizationId,
      typeId: alice.typeId,
    });
    expect(items.find((i) => i.id === workItemId)?.status.label).toBe('In progress');
  });

  it('still refuses the move that was not configured (I13)', async () => {
    // Open → In progress is wired; Open → Done is not. Configuring one move must not open
    // the board, which is the failure mode of "an update policy would let it move anywhere".
    const workItemId = await newWorkItem(alice);

    await expect(
      changeWorkItemStatus(alice.db, { workItemId, toStatusId: alice.done }),
    ).rejects.toMatchObject({ code: 'work_items.transition_not_allowed' });

    const { error } = await moveDirectly(alice, workItemId, alice.done);
    expect(error?.code).toBe('23514');
  });

  it('is directional', async () => {
    // Open → In progress does not imply In progress → Open. A board where every arrow ran
    // both ways would be a board with no process in it.
    const workItemId = await newWorkItem(alice);
    await changeWorkItemStatus(alice.db, { workItemId, toStatusId: alice.doing });

    await expect(
      changeWorkItemStatus(alice.db, { workItemId, toStatusId: alice.open }),
    ).rejects.toMatchObject({ code: 'work_items.transition_not_allowed' });
  });

  it('refuses a move to the status the work item is already in', async () => {
    const workItemId = await newWorkItem(alice);

    await expect(
      changeWorkItemStatus(alice.db, { workItemId, toStatusId: alice.open }),
    ).rejects.toMatchObject({ code: 'work_items.transition_not_allowed' });
  });

  it('refuses a self-transition at configuration time', async () => {
    await expect(
      createWorkItemTransition(alice.db, {
        organizationId: alice.organizationId,
        typeId: alice.typeId,
        fromStatusId: alice.open,
        toStatusId: alice.open,
      }),
    ).rejects.toMatchObject({ code: 'transitions.self_transition' });

    // And in the database, which is where the guarantee lives — the domain check above only
    // buys the message.
    const { error } = await alice.db.from('work_item_transitions').insert({
      organization_id: alice.organizationId,
      type_id: alice.typeId,
      from_status_id: alice.open,
      to_status_id: alice.open,
      created_by: alice.userId,
    });
    expect(error?.code).toBe('23514');
  });

  it('refuses a duplicate transition (I2)', async () => {
    await expect(
      createWorkItemTransition(alice.db, {
        organizationId: alice.organizationId,
        typeId: alice.typeId,
        fromStatusId: alice.open,
        toStatusId: alice.doing,
      }),
    ).rejects.toMatchObject({ code: 'transitions.already_allowed' });
  });

  it('lets two tenants wire the same pair of statuses (I2)', async () => {
    // Both boards gain Open → In progress. If the unique index had lost its leading
    // organization_id, the second of these would fail.
    const theirs = await createWorkItemTransition(bob.db, {
      organizationId: bob.organizationId,
      typeId: bob.typeId,
      fromStatusId: bob.open,
      toStatusId: bob.doing,
    });
    expect(theirs).toBeTypeOf('string');
  });

  it('cannot wire a transition to another tenant\'s status (I18)', async () => {
    await expect(
      createWorkItemTransition(bob.db, {
        organizationId: bob.organizationId,
        typeId: bob.typeId,
        fromStatusId: bob.open,
        toStatusId: alice.done,
      }),
    ).rejects.toMatchObject({ code: 'transitions.status_not_found' });
  });

  it('cannot wire a transition across two of its own types (I20)', async () => {
    // Not a tenancy question: both statuses are Bob's, so RLS is satisfied and every
    // composite reference carrying only organization_id would pass. The third column is what
    // refuses it.
    const otherType = await createWorkItemType(bob.db, {
      organizationId: bob.organizationId,
      name: 'Installation',
    });
    const otherOpen = await createWorkItemStatus(bob.db, {
      organizationId: bob.organizationId,
      typeId: otherType,
      name: 'Open',
    });

    const { error } = await bob.db.from('work_item_transitions').insert({
      organization_id: bob.organizationId,
      type_id: bob.typeId,
      from_status_id: bob.open,
      to_status_id: otherOpen,
      created_by: bob.userId,
    });
    expect(error?.code).toBe('23503');
  });

  it('does not let one tenant\'s transitions authorize another tenant\'s move', async () => {
    // Alice has wired Open → In progress. Bob's board has statuses with the same names and,
    // as of the test above, the same wiring — but a work item of Bob's must be governed by
    // Bob's rows. Asserted by moving on a pair Alice allows and Bob does not.
    await createWorkItemTransition(alice.db, {
      organizationId: alice.organizationId,
      typeId: alice.typeId,
      fromStatusId: alice.doing,
      toStatusId: alice.done,
    });

    const workItemId = await createWorkItem(bob.db, {
      organizationId: bob.organizationId,
      title: 'Bob job',
      statusId: bob.doing,
    });

    await expect(
      changeWorkItemStatus(bob.db, { workItemId, toStatusId: bob.done }),
    ).rejects.toMatchObject({ code: 'work_items.transition_not_allowed' });
  });

  it('reports only the moves that are legal from where an item is', async () => {
    const transitions = await listWorkItemTransitions(alice.db, {
      organizationId: alice.organizationId,
      typeId: alice.typeId,
    });

    expect(allowedNextStatusIds(transitions, alice.open)).toEqual([alice.doing]);
    expect(allowedNextStatusIds(transitions, alice.doing)).toEqual([alice.done]);
    expect(allowedNextStatusIds(transitions, alice.done)).toEqual([]);
  });

  it('records the move on the timeline, naming both ends (I11)', async () => {
    const workItemId = await newWorkItem(alice);
    await changeWorkItemStatus(alice.db, { workItemId, toStatusId: alice.doing });

    const { data, error } = await alice.db
      .from('events')
      .select('action, actor_id, payload')
      .eq('organization_id', alice.organizationId)
      .eq('entity_id', workItemId)
      .eq('action', 'work_item.status_changed');

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].actor_id).toBe(alice.userId);
    expect(data![0].payload).toMatchObject({
      from_status_id: alice.open,
      to_status_id: alice.doing,
    });
  });

  it('refuses a move to a member without the capability (I12, I16)', async () => {
    const limited = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'No Moving',
      capabilities: ['role.manage', 'work_item.create'],
    });

    const workItemId = await createWorkItem(bob.db, {
      organizationId: bob.organizationId,
      title: 'Not yours to move',
      statusId: bob.open,
    });

    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();

    await assignRole(bob.db, { membershipId: membership!.id, roleId: limited });

    await expect(
      changeWorkItemStatus(bob.db, { workItemId, toStatusId: bob.doing }),
    ).rejects.toMatchObject({ code: 'work_items.transition_forbidden' });

    // The dangerous half. A denied UPDATE policy makes the row invisible to the statement
    // rather than raising, so a function that did not check `returning` would report success
    // and write a timeline entry for a move that never happened. Nothing moved:
    const { data: after } = await bob.db
      .from('work_items')
      .select('status_id')
      .eq('id', workItemId)
      .single();
    expect(after!.status_id).toBe(bob.open);

    const { data: events } = await bob.db
      .from('events')
      .select('id')
      .eq('entity_id', workItemId)
      .eq('action', 'work_item.status_changed');
    expect(events).toEqual([]);
  });

  it('lets a member without the capability change nothing else either', async () => {
    // Bob's founder still holds the limited role from the test above — `role.manage` and
    // `work_item.create`, and none of the three capabilities that reach this table.
    //
    // What stops them changed shape when `work_item.update` landed, and the assertion moved
    // with it rather than being relaxed. `title` used to be outside the column grant
    // altogether, so any caller got a bare privilege error; it is now grantable, and the
    // refusal comes from the `work_items_update` policy instead. That means no error at all:
    // a row an UPDATE policy denies is invisible to the statement rather than raising, which
    // is the silent shape `change_work_item_status` checks `returning` to catch. So the
    // assertion that carries the guarantee is the value.
    const { error } = await bob.db
      .from('work_items')
      .update({ title: 'Renamed by someone who may not' })
      .eq('organization_id', bob.organizationId);

    expect(error).toBeNull();

    const { data } = await bob.db
      .from('work_items')
      .select('title')
      .eq('organization_id', bob.organizationId);
    expect(data!.every((row) => row.title !== 'Renamed by someone who may not')).toBe(true);
  });

  it('refuses the title to a member who may transition but not edit', async () => {
    // The other half, and the one the per-column trigger exists for: this role passes the
    // policy — it holds `work_item.transition`, so it has a reason to be writing here — and
    // is refused the column anyway. A policy sees the old row or the new one but never both,
    // so only a trigger can say "you may change the status and not the title".
    const mover = await createRole(bob.db, {
      organizationId: bob.organizationId,
      name: 'Moves Only',
      capabilities: ['role.manage', 'work_item.create', 'work_item.transition'],
    });

    const { data: membership } = await bob.db
      .from('memberships')
      .select('id')
      .eq('organization_id', bob.organizationId)
      .single();
    await assignRole(bob.db, { membershipId: membership!.id, roleId: mover });

    const { error } = await bob.db
      .from('work_items')
      .update({ title: 'Renamed by a mover' })
      .eq('organization_id', bob.organizationId);

    expect(error).not.toBeNull();
    expect(error!.message).toContain('edit the details');
  });
});
